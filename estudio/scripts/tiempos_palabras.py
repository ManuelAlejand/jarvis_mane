"""Tiempos reales de cada palabra de la narración, escuchando el audio (faster-whisper, licencia MIT).

Los subtítulos usan el TEXTO del guion (bien escrito) con los TIEMPOS que detecta Whisper en el audio:
se alinean las dos secuencias de palabras y las que no coinciden se interpolan entre vecinas.
Si faster-whisper no está instalado o falla, devuelve None y el montaje usa la estimación por letras.

Modelo: WHISPER_MODELO en .env (por defecto "base": ~140 MB, rápido en GPU y aceptable en CPU).
"""
from __future__ import annotations

import difflib
import re
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
        try:
            _modelo = WhisperModel(nombre, device="cuda", compute_type="float16")
        except Exception:  # noqa: BLE001 — sin GPU/CUDA: CPU
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


def tiempos_escena(audio: Path, texto: str, idioma: str, dur: float) -> list[tuple[str, float, float]] | None:
    """(palabra del guion, inicio, fin) relativos al inicio del audio de la escena; None si no hay Whisper."""
    if (env("SUBTITULOS_SINCRONIA", "whisper") or "whisper").lower() != "whisper":
        return None
    try:
        modelo = _cargar()
        segmentos, _ = modelo.transcribe(str(audio), language=idioma, word_timestamps=True, vad_filter=False,
                                         beam_size=1, condition_on_previous_text=False)
        oidas = [(w.word.strip(), float(w.start), float(w.end)) for s in segmentos for w in (s.words or [])]
    except Exception as e:  # noqa: BLE001
        print(f"  (Whisper no disponible: {type(e).__name__}; subtítulos con tiempos estimados)", flush=True)
        return None
    if not oidas:
        return None
    return alinear(texto.split(), oidas, dur)


if __name__ == "__main__":
    # Prueba de alineación sin modelo: el guion dice "1,000" y Whisper oye "mil"
    guion = "Bajas 1,000 metros y el sol deja de existir.".split()
    oidas = [("Bajas", 0.10, 0.42), ("mil", 0.50, 0.71), ("metros", 0.74, 1.10), ("y", 1.30, 1.36), ("el", 1.38, 1.47),
             ("sol", 1.50, 1.80), ("deja", 1.85, 2.10), ("de", 2.12, 2.20), ("existir.", 2.22, 2.90)]
    for p, a, b in alinear(guion, oidas, 3.0):
        print(f"{a:5.2f}–{b:5.2f}  {p}")
