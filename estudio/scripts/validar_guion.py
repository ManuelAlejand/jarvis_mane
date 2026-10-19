"""Validación automática del guion: esquema, tiempos, política y similitud.

Uso: python scripts/validar_guion.py proyectos/<id>/guion.json [--comparar proyectos/]
Imprime JSON con errores/advertencias. Código de salida 1 si hay errores.
"""
import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).parent))
from comun import RAIZ, escribir_json, leer_json  # noqa: E402

PALABRAS_SEG = {"es": 2.6, "en": 2.7, "pt": 2.6}  # ritmo de locución cómodo
TOLERANCIA_RITMO = 1.25

# Temas sensibles: no permitidos con presentador/persona IA (política sección 2.3)
SENSIBLES = {
    "salud/medicina": r"\b(diagn[oó]stic|tratamiento|medicament|dosis|cura(r)? (el|la)|"
                      r"diagnos|treatment|medication|dosage|cure for|s[ií]ntomas de)\w*",
    "finanzas personales": r"\b(invierte|inversi[oó]n segura|criptomoneda|trading|acciones de|"
                           r"invest(ing|ment) advice|crypto|stock tips|hazte rico|get rich)\w*",
    "legal": r"\b(asesor[ií]a legal|demanda(r)?|abogad|legal advice|lawsuit)\w*",
}
PERTURBADOR = r"\b(gore|desmembra|tortura|suicid|torture|dismember|self-harm)\w*"
MARCAS = r"\b(disney|marvel|pixar|nintendo|pok[eé]mon|coca-cola|nike|apple|netflix|star wars|" \
         r"harry potter|mickey|spider-?man|batman)\b"


def palabras(t: str) -> list[str]:
    return re.findall(r"[a-záéíóúñüç]+", t.lower())


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def validar(ruta: Path, comparar: Path | None) -> dict:
    errores, avisos = [], []
    g = leer_json(ruta)

    esquema = leer_json(RAIZ / "schemas" / "guion.schema.json")
    for e in Draft202012Validator(esquema).iter_errors(g):
        errores.append(f"esquema: {'/'.join(map(str, e.path)) or '(raíz)'}: {e.message}")
    if errores:
        return {"ok": False, "errores": errores, "advertencias": avisos}

    esc = g["escenas"]
    nums = [e["n"] for e in esc]
    if nums != list(range(1, len(esc) + 1)):
        errores.append(f"escenas: numeración debe ser 1..{len(esc)} consecutiva (hay {nums})")

    ritmo = PALABRAS_SEG[g["idioma"]]
    for e in esc:
        n_pal = len(e["narracion"].split())
        max_pal = e["duracion_seg"] * ritmo * TOLERANCIA_RITMO
        if n_pal > max_pal * 1.6:
            errores.append(f"escena {e['n']}: {n_pal} palabras no caben en {e['duracion_seg']}s "
                           f"(máx ≈{int(max_pal)}). Divide la escena.")
        elif n_pal > max_pal:
            avisos.append(f"escena {e['n']}: narración larga ({n_pal} pal.) para "
                          f"{e['duracion_seg']}s; el clip se repetirá en bucle.")
        if re.search(r"\b(text|letters|words|caption)\b", e["prompt_visual"], re.I):
            avisos.append(f"escena {e['n']}: el prompt pide texto en pantalla; Kling lo deforma.")

    ids = {p["id"] for p in g["personajes"]}
    for e in esc:
        if e.get("personaje") and e["personaje"] not in ids:
            errores.append(f"escena {e['n']}: personaje '{e['personaje']}' no está en personajes")

    texto = " ".join([g["titulo"], g["gancho"], g["metadatos"]["titulo_youtube"],
                      g["metadatos"]["descripcion"]] + [e["narracion"] for e in esc]).lower()
    prompts = " ".join(e["prompt_visual"] for e in esc).lower()
    hay_presentador = any((p.get("rol") or "").lower() in ("presentador", "host", "narrador en pantalla")
                          for p in g["personajes"])
    for tema, patron in SENSIBLES.items():
        hits = set(m.group(0) for m in re.finditer(patron, texto, re.I))
        if hits:
            (errores if hay_presentador else avisos).append(
                f"tema sensible ({tema}): {sorted(hits)[:5]}"
                + (" con presentador IA → no monetizable" if hay_presentador else
                   " — revisar que no sea consejo"))
    if re.search(PERTURBADOR, texto + prompts, re.I):
        avisos.append("posible contenido perturbador; revisar política sección 2.2")
    marcas = set(m.group(0) for m in re.finditer(MARCAS, texto + " " + prompts, re.I))
    if marcas:
        errores.append(f"marcas/personajes con copyright detectados: {sorted(marcas)}")

    dur = sum(e["duracion_seg"] for e in esc)
    if g["formato"] == "largo" and dur < 180:
        avisos.append(f"video largo de solo {dur}s; < 3 min suele rendir peor en RPM")
    if g["formato"] == "short" and dur > 180:  # YouTube admite Shorts de hasta 3 min
        errores.append(f"formato short pero dura {dur}s (> 180)")
    if len(g["metadatos"]["titulo_youtube"]) > 70:
        avisos.append("titulo_youtube > 70 caracteres; se corta en móviles")
    if not g["divulgacion_ia"]:
        avisos.append("divulgacion_ia=false: confirma que no hay imágenes realistas generadas")
    if not g["fuentes"]:
        avisos.append("sin fuentes: el validador editorial no podrá verificar hechos")

    for c in g.get("clips_short", []):
        if not (1 <= c["desde_escena"] <= c["hasta_escena"] <= len(esc)):
            errores.append(f"clip_short '{c['titulo']}': rango de escenas inválido")
        else:
            d = sum(e["duracion_seg"] for e in esc[c["desde_escena"] - 1:c["hasta_escena"]])
            if d > 75:
                avisos.append(f"clip_short '{c['titulo']}': ~{d}s; se recortará a 59s")

    similitud = []
    if comparar and comparar.exists():
        propio = set(palabras(" ".join(e["narracion"] for e in esc)))
        for otro in comparar.glob("*/guion.json"):
            if otro.resolve() == ruta.resolve():
                continue
            try:
                o = json.loads(otro.read_text(encoding="utf-8"))
                s = jaccard(propio, set(palabras(" ".join(x["narracion"] for x in o["escenas"]))))
                t = jaccard(set(palabras(g["titulo"])), set(palabras(o["titulo"])))
            except Exception:
                continue
            similitud.append({"guion": otro.parent.name, "texto": round(s, 3), "titulo": round(t, 3)})
            if s > 0.5:
                errores.append(f"muy similar a {otro.parent.name} ({s:.0%}): riesgo de contenido "
                               "inauténtico/repetitivo")
            elif s > 0.35 or t > 0.6:
                avisos.append(f"parecido a {otro.parent.name} (texto {s:.0%}, título {t:.0%})")

    return {"ok": not errores, "errores": errores, "advertencias": avisos,
            "resumen": {"escenas": len(esc), "duracion_seg_clips": dur,
                        "palabras": sum(len(e["narracion"].split()) for e in esc)},
            "similitud": sorted(similitud, key=lambda x: -x["texto"])[:5]}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ruta = Path(sys.argv[1]).resolve()
    comparar = Path(sys.argv[sys.argv.index("--comparar") + 1]).resolve() \
        if "--comparar" in sys.argv else None
    r = validar(ruta, comparar)
    escribir_json(ruta.parent / "qa" / "validacion_guion.json", r)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r["ok"] else 1)


if __name__ == "__main__":
    main()
