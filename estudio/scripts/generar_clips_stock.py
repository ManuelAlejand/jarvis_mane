"""Modo gratis: un clip de stock vertical por escena desde Pexels (licencia libre, uso comercial).

Uso: python scripts/generar_clips_stock.py proyectos/<id> [--solo 3,4] [--forzar]
Salida: clips/escena_XX.mp4 y clips/stock.json (qué clip de Pexels se usó en cada escena).
Necesita PEXELS_API_KEY en .env (gratis en pexels.com/api).

Búsqueda por escena: `busqueda_stock` (inglés) → palabras clave de la idea → inicio de `prompt_visual`.
No repite un mismo clip dentro del video; con --forzar elige otro distinto al anterior.
"""
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, env, escribir_json, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion)

API = env("PEXELS_API_URL", "https://api.pexels.com/videos/search")  # se puede cambiar para pruebas


def buscar(clave: str, consulta: str, orientacion: str, pagina: int = 1) -> list[dict]:
    for intento in range(4):
        r = requests.get(
            API,
            headers={"Authorization": clave},
            params={"query": consulta, "orientation": orientacion, "size": "medium", "per_page": 15, "page": pagina},
            timeout=30,
        )
        if r.status_code == 200:
            return r.json().get("videos", [])
        if r.status_code == 429:
            time.sleep(10 * (intento + 1))
            continue
        raise RuntimeError(f"Pexels {r.status_code}: {r.text[:300]}")
    raise RuntimeError("Pexels: demasiados reintentos (límite de la API)")


def mejor_archivo(video: dict, vertical: bool) -> dict | None:
    """El archivo mp4 más cercano a 1080 px en el lado corto, sin pasar de 4K."""
    candidatos = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width") and f.get("height")]
    if vertical:
        candidatos = [f for f in candidatos if f["height"] >= f["width"]] or candidatos
    candidatos = [f for f in candidatos if min(f["width"], f["height"]) >= 720 and max(f["width"], f["height"]) <= 3840] or candidatos
    if not candidatos:
        return None
    return min(candidatos, key=lambda f: abs(min(f["width"], f["height"]) - 1080))


def consultas(g: dict, e: dict, idea: dict) -> list[str]:
    out = []
    if e.get("busqueda_stock"):
        out.append(e["busqueda_stock"])
    kws = idea.get("palabras_clave") or []
    if kws:
        out.append(" ".join(kws[:2]))
    pv = re.sub(r"[^A-Za-z ]", " ", e.get("prompt_visual", "")).split()
    if pv:
        out.append(" ".join(pv[:4]))
    if g.get("nicho"):
        out.append(str(g["nicho"]))
    vistos, limpias = set(), []
    for c in out:
        c = " ".join(c.split())[:80]
        if c and c.lower() not in vistos:
            vistos.add(c.lower())
            limpias.append(c)
    return limpias


def descargar(url: str, destino: Path) -> None:
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        tmp = destino.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(destino)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    forzar = "--forzar" in sys.argv
    solo = None
    if "--solo" in sys.argv:
        solo = {int(x) for x in sys.argv[sys.argv.index("--solo") + 1].split(",")}

    clave = env("PEXELS_API_KEY", requerido=True)
    g = leer_json(proyecto / "guion.json")
    idea = leer_json(proyecto / "nicho.json").get("idea", {}) if (proyecto / "nicho.json").exists() else {}
    vertical = g.get("aspect_ratio") == "9:16"
    orientacion = "portrait" if vertical else "landscape"

    clips = proyecto / "clips"
    clips.mkdir(exist_ok=True)
    ruta_reg = clips / "stock.json"
    registro = leer_json(ruta_reg) if ruta_reg.exists() else {}
    usados = {v["pexels_id"] for v in registro.values()}

    total = len(g["escenas"])
    faltan = []
    for i, e in enumerate(g["escenas"], 1):
        if solo and e["n"] not in solo:
            continue
        destino = clips / f"{nombre_escena(e['n'])}.mp4"
        if destino.exists() and not forzar:
            continue
        anterior = registro.get(str(e["n"]), {}).get("pexels_id")
        print(f"PROGRESO Clips {i}/{total}", flush=True)
        elegido = None
        for consulta in consultas(g, e, idea):
            for orient in (orientacion, None):  # si no hay vertical, se acepta horizontal y se recorta
                for v in buscar(clave, consulta, orient or "landscape"):
                    if v["id"] in usados or v["id"] == anterior:
                        continue
                    if v.get("duration", 0) < min(e["duracion_seg"], 4):
                        continue
                    f = mejor_archivo(v, vertical)
                    if f:
                        elegido = (v, f, consulta)
                        break
                if elegido:
                    break
            if elegido:
                break
        if not elegido:
            print(f"  escena {e['n']}: sin clip en Pexels", flush=True)
            faltan.append(e["n"])
            continue
        v, f, consulta = elegido
        descargar(f["link"], destino)
        usados.add(v["id"])
        registro[str(e["n"])] = {
            "pexels_id": v["id"], "url": v.get("url"), "autor": (v.get("user") or {}).get("name"),
            "consulta": consulta, "resolucion": f"{f['width']}x{f['height']}",
        }
        escribir_json(ruta_reg, registro)
        print(f"  escena {e['n']}: «{consulta}» → pexels {v['id']} ({f['width']}x{f['height']})", flush=True)

    registrar_produccion(proyecto, "clips", {"motor": "pexels", "faltantes": faltan, "licencia": "Pexels License (uso comercial, sin atribución obligatoria)"})
    if faltan:
        print(f"FALTAN clips de las escenas: {faltan}")
        sys.exit(1)
    print("Todos los clips listos.")


if __name__ == "__main__":
    main()
