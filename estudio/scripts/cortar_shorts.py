"""Corta Shorts verticales (9:16, ≤ 59 s) a partir de NUESTRO video final.

Uso: python scripts/cortar_shorts.py proyectos/<id>
Usa `clips_short` del guion y la línea de tiempo de produccion.json.
Si el video es 16:9, coloca el cuadro centrado sobre un fondo desenfocado del mismo video.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, ffmpeg, leer_json,  # noqa: E402
                   registrar_produccion)

MAX_SHORT = 59.0


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    g = leer_json(proyecto / "guion.json")
    prod = leer_json(proyecto / "produccion.json")
    linea = {x["n"]: x for x in prod["ensamblado"]["linea_tiempo"]}
    video = proyecto / "final" / "video.mp4"
    salida = proyecto / "shorts"
    salida.mkdir(exist_ok=True)

    vertical = g["aspect_ratio"] == "9:16"
    vf = ("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" if vertical else
          "split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,"
          "crop=1080:1920,boxblur=25:2,eq=brightness=-0.15[fondo];"
          "[b]scale=1080:-2[frente];[fondo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1")

    hechos = []
    for i, c in enumerate(g.get("clips_short", []), 1):
        a, b = linea.get(c["desde_escena"]), linea.get(c["hasta_escena"])
        if not a or not b or b["fin"] <= a["inicio"]:
            hechos.append({"i": i, "estado": "rango_invalido", "clip": c})
            continue
        ini, fin = a["inicio"], min(b["fin"], a["inicio"] + MAX_SHORT)
        destino = salida / f"short_{i}.mp4"
        ffmpeg("-ss", f"{ini:.3f}", "-i", str(video), "-t", f"{fin - ini:.3f}",
               "-filter_complex" if not vertical else "-vf", vf,
               "-c:v", "libx264", "-preset", "medium", "-crf", "20",
               "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(destino))
        hechos.append({"i": i, "estado": "ok", "archivo": str(destino), "titulo": c["titulo"],
                       "duracion_seg": round(duracion(destino), 2),
                       "recortado": (b["fin"] - a["inicio"]) > MAX_SHORT})
        print(f"Short {i}: {destino.name} ({fin - ini:.1f}s)")

    registrar_produccion(proyecto, "shorts", hechos)
    if not hechos:
        print("El guion no define clips_short.")


if __name__ == "__main__":
    main()
