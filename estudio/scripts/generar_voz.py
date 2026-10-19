"""Genera la narración de cada escena.

Uso: python scripts/generar_voz.py proyectos/<id> [--forzar]
Salida: audio/escena_XX.mp3 (una pista por escena). Reanudable.

Motor según VOZ_MOTOR en .env:
  chatterbox  Chatterbox Multilingual V3 (Resemble AI, licencia MIT): la más natural, usa la GPU.
              Si no está instalado o falla, se usa Kokoro automáticamente.
  kokoro      Kokoro-82M, local y gratuito, licencia Apache-2.0. Requiere espeak-ng para es/pt.
  elevenlabs  API de pago (ELEVENLABS_API_KEY, ELEVENLABS_VOZ_ID).
Antes de sintetizar, el texto pasa por texto_narracion.preparar ("1,000" → "mil").

Control de calidad (Chatterbox): Whisper escucha cada escena y la compara con el guion. Si repite palabras
("de de de"), se salta texto o deja silencios largos, la escena se regenera con otros ajustes (hasta
VOZ_REINTENTOS veces). Si aun así falla, TODA la narración se rehace con Kokoro para que la voz sea una sola.
Al final se acortan las pausas largas (> 0,4 s) que dejan los motores de voz.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, duracion, env, ffmpeg, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion)
from texto_narracion import preparar  # noqa: E402 — "1,000" → "mil", "40 %" → "cuarenta por ciento"
from tiempos_palabras import oir_archivos, revisar_locucion  # noqa: E402 — control de calidad con Whisper

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


_chatterbox = None


# Ajustes por intento: el 1.º usa los del .env; si sale mal, se prueba más estable (menos expresivo, más guiado)
AJUSTES_REINTENTO = [None, (0.5, 0.5), (0.4, 0.6), (0.35, 0.7)]


def tts_chatterbox(texto: str, idioma: str, destino: Path, intento: int = 0) -> None:
    """Chatterbox Multilingual V3 (Resemble AI, MIT): voz más natural y expresiva, en la GPU."""
    global _chatterbox
    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    if _chatterbox is None:
        dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            _chatterbox = ChatterboxMultilingualTTS.from_pretrained(device=dispositivo, t3_model="v3")
        except TypeError:  # versiones sin el parámetro t3_model
            _chatterbox = ChatterboxMultilingualTTS.from_pretrained(device=dispositivo)
        print(f"  Chatterbox cargado en {dispositivo}", flush=True)

    ajuste = AJUSTES_REINTENTO[min(intento, len(AJUSTES_REINTENTO) - 1)]
    exag, cfg = ajuste or (float(env("CHATTERBOX_EXAGERACION", "0.5")), float(env("CHATTERBOX_CFG", "0.5")))
    torch.manual_seed(1234 + intento * 977)  # otra semilla en cada reintento
    kwargs = {"language_id": idioma, "exaggeration": exag, "cfg_weight": cfg}
    ref = env(f"CHATTERBOX_VOZ_{idioma.upper()}") or env("CHATTERBOX_VOZ_REF")
    if ref and Path(ref).exists():
        kwargs["audio_prompt_path"] = ref  # clip de 10 s de la voz a imitar, en el MISMO idioma
    try:
        wav = _chatterbox.generate(texto, **kwargs)
    except TypeError:  # versiones que no aceptan los parámetros de estilo
        wav = _chatterbox.generate(texto, language_id=idioma, **({"audio_prompt_path": ref} if "audio_prompt_path" in kwargs else {}))
    datos = wav.squeeze().detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav).squeeze()
    tmp = destino.with_suffix(".wav")
    sf.write(str(tmp), datos, _chatterbox.sr)
    ffmpeg("-i", str(tmp), "-ar", "44100", "-ac", "2", "-b:a", "192k", str(destino))
    tmp.unlink(missing_ok=True)


def chatterbox_disponible() -> bool:
    try:
        import chatterbox.mtl_tts  # noqa: F401
        return True
    except Exception:  # noqa: BLE001 — cualquier fallo de instalación → respaldo Kokoro
        return False


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
    if motor == "chatterbox" and not chatterbox_disponible():
        print("  Chatterbox no está instalado o no carga: uso Kokoro (ver README → Voz natural)", flush=True)
        motor = "kokoro"
    idioma = g.get("idioma", "es")
    voces = {p["id"]: p.get("voz_id") for p in g.get("personajes", [])}
    voz_eleven = env("ELEVENLABS_VOZ_ID") if motor == "elevenlabs" else None

    salida = proyecto / "audio"
    salida.mkdir(exist_ok=True)
    resumen: dict[int, dict] = {}
    textos: dict[int, str] = {}
    nuevas: list[int] = []
    total = len(g["escenas"])
    for i, e in enumerate(g["escenas"], 1):
        destino = salida / f"{nombre_escena(e['n'])}.mp3"
        texto = preparar(e["narracion"].strip(), idioma) if e["narracion"].strip() else ""
        if not texto:
            resumen[e["n"]] = {"n": e["n"], "estado": "sin_narracion"}
            continue
        textos[e["n"]] = texto
        if destino.exists() and not forzar:
            resumen[e["n"]] = {"n": e["n"], "estado": "existente", "seg": duracion(destino)}
            continue
        print(f"PROGRESO Voz {i}/{total}", flush=True)
        if motor == "elevenlabs":
            tts_elevenlabs(texto, voces.get(e.get("personaje") or "") or voz_eleven or "", destino)
        elif motor == "chatterbox":
            try:
                tts_chatterbox(texto, idioma, destino)
            except Exception as err:  # noqa: BLE001 — p. ej. memoria de GPU: seguimos con Kokoro
                print(f"  Chatterbox falló ({type(err).__name__}: {str(err)[:120]}); rehago todo con Kokoro", flush=True)
                return rehacer_con_kokoro(proyecto, g, textos_todos(g, idioma), idioma)
        else:
            tts_kokoro(texto, idioma, destino)
        nuevas.append(e["n"])
        resumen[e["n"]] = {"n": e["n"], "estado": "generada"}

    if motor == "chatterbox" and nuevas:
        malas = controlar_calidad(salida, textos, nuevas, idioma)
        if malas:
            print(f"  La voz natural siguió fallando en escenas {malas}: rehago TODA la narración con Kokoro", flush=True)
            return rehacer_con_kokoro(proyecto, g, textos_todos(g, idioma), idioma)

    for n in nuevas:
        acortar_pausas(salida / f"{nombre_escena(n)}.mp3")
        resumen[n]["seg"] = round(duracion(salida / f"{nombre_escena(n)}.mp3"), 2)
    registrar_produccion(proyecto, "voz", {"motor": motor, "escenas": list(resumen.values())})
    print(f"Listo: {len(resumen)} escenas en {salida} (motor {motor})")


def textos_todos(g: dict, idioma: str) -> dict[int, str]:
    return {e["n"]: preparar(e["narracion"].strip(), idioma) for e in g["escenas"] if e["narracion"].strip()}


def controlar_calidad(salida: Path, textos: dict[int, str], escenas: list[int], idioma: str) -> list[int]:
    """Whisper escucha las escenas; las que salen mal se regeneran. Devuelve las que siguen mal."""
    intentos = int(env("VOZ_REINTENTOS", "3") or 3)
    pendientes = list(escenas)
    for ronda in range(1, intentos + 1):
        print(f"PROGRESO Revisando la voz ({ronda}/{intentos})", flush=True)
        oidas = oir_archivos([salida / f"{nombre_escena(n)}.mp3" for n in pendientes], idioma)
        if oidas is None:
            print("  Sin Whisper: no puedo revisar la voz automáticamente", flush=True)
            return []
        malas = []
        for n, o in zip(pendientes, oidas):
            problema = revisar_locucion(textos[n], o)
            if problema:
                print(f"  Escena {n}: {problema} → la regenero", flush=True)
                malas.append(n)
        if not malas:
            print("  Voz revisada: todas las escenas dicen el texto completo", flush=True)
            return []
        if ronda == intentos:
            return malas
        for n in malas:
            tts_chatterbox(textos[n], idioma, salida / f"{nombre_escena(n)}.mp3", intento=ronda)
        pendientes = malas
    return pendientes


def rehacer_con_kokoro(proyecto: Path, g: dict, textos: dict[int, str], idioma: str) -> None:
    salida = proyecto / "audio"
    resumen = []
    for n, texto in textos.items():
        destino = salida / f"{nombre_escena(n)}.mp3"
        print(f"PROGRESO Voz Kokoro {n}/{len(textos)}", flush=True)
        tts_kokoro(texto, idioma, destino)
        acortar_pausas(destino)
        resumen.append({"n": n, "estado": "generada", "seg": round(duracion(destino), 2)})
    registrar_produccion(proyecto, "voz", {"motor": "kokoro", "respaldo": True, "escenas": resumen})
    print(f"Listo: {len(resumen)} escenas con Kokoro (respaldo)")


def acortar_pausas(audio: Path) -> None:
    """Quita el silencio inicial y deja como máximo ~0,25 s en las pausas largas (> 0,4 s)."""
    tmp = audio.with_name(audio.stem + "_tmp.mp3")
    ffmpeg("-i", str(audio), "-af",
           "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05:"
           "stop_periods=-1:stop_duration=0.4:stop_threshold=-45dB:stop_silence=0.25",
           "-ar", "44100", "-ac", "2", "-b:a", "192k", str(tmp))
    tmp.replace(audio)


if __name__ == "__main__":
    main()
