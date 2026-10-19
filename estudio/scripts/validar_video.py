"""Validación técnica del video final y los Shorts con ffprobe/ffmpeg.

Uso: python scripts/validar_video.py proyectos/<id> [--fotogramas N]
Revisa: pistas de audio/video, resolución, duración vs narración, frames negros,
silencios largos, subtítulos, Shorts (≤ 3 min y vertical). Con --fotogramas extrae N
imágenes a qa/ para revisión visual.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, escribir_json, ffmpeg,  # noqa: E402
                   leer_json, resolucion)


def streams(ruta: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(ruta)],
                       capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)["streams"]
    v = next((x for x in s if x["codec_type"] == "video"), None)
    a = next((x for x in s if x["codec_type"] == "audio"), None)
    return {"video": v, "audio": a}


def detectar(ruta: Path, filtro: str, patron: str) -> list[tuple[float, float]]:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(ruta), "-af" if "silence" in filtro
                        else "-vf", filtro, "-f", "null", "-"], capture_output=True, text=True)
    return [(float(a), float(b)) for a, b in re.findall(patron, r.stderr)]


def revisar(ruta: Path, esperado_wh: tuple[int, int] | None, max_dur: float | None) -> dict:
    errores, avisos = [], []
    if not ruta.exists():
        return {"archivo": str(ruta), "errores": ["no existe"], "advertencias": []}
    st = streams(ruta)
    dur = duracion(ruta)
    if not st["video"]:
        errores.append("sin pista de video")
    if not st["audio"]:
        errores.append("sin pista de audio")
    if st["video"]:
        wh = (st["video"]["width"], st["video"]["height"])
        if esperado_wh and wh != esperado_wh:
            errores.append(f"resolución {wh[0]}x{wh[1]}, se esperaba {esperado_wh[0]}x{esperado_wh[1]}")
        if st["video"].get("codec_name") != "h264":
            avisos.append(f"códec {st['video'].get('codec_name')} (YouTube prefiere h264)")
    if max_dur and dur > max_dur:
        errores.append(f"dura {dur:.1f}s > {max_dur}s")

    negros = detectar(ruta, "blackdetect=d=0.8:pix_th=0.10",
                      r"black_start:([\d.]+) black_end:([\d.]+)")
    for a, b in negros:
        (errores if b - a > 2.5 else avisos).append(f"pantalla negra {a:.1f}s–{b:.1f}s")

    silencios = []
    if st["audio"]:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(ruta), "-af",
                            "silencedetect=noise=-45dB:d=2.5", "-f", "null", "-"],
                           capture_output=True, text=True)
        ini = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
        fin = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
        silencios = list(zip(ini, fin + [dur] * (len(ini) - len(fin))))
        for a, b in silencios:
            avisos.append(f"silencio {a:.1f}s–{b:.1f}s ({b - a:.1f}s)")
        if silencios and sum(b - a for a, b in silencios) > dur * 0.3:
            errores.append("más del 30% del video está en silencio")

    return {"archivo": str(ruta), "duracion_seg": round(dur, 2), "errores": errores,
            "advertencias": avisos}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    g = leer_json(proyecto / "guion.json")
    final = proyecto / "final" / "video.mp4"
    res = {"video": revisar(final, resolucion(g["aspect_ratio"]), None), "shorts": []}

    prod = proyecto / "produccion.json"
    if prod.exists() and final.exists():
        p = leer_json(prod)
        reg_voz = p.get("voz", [])
        escenas_voz = reg_voz.get("escenas", []) if isinstance(reg_voz, dict) else reg_voz
        voz = sum(x.get("seg", 0) for x in escenas_voz)
        if voz and abs(res["video"]["duracion_seg"] - voz) > max(5.0, voz * 0.25):
            res["video"]["advertencias"].append(
                f"duración {res['video']['duracion_seg']}s muy distinta a la narración ({voz:.1f}s)")
        faltan = p.get("clips", {}).get("faltantes")
        if faltan:
            res["video"]["errores"].append(f"clips faltantes: {faltan}")
    if not (proyecto / "final" / "subtitulos.srt").exists():
        res["video"]["advertencias"].append("sin archivo de subtítulos")

    for s in sorted((proyecto / "shorts").glob("short_*.mp4")):
        res["shorts"].append(revisar(s, (1080, 1920), 180.0))

    if "--fotogramas" in sys.argv and final.exists():
        n = int(sys.argv[sys.argv.index("--fotogramas") + 1])
        qa = proyecto / "qa"
        qa.mkdir(exist_ok=True)
        dur = res["video"]["duracion_seg"]
        res["fotogramas"] = []
        for i in range(n):
            t = dur * (i + 0.5) / n
            img = qa / f"fotograma_{i + 1:02d}_{int(t)}s.jpg"
            ffmpeg("-ss", f"{t:.2f}", "-i", str(final), "-frames:v", "1", "-q:v", "3",
                   "-vf", "scale=960:-2", str(img))
            res["fotogramas"].append(str(img))

    todos = [res["video"]] + res["shorts"]
    res["ok"] = all(not x["errores"] for x in todos)
    escribir_json(proyecto / "qa" / "validacion_video.json", res)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
