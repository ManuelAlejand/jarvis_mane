"""Estima el costo de producir un guion y lo compara con PRESUPUESTO_MAX_USD.

Uso: python scripts/estimar_costo.py proyectos/<id>/guion.json
Sale con código 2 si el costo supera el presupuesto.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import env, leer_json, escribir_json  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ruta = Path(sys.argv[1])
    g = leer_json(ruta)
    escenas = g["escenas"]

    seg_video = sum(e["duracion_seg"] for e in escenas)
    caracteres = sum(len(e["narracion"]) for e in escenas)

    usd_seg = float(env("KLING_USD_POR_SEG", "0.07"))
    usd_1k_chars = float(env("ELEVENLABS_USD_POR_1K_CARACTERES", "0.30"))
    margen = float(env("MARGEN_REINTENTOS", "1.3"))  # regeneraciones
    presupuesto = float(env("PRESUPUESTO_MAX_USD", "25"))

    # Modo gratis: clips de stock (Pexels) y voz local (Kokoro) no cuestan nada
    modo = sys.argv[sys.argv.index("--modo") + 1] if "--modo" in sys.argv else env("MODO_PRODUCCION", "gratis")
    voz_motor = (env("VOZ_MOTOR", "kokoro") or "kokoro").lower()
    video = 0.0 if modo == "gratis" else seg_video * usd_seg * margen
    voz = 0.0 if voz_motor == "kokoro" else caracteres / 1000 * usd_1k_chars
    total = round(video + voz, 2)

    reporte = {
        "escenas": len(escenas),
        "segundos_video": seg_video,
        "caracteres_narracion": caracteres,
        "modo": modo,
        "motor_voz": voz_motor,
        "usd_video": round(video, 2),
        "usd_voz": round(voz, 2),
        "usd_total_estimado": total,
        "presupuesto_max_usd": presupuesto,
        "dentro_de_presupuesto": total <= presupuesto,
        "nota": "Tarifas configurables en .env; verifica precios vigentes en Kling y ElevenLabs.",
    }
    escribir_json(ruta.parent / "costo_estimado.json", reporte)
    for k, v in reporte.items():
        print(f"{k}: {v}")
    if total > presupuesto:
        print(f"\nPRESUPUESTO EXCEDIDO: {total} USD > {presupuesto} USD")
        sys.exit(2)


if __name__ == "__main__":
    main()
