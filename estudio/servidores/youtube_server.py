"""Servidor MCP de YouTube para el estudio (YouTube Data API v3).

Herramientas: verificar_conexion, subir_video, subir_miniatura, estado_video.

Salvaguardas incorporadas:
- Rechaza subir si el reporte de validación no dice "APROBADO".
- Fuerza privacidad "private"/"unlisted" salvo que PERMITIR_PUBLICO=1 en .env.
- Marca containsSyntheticMedia (divulgación de contenido alterado/sintético).

Autorización (una sola vez): python scripts/autorizar_youtube.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
from comun import cargar_env  # noqa: E402

try:  # SDK de MCP 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP  # noqa: E402
except ImportError:  # SDK de MCP 1.x
    from mcp.server.fastmcp import FastMCP  # noqa: E402

cargar_env()
TOKEN = RAIZ / os.environ.get("YOUTUBE_TOKEN", "credenciales/token.json")
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]

mcp = FastMCP("youtube")


def _cliente():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not TOKEN.exists():
        raise RuntimeError("No hay token. Ejecuta: python scripts/autorizar_youtube.py")
    cred = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not cred.valid:
        if cred.expired and cred.refresh_token:
            cred.refresh(Request())
            TOKEN.write_text(cred.to_json(), encoding="utf-8")
        else:
            raise RuntimeError("Token inválido. Vuelve a ejecutar scripts/autorizar_youtube.py")
    return build("youtube", "v3", credentials=cred, cache_discovery=False)


@mcp.tool()
def verificar_conexion() -> str:
    """Comprueba la autorización y devuelve el canal conectado."""
    try:
        yt = _cliente()
        r = yt.channels().list(part="snippet,statistics", mine=True).execute()
        if not r.get("items"):
            return "ERROR: la cuenta autorizada no tiene canal de YouTube."
        c = r["items"][0]
        return json.dumps({"ok": True, "canal": c["snippet"]["title"], "id": c["id"],
                           "suscriptores": c["statistics"].get("subscriberCount")},
                          ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return f"ERROR: {e}"


@mcp.tool()
def subir_video(ruta_video: str, titulo: str, descripcion: str, tags: list[str],
                categoria_id: str, ruta_reporte: str, idioma: str = "es",
                privacidad: str = "private", contenido_sintetico: bool = True,
                para_ninos: bool = False) -> str:
    """Sube un video a YouTube (subida reanudable).

    ruta_reporte: reporte_validacion.json del proyecto; debe tener veredicto APROBADO.
    privacidad: private | unlisted (public solo si PERMITIR_PUBLICO=1).
    """
    from googleapiclient.http import MediaFileUpload

    video = Path(ruta_video)
    if not video.exists():
        return f"ERROR: no existe {video}"
    try:
        rep = json.loads(Path(ruta_reporte).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return f"ERROR: no se pudo leer el reporte de validación ({e}). No se sube."
    if rep.get("veredicto") != "APROBADO":
        return f"BLOQUEADO: el veredicto es '{rep.get('veredicto')}'. Solo se sube con APROBADO."

    if privacidad == "public" and os.environ.get("PERMITIR_PUBLICO") != "1":
        privacidad = "private"
    if privacidad not in ("private", "unlisted", "public"):
        privacidad = "private"

    cuerpo = {
        "snippet": {"title": titulo[:100], "description": descripcion[:5000],
                    "tags": tags[:30], "categoryId": str(categoria_id),
                    "defaultLanguage": idioma, "defaultAudioLanguage": idioma},
        "status": {"privacyStatus": privacidad, "selfDeclaredMadeForKids": para_ninos,
                   "containsSyntheticMedia": contenido_sintetico, "embeddable": True},
    }
    try:
        yt = _cliente()
        media = MediaFileUpload(str(video), mimetype="video/mp4", chunksize=8 * 1024 * 1024,
                                resumable=True)
        req = yt.videos().insert(part="snippet,status", body=cuerpo, media_body=media)
        resp = None
        while resp is None:
            _, resp = req.next_chunk()
        vid = resp["id"]
        return json.dumps({"ok": True, "video_id": vid, "privacidad": privacidad,
                           "url": f"https://youtu.be/{vid}",
                           "studio": f"https://studio.youtube.com/video/{vid}/edit",
                           "contenido_sintetico": contenido_sintetico}, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return f"ERROR al subir: {e}"


@mcp.tool()
def subir_miniatura(video_id: str, ruta_imagen: str) -> str:
    """Asigna una miniatura (JPG/PNG, ≤ 2 MB, idealmente 1280x720). Requiere canal verificado."""
    from googleapiclient.http import MediaFileUpload

    img = Path(ruta_imagen)
    if not img.exists():
        return f"ERROR: no existe {img}"
    try:
        mime = "image/png" if img.suffix.lower() == ".png" else "image/jpeg"
        _cliente().thumbnails().set(videoId=video_id,
                                    media_body=MediaFileUpload(str(img), mimetype=mime)).execute()
        return json.dumps({"ok": True, "video_id": video_id})
    except Exception as e:  # noqa: BLE001
        return f"ERROR: {e}"


@mcp.tool()
def estado_video(video_id: str) -> str:
    """Estado de procesamiento, privacidad y posibles rechazos de un video subido."""
    try:
        r = _cliente().videos().list(part="status,processingDetails,snippet",
                                     id=video_id).execute()
        if not r.get("items"):
            return "ERROR: video no encontrado"
        v = r["items"][0]
        return json.dumps({"titulo": v["snippet"]["title"], "status": v["status"],
                           "procesamiento": v.get("processingDetails", {})},
                          ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        return f"ERROR: {e}"


if __name__ == "__main__":
    mcp.run()
