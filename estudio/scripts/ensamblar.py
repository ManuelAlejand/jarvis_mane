"""Ensambla el video final: clips + narración + subtítulos (+ música opcional).

Uso: python scripts/ensamblar.py proyectos/<id> [--sin-subtitulos]
Salida: final/video.mp4, final/subtitulos.srt, y la línea de tiempo en produccion.json.

Cada escena dura lo que dure su narración (+ un pequeño respiro). Si el clip de Kling es
más corto se repite en bucle; si es más largo se recorta.
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, env, ffmpeg, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion, resolucion, RAIZ)

RESPIRO = 0.35   # segundos de silencio al final de cada escena
FPS = 30


def ts(seg: float) -> str:
    ms = int(round(seg * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def trozos(texto: str, max_palabras: int) -> list[str]:
    palabras = texto.split()
    return [" ".join(palabras[i:i + max_palabras]) for i in range(0, len(palabras), max_palabras)]


def construir_srt(linea: list[dict], vertical: bool) -> str:
    """Reparte el texto de cada escena en bloques, proporcional al nº de caracteres."""
    bloques, i = [], 1
    for esc in linea:
        if not esc["narracion"].strip():
            continue
        partes = trozos(esc["narracion"], 5 if vertical else 9)
        total = sum(len(p) for p in partes) or 1
        t = esc["inicio"]
        dur_voz = esc["dur_audio"]
        for p in partes:
            d = dur_voz * len(p) / total
            bloques.append(f"{i}\n{ts(t)} --> {ts(t + d)}\n{p}\n")
            i += 1
            t += d
    return "\n".join(bloques)


def segmento(clip: Path, audio: Path | None, dur: float, w: int, h: int, destino: Path) -> None:
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
          f"fps={FPS},format=yuv420p,setsar=1")
    entradas = ["-stream_loop", "-1", "-i", str(clip)]
    if audio:
        entradas += ["-i", str(audio)]
        af = ["-af", f"apad=whole_dur={dur:.3f}", "-map", "0:v", "-map", "1:a"]
    else:
        entradas += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
        af = ["-map", "0:v", "-map", "1:a"]
    ffmpeg(*entradas, "-t", f"{dur:.3f}", "-vf", vf, *af,
           "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", str(destino))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    g = leer_json(proyecto / "guion.json")
    w, h = resolucion(g["aspect_ratio"])
    tmp = proyecto / "final" / "_segmentos"
    tmp.mkdir(parents=True, exist_ok=True)

    linea, t = [], 0.0
    for e in g["escenas"]:
        base = nombre_escena(e["n"])
        clip = proyecto / "clips" / f"{base}.mp4"
        if not clip.exists():
            sys.exit(f"ERROR: falta {clip}. Corre generar_clips.py primero.")
        audio = proyecto / "audio" / f"{base}.mp3"
        audio = audio if audio.exists() else None
        dur_audio = duracion(audio) if audio else 0.0
        dur = max(dur_audio + RESPIRO, 2.0) if audio else float(e["duracion_seg"])
        seg = tmp / f"{base}.mp4"
        print(f"Segmento {e['n']}: {dur:.1f}s", flush=True)
        segmento(clip, audio, dur, w, h, seg)
        real = duracion(seg)
        linea.append({"n": e["n"], "inicio": round(t, 3), "fin": round(t + real, 3),
                      "dur_audio": round(dur_audio, 3), "narracion": e["narracion"]})
        t += real

    lista = tmp / "lista.txt"
    lista.write_text("".join(f"file '{(tmp / (nombre_escena(e['n']) + '.mp4')).as_posix()}'\n"
                             for e in g["escenas"]), encoding="utf-8")
    unido = tmp / "unido.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(unido))

    srt = proyecto / "final" / "subtitulos.srt"
    srt.write_text(construir_srt(linea, g["aspect_ratio"] == "9:16"), encoding="utf-8")

    # Música de fondo opcional (solo pistas con licencia: assets/musica/*.mp3)
    pistas = sorted((RAIZ / "assets" / "musica").glob("*.mp3"))
    vol = env("VOLUMEN_MUSICA", "0.08")
    final = proyecto / "final" / "video.mp4"
    subs = "--sin-subtitulos" not in sys.argv
    tam_fuente = 13 if g["aspect_ratio"] == "9:16" else 20
    estilo = (f"FontName=Arial,FontSize={tam_fuente},PrimaryColour=&H00FFFFFF,"
              "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=60")
    # En Windows la ruta lleva "C:"; en los filtros de ffmpeg los dos puntos deben escaparse.
    ruta_srt = srt.as_posix().replace(":", r"\:").replace("'", r"\'")
    vf = ["-vf", f"subtitles='{ruta_srt}':force_style='{estilo}'"] if subs else []

    if pistas:
        musica = random.choice(pistas)
        ffmpeg("-i", str(unido), "-stream_loop", "-1", "-i", str(musica), *vf,
               "-filter_complex", f"[1:a]volume={vol}[m];[0:a][m]amix=inputs=2:duration=first:"
                                  "dropout_transition=2[a]",
               "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
               "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final))
    else:
        musica = None
        ffmpeg("-i", str(unido), *vf, "-c:v", "libx264", "-preset", "medium", "-crf", "20",
               "-c:a", "copy", "-movflags", "+faststart", str(final))

    registrar_produccion(proyecto, "ensamblado", {
        "video": str(final), "duracion_seg": round(duracion(final), 2),
        "resolucion": f"{w}x{h}", "subtitulos": subs,
        "musica": musica.name if musica else None, "linea_tiempo": linea,
    })
    print(f"Video final: {final} ({duracion(final):.1f}s)")


if __name__ == "__main__":
    main()
