"use client";
/**
 * Oficina de JARVIS: los agentes como personajes que trabajan en salas por proyecto.
 * Motor: Pixel Agents (MIT, vendor/pixel-agents). Datos: los mismos de useJarvis (Supabase Realtime).
 * No gasta tokens: solo dibuja lo que ya pasa en la base de datos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JarvisState } from "@/components/useJarvis";
import type { AgentRow, AgentRun, Project } from "@/lib/types";
import { cargarAssetsOficina } from "@/lib/oficina/assets";
import { generarPlano, type Plano, type SalaPlano, type SalaSpec } from "@/lib/oficina/layout";
import { OfficeCanvas } from "@/vendor/pixel-agents/webview-ui/src/office/components/OfficeCanvas";
import { EditorState } from "@/vendor/pixel-agents/webview-ui/src/office/editor/editorState";
import { OfficeState } from "@/vendor/pixel-agents/webview-ui/src/office/engine/officeState";
import { overlayProjection } from "@/vendor/pixel-agents/webview-ui/src/office/projection";
import { setProviderCapabilities } from "@/vendor/pixel-agents/webview-ui/src/office/toolUtils";
import { CharacterState, TILE_SIZE } from "@/vendor/pixel-agents/webview-ui/src/office/types";

setProviderCapabilities({ readingTools: ["leer"], subagentToolNames: [] });

const ESTUDIO = new Set(["explorador", "investigador", "guionista", "productor", "validador", "publicador"]);
const LECTURA = /(investig|busc|revis|valid|analiz|leyend|explor|tendenc|verific|calific)/i;
const NOTA_SEG = 25; // segundos que se ve "listo" o "error" sobre la cabeza

type Nota = { tipo: "ok" | "error"; texto: string; hasta: number };

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Salas: el Núcleo (JARVIS) + cada proyecto activo o con agentes asignados. */
function salasDe(projects: Project[], agents: AgentRow[]): SalaSpec[] {
  const conAgentes = new Set(agents.map((a) => a.project_id).filter(Boolean));
  const estudio = projects.find((p) => p.slug === "youtube-shorts");
  const out: SalaSpec[] = [{ slug: "nucleo", nombre: "Núcleo JARVIS", tipo: "nucleo", tono: 195 }];
  const lista = projects
    .filter((p) => p.slug !== "jarvis-core" && (p.status === "activo" || conAgentes.has(p.id) || p.id === estudio?.id))
    .sort((a, b) => (a.status === "activo" ? 0 : 1) - (b.status === "activo" ? 0 : 1));
  for (const p of lista) out.push({ slug: p.slug, nombre: p.name, tipo: "proyecto", tono: hash(p.slug) % 360 });
  return out;
}

/** Sala de cada agente: la de su proyecto; el estudio de YouTube por defecto para sus agentes; si no, el Núcleo. */
function salaDeAgente(a: AgentRow, projects: Project[], salas: SalaPlano[]): SalaPlano {
  const porSlug = (slug: string) => salas.find((s) => s.slug === slug);
  const proyecto = a.project_id ? projects.find((p) => p.id === a.project_id) : undefined;
  return (proyecto && porSlug(proyecto.slug)) || (ESTUDIO.has(a.slug) && porSlug("youtube-shorts")) || salas[0];
}

function ago(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace segundos";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function OficinaView({ s }: { s: JarvisState }) {
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [zoom, setZoom] = useState(3);
  const [seleccion, setSeleccion] = useState<string | null>(null); // slug del agente
  const [, setTick] = useState(0);
  const panRef = useRef({ x: 0, y: 0 });
  const contRef = useRef<HTMLDivElement>(null);
  const osRef = useRef<OfficeState | null>(null);
  const editor = useMemo(() => new EditorState(), []);
  const idsRef = useRef(new Map<string, number>()); // slug → id de personaje
  const notasRef = useRef(new Map<string, Nota>());
  const runsVistos = useRef<Map<string, AgentRun["status"]> | null>(null);
  const planoRef = useRef<Plano | null>(null);
  const firmaRef = useRef("");

  // 1) Sprites del motor (una vez)
  useEffect(() => {
    cargarAssetsOficina().then(() => setListo(true)).catch((e) => setFallo(e instanceof Error ? e.message : String(e)));
  }, []);

  const specs = useMemo(() => salasDe(s.projects, s.agents), [s.projects, s.agents]);
  const plano = useMemo(() => generarPlano(specs), [specs]);

  const agentesActivos = useMemo(() => s.agents.filter((a) => a.enabled), [s.agents]);
  const porSlug = useMemo(() => new Map(s.agents.map((a) => [a.slug, a])), [s.agents]);
  const porId = useMemo(() => new Map(s.agents.map((a) => [a.id, a])), [s.agents]);

  const ajustarZoom = useCallback(() => {
    const el = contRef.current;
    if (!el || !planoRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const { cols, rows } = planoRef.current.layout;
    const r = el.getBoundingClientRect();
    const z = Math.floor(Math.min((r.width * dpr) / (cols * TILE_SIZE), (r.height * dpr) / (rows * TILE_SIZE)));
    setZoom(Math.max(1, Math.min(10, z)));
    panRef.current = { x: 0, y: 0 };
  }, []);

  // 2) Plano: se reconstruye solo si cambian las salas
  useEffect(() => {
    if (!listo) return;
    const firma = specs.map((x) => x.slug).join("|");
    if (!osRef.current) osRef.current = new OfficeState(plano.layout);
    else if (firma !== firmaRef.current) {
      osRef.current.rebuildFromLayout(plano.layout);
      for (const id of idsRef.current.values()) osRef.current.removeAgent(id);
      idsRef.current.clear();
    }
    firmaRef.current = firma;
    planoRef.current = plano;
    ajustarZoom();
  }, [listo, plano, specs, ajustarZoom]);

  useEffect(() => {
    window.addEventListener("resize", ajustarZoom);
    return () => window.removeEventListener("resize", ajustarZoom);
  }, [ajustarZoom]);

  // 3) Personajes ← agentes y ejecuciones (cada cambio en Supabase)
  useEffect(() => {
    const os = osRef.current;
    const pl = planoRef.current;
    if (!listo || !os || !pl) return;

    // Altas y bajas
    const vivos = new Set(agentesActivos.map((a) => a.slug));
    for (const [slug, id] of idsRef.current) {
      if (!vivos.has(slug)) {
        os.removeAgent(id);
        idsRef.current.delete(slug);
      }
    }
    const ocupadas = new Map<string, number>(); // sala → sillas usadas
    const ordenados = [...agentesActivos].sort((a, b) => a.position - b.position);
    for (const a of ordenados) {
      const sala = salaDeAgente(a, s.projects, pl.salas);
      const n = ocupadas.get(sala.slug) ?? 0;
      ocupadas.set(sala.slug, n + 1);
      if (idsRef.current.has(a.slug)) continue;
      const id = 1 + Math.max(0, ...idsRef.current.values());
      idsRef.current.set(a.slug, id);
      const silla = sala.sillas[n]; // líder = primera silla de la sala
      const paleta = a.slug === "jarvis" ? 0 : a.position % 6;
      os.addAgent(id, paleta, a.slug === "jarvis" ? 0 : (Math.floor(a.position / 6) * 47) % 360, silla, false, sala.slug);
      const ch = os.characters.get(id);
      if (ch) ch.agentName = a.name;
    }

    // Actividad
    const ultimoRun = new Map<string, AgentRun>();
    for (const r of s.runs) if (!ultimoRun.has(r.agent_id)) ultimoRun.set(r.agent_id, r); // runs vienen del más nuevo al más viejo
    for (const a of agentesActivos) {
      const id = idsRef.current.get(a.slug);
      if (id === undefined) continue;
      const run = ultimoRun.get(a.id);
      const trabajando = a.status === "working" || run?.status === "running" || run?.status === "queued";
      const paso = run?.current_step ?? a.last_summary ?? "";
      os.setAgentTool(id, trabajando ? (LECTURA.test(paso) ? "leer" : "escribir") : null);
      const ch = os.characters.get(id);
      if (ch && ch.isActive !== trabajando) os.setAgentActive(id, trabajando);
    }

    // Entregas y avisos: solo para ejecuciones nuevas o que cambiaron (no en la primera carga)
    const vistos = runsVistos.current;
    const ahora = Date.now();
    if (vistos) {
      for (const r of [...s.runs].reverse()) {
        const antes = vistos.get(r.id);
        const agente = porId.get(r.agent_id);
        if (!agente) continue;
        const idAgente = idsRef.current.get(agente.slug);
        if (antes === undefined && (r.status === "queued" || r.status === "running")) {
          // ¿Quién le entrega el trabajo? El agente de la ejecución anterior del mismo video/ejecución padre, o JARVIS
          const previa = r.parent_run_id
            ? s.runs.find((x) => x.id === r.parent_run_id)
            : r.video_id
              ? s.runs.find((x) => x.video_id === r.video_id && x.id !== r.id && x.created_at <= r.created_at)
              : undefined;
          const quien = previa ? porId.get(previa.agent_id)?.slug : "jarvis";
          if (quien && quien !== agente.slug) entregar(quien, agente.slug);
        }
        if (antes !== undefined && antes !== r.status && idAgente !== undefined) {
          if (r.status === "done") {
            os.showWaitingBubble(idAgente);
            notasRef.current.set(agente.slug, { tipo: "ok", texto: r.summary ?? "Trabajo terminado", hasta: ahora + NOTA_SEG * 1000 });
          } else if (r.status === "error") {
            notasRef.current.set(agente.slug, { tipo: "error", texto: r.error ?? "Se detuvo", hasta: ahora + NOTA_SEG * 1000 });
          }
        }
      }
    }
    runsVistos.current = new Map(s.runs.map((r) => [r.id, r.status]));

    function entregar(de: string, para: string) {
      const idDe = idsRef.current.get(de);
      const destino = porSlug.get(para);
      if (idDe === undefined || !destino || !os || !pl) return;
      const sala = salaDeAgente(destino, s.projects, pl.salas);
      const idx = [...agentesActivos]
        .sort((a, b) => a.position - b.position)
        .filter((x) => salaDeAgente(x, s.projects, pl.salas).slug === sala.slug)
        .findIndex((x) => x.slug === para);
      const punto = sala.entregas[Math.max(0, idx)];
      if (!punto) return;
      const ch = os.characters.get(idDe);
      if (!ch) return;
      if (os.walkToTile(idDe, punto.col, punto.row)) {
        notasRef.current.set(de, { tipo: "ok", texto: `Entregando a ${destino.name}…`, hasta: Date.now() + 9000 });
        // Vuelve a su puesto cuando llega (o a los 15 s como máximo)
        const inicio = Date.now();
        const vigilar = window.setInterval(() => {
          const c = os.characters.get(idDe);
          const llego = c && c.state !== CharacterState.WALK && c.tileCol === punto.col && c.tileRow === punto.row;
          if (!c || llego || Date.now() - inicio > 15000) {
            window.clearInterval(vigilar);
            window.setTimeout(() => os.sendToSeat(idDe), llego ? 1800 : 0);
          }
        }, 300);
      }
    }
  }, [listo, s.runs, s.projects, agentesActivos, porId, porSlug, plano]);

  // 4) Superposición (nombres, globos, pantallas) a 30 fps
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) {
        last = t;
        setTick((n) => (n + 1) % 1e6);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onClickAgente = useCallback((id: number) => {
    const slug = [...idsRef.current].find(([, v]) => v === id)?.[0] ?? null;
    setSeleccion((prev) => (prev === slug ? null : slug));
  }, []);

  const os = osRef.current;
  const el = contRef.current;
  const pl = planoRef.current;
  const proj =
    os && el && pl
      ? overlayProjection(pl.layout, el.getBoundingClientRect(), zoom, panRef.current, window.devicePixelRatio || 1)
      : null;
  const pxTile = proj ? proj.toScreenX(TILE_SIZE) - proj.toScreenX(0) : 0;
  const agenteSel = seleccion ? porSlug.get(seleccion) : undefined;

  const pcConectado = s.heartbeat ? Date.now() - new Date(s.heartbeat).getTime() < 3 * 60 * 1000 : false;
  const errores24h = s.runs.filter((r) => r.status === "error" && Date.now() - new Date(r.created_at).getTime() < 86400000).length;

  return (
    <section className="oficina">
      <div className="oficina-barra">
        <h2>Oficina</h2>
        <span className="muted small">
          {agentesActivos.filter((a) => a.status === "working" || s.runs.some((r) => r.agent_id === a.id && (r.status === "running" || r.status === "queued"))).length} trabajando · {agentesActivos.length} agentes · {specs.length} salas
        </span>
        <div className="oficina-acciones">
          <button className="btn btn-ghost small" onClick={() => setZoom((z) => Math.max(1, z - 1))} aria-label="Alejar">−</button>
          <button className="btn btn-ghost small" onClick={ajustarZoom}>Ajustar</button>
          <button className="btn btn-ghost small" onClick={() => setZoom((z) => Math.min(10, z + 1))} aria-label="Acercar">+</button>
        </div>
      </div>

      <div className="oficina-escena" ref={contRef}>
        {fallo && <p className="oficina-aviso">No pude cargar la oficina: {fallo}</p>}
        {!listo && !fallo && <p className="oficina-aviso">Encendiendo la oficina…</p>}
        {listo && os && (
          <OfficeCanvas
            officeState={os}
            onClick={onClickAgente}
            isEditMode={false}
            editorState={editor}
            onEditorTileAction={() => {}}
            onEditorEraseAction={() => {}}
            onEditorSelectionChange={() => {}}
            onDeleteSelected={() => {}}
            onRotateSelected={() => {}}
            onDrop={() => {}}
            editorTick={0}
            zoom={zoom}
            onZoomChange={setZoom}
            panRef={panRef}
            showAreas={false}
            activeAreaLabel={null}
          />
        )}

        {proj && os && pl && (
          <div className="oficina-capa" aria-hidden="false">
            {/* Pantalla de pared de cada sala */}
            {pl.salas.map((sala) => {
              const left = proj.toScreenX(sala.col * TILE_SIZE);
              const top = proj.toScreenY((sala.row - 1) * TILE_SIZE) - pxTile * 0.95;
              const width = sala.w * pxTile;
              const proyecto = s.projects.find((p) => p.slug === sala.slug);
              const tareas = proyecto ? s.tasks.filter((t) => t.project_id === proyecto.id) : [];
              const hechas = tareas.filter((t) => t.status === "hecha").length;
              const curso = tareas.filter((t) => t.status === "en_curso").length;
              const agentesSala = agentesActivos.filter((a) => salaDeAgente(a, s.projects, pl.salas).slug === sala.slug);
              const errSala = s.runs.filter(
                (r) => r.status === "error" && agentesSala.some((a) => a.id === r.agent_id) && Date.now() - new Date(r.created_at).getTime() < 86400000,
              ).length;
              const pct = Math.round((s.spend.spent / Math.max(0.01, s.spend.budget)) * 100);
              return (
                <div key={sala.slug} className={`pared ${sala.tipo}`} style={{ left, top, width, fontSize: Math.max(9, pxTile * 0.32) }}>
                  <b>{sala.nombre}</b>
                  {sala.tipo === "nucleo" ? (
                    <span>
                      API ${s.spend.spent.toFixed(2)}/{s.spend.budget} <i className="barra"><i style={{ width: `${Math.min(100, pct)}%` }} /></i>
                      {" · "}PC {pcConectado ? <em className="ok">en línea</em> : <em className="mal">desconectado</em>}
                      {errores24h > 0 && <> · <em className="mal">{errores24h} alerta{errores24h > 1 ? "s" : ""}</em></>}
                    </span>
                  ) : (
                    <span>
                      {proyecto?.status ?? ""} · ◐ {curso} · ● {hechas}/{tareas.length}
                      {errSala > 0 && <> · <em className="mal">⚠ {errSala}</em></>}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Nombre y globo de cada agente */}
            {agentesActivos.map((a) => {
              const id = idsRef.current.get(a.slug);
              const ch = id !== undefined ? os.characters.get(id) : undefined;
              if (!ch) return null;
              const sentado = ch.state === CharacterState.TYPE ? 6 : 0;
              const x = proj.toScreenX(ch.x);
              const yCabeza = proj.toScreenY(ch.y + sentado - 26);
              const run = s.runs.find((r) => r.agent_id === a.id);
              const nota = notasRef.current.get(a.slug);
              const notaViva = nota && nota.hasta > Date.now() ? nota : undefined;
              const trabajando = ch.isActive;
              const texto = notaViva?.texto ?? (trabajando ? run?.current_step || "Trabajando…" : null);
              const sel = seleccion === a.slug;
              return (
                <div key={a.slug} className="agente-capa" style={{ left: x, top: yCabeza, fontSize: Math.max(8, Math.min(12, pxTile * 0.36)) }}>
                  {texto && (sel || trabajando || notaViva) && (
                    <div className={`globo ${notaViva?.tipo ?? "trabajo"}`}>{texto.length > 60 && !sel ? `${texto.slice(0, 57)}…` : texto}</div>
                  )}
                  <div className={`nombre ${a.slug === "jarvis" ? "jarvis" : ""} ${sel ? "sel" : ""} ${trabajando ? "activo" : ""}`}>
                    {a.slug === "jarvis" ? "J.A.R.V.I.S." : a.name}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {agenteSel && <PanelAgente a={agenteSel} runs={s.runs.filter((r) => r.agent_id === agenteSel.id)} onClose={() => setSeleccion(null)} />}
      <p className="muted small oficina-ayuda">
        Toca un agente para ver qué hace · arrastra para moverte · rueda o pellizco para acercar. En el celular, usa el teléfono en horizontal.
      </p>
    </section>
  );
}

function PanelAgente({ a, runs, onClose }: { a: AgentRow; runs: AgentRun[]; onClose: () => void }) {
  const actual = runs.find((r) => r.status === "running" || r.status === "queued");
  const costo = runs.reduce((t, r) => t + (Number(r.cost_usd) || 0), 0);
  return (
    <aside className="panel oficina-panel" aria-label={`Detalle de ${a.name}`}>
      <div className="panel-title">
        <h3>{a.name}</h3>
        <button className="btn btn-ghost small" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <p className="muted small">
        {a.role} · {a.runtime === "local" ? "motor local (tu PC)" : a.runtime === "api" ? "servidor" : "chat Claude"} · {a.model.replace("claude-", "")}
      </p>
      <p>
        <span className={`estado-punto ${a.status}`} /> {a.status === "working" ? "Trabajando" : a.status === "error" ? "Con error" : "Libre"}
        {actual?.current_step && <> — <i>{actual.current_step}</i></>}
      </p>
      {a.last_summary && (
        <p className="small">
          <b>Último trabajo:</b> {a.last_summary} <span className="muted">({ago(a.last_run_at)})</span>
        </p>
      )}
      <p className="muted small">Gasto en las últimas {runs.length} ejecuciones: ${costo.toFixed(3)}</p>
      <ul className="oficina-historial">
        {runs.slice(0, 6).map((r) => (
          <li key={r.id}>
            <span className={`estado-punto ${r.status === "done" ? "idle" : r.status === "error" ? "error" : "working"}`} />
            <span className="small">{(r.summary || r.input || "").slice(0, 90)}</span>
            <span className="muted small"> · {ago(r.created_at)}</span>
          </li>
        ))}
        {runs.length === 0 && <li className="muted small">Sin trabajos todavía.</li>}
      </ul>
    </aside>
  );
}
