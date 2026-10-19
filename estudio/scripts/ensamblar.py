"""Ensambla el video final: clips + narración + subtítulos palabra por palabra + música equilibrada.

Uso: python scripts/ensamblar.py proyectos/<id> [--sin-subtitulos]
Salida: final/video.mp4, final/subtitulos.srt (para YouTube), final/subtitulos.ass (los quemados)
y la línea de tiempo en produccion.json.

- Cada escena dura lo que dure su narración (+ un respiro). Si hay varios clips por escena
  (escena_XX.mp4, escena_XX_2.mp4…) se reparten el tiempo: cortes cada 2–3 s.
- Subtítulos estilo Shorts: 2–3 palabras por línea, la palabra que se dice resaltada.
  Los tiempos por palabra se estiman según la longitud de cada palabra dentro del audio de la escena.
- Música (assets/musica/*.mp3, solo pistas con licencia): baja sola cuando hay voz (ducking),
  entra y sale con fundido, y el audio final se normaliza a -14 LUFS (lo que usa YouTube).
"""
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, env, ffmpeg, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion, resolucion, RAIZ)

RESPIRO = 0.35   # segundos de silencio al final de cada escena
FPS = 30


# ------------------------------------------------------------------ subtítulos

def ts_srt(seg: float) -> str:
    ms = int(round(seg * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def ts_ass(seg: float) -> str:
    cs = int(round(seg * 100))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6_000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def palabras_con_tiempo(linea: list[dict]) -> list[list[tuple[str, float, float]]]:
    """Por escena: (palabra, inicio, fin) estimados; cada palabra pesa según sus letras (+1 por la pausa)."""
    out = []
    for esc in linea:
        frase = []
        palabras = esc["narracion"].split()
        if not palabras or esc["dur_audio"] <= 0:
            continue
        pesos = [len(re.sub(r"\W", "", p)) + 1 for p in palabras]
        total = sum(pesos)
        t = esc["inicio"]
        for p, w in zip(palabras, pesos):
            d = esc["dur_audio"] * w / total
            frase.append((p, t, t + d))
            t += d
        out.append(frase)
    return out


def lineas(escenas: list[list[tuple[str, float, float]]], por_linea: int) -> list[list[tuple[str, float, float]]]:
    """Agrupa palabras en líneas sin mezclar escenas; evita dejar una palabra sola al final."""
    out = []
    for frase in escenas:
        grupos = [frase[i:i + por_linea] for i in range(0, len(frase), por_linea)]
        if len(grupos) > 1 and len(grupos[-1]) == 1:
            grupos[-2] += grupos.pop()
        out += grupos
    return out


def construir_srt(escenas: list[list[tuple[str, float, float]]], por_linea: int) -> str:
    bloques = []
    for grupo in lineas(escenas, por_linea):
        bloques.append(f"{len(bloques) + 1}\n{ts_srt(grupo[0][1])} --> {ts_srt(grupo[-1][2])}\n{' '.join(p for p, _, _ in grupo)}\n")
    return "\n".join(bloques)


def construir_ass(escenas: list[list[tuple[str, float, float]]], w: int, h: int, vertical: bool) -> str:
    """Karaoke: cada línea muestra 2–3 palabras; la que suena pasa a amarillo (\\k)."""
    tam = 96 if vertical else 64
    margen = int(h * 0.30) if vertical else 70
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Arial Black,{tam},&H0000E5FF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,3,2,60,60,{margen},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    por_linea = 3 if vertical else 6
    eventos = []
    for grupo in lineas(escenas, por_linea):
        inicio, fin = grupo[0][1], grupo[-1][2]
        partes = []
        for p, a, b in grupo:
            cs = max(1, int(round((b - a) * 100)))
            limpio = p.replace("{", "(").replace("}", ")")
            partes.append(f"{{\\k{cs}}}{limpio.upper() if vertical else limpio}")
        eventos.append(f"Dialogue: 0,{ts_ass(inicio)},{ts_ass(fin)},Karaoke,,0,0,0,,{' '.join(partes)}")
    return cab + "\n".join(eventos) + "\n"


def ruta_filtro(p: Path) -> str:
    """En Windows la ruta lleva "C:"; en los filtros de ffmpeg los dos puntos deben escaparse."""
    return p.as_posix().replace(":", r"\:").replace("'", r"\'")


# ------------------------------------------------------------------ video

def clips_de_escena(proyecto: Path, n: int) -> list[Path]:
    base = nombre_escena(n)
    principal = proyecto / "clips" / f"{base}.mp4"
    extra = sorted(proyecto.glob(f"clips/{base}_*.mp4"), key=lambda p: p.stem)
    return [principal, *[p for p in extra if not p.name.endswith(".part")]] if principal.exists() else []


def segmento(clips: list[Path], audio: Path | None, dur: float, w: int, h: int, destino: Path) -> None:
    """Une los clips de la escena repartiendo el tiempo (cortes rápidos) y pone la narración debajo."""
    k = len(clips)
    parte = dur / k
    entradas, filtros = [], []
    for i, c in enumerate(clips):
        # Arranca un poco dentro del clip (evita fundidos de entrada del stock) y repite si es corto
        entradas += ["-stream_loop", "-1", "-ss", "0.4", "-t", f"{parte + 0.05:.3f}", "-i", str(c)]
        filtros.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
                       f"fps={FPS},format=yuv420p,setsar=1,trim=duration={parte:.3f},setpts=PTS-STARTPTS[v{i}]")
    filtros.append("".join(f"[v{i}]" for i in range(k)) + f"concat=n={k}:v=1:a=0[v]")
    if audio:
        entradas += ["-i", str(audio)]
        filtros.append(f"[{k}:a]apad=whole_dur={dur:.3f}[a]")
    else:
        entradas += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
        filtros.append(f"[{k}:a]anull[a]")
    ffmpeg(*entradas, "-filter_complex", ";".join(filtros), "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", str(destino))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    g = leer_json(proyecto / "guion.json")
    w, h = resolucion(g["aspect_ratio"])
    vertical = g["aspect_ratio"] == "9:16"
    tmp = proyecto / "final" / "_segmentos"
    tmp.mkdir(parents=True, exist_ok=True)

    linea, t = [], 0.0
    for e in g["escenas"]:
        base = nombre_escena(e["n"])
        clips = clips_de_escena(proyecto, e["n"])
        if not clips:
            sys.exit(f"ERROR: falta clips/{base}.mp4. Genera los clips primero.")
        audio = proyecto / "audio" / f"{base}.mp3"
        audio = audio if audio.exists() else None
        dur_audio = duracion(audio) if audio else 0.0
        dur = max(dur_audio + RESPIRO, 2.0) if audio else float(e["duracion_seg"])
        # Un corte extra solo si cada parte dura al menos ~1,6 s
        clips = clips[:max(1, min(len(clips), int(dur // 1.6)))]
        seg = tmp / f"{base}.mp4"
        print(f"PROGRESO Montaje {e['n']}/{len(g['escenas'])}", flush=True)
        segmento(clips, audio, dur, w, h, seg)
        real = duracion(seg)
        linea.append({"n": e["n"], "inicio": round(t, 3), "fin": round(t + real, 3), "clips": len(clips),
                      "dur_audio": round(dur_audio, 3), "narracion": e["narracion"]})
        t += real

    lista = tmp / "lista.txt"
    lista.write_text("".join(f"file '{(tmp / (nombre_escena(e['n']) + '.mp4')).as_posix()}'\n"
                             for e in g["escenas"]), encoding="utf-8")
    unido = tmp / "unido.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(unido))
    total = duracion(unido)

    palabras = palabras_con_tiempo(linea)
    srt = proyecto / "final" / "subtitulos.srt"
    srt.write_text(construir_srt(palabras, 4 if vertical else 8), encoding="utf-8")
    ass = proyecto / "final" / "subtitulos.ass"
    ass.write_text(construir_ass(palabras, w, h, vertical), encoding="utf-8")
    subs = "--sin-subtitulos" not in sys.argv
    filtro_v = f"ass='{ruta_filtro(ass)}'" if subs else "null"

    # Música: solo pistas con licencia en assets/musica (ver assets/musica/LEEME.md)
    pistas = sorted((RAIZ / "assets" / "musica").glob("*.mp3"))
    musica = random.choice(pistas) if pistas else None
    vol = float(env("VOLUMEN_MUSICA", "0.35"))  # nivel de la música SIN voz; con voz baja más por el ducking
    final = proyecto / "final" / "video.mp4"
    salida_audio = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    if musica:
        fade_out = max(0.0, total - 2.0)
        filtro = (
            f"[0:v]{filtro_v}[vout];"
            f"[0:a]asplit=2[voz][ref];"
            f"[1:a]volume={vol},afade=t=in:d=1.5,afade=t=out:st={fade_out:.2f}:d=2[mus];"
            # La música se comprime cuando la voz suena (sidechain): queda de fondo y vuelve en las pausas
            f"[mus][ref]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350:makeup=1[musduck];"
            f"[voz][musduck]amix=inputs=2:duration=first:normalize=0,"
            f"loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
        )
        ffmpeg("-i", str(unido), "-stream_loop", "-1", "-i", str(musica), "-filter_complex", filtro,
               "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium",
               "-crf", "20", *salida_audio, "-movflags", "+faststart", str(final))
    else:
        ffmpeg("-i", str(unido), "-filter_complex", f"[0:v]{filtro_v}[vout];[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]",
               "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
               *salida_audio, "-movflags", "+faststart", str(final))

    registrar_produccion(proyecto, "ensamblado", {
        "video": str(final), "duracion_seg": round(duracion(final), 2),
        "resolucion": f"{w}x{h}", "subtitulos": "karaoke" if subs else None,
        "musica": musica.name if musica else None, "cortes": sum(x["clips"] for x in linea), "linea_tiempo": linea,
    })
    print(f"Video final: {final} ({duracion(final):.1f}s, {sum(x['clips'] for x in linea)} cortes"
          f"{', música ' + musica.name if musica else ', sin música (agrega pistas en assets/musica)'})")


if __name__ == "__main__":
    main()
