"""Prepara el texto de una narración para que el motor de voz lo lea como lo diría una persona.

- Números a palabras: "1,000" → "mil" (es) / "one thousand" (en); "3,5" → "tres coma cinco"; "1969" → "nineteen sixty-nine" (en).
- Porcentajes y unidades comunes: "40 %" → "cuarenta por ciento", "11 km" → "once kilómetros", "-2 °C" → "menos dos grados".
- Símbolos que se leen mal: "&" → "y", "~" → "unos", "x10" → "por diez".

Uso:  from texto_narracion import preparar;  preparar("A 1,000 m de profundidad", "es")
"""
from __future__ import annotations

import re

from num2words import num2words

LANG = {"es": "es", "en": "en", "pt": "pt_BR"}

UNIDADES = {
    "es": {"km": "kilómetros", "m": "metros", "cm": "centímetros", "mm": "milímetros", "kg": "kilos", "g": "gramos",
           "km/h": "kilómetros por hora", "°c": "grados", "°": "grados", "%": "por ciento", "l": "litros", "h": "horas",
           "min": "minutos", "s": "segundos", "usd": "dólares", "$": "dólares", "€": "euros"},
    "en": {"km": "kilometers", "m": "meters", "cm": "centimeters", "mm": "millimeters", "kg": "kilograms", "g": "grams",
           "km/h": "kilometers per hour", "mph": "miles per hour", "°c": "degrees Celsius", "°f": "degrees Fahrenheit",
           "°": "degrees", "%": "percent", "ft": "feet", "mi": "miles", "lb": "pounds", "h": "hours", "min": "minutes",
           "s": "seconds", "usd": "dollars", "$": "dollars", "€": "euros"},
    "pt": {"km": "quilômetros", "m": "metros", "cm": "centímetros", "kg": "quilos", "g": "gramas", "°c": "graus",
           "°": "graus", "%": "por cento", "h": "horas", "min": "minutos", "s": "segundos", "$": "dólares", "€": "euros"},
}
MENOS = {"es": "menos", "en": "minus", "pt": "menos"}
COMA = {"es": "coma", "en": "point", "pt": "vírgula"}
SIMBOLOS = {"es": {"&": " y ", "~": "unos ", "≈": "unos "}, "en": {"&": " and ", "~": "about ", "≈": "about "},
            "pt": {"&": " e ", "~": "cerca de ", "≈": "cerca de "}}

# número (con miles 1,000 / 1.000 / 1 000, decimal 3,5 / 3.5 o entero) + unidad opcional pegada a él
_UNIDADES = r"km/h|mph|°\s?[cCfF]|°|%|usd|USD|km|cm|mm|kg|ft|mi|lb|min|m|g|h|s|[$€]"
NUM = re.compile(
    r"(?<![\w])(-)?(\d{1,3}(?:[.,  ]\d{3})+(?!\d)|\d+(?:[.,]\d+)?)"
    r"(?:\s?(" + _UNIDADES + r"))?(?![\w])"
)


def _a_numero(t: str, idioma: str) -> tuple[float | int, bool]:
    """Devuelve (valor, es_decimal) interpretando separadores según el idioma."""
    if re.fullmatch(r"\d{1,3}(?:[.,  ]\d{3})+", t):
        return int(re.sub(r"[.,  ]", "", t)), False
    if "," in t or "." in t:
        entero, dec = re.split(r"[.,]", t, maxsplit=1)
        # "1,5" en es/pt o "1.5" en en → decimal; ambos símbolos se aceptan como decimal si no son grupos de 3
        return float(f"{entero}.{dec}"), True
    return int(t), False


def _decir(valor: float | int, decimal: bool, idioma: str, contexto_anio: bool) -> str:
    lang = LANG.get(idioma, "es")
    if decimal:
        entero, dec = f"{valor}".split(".")
        dec_txt = " ".join(num2words(int(d), lang=lang) for d in dec) if len(dec) > 2 or dec.startswith("0") \
            else num2words(int(dec), lang=lang)
        return f"{num2words(int(entero), lang=lang)} {COMA.get(idioma, 'coma')} {dec_txt}"
    if contexto_anio and idioma == "en" and 1100 <= int(valor) <= 2099:
        return num2words(int(valor), lang=lang, to="year")
    return num2words(int(valor), lang=lang)


def preparar(texto: str, idioma: str = "es") -> str:
    idioma = idioma if idioma in LANG else "es"
    t = texto
    for k, v in SIMBOLOS[idioma].items():
        t = t.replace(k, v)
    veces = {"es": "veces", "en": "times", "pt": "vezes"}[idioma]
    t = re.sub(r"(\d+)\s?[xX×](?![\w\d])", rf"\1 {veces}", t)              # "2x" → "2 veces"
    t = re.sub(r"(?<![\w])[xX×](\d+)", rf"\1 {veces}", t)                 # "x10" → "10 veces"

    # "$5" / "€5" → "5 $" para que la unidad se diga después del número
    t = re.sub(r"([$€])\s?(\d+(?:[.,]\d+)*)", r"\2 \1", t)

    def reemplazo(m: re.Match) -> str:
        signo, cifra, unidad = m.group(1), m.group(2), m.group(3)
        try:
            valor, es_dec = _a_numero(cifra, idioma)
        except ValueError:
            return m.group(0)
        palabras = _decir(valor, es_dec, idioma, contexto_anio=not unidad)
        if signo:
            palabras = f"{MENOS[idioma]} {palabras}"
        if unidad:
            u = re.sub(r"\s", "", unidad).lower()
            palabras += " " + UNIDADES[idioma].get(u, unidad)
        return palabras

    t = NUM.sub(reemplazo, t)
    return re.sub(r"\s{2,}", " ", t).strip()


if __name__ == "__main__":
    pruebas = [
        ("es", "Bajas 1,000 metros y el sol deja de existir."),
        ("es", "A 11 km de profundidad, la presión es 1.000 veces mayor."),
        ("es", "El 70 % del planeta es océano y solo exploramos el 5,5 %."),
        ("es", "La temperatura baja a -2 °C en 1960 y costó $5."),
        ("en", "Dive 1,000 meters down. In 1960 they reached 10,935 m."),
        ("en", "Only 5.5% has been mapped & it costs $20."),
        ("pt", "A 4.000 metros, a temperatura é de 2 °C."),
    ]
    for lang, frase in pruebas:
        print(f"[{lang}] {frase}\n     → {preparar(frase, lang)}")
