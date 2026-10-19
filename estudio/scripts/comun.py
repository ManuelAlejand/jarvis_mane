"""Utilidades compartidas por los scripts del estudio."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def cargar_env() -> None:
    """Carga .env de la raíz del proyecto (sin dependencias externas)."""
    env = RAIZ / ".env"
    if not env.exists():
        return
    for linea in env.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def env(nombre: str, defecto: str | None = None, requerido: bool = False) -> str | None:
    cargar_env()
    valor = os.environ.get(nombre, defecto)
    if requerido and not valor:
        sys.exit(f"ERROR: falta la variable {nombre} en .env")
    return valor


def leer_json(ruta: Path) -> dict:
    return json.loads(Path(ruta).read_text(encoding="utf-8"))


def escribir_json(ruta: Path, datos: dict) -> None:
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def carpeta_proyecto(arg: str) -> Path:
    p = Path(arg).resolve()
    if p.is_file():
        p = p.parent
    if not (p / "guion.json").exists():
        sys.exit(f"ERROR: no hay guion.json en {p}")
    return p


def registrar_produccion(proyecto: Path, clave: str, valor) -> None:
    ruta = proyecto / "produccion.json"
    datos = leer_json(ruta) if ruta.exists() else {}
    datos[clave] = valor
    datos["actualizado"] = datetime.now().isoformat(timespec="seconds")
    escribir_json(ruta, datos)


def duracion(ruta: Path) -> float:
    """Duración en segundos de un archivo de audio/video (ffprobe)."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(ruta)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def ffmpeg(*args: str) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg falló: {' '.join(cmd)}\n{r.stderr[-2000:]}")


def resolucion(aspect_ratio: str) -> tuple[int, int]:
    return (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)


def nombre_escena(n: int) -> str:
    return f"escena_{n:02d}"
