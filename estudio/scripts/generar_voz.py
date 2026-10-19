"""Genera la narración de cada escena.

Uso: python scripts/generar_voz.py proyectos/<id> [--forzar]
Salida: audio/escena_XX.mp3 (una pista por escena). Reanudable.

Motor según VOZ_MOTOR en .env:
  kokoro      (por defecto) Kokoro-82M, local y gratuito, licencia Apache-2.0 (uso comercial permitido).
              Voces en español, inglés y portugués. Requiere espeak-ng instalado para es/pt.
  elevenlabs  API de pago (ELEVENLABS_API_KEY, ELEVENLABS_VOZ_ID).
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, env, ffmpeg, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion)
from texto_narracion import preparar  # noqa: E402 — "1,000" → "mil", "40 %" → "cuarenta por ciento"

# Código de idioma de Kokoro y voz por defecto (masculina) para cada idioma del guion
KOKORO_IDIOMA = {"es": "e", "en": "a", "pt": "p"}
KOKORO_VOZ = {"es": "em_alex", "en": "am_michael", "pt": "pm_alex"}

_pipelines: dict = {}


def tts_kokoro(texto: str, idioma: str, destino: Path) -> None:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    codigo = KOKORO_IDIOMA.get(idioma, "e")
    if codigo not in _pipelines:
        _pipelines[codigo] = KPipeline(lang_code=codigo)
    voz = env(f"KOKORO_VOZ_{idioma.upper()}", KOKORO_VOZ.get(idioma, "em_alex"))
    velocidad = float(env("KOKORO_VELOCIDAD", "1.0"))
    trozos = [audio for _, _, audio in _pipelines[codigo](texto, voice=voz, speed=velocidad)]
    if not trozos:
        raise RuntimeError("Kokoro no devolvió audio")
    wav = destino.with_suffix(".wav")
    sf.write(str(wav), np.concatenate([np.asarray(t) for t in trozos]), 24000)
    ffmpeg("-i", str(wav), "-ar", "44100", "-ac", "2", "-b:a", "192k", str(destino))
    wav.unlink(missing_ok=True)


def tts_elevenlabs(texto: str, voz: str, destino: Path) -> None:
    import requests

    clave = env("ELEVENLABS_API_KEY", requerido=True)
    cuerpo = {
        "text": texto,
        "model_id": env("ELEVENLABS_MODELO", "eleven_multilingual_v2"),
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.2},
    }
    for intento in range(4):
        r = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voz}",
            headers={"xi-api-key": clave, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            params={"output_format": "mp3_44100_128"},
            json=cuerpo, timeout=120,
        )
        if r.status_code == 200:
            destino.write_bytes(r.content)
            return
        if r.status_code in (429, 500, 502, 503):
            time.sleep(5 * (intento + 1))
            continue
        raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:500]}")
    raise RuntimeError("ElevenLabs: demasiados reintentos")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    forzar = "--forzar" in sys.argv
    g = leer_json(proyecto / "guion.json")
    motor = (env("VOZ_MOTOR", "kokoro") or "kokoro").lower()
    idioma = g.get("idioma", "es")
    voces = {p["id"]: p.get("voz_id") for p in g.get("personajes", [])}
    voz_eleven = env("ELEVENLABS_VOZ_ID") if motor == "elevenlabs" else None

    salida = proyecto / "audio"
    salida.mkdir(exist_ok=True)
    resumen = []
    total = len(g["escenas"])
    for i, e in enumerate(g["escenas"], 1):
        destino = salida / f"{nombre_escena(e['n'])}.mp3"
        texto = preparar(e["narracion"].strip(), idioma) if e["narracion"].strip() else ""
        if not texto:
            resumen.append({"n": e["n"], "estado": "sin_narracion"})
            continue
        if destino.exists() and not forzar:
            resumen.append({"n": e["n"], "estado": "existente", "seg": duracion(destino)})
            continue
        print(f"PROGRESO Voz {i}/{total}", flush=True)
        if motor == "elevenlabs":
            tts_elevenlabs(texto, voces.get(e.get("personaje") or "") or voz_eleven or "", destino)
        else:
            tts_kokoro(texto, idioma, destino)
        resumen.append({"n": e["n"], "estado": "generada", "seg": round(duracion(destino), 2)})

    registrar_produccion(proyecto, "voz", {"motor": motor, "escenas": resumen})
    print(f"Listo: {len(resumen)} escenas en {salida} (motor {motor})")


if __name__ == "__main__":
    main()
