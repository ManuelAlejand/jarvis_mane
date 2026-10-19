"""Genera un clip de video por escena con Kling.

Uso: python scripts/generar_clips.py proyectos/<id> [--solo 3,4] [--forzar]
Salida: clips/escena_XX.mp4. Reanudable: guarda los task_id en clips/tareas.json
y no regenera clips existentes. Envía hasta KLING_CONCURRENCIA tareas a la vez.
"""
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (carpeta_proyecto, env, escribir_json, leer_json,  # noqa: E402
                   nombre_escena, registrar_produccion)
from kling_client import Kling, KlingError  # noqa: E402


def construir_prompt(g: dict, e: dict) -> str:
    partes = [e["prompt_visual"].strip()]
    pid = e.get("personaje")
    if pid:
        p = next((x for x in g.get("personajes", []) if x["id"] == pid), None)
        if p and p["descripcion_visual"][:40].lower() not in e["prompt_visual"].lower():
            partes.insert(0, p["descripcion_visual"].strip())
    if g.get("estilo_visual"):
        partes.append(g["estilo_visual"])
    return ". ".join(partes)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    proyecto = carpeta_proyecto(sys.argv[1])
    forzar = "--forzar" in sys.argv
    solo = None
    if "--solo" in sys.argv:
        solo = {int(x) for x in sys.argv[sys.argv.index("--solo") + 1].split(",")}

    g = leer_json(proyecto / "guion.json")
    clips = proyecto / "clips"
    clips.mkdir(exist_ok=True)
    ruta_tareas = clips / "tareas.json"
    tareas = leer_json(ruta_tareas) if ruta_tareas.exists() else {}
    kling = Kling()

    pendientes = []
    for e in g["escenas"]:
        if solo and e["n"] not in solo:
            continue
        destino = clips / f"{nombre_escena(e['n'])}.mp4"
        if destino.exists() and not forzar:
            continue
        pendientes.append(e)

    def procesar(e: dict) -> dict:
        clave = str(e["n"])
        destino = clips / f"{nombre_escena(e['n'])}.mp4"
        try:
            task_id = None if forzar else tareas.get(clave)
            if not task_id:
                task_id = kling.crear_texto_a_video(
                    construir_prompt(g, e), e["duracion_seg"], g["aspect_ratio"],
                    e.get("prompt_negativo", ""))
                tareas[clave] = task_id
                escribir_json(ruta_tareas, tareas)
            url = kling.esperar(task_id)
            kling.descargar(url, destino)
            return {"n": e["n"], "estado": "ok", "task_id": task_id}
        except KlingError as err:
            tareas.pop(clave, None)
            escribir_json(ruta_tareas, tareas)
            return {"n": e["n"], "estado": "error", "detalle": str(err)[:500]}

    hilos = int(env("KLING_CONCURRENCIA", "3"))
    resultados = []
    print(f"Generando {len(pendientes)} clips con Kling ({kling.modelo}, {hilos} en paralelo)...")
    with ThreadPoolExecutor(max_workers=hilos) as pool:
        for fut in as_completed([pool.submit(procesar, e) for e in pendientes]):
            r = fut.result()
            resultados.append(r)
            print(f"  escena {r['n']}: {r['estado']} {r.get('detalle', '')}", flush=True)

    faltan = [e["n"] for e in g["escenas"]
              if not (clips / f"{nombre_escena(e['n'])}.mp4").exists()]
    registrar_produccion(proyecto, "clips", {"resultados": sorted(resultados, key=lambda x: x["n"]),
                                             "faltantes": faltan})
    if faltan:
        print(f"FALTAN clips de las escenas: {faltan}. Revisa los errores y vuelve a correr.")
        sys.exit(1)
    print("Todos los clips listos.")


if __name__ == "__main__":
    main()
