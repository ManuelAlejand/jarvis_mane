"""Puente del estudio: conecta este PC con JARVIS.

Pide trabajo a JARVIS cada pocos segundos y lo ejecuta aquí:
  guion    → Guionista (Claude Code con tu plan Pro) → Productor (voz Kokoro + clips + ffmpeg)
             → Validador (Claude Code) con hasta 2 rondas de corrección
             → te envía el Short por Telegram con los botones Publicar / Cambiar / Descartar
  publicar → Publicador: sube el Short a YouTube en privado, con divulgación de IA

Uso (desde la carpeta del estudio):  python puente.py          # se queda escuchando
                                     python puente.py --una-vez  # procesa un trabajo y sale
                                     python puente.py --probar   # revisa que todo esté instalado
Variables en .env: JARVIS_URL, WORKER_SECRET, TELEGRAM_TOKEN (ver .env.example).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
from datetime import datetime
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ / "scripts"))
from comun import cargar_env, escribir_json, leer_json  # noqa: E402

cargar_env()
JARVIS = os.environ.get("JARVIS_URL", "").rstrip("/")
SECRETO = os.environ.get("WORKER_SECRET", "")
TG_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
INTERVALO = int(os.environ.get("PUENTE_INTERVALO_SEG", "20"))
MAX_RONDAS = 2
PY = sys.executable
LOG = RAIZ / "puente.log"


# ----------------------------------------------------------------------------- utilidades

def log(msg: str) -> None:
    linea = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(linea, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(linea + "\n")


def esc(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def slug(texto: str) -> str:
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "short"


def api(metodo: str, ruta: str, **kw):
    r = requests.request(metodo, f"{JARVIS}{ruta}", headers={"Authorization": f"Bearer {SECRETO}"}, timeout=30, **kw)
    r.raise_for_status()
    return r.json()


def reportar(video_id: str, **campos) -> None:
    try:
        api("POST", "/api/studio/report", json={"video_id": video_id, **campos})
    except Exception as e:  # noqa: BLE001 — un reporte fallido no detiene la producción
        log(f"  (no se pudo reportar a JARVIS: {e})")


class Fallo(RuntimeError):
    pass


def correr(args: list[str], video: dict, agente: str, etiqueta: str, timeout: int = 1800, ok_codes=(0,),
           env_extra: dict | None = None) -> str:
    """Ejecuta un script y reporta en vivo las líneas 'PROGRESO …'."""
    log(f"  → {etiqueta}: {' '.join(Path(a).name if i == 0 else a for i, a in enumerate(args))}")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", **(env_extra or {})}
    p = subprocess.Popen(args, cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         encoding="utf-8", errors="replace", env=env)
    salida, ultimo = [], 0.0
    inicio = time.time()
    # Vigilante: mata el proceso si se pasa del tiempo aunque no imprima nada (un cuelgue silencioso)
    vencido = threading.Event()

    def _vencer() -> None:
        vencido.set()
        p.kill()

    vigilante = threading.Timer(timeout, _vencer)
    vigilante.daemon = True
    vigilante.start()
    assert p.stdout
    for linea in p.stdout:
        salida.append(linea)
        if linea.startswith("PROGRESO") and time.time() - ultimo > 4:
            paso = linea.replace("PROGRESO", "").strip()
            reportar(video["id"], agente=agente, paso=paso, fase_detalle=paso)
            ultimo = time.time()
        if time.time() - inicio > timeout:
            p.kill()
            raise Fallo(f"{etiqueta}: tardó más de {timeout // 60} min")
    p.wait()
    vigilante.cancel()
    if vencido.is_set():
        raise Fallo(f"{etiqueta}: tardó más de {timeout // 60} min (proceso detenido)")
    texto = "".join(salida)
    if p.returncode not in ok_codes:
        raise Fallo(f"{etiqueta} falló (código {p.returncode}): {texto[-600:].strip()}")
    return texto


def comando_claude() -> list[str]:
    ruta = os.environ.get("CLAUDE_CMD") or shutil.which("claude")
    if not ruta:
        raise Fallo("No encuentro Claude Code (comando 'claude'). Instálalo e inicia sesión con tu cuenta Pro.")
    return ["cmd", "/c", ruta] if ruta.lower().endswith((".cmd", ".bat")) else [ruta]


HERRAMIENTAS = ",".join([
    "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "Agent",
    "Bash(python scripts/*)", "Bash(python3 scripts/*)", "Bash(py scripts/*)", "Bash(ffmpeg:*)", "Bash(ffprobe:*)",
])


def claude(instrucciones: str, video: dict, agente: str, paso: str, timeout: int = 1500) -> str:
    """Ejecuta Claude Code sin interfaz, con tu sesión Pro, en la carpeta del estudio."""
    reportar(video["id"], agente=agente, paso=paso, fase_detalle=paso)
    log(f"  → Claude Code ({agente}): {paso}")
    args = comando_claude() + [
        "-p", "Sigue exactamente las instrucciones recibidas por la entrada estandar.",
        "--permission-mode", "acceptEdits", "--allowedTools", HERRAMIENTAS, "--output-format", "text",
    ]
    try:
        r = subprocess.run(args, cwd=RAIZ, input=instrucciones, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise Fallo(f"Claude Code tardó más de {timeout // 60} min en «{paso}»") from e
    salida = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        if re.search(r"usage limit|rate limit|limit reached|5-hour", salida, re.I):
            raise Fallo("Se alcanzó el límite de uso de tu plan de Claude. Reintenta cuando se renueve.")
        raise Fallo(f"Claude Code falló en «{paso}»: {salida[-500:].strip()}")
    return salida


# ----------------------------------------------------------------------------- fases

def preparar_carpeta(video: dict) -> Path:
    if video.get("carpeta") and (RAIZ / "proyectos" / video["carpeta"]).exists():
        carpeta = RAIZ / "proyectos" / video["carpeta"]
    else:
        nombre = f"{datetime.now():%Y%m%d}-v{video['ref']}-{slug(video['titulo'])}"
        carpeta = RAIZ / "proyectos" / nombre
        carpeta.mkdir(parents=True, exist_ok=True)
    idea = video.get("idea") or {}
    escribir_json(carpeta / "nicho.json", {
        "fecha": f"{datetime.now():%Y-%m-%d}",
        "origen": "JARVIS · Investigador",
        "video_ref": video["ref"],
        "mercado": {"idioma": idea.get("idioma", "es"), "descripcion": idea.get("mercado"), "rpm_estimado": idea.get("rpm_estimado")},
        "nicho": idea.get("nicho"),
        "justificacion": idea.get("por_que"),
        "idea": idea,
        "temas": [{"titulo_tentativo": idea.get("titulo", video["titulo"]), "angulo_original": idea.get("angulo"),
                   "gancho": idea.get("gancho"), "palabras_clave": idea.get("palabras_clave", []), "recomendado": True}],
    })
    return carpeta


PLANTILLA_GUION = """{
  "id": "v1-the-ocean-zone",
  "titulo": "The Ocean Zone Where Sunlight Never Arrives",
  "idioma": "en",
  "mercado": ["US", "UK"],
  "nicho": "Deep ocean mysteries",
  "formato": "short",
  "aspect_ratio": "9:16",
  "gancho": "Dive 1,000 meters down and the sun simply stops existing.",
  "aporte_original": "Explica en 40 segundos, con datos verificados, por qué la zona de medianoche es el hábitat más grande del planeta y casi inexplorado.",
  "estilo_visual": "dark cinematic underwater footage",
  "personajes": [],
  "escenas": [
    {"n": 1, "narracion": "Dive 1,000 meters down and the sun simply stops existing.",
     "prompt_visual": "Sunlight rays fading into deep blue ocean water, camera descending",
     "busqueda_stock": "ocean sunlight rays", "duracion_seg": 5}
  ],
  "sujeto_stock": ["ocean", "sea"],
  "clips_short": [],
  "metadatos": {
    "titulo_youtube": "The Ocean Zone Where Sunlight Never Arrives",
    "descripcion": "Texto de 2-3 frases con el dato central y las fuentes... #Shorts",
    "tags": ["deep ocean", "midnight zone", "ocean facts"],
    "categoria_id": "27"
  },
  "divulgacion_ia": true,
  "fuentes": [{"titulo": "NOAA Ocean Exploration", "url": "https://oceanexplorer.noaa.gov/"}]
}"""

# Nombres de campo equivocados que los modelos suelen usar → nombre correcto del esquema
ALIAS_ESCENA = {"numero": "n", "num": "n", "number": "n", "duracion": "duracion_seg", "duration": "duracion_seg",
                "segundos": "duracion_seg", "naracion": "narracion", "narration": "narracion", "texto": "narracion",
                "visual": "prompt_visual", "prompt": "prompt_visual", "stock": "busqueda_stock"}
ALIAS_META = {"titulo": "titulo_youtube", "title": "titulo_youtube", "description": "descripcion",
              "etiquetas": "tags", "categoria": "categoria_id", "category_id": "categoria_id"}


def normalizar_guion(ruta: Path, carpeta: Path, video: dict) -> None:
    """Arregla sin preguntar los errores de forma inequívocos (nombres de campo, tipos simples)."""
    g = leer_json(ruta)
    for i, e in enumerate(g.get("escenas", []), 1):
        for viejo, nuevo in ALIAS_ESCENA.items():
            if viejo in e and nuevo not in e:
                e[nuevo] = e.pop(viejo)
        e.setdefault("n", i)
        try:
            d = float(e.get("duracion_seg", 5))
        except (TypeError, ValueError):
            d = 5
        e["duracion_seg"] = 10 if d > 7.5 else 5
    meta = g.get("metadatos") or {}
    for viejo, nuevo in ALIAS_META.items():
        if viejo in meta and nuevo not in meta:
            meta[nuevo] = meta.pop(viejo)
    if meta:
        meta.setdefault("titulo_youtube", g.get("titulo") or video["titulo"])
        meta["categoria_id"] = str(meta.get("categoria_id", "27"))
        g["metadatos"] = meta
    nicho = leer_json(carpeta / "nicho.json") if (carpeta / "nicho.json").exists() else {}
    g.setdefault("id", carpeta.name)
    if not g.get("nicho") and nicho.get("nicho"):
        g["nicho"] = nicho["nicho"]
    if not g.get("gancho") and g.get("escenas"):
        g["gancho"] = g["escenas"][0].get("narracion", "")
    g.setdefault("formato", "short")
    g.setdefault("aspect_ratio", "9:16")
    g.setdefault("divulgacion_ia", True)
    g.setdefault("clips_short", [])
    g.setdefault("personajes", [])
    escribir_json(ruta, g)


def errores_guion(ruta: Path, video: dict) -> list[str]:
    correr([PY, "scripts/validar_guion.py", str(ruta), "--comparar", "proyectos/"], video, "guionista", "Validar guion", ok_codes=(0, 1))
    rep = ruta.parent / "qa" / "validacion_guion.json"
    return leer_json(rep).get("errores", []) if rep.exists() else ["no se generó qa/validacion_guion.json"]


def instrucciones_guion(carpeta: Path, idea: dict, correccion: str | None) -> str:
    base = f"""Actúa como el subagente `guionista` definido en .claude/agents/guionista.md (usa la herramienta Agent/Task con subagent_type "guionista" si está disponible; si no, sigue tú mismo ese archivo).

Carpeta del proyecto (ruta absoluta): {carpeta}
Lee {carpeta / 'nicho.json'}: la idea elegida por el usuario está en "idea".

FORMATO OBLIGATORIO: YouTube Short — este encargo reemplaza las reglas de video largo del guionista.
- "formato": "short", "aspect_ratio": "9:16", idioma = "{idea.get('idioma', 'es')}".
- Duración total entre 60 y 75 segundos: 12 a 15 escenas de 5 s (usa 10 s solo si la narración lo exige).
- Narración: entre 10 y 12 palabras por escena de 5 s (ritmo ágil, sin relleno).
- Estructura con tensión, no una lista de datos:
  1) Gancho (escena 1): una pregunta o dato imposible de ignorar, sin saludos.
  2) Contexto rápido (2-3 escenas) que plantea un misterio o pregunta abierta.
  3) Primer giro hacia la mitad ("pero aquí está lo extraño…").
  4) Escalada con 2-3 datos sorprendentes y concretos.
  5) Revelación o respuesta en las últimas 3 escenas.
  6) Cierre que conecte con el gancho (invita a volver a verlo) o una pregunta para comentarios.
  Escribe la narración como se dice en voz alta: números en palabras ("mil metros", no "1,000 m"), sin siglas raras ni símbolos.
- Producción en MODO GRATIS: los visuales serán clips de stock (Pixabay), no video generado.
  Añade en la raíz del guion "sujeto_stock": la lista de 1 a 3 sustantivos en inglés, en singular, que se ven en
  pantalla durante el video (ej. ["crow", "raven"] para cuervos, ["octopus"], ["volcano", "lava"]).
  Cada escena debe incluir "busqueda_stock": 2 o 3 palabras en inglés que EMPIECEN por uno de esos sujetos y
  describan solo lo que la cámara ve (ej. "crow flock tree", "crow flying", "crow ground"). Prohibido:
  palabras abstractas (learning, intelligence, strategy, memory, communication, threat), personas (silhouette,
  watcher, scientist, face, people), y escenas imposibles de filmar. Si la narración es abstracta, muestra al
  sujeto haciendo algo simple (posado, volando, mirando, en grupo). Varía la acción entre escenas.
  Mantén igualmente "prompt_visual" (requerido por el esquema).
- "personajes" puede ir vacío ([]) si no hay figuras recurrentes. "clips_short": [] (el video ya es un Short).
- Incluye "#Shorts" al final de metadatos.descripcion. "divulgacion_ia": true (la voz es sintética).
- Escribe {carpeta / 'guion.json'} siguiendo EXACTAMENTE schemas/guion.schema.json. Usa estos nombres de campo
  tal cual (no los traduzcas ni los cambies: "n", "narracion", "duracion_seg", no "numero", "duracion" ni "narration"):

{PLANTILLA_GUION}

- Valídalo con: python scripts/validar_guion.py "{carpeta / 'guion.json'}" --comparar proyectos/
  Corrige hasta que no haya errores.
Al terminar responde solo una línea: el título del Short."""
    if correccion:
        base += f"""

CORRECCIÓN PEDIDA (prioridad máxima). Ya existe un guion.json en la carpeta: reescríbelo aplicando esto:
{correccion}"""
    return base


def instrucciones_validador(carpeta: Path) -> str:
    return f"""Actúa como el subagente `validador` definido en .claude/agents/validador.md (usa la herramienta Agent/Task con subagent_type "validador" si está disponible; si no, sigue tú mismo ese archivo).

Proyecto (ruta absoluta): {carpeta}
Es un YouTube Short (9:16, de 60 a 75 s; YouTube admite hasta 3 min) producido en modo gratis: los visuales son clips de stock de Pixabay o Pexels
(registrados en clips/stock.json, licencias libres con uso comercial) y la voz es Kokoro (sintética, licencia Apache-2.0).
No penalices que los clips sean de stock; sí revisa que encajen con la narración, que no muestren marcas,
logos, texto legible ajeno ni personas reconocibles, y que el conjunto aporte valor original.
Ejecuta las validaciones automáticas (python scripts/validar_guion.py ... y python scripts/validar_video.py "{carpeta}" --fotogramas 6),
revisa los fotogramas de qa/ y escribe {carpeta / 'reporte_validacion.json'} con el formato del validador.
En cada problema, "responsable" debe ser "guionista" o "productor" y, si aplica, el número de "escena".
Responde solo con una línea: VEREDICTO y puntaje."""


def producir(video: dict, carpeta: Path, solo: list[int] | None = None) -> None:
    modo = video.get("modo") or "gratis"
    reportar(video["id"], estado="produciendo", agente="productor", paso="Preparando producción", fase_detalle="Preparando producción")
    if solo is None:
        try:
            correr([PY, "scripts/generar_voz.py", str(carpeta)], video, "productor", "Voz", timeout=1200)
        except Fallo as e:
            # Si el motor de voz se cae (p. ej. Chatterbox cierra Python en Windows), se rehace con Kokoro
            # en un proceso nuevo para que el video no se detenga. Se rehacen todas las escenas para que la voz sea una sola.
            if (os.environ.get("VOZ_MOTOR") or "kokoro").lower() == "kokoro":
                raise
            log(f"  Voz con {os.environ.get('VOZ_MOTOR')} falló; reintento con Kokoro. Detalle: {str(e)[:200]}")
            reportar(video["id"], agente="productor", paso="Voz principal falló: usando Kokoro", fase_detalle="Voz de respaldo (Kokoro)")
            # --forzar: todas las escenas con la misma voz (no mezclar Chatterbox y Kokoro)
            correr([PY, "scripts/generar_voz.py", str(carpeta), "--forzar"], video, "productor", "Voz (respaldo Kokoro)",
                   env_extra={"VOZ_MOTOR": "kokoro"})
    script_clips = "scripts/generar_clips_stock.py" if modo == "gratis" else "scripts/generar_clips.py"
    extra = ["--solo", ",".join(map(str, solo)), "--forzar"] if solo else []
    correr([PY, script_clips, str(carpeta), *extra], video, "productor", "Clips")
    reportar(video["id"], agente="productor", paso="Montando video y subtítulos", fase_detalle="Montando video y subtítulos")
    correr([PY, "scripts/ensamblar.py", str(carpeta)], video, "productor", "Montaje", timeout=900)
    dur = leer_json(carpeta / "produccion.json").get("ensamblado", {}).get("duracion_seg")
    reportar(video["id"], agente="productor", fin=True, duracion_seg=dur,
             resumen=f"V{video['ref']}: Short de {dur:.0f} s listo para validar" if dur else "Video montado")


def escribir_guion(video: dict, carpeta: Path, correccion: str | None) -> dict:
    estado = "cambios" if correccion else "guionando"
    reportar(video["id"], estado="guionando", carpeta=carpeta.name, agente="guionista",
             paso="Aplicando cambios" if correccion else "Escribiendo el guion", fase_detalle="Escribiendo el guion")
    claude(instrucciones_guion(carpeta, video.get("idea") or {}, correccion), video, "guionista",
           "Aplicando cambios al guion" if estado == "cambios" else "Escribiendo el guion")
    ruta = carpeta / "guion.json"
    if not ruta.exists():
        raise Fallo("El guionista no escribió guion.json")

    # El guion debe cumplir el esquema antes de producir: se normaliza y, si quedan errores,
    # se le devuelven al Guionista (máx. 2 veces).
    for intento in range(3):
        try:
            normalizar_guion(ruta, carpeta, video)
        except (json.JSONDecodeError, OSError) as e:
            errores = [f"guion.json no es un JSON válido: {e}"]
        else:
            errores = errores_guion(ruta, video)
        if not errores:
            break
        if intento == 2:
            raise Fallo("El guion sigue sin cumplir el formato tras 2 correcciones: " + "; ".join(errores[:5]))
        lista = "\n".join(f"- {x}" for x in errores[:40])
        try:  # se guardan las búsquedas de stock por si la corrección las borra
            busquedas = {e.get("n"): e.get("busqueda_stock") for e in leer_json(ruta).get("escenas", []) if e.get("busqueda_stock")}
        except (json.JSONDecodeError, OSError):
            busquedas = {}
        claude(f"""Corrige el archivo {ruta} para que cumpla EXACTAMENTE schemas/guion.schema.json.
El validador encontró estos errores:
{lista}

Conserva el contenido creativo (título, gancho, narración, búsquedas de stock); solo arregla la estructura y completa
los campos que falten. Plantilla de referencia con los nombres de campo correctos:
{PLANTILLA_GUION}

Vuelve a validar con: python scripts/validar_guion.py "{ruta}" --comparar proyectos/
Responde solo "listo" cuando no haya errores.""", video, "guionista", f"Corrigiendo formato del guion ({intento + 1}/2)", timeout=900)
        if busquedas:
            try:
                g2 = leer_json(ruta)
                for e in g2.get("escenas", []):
                    if not e.get("busqueda_stock") and busquedas.get(e.get("n")):
                        e["busqueda_stock"] = busquedas[e["n"]]
                escribir_json(ruta, g2)
            except (json.JSONDecodeError, OSError):
                pass

    correr([PY, "scripts/estimar_costo.py", str(ruta), "--modo", video.get("modo") or "gratis"], video, "guionista", "Costo", ok_codes=(0, 2))
    g = leer_json(ruta)
    costo = leer_json(carpeta / "costo_estimado.json")
    (carpeta / "guion.md").write_text(guion_markdown(g, video), encoding="utf-8")  # versión legible, 0 tokens
    resumen = {"titulo": g.get("titulo"), "gancho": g.get("gancho"), "escenas": len(g.get("escenas", [])),
               "segundos": sum(e.get("duracion_seg", 0) for e in g.get("escenas", [])), "idioma": g.get("idioma")}
    narracion = "\n".join(f"<b>{e['n']}.</b> {esc(e.get('narracion', ''))}" for e in g.get("escenas", []))
    aviso = (f"📝 <b>Guion listo</b> · <code>V{video['ref']}</code>\n<b>{esc(g.get('titulo', ''))}</b>\n"
             f"{resumen['escenas']} escenas · ~{resumen['segundos']} s · idioma {g.get('idioma', '?')} · "
             f"costo estimado ${costo.get('usd_total_estimado', 0)}\n\n{narracion}")
    reportar(video["id"], agente="guionista", fin=True, titulo=g.get("titulo") or video["titulo"],
             guion_resumen=resumen, costo_estimado_usd=costo.get("usd_total_estimado", 0),
             resumen=f"V{video['ref']}: guion de {resumen['escenas']} escenas (~{resumen['segundos']} s)",
             notificar=aviso[:3800] + "\n\n<i>Produciendo el video…</i>")
    return g


def guion_markdown(g: dict, video: dict) -> str:
    """Guion en texto legible para revisarlo en el PC o en Telegram (sin pasar por la IA)."""
    m = g.get("metadatos", {})
    lineas = [
        f"# {g.get('titulo', video['titulo'])}",
        "",
        f"- Video: V{video['ref']} · Idioma: {g.get('idioma', '?')} · Formato: {g.get('formato', 'short')} {g.get('aspect_ratio', '9:16')}",
        f"- Nicho: {g.get('nicho', '')}",
        f"- Duración aproximada: {sum(e.get('duracion_seg', 0) for e in g.get('escenas', []))} s en {len(g.get('escenas', []))} escenas",
        "",
        f"**Gancho:** {g.get('gancho', '')}",
        "",
        f"**Aporte original:** {g.get('aporte_original', '')}",
        "",
        "## Escenas",
        "",
        "| # | Seg | Narración | Clip de stock |",
        "|---|---|---|---|",
    ]
    for e in g.get("escenas", []):
        narr = str(e.get("narracion", "")).replace("|", "/").replace("\n", " ")
        lineas.append(f"| {e.get('n')} | {e.get('duracion_seg')} | {narr} | {e.get('busqueda_stock', '')} |")
    lineas += [
        "",
        "## YouTube",
        "",
        f"**Título:** {m.get('titulo_youtube', '')}",
        "",
        f"**Descripción:**\n\n{m.get('descripcion', '')}",
        "",
        f"**Etiquetas:** {', '.join(m.get('tags', []))}",
        "",
        "## Fuentes",
        "",
        *[f"- {f.get('titulo', '')} {f.get('url', '')}".strip() for f in g.get("fuentes", []) if isinstance(f, dict)],
    ]
    return "\n".join(lineas) + "\n"


def validar(video: dict, carpeta: Path) -> dict:
    reportar(video["id"], estado="validando", fase_detalle="Revisando guion y video")
    claude(instrucciones_validador(carpeta), video, "validador", "Revisando guion y video")
    ruta = carpeta / "reporte_validacion.json"
    if not ruta.exists():
        raise Fallo("El validador no escribió reporte_validacion.json")
    rep = leer_json(ruta)
    veredicto = str(rep.get("veredicto", "RECHAZADO")).upper()
    veredicto = "APROBADO" if veredicto.startswith("APROB") else "RECHAZADO"
    rep["veredicto"] = veredicto
    try:  # a veces el validador puntúa de 0 a 10: se lleva a 0-100
        p = float(rep.get("puntaje", 0))
        rep["puntaje"] = round(p * 10) if 0 < p <= 10 else round(p)
    except (TypeError, ValueError):
        pass
    escribir_json(ruta, rep)
    problemas = rep.get("problemas", [])
    reportar(video["id"], agente="validador", fin=True, veredicto=veredicto, problemas=problemas,
             resumen=f"V{video['ref']}: {veredicto} ({rep.get('puntaje', '?')}/100, {len(problemas)} problemas)")
    return rep


def enviar_para_revision(video: dict, carpeta: Path, rep: dict) -> None:
    final = carpeta / "final" / "video.mp4"
    aprobado = rep["veredicto"] == "APROBADO"
    g = leer_json(carpeta / "guion.json")
    problemas = rep.get("problemas", [])
    texto = (f"🎬 <b>Short listo para revisar</b> · <code>V{video['ref']}</code>\n<b>{esc(g.get('titulo', ''))}</b>\n"
             f"Validador: <b>{rep['veredicto']}</b> · {rep.get('puntaje', '?')}/100")
    if problemas:
        texto += "\n" + "\n".join(f"• {esc(p.get('detalle', ''))[:120]}" for p in problemas[:4])
    if rep.get("notas_para_humano"):
        texto += f"\n<i>{esc(rep['notas_para_humano'])[:250]}</i>"
    if not aprobado:
        texto += "\n\nNo pasó la validación tras 2 rondas: puedes pedir cambios o descartarlo."

    fila = [{"text": "✏️ Cambiar", "callback_data": f"chg:{video['ref']}"},
            {"text": "🗑️ Descartar", "callback_data": f"del:{video['ref']}"}]
    if aprobado:
        fila.insert(0, {"text": "✅ Publicar", "callback_data": f"pub:{video['ref']}"})

    reportar(video["id"], estado="revision", fase_detalle="Esperando tu revisión")
    chat = video.get("chat_id")
    if not (TG_TOKEN and chat):
        log("  (sin Telegram configurado: revisa el video en la carpeta del proyecto)")
        return
    envio = final
    if final.stat().st_size > 48 * 1024 * 1024:  # Telegram: máx. 50 MB para bots
        envio = carpeta / "final" / "video_telegram.mp4"
        correr(["ffmpeg", "-y", "-loglevel", "error", "-i", str(final), "-vf", "scale=720:-2", "-c:v", "libx264",
                "-crf", "28", "-c:a", "aac", "-b:a", "96k", str(envio)], video, "validador", "Versión liviana")
    with open(envio, "rb") as f:
        r = requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendVideo", timeout=300,
                          data={"chat_id": chat, "caption": texto[:1024], "parse_mode": "HTML", "supports_streaming": "true",
                                "reply_markup": json.dumps({"inline_keyboard": [fila]})},
                          files={"video": ("short.mp4", f, "video/mp4")})
    if not r.ok:
        log(f"  Telegram rechazó el video: {r.text[:300]}")
        reportar(video["id"], notificar=texto + "\n\n(No pude adjuntar el video; revísalo en el PC.)")
    # El guion legible como adjunto (enviar archivos no gasta tokens)
    md = carpeta / "guion.md"
    if md.exists():
        with open(md, "rb") as f:
            requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendDocument", timeout=60,
                          data={"chat_id": chat, "caption": f"📄 Guion de V{video['ref']} · carpeta {carpeta.name}"},
                          files={"document": (f"guion_V{video['ref']}.md", f, "text/markdown")})


def limpiar_produccion(carpeta: Path) -> None:
    """Borra voz y clips por escena (y el registro de stock) para regenerarlos desde el guion nuevo."""
    for sub in ("audio", "clips"):
        for f in (carpeta / sub).glob("escena_*"):
            f.unlink(missing_ok=True)
    (carpeta / "clips" / "stock.json").unlink(missing_ok=True)


def flujo_guion(video: dict) -> None:
    carpeta = preparar_carpeta(video)
    correccion = video.get("feedback") or None  # solo existe cuando pediste cambios con ✏️
    escribir_guion(video, carpeta, correccion)
    if correccion:
        limpiar_produccion(carpeta)  # el guion cambió: voz y clips viejos ya no sirven
    producir(video, carpeta)

    rep = validar(video, carpeta)
    ronda = 0
    while rep["veredicto"] != "APROBADO" and ronda < MAX_RONDAS:
        ronda += 1
        reportar(video["id"], intentos=ronda, fase_detalle=f"Corrigiendo (ronda {ronda} de {MAX_RONDAS})")
        problemas = rep.get("problemas", [])
        del_guion = [p for p in problemas if p.get("responsable") == "guionista"]
        if del_guion:
            lista = "\n".join(f"- [{p.get('severidad')}] escena {p.get('escena', '-')}: {p.get('detalle')} → {p.get('accion', '')}" for p in del_guion)
            escribir_guion(video, carpeta, f"El Validador rechazó el guion. Corrige TODOS estos problemas:\n{lista}")
            limpiar_produccion(carpeta)
            producir(video, carpeta)
        else:
            escenas = sorted({int(p["escena"]) for p in problemas if str(p.get("escena", "")).isdigit()})
            producir(video, carpeta, solo=escenas or None)
        rep = validar(video, carpeta)

    enviar_para_revision(video, carpeta, rep)


def flujo_publicar(video: dict) -> None:
    carpeta = RAIZ / "proyectos" / (video.get("carpeta") or "")
    if not video.get("carpeta") or not (carpeta / "final" / "video.mp4").exists():
        raise Fallo("No encuentro el video en el PC para subirlo")
    reportar(video["id"], agente="publicador", paso="Subiendo a YouTube (privado)", fase_detalle="Subiendo a YouTube")
    from servidores.youtube_server import subir_video  # noqa: PLC0415 — solo se carga al publicar

    g = leer_json(carpeta / "guion.json")
    m = g["metadatos"]
    desc = m["descripcion"] if "#shorts" in m["descripcion"].lower() else m["descripcion"] + "\n\n#Shorts"
    res = subir_video(ruta_video=str(carpeta / "final" / "video.mp4"), titulo=m["titulo_youtube"], descripcion=desc,
                      tags=m.get("tags", []), categoria_id=str(m.get("categoria_id", "27")),
                      ruta_reporte=str(carpeta / "reporte_validacion.json"), idioma=g.get("idioma", "es"),
                      privacidad="private", contenido_sintetico=bool(g.get("divulgacion_ia", True)))
    try:
        data = json.loads(res)
    except (TypeError, json.JSONDecodeError):
        data = {"ok": False, "error": str(res)}
    if not data.get("ok"):
        reportar(video["id"], estado="revision", agente="publicador", error=str(data.get("error") or res)[:400],
                 notificar=f"⚠️ No pude subir <code>V{video['ref']}</code>: {esc(str(data.get('error') or res))[:300]}\nCorrige y vuelve a tocar Publicar.")
        return
    escribir_json(carpeta / "publicacion.json", data)
    reportar(video["id"], estado="publicado", agente="publicador", fin=True, youtube_id=data["video_id"], youtube_url=data["url"],
             resumen=f"V{video['ref']} subido en privado", fase_detalle=None,
             notificar=(f"✅ <code>V{video['ref']}</code> subido a YouTube en <b>privado</b>, con divulgación de IA.\n"
                        f"Revísalo y hazlo público desde YouTube Studio:\n{data.get('studio') or data['url']}"))


# ----------------------------------------------------------------------------- bucle

def procesar(trabajo: dict) -> None:
    video = trabajo["video"]
    log(f"Trabajo: {trabajo['accion']} · V{video['ref']} «{video['titulo']}»")
    agente = "publicador" if trabajo["accion"] == "publicar" else "guionista"
    try:
        flujo_publicar(video) if trabajo["accion"] == "publicar" else flujo_guion(video)
        log(f"Listo V{video['ref']}")
    except Exception as e:  # noqa: BLE001
        detalle = str(e) if isinstance(e, Fallo) else f"{type(e).__name__}: {e}"
        log(f"ERROR V{video['ref']}: {detalle}\n{traceback.format_exc()}")
        reportar(video["id"], estado="error", error=detalle[:500], agente=agente, fase_detalle=None,
                 notificar=f"⚠️ <code>V{video['ref']}</code> se detuvo: {esc(detalle)[:350]}")


def probar() -> None:
    ok = True

    def chequeo(nombre: str, cond: bool, ayuda: str = "") -> None:
        nonlocal ok
        ok &= cond
        print(f"  {'✔' if cond else '✘'} {nombre}" + ("" if cond else f"  → {ayuda}"))

    print("Revisión del puente del estudio:")
    chequeo("JARVIS_URL y WORKER_SECRET en .env", bool(JARVIS and SECRETO), "complétalos en .env")
    chequeo("TELEGRAM_TOKEN en .env", bool(TG_TOKEN), "pega el token del bot para recibir los videos")
    chequeo("ffmpeg instalado", bool(shutil.which("ffmpeg")), "instálalo: winget install Gyan.FFmpeg")
    chequeo("Claude Code instalado", bool(os.environ.get("CLAUDE_CMD") or shutil.which("claude")), "ver README: Instalación en Windows")
    prov = (os.environ.get("STOCK_PROVEEDOR") or "pixabay").lower()
    chequeo(f"Llave de stock ({prov}) en .env", bool(os.environ.get(f"{prov.upper()}_API_KEY")),
            "crea una cuenta en pixabay.com y copia tu llave de pixabay.com/api/docs a PIXABAY_API_KEY")
    try:
        import kokoro  # noqa: F401, PLC0415
        chequeo("Kokoro (voz) instalado", True)
    except ImportError:
        chequeo("Kokoro (voz) instalado", False, "pip install -r requirements.txt")
    if (os.environ.get("VOZ_MOTOR") or "kokoro").lower() == "chatterbox":
        try:
            import torch  # noqa: PLC0415
            import chatterbox.mtl_tts  # noqa: F401, PLC0415
            chequeo("Chatterbox (voz natural) instalado", True)
            chequeo("GPU NVIDIA disponible para Chatterbox", torch.cuda.is_available(),
                    "instala PyTorch con CUDA (README → Voz natural); mientras tanto usará la CPU, mucho más lento")
        except Exception:  # noqa: BLE001
            chequeo("Chatterbox (voz natural) instalado", False, "README → Voz natural. Mientras tanto se usa Kokoro")
    chequeo("espeak-ng (voz en español/portugués)", bool(shutil.which("espeak-ng")) or Path(r"C:\Program Files\eSpeak NG").exists(),
            "instala el .msi de github.com/espeak-ng/espeak-ng/releases")
    chequeo("YouTube autorizado (para publicar)", (RAIZ / os.environ.get("YOUTUBE_TOKEN", "credenciales/token.json")).exists(),
            "python scripts/autorizar_youtube.py (puedes hacerlo después)")
    if JARVIS and SECRETO:
        try:
            api("GET", f"/api/studio/next?host={socket.gethostname()}&probar=1")
            chequeo("Conexión con JARVIS", True)
        except Exception as e:  # noqa: BLE001
            chequeo("Conexión con JARVIS", False, str(e)[:120])
    print("\nTodo listo." if ok else "\nCorrige lo marcado con ✘ y vuelve a probar.")


def main() -> None:
    if "--probar" in sys.argv:
        return probar()
    if not (JARVIS and SECRETO):
        sys.exit("Falta JARVIS_URL o WORKER_SECRET en .env. Ejecuta: python puente.py --probar")
    una = "--una-vez" in sys.argv
    log(f"Puente del estudio conectado a {JARVIS}. Esperando trabajo… (Ctrl+C para salir)")
    host = socket.gethostname()
    while True:
        try:
            t = api("GET", f"/api/studio/next?host={host}").get("trabajo")
            if t:
                procesar(t)
                continue  # puede haber más en cola
            if una:
                return
        except requests.RequestException as e:
            log(f"Sin conexión con JARVIS ({e.__class__.__name__}); reintento en {INTERVALO * 3} s")
            time.sleep(INTERVALO * 2)
        except KeyboardInterrupt:
            log("Puente detenido.")
            return
        time.sleep(INTERVALO)


if __name__ == "__main__":
    main()
