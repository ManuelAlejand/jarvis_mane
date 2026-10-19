"""Modo gratis: un clip de stock por escena (licencia libre con uso comercial).

Uso: python scripts/generar_clips_stock.py proyectos/<id> [--solo 3,4] [--forzar]
Salida: clips/escena_XX.mp4 y clips/stock.json (qué clip se usó en cada escena y de dónde).

Proveedor según STOCK_PROVEEDOR en .env:
  pixabay (por defecto) PIXABAY_API_KEY — gratis: crea una cuenta en pixabay.com y la llave
                        aparece en pixabay.com/api/docs. Licencia Pixabay: uso comercial, sin atribución.
  pexels                PEXELS_API_KEY  — licencia Pexels: uso comercial, sin atribución.

Búsqueda por escena: `busqueda_stock` (inglés) → sujeto + palabra principal → solo el sujeto.
SUJETO: `sujeto_stock` del guion (p. ej. ["crow", "raven"]) o, si falta, la palabra que más se repite en las
búsquedas. Todo clip debe tener el sujeto en sus etiquetas: es preferible repetir un clip del mismo video
que mostrar otro animal (un petirrojo en un video de cuervos) o vacas.
Nunca se usan clips con personas ni borrosos/abstractos, salvo que la búsqueda los pida.
Prefiere clips verticales; si no hay, usa horizontales y el montaje los recorta a 9:16.
No repite un mismo clip dentro del video; con --forzar elige otro distinto al anterior.
Las búsquedas se guardan 24 h en cache/ (lo exige Pixabay y ahorra cuota).
"""
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from comun import (RAIZ, carpeta_proyecto, env, escribir_json, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion)

CACHE = RAIZ / "cache" / "stock"
MAX_MB = 120  # no descargar archivos enormes (4K largos)


# ------------------------------------------------------------------ proveedores
# Cada uno devuelve candidatos normalizados:
# {"id", "duracion", "pagina", "autor", "archivos": [{"url", "w", "h", "mb"}]}

def _get(url: str, **kw) -> requests.Response:
    for intento in range(4):
        r = requests.get(url, timeout=30, **kw)
        if r.status_code == 429:
            time.sleep(15 * (intento + 1))
            continue
        return r
    raise RuntimeError("Límite de la API de stock alcanzado; reintenta en unos minutos")


def _cache(clave: str, cargar):
    CACHE.mkdir(parents=True, exist_ok=True)
    ruta = CACHE / (hashlib.sha1(clave.encode()).hexdigest() + ".json")
    if ruta.exists() and time.time() - ruta.stat().st_mtime < 24 * 3600:
        return json.loads(ruta.read_text(encoding="utf-8"))
    datos = cargar()
    ruta.write_text(json.dumps(datos), encoding="utf-8")
    return datos


def buscar_pixabay(consulta: str, vertical: bool) -> list[dict]:
    clave = env("PIXABAY_API_KEY", requerido=True)
    url = env("PIXABAY_API_URL", "https://pixabay.com/api/videos/")

    def cargar():
        r = _get(url, params={"key": clave, "q": consulta[:100], "video_type": "film", "safesearch": "true",
                              "per_page": 50, "min_height": 720})
        if r.status_code != 200:
            raise RuntimeError(f"Pixabay {r.status_code}: {r.text[:300]}")
        return r.json().get("hits", [])

    hits = _cache(f"pixabay|{consulta}", cargar)
    out = []
    for h in hits:
        archivos = [{"url": v["url"], "w": v["width"], "h": v["height"], "mb": (v.get("size") or 0) / 1e6}
                    for v in (h.get("videos") or {}).values() if v.get("url") and v.get("width")]
        out.append({"id": f"pixabay-{h['id']}", "duracion": h.get("duration", 0), "pagina": h.get("pageURL"),
                    "autor": h.get("user"), "archivos": archivos, "tags": h.get("tags", "")})
    return out  # en el orden de relevancia de Pixabay


def buscar_pexels(consulta: str, vertical: bool) -> list[dict]:
    clave = env("PEXELS_API_KEY", requerido=True)
    url = env("PEXELS_API_URL", "https://api.pexels.com/videos/search")
    out = []
    for orient in (("portrait", "landscape") if vertical else ("landscape",)):
        def cargar(o=orient):
            r = _get(url, headers={"Authorization": clave},
                     params={"query": consulta, "orientation": o, "size": "medium", "per_page": 15})
            if r.status_code != 200:
                raise RuntimeError(f"Pexels {r.status_code}: {r.text[:300]}")
            return r.json().get("videos", [])
        for v in _cache(f"pexels|{orient}|{consulta}", cargar):
            archivos = [{"url": f["link"], "w": f["width"], "h": f["height"], "mb": 0}
                        for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
            # Pexels no da etiquetas; la URL de la página trae el título del clip ("…/video/deep-ocean-fish-123/")
            out.append({"id": f"pexels-{v['id']}", "duracion": v.get("duration", 0), "pagina": v.get("url"),
                        "autor": (v.get("user") or {}).get("name"), "archivos": archivos,
                        "tags": re.sub(r"[-/\d]+", " ", (v.get("url") or "").split("/video/")[-1])})
    return out


PROVEEDORES = {"pixabay": buscar_pixabay, "pexels": buscar_pexels}
LICENCIA = {"pixabay": "Pixabay Content License (uso comercial, sin atribución obligatoria)",
            "pexels": "Pexels License (uso comercial, sin atribución obligatoria)"}


HUMANOS = {"man", "woman", "people", "person", "girl", "boy", "child", "kid", "baby", "men", "women", "human",
           "face", "portrait", "model", "couple", "family", "businessman", "lady", "guy", "crowd", "selfie", "hand", "hands",
           "female", "male", "young", "adult", "smile", "smiling", "beauty", "fashion", "teen", "teenager", "student",
           "worker", "doctor", "tourist", "traveler", "hiker", "photographer", "binoculars", "eyes", "hair", "makeup"}
BORROSOS = {"bokeh", "blur", "blurred", "blurry", "defocused", "abstract", "unfocused", "tunnel", "glitch", "particles"}
VACIAS = {"a", "an", "the", "of", "in", "on", "at", "and", "with", "close", "up", "closeup", "view", "shot", "slow",
          "motion", "video", "footage", "aerial", "dark", "light", "background", "4k", "hd"}


def palabras(texto: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", texto.lower()) if len(w) > 2 and w not in VACIAS}


def singular(w: str) -> str:
    return w[:-3] + "y" if w.endswith("ies") else w[:-2] if w.endswith(("ches", "shes", "sses")) else w.rstrip("s")


def relevante(c: dict, consulta: str, sujetos: set[str]) -> bool:
    """El clip debe mostrar el sujeto del video, compartir algo con la búsqueda y no tener personas ni ser borroso."""
    etiquetas = palabras(c.get("tags", ""))
    buscadas = palabras(consulta)
    if not etiquetas:
        return False  # sin etiquetas no se puede comprobar qué muestra
    et_s = {singular(w) for w in etiquetas}
    bu_s = {singular(w) for w in buscadas}
    if sujetos and not sujetos & et_s:
        return False
    if not bu_s & et_s:
        return False
    if etiquetas & HUMANOS and not buscadas & HUMANOS:
        return False
    if etiquetas & BORROSOS and not buscadas & BORROSOS:
        return False
    return True


def sujetos_del_video(g: dict) -> set[str]:
    """Sujeto visual del video (singular, en inglés): del guion o la palabra más repetida en las búsquedas."""
    dado = g.get("sujeto_stock")
    if dado:
        lista = dado if isinstance(dado, list) else re.split(r"[,/]", str(dado))
        return {singular(w) for x in lista for w in palabras(x)}
    conteo: dict[str, int] = {}
    for e in g.get("escenas", []):
        for w in {singular(w) for w in palabras(e.get("busqueda_stock", ""))}:
            conteo[w] = conteo.get(w, 0) + 1
    if not conteo:
        return set()
    w, n = max(conteo.items(), key=lambda x: x[1])
    return {w} if n >= max(2, len(g.get("escenas", [])) // 3) else set()


def ordenar(candidatos: list[dict], vertical: bool, top: int = 6) -> list[dict]:
    """Respeta la relevancia del buscador; dentro de los primeros `top`, adelanta los verticales."""
    if not vertical:
        return candidatos
    es_v = lambda c: any(a["h"] > a["w"] for a in c["archivos"])  # noqa: E731
    cabeza = candidatos[:top]
    return [c for c in cabeza if es_v(c)] + [c for c in cabeza if not es_v(c)] + candidatos[top:]


def mejor_archivo(c: dict, vertical: bool) -> dict | None:
    """El archivo más cercano a 1080 px de ancho útil en 9:16 (o alto en 16:9), sin pasar de MAX_MB."""
    archivos = [a for a in c["archivos"] if not a["mb"] or a["mb"] <= MAX_MB]
    if not archivos:
        return None
    if vertical:
        verticales = [a for a in archivos if a["h"] >= a["w"]]
        if verticales:
            return min(verticales, key=lambda a: abs(a["w"] - 1080))
        # Horizontal recortado a 9:16: el ancho útil es alto * 9/16; buscamos ~1080 px
        return min(archivos, key=lambda a: abs(a["h"] * 9 / 16 - 1080) + (0 if a["h"] * 9 / 16 >= 600 else 5000))
    return min(archivos, key=lambda a: abs(a["h"] - 1080))


# ------------------------------------------------------------------ búsqueda por escena

def consultas(e: dict, sujetos: set[str]) -> list[str]:
    """De lo más específico a lo más general, siempre con el sujeto del video."""
    base = " ".join((e.get("busqueda_stock") or "").split()[:4])
    principal = sorted(sujetos)[0] if sujetos else ""
    out = [base] if base else []
    if principal:
        if principal not in {singular(w) for w in palabras(base)} and base:
            out.append(f"{principal} {' '.join(base.split()[:2])}")
        resto = [w for w in base.split() if singular(w.lower()) not in sujetos and w.lower() not in VACIAS]
        if resto:
            out.append(f"{principal} {resto[0]}")
        out.append(principal)
    elif not base:
        pv = re.sub(r"[^A-Za-z ]", " ", e.get("prompt_visual", "")).split()
        out.append(" ".join(pv[:3]))
    vistos, limpias = set(), []
    for c in out:
        c = " ".join(c.split())[:80]
        if c and c.lower() not in vistos:
            vistos.add(c.lower())
            limpias.append(c)
    return limpias


def descargar(url: str, destino: Path) -> None:
    with requests.get(url, stream=True, timeout=180) as r:
        r.raise_for_status()
        tmp = destino.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(destino)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    forzar = "--forzar" in sys.argv
    solo = None
    if "--solo" in sys.argv:
        solo = {int(x) for x in sys.argv[sys.argv.index("--solo") + 1].split(",")}

    proveedor = (env("STOCK_PROVEEDOR", "pixabay") or "pixabay").lower()
    buscar = PROVEEDORES.get(proveedor)
    if not buscar:
        sys.exit(f"ERROR: STOCK_PROVEEDOR desconocido: {proveedor} (usa pixabay o pexels)")
    g = leer_json(proyecto / "guion.json")
    sujetos = sujetos_del_video(g)
    print(f"  Sujeto visual del video: {', '.join(sorted(sujetos)) or '(ninguno: cada escena según su búsqueda)'}", flush=True)
    vertical = g.get("aspect_ratio") == "9:16"

    clips = proyecto / "clips"
    clips.mkdir(exist_ok=True)
    ruta_reg = clips / "stock.json"
    registro = leer_json(ruta_reg) if ruta_reg.exists() else {}
    usados = {v["id"] for v in registro.values() if "id" in v}

    # Cortes rápidos: varios clips por escena (escena_XX.mp4, escena_XX_2.mp4, …); el montaje los alterna
    por_escena = max(1, int(env("CLIPS_POR_ESCENA", "2") or 2))
    total = len(g["escenas"])
    faltan = []
    for i, e in enumerate(g["escenas"], 1):
        if solo and e["n"] not in solo:
            continue
        print(f"PROGRESO Clips {i}/{total}", flush=True)
        for k in range(1, por_escena + 1):
            sufijo = "" if k == 1 else f"_{k}"
            clave = str(e["n"]) + sufijo
            destino = clips / f"{nombre_escena(e['n'])}{sufijo}.mp4"
            if destino.exists() and not forzar:
                continue
            anterior = registro.get(clave, {}).get("id")
            # Clips de 2–3 s bastan para los cortes extra; el principal debe cubrir la escena
            min_dur = min(e["duracion_seg"], 4) if k == 1 else 2
            elegido = None
            for consulta in consultas(e, sujetos):
                for c in ordenar(buscar(consulta, vertical), vertical):
                    if c["id"] in usados or c["id"] == anterior or c["duracion"] < min_dur:
                        continue
                    if not relevante(c, consulta, sujetos):
                        continue
                    a = mejor_archivo(c, vertical)
                    if a:
                        elegido = (c, a, consulta)
                        break
                if elegido:
                    break
            if not elegido and k == 1:
                # Mejor repetir un clip correcto de este mismo video que mostrar algo que no corresponde
                previos = sorted(clips.glob("escena_*.mp4"), key=lambda f: abs(int(f.stem.split("_")[1]) - e["n"]))
                previos = [f for f in previos if f.resolve() != destino.resolve()]
                if previos:
                    shutil.copyfile(previos[0], destino)
                    partes = previos[0].stem.split("_")  # escena_03_2 → "3_2"
                    origen = str(int(partes[1])) + ("_" + partes[2] if len(partes) > 2 else "")
                    registro[clave] = {**registro.get(origen, {}), "reutilizado_de": previos[0].name}
                    escribir_json(ruta_reg, registro)
                    print(f"  escena {clave}: sin clip nuevo del sujeto; reutilizo {previos[0].name}", flush=True)
                    continue
            if not elegido:
                if k == 1:
                    print(f"  escena {e['n']}: sin clip de stock", flush=True)
                    faltan.append(e["n"])
                break  # sin clip principal no hay escena; sin clip extra, la escena usa uno solo
            c, a, consulta = elegido
            descargar(a["url"], destino)
            usados.add(c["id"])
            registro[clave] = {"id": c["id"], "proveedor": proveedor, "url": c["pagina"], "autor": c["autor"],
                               "consulta": consulta, "resolucion": f"{a['w']}x{a['h']}"}
            escribir_json(ruta_reg, registro)
            print(f"  escena {clave}: «{consulta}» → {c['id']} ({a['w']}x{a['h']})", flush=True)

    registrar_produccion(proyecto, "clips", {"motor": proveedor, "faltantes": faltan, "licencia": LICENCIA[proveedor]})
    if faltan:
        print(f"FALTAN clips de las escenas: {faltan}")
        sys.exit(1)
    print("Todos los clips listos.")


if __name__ == "__main__":
    main()
