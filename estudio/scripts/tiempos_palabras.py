"""Tiempos reales de cada palabra de la narración, escuchando el audio (faster-whisper, licencia MIT).

Los subtítulos usan el TEXTO del guion (bien escrito) con los TIEMPOS que detecta Whisper en el audio:
se alinean las dos secuencias de palabras y las que no coinciden se interpolan entre vecinas.
Si faster-whisper no está instalado o falla, devuelve None y el montaje usa la estimación por letras.

Modelo: WHISPER_MODELO en .env (por defecto "base": ~140 MB). Dispositivo: WHISPER_DISPOSITIVO (cpu por defecto:
en Windows la GPU de faster-whisper necesita DLLs de CUDA aparte y puede colgarse; en CPU tarda ~10 s por video).
Whisper corre en un PROCESO APARTE con tiempo límite (WHISPER_TIMEOUT_SEG): si se cuelga o se cierra, el montaje sigue
con tiempos estimados en vez de quedarse esperando.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from comun import env

_modelo = None


def _norm(p: str) -> str:
    p = unicodedata.normalize("NFD", p.lower())
    return re.sub(r"[^a-z0-9ñ]", "", "".join(c for c in p if unicodedata.category(c) != "Mn"))


def _cargar():
    global _modelo
    if _modelo is None:
        from faster_whisper import WhisperModel
        nombre = env("WHISPER_MODELO", "base") or "base"
        if (env("WHISPER_DISPOSITIVO", "cpu") or "cpu").lower() == "cuda":
            try:
                _modelo = WhisperModel(nombre, device="cuda", compute_type="float16")
                return _modelo
            except Exception:  # noqa: BLE001 — sin DLLs de CUDA: CPU
                pass
        _modelo = WhisperModel(nombre, device="cpu", compute_type="int8")
    return _modelo


def alinear(guion: list[str], oidas: list[tuple[str, float, float]], dur: float) -> list[tuple[str, float, float]]:
    """Asigna a cada palabra del guion el tiempo de la palabra oída que le corresponde."""
    a = [_norm(p) for p in guion]
    b = [_norm(p) for p, _, _ in oidas]
    tiempos: list[tuple[float, float] | None] = [None] * len(guion)
    for bloque in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
        for k in range(bloque.size):
            _, ini, fin = oidas[bloque.b + k]
            tiempos[bloque.a + k] = (ini, fin)
    # Interpolar las que no coincidieron (números escritos distinto, nombres raros…)
    i = 0
    while i < len(guion):
        if tiempos[i] is not None:
            i += 1
            continue
        j = i
        while j < len(guion) and tiempos[j] is None:
            j += 1
        desde = tiempos[i - 1][1] if i > 0 else (oidas[0][1] if oidas else 0.0)
        hasta = tiempos[j][0] if j < len(guion) else max(desde, oidas[-1][2] if oidas else dur)
        if hasta <= desde:
            hasta = desde + 0.25 * (j - i)
        paso = (hasta - desde) / (j - i)
        for k in range(i, j):
            tiempos[k] = (desde + paso * (k - i), desde + paso * (k - i + 1))
        i = j
    return [(p, t[0], t[1]) for p, t in zip(guion, tiempos)]  # type: ignore[index]


def _oir(audio: str, idioma: str) -> list[tuple[str, float, float]]:
    segmentos, _ = _cargar().transcribe(audio, language=idioma, word_timestamps=True, vad_filter=False,
                                        beam_size=1, condition_on_previous_text=False)
    return [(w.word.strip(), float(w.start), float(w.end)) for s in segmentos for w in (s.words or [])]


def tiempos_todas(escenas: list[tuple[Path, str, float]], idioma: str) -> list[list[tuple[str, float, float]] | None] | None:
    """Para cada (audio, texto, duración): palabras del guion con tiempos reales. None si Whisper no está o falla.

    Corre en un proceso aparte con tiempo límite: un cuelgue o cierre de Whisper no detiene el montaje.
    """
    if (env("SUBTITULOS_SINCRONIA", "whisper") or "whisper").lower() != "whisper" or not escenas:
        return None
    limite = int(env("WHISPER_TIMEOUT_SEG", "300") or 300)
    entrada = json.dumps({"idioma": idioma, "audios": [str(a) for a, _, _ in escenas]})
    try:
        r = subprocess.run([sys.executable, __file__, "--oir"], input=entrada, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=limite, cwd=Path(__file__).parent,
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except subprocess.TimeoutExpired:
        print(f"  (Whisper tardó más de {limite} s; subtítulos con tiempos estimados)", flush=True)
        return None
    marca = next((l for l in reversed(r.stdout.splitlines()) if l.startswith("OIDAS ")), None)
    if r.returncode != 0 or not marca:
        print(f"  (Whisper no disponible, código {r.returncode}: {(r.stderr or r.stdout)[-200:].strip()}; "
              "subtítulos con tiempos estimados)", flush=True)
        return None
    oidas_por_escena = json.loads(marca[6:])
    out: list[list[tuple[str, float, float]] | None] = []
    for (_, texto, dur), oidas in zip(escenas, oidas_por_escena):
        out.append(alinear(texto.split(), [tuple(o) for o in oidas], dur) if oidas else None)
    return out


def _proceso_oir() -> None:
    datos = json.loads(sys.stdin.read())
    res = [_oir(a, datos["idioma"]) for a in datos["audios"]]
    print("OIDAS " + json.dumps(res), flush=True)
    os._exit(0)  # salir sin liberar el modelo: en Windows a veces se cuelga al cerrarlo


if __name__ == "__main__" and "--oir" in sys.argv:
    _proceso_oir()
elif __name__ == "__main__":
    # Prueba de alineación sin modelo: el guion dice "1,000" y Whisper oye "mil"
    guion = "Bajas 1,000 metros y el sol deja de existir.".split()
    oidas = [("Bajas", 0.10, 0.42), ("mil", 0.50, 0.71), ("metros", 0.74, 1.10), ("y", 1.30, 1.36), ("el", 1.38, 1.47),
             ("sol", 1.50, 1.80), ("deja", 1.85, 2.10), ("de", 2.12, 2.20), ("existir.", 2.22, 2.90)]
    for p, a, b in alinear(guion, oidas, 3.0):
        print(f"{a:5.2f}–{b:5.2f}  {p}")
