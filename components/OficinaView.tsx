"use client";
/**
 * Oficina 3D de JARVIS: los agentes son robots con armadura que trabajan en salas por proyecto.
 * Datos: los mismos de useJarvis (Supabase Realtime). No gasta tokens: solo dibuja lo que ya pasa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JarvisState } from "@/components/useJarvis";
import type { AgentRow, AgentRun, Project } from "@/lib/types";
import { generarPlano, type Puesto, type Sala, type SalaSpec } from "@/lib/oficina/plano";
import { Mundo } from "@/lib/oficina/mundo";
import { Escena, type InfoRobot, type InfoSala } from "@/components/oficina3d/Escena";

const ESTUDIO = new Set(["explorador", "investigador", "guionista", "productor", "validador", "publicador"]);
const NOTA_MS = 25000; // tiempo que se ve "listo" o "error" sobre la cabeza

type Nota = { tipo: "ok" | "error"; texto: string; hasta: number };

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Salas: el Núcleo (JARVIS) + cada proyecto activo o con agentes asignados. */
function salasDe(projects: Project[], agents: AgentRow[]): SalaSpec[] {
  const conAgentes = new Set(agents.map((a) => a.project_id).filter(Boolean));
  const out: SalaSpec[] = [{ slug: "nucleo", nombre: "Núcleo JARVIS", tipo: "nucleo", tono: 195 }];
  const lista = projects
    .filter((p) => p.slug !== "jarvis-core" && (p.status === "activo" || conAgentes.has(p.id) || p.slug === "youtube-shorts"))
    .sort((a, b) => (a.status === "activo" ? 0 : 1) - (b.status === "activo" ? 0 : 1));
  for (const p of lista) out.push({ slug: p.slug, nombre: p.name, tipo: "proyecto", tono: hash(p.slug) % 360 });
  return out;
}

/** Sala de cada agente: la de su proyecto; los agentes del estudio van a YouTube; si no, el Núcleo. */
function salaDeAgente(a: AgentRow, projects: Project[], salas: Sala[]): Sala {
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

const enCurso = (r?: AgentRun) => r?.status === "running" || r?.status === "queued";

export function OficinaView({ s }: { s: JarvisState }) {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [ajustar, setAjustar] = useState(0);
  const [, setReloj] = useState(0);
  const notas = useRef(new Map<string, Nota>());
  const runsVistos = useRef<Map<string, AgentRun["status"]> | null>(null);

  const specs = useMemo(() => salasDe(s.projects, s.agents), [s.projects, s.agents]);
  const firma = specs.map((x) => `${x.slug}:${x.nombre}`).join("|");
  // El plano solo se regenera si cambian las salas (no en cada actualización de datos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plano = useMemo(() => generarPlano(specs), [firma]);
  const mundo = useMemo(() => new Mundo(plano), [plano]);

  const activos = useMemo(() => s.agents.filter((a) => a.enabled).sort((a, b) => a.position - b.position), [s.agents]);
  const porId = useMemo(() => new Map(s.agents.map((a) => [a.id, a])), [s.agents]);
  const ultimoRun = useMemo(() => {
    const m = new Map<string, AgentRun>();
    for (const r of s.runs) if (!m.has(r.agent_id)) m.set(r.agent_id, r); // vienen del más nuevo al más viejo
    return m;
  }, [s.runs]);

  // Puesto de cada agente: el primero de cada sala es el líder (primer escritorio)
  const asignacion = useMemo(() => {
    const usados = new Map<string, number>();
    const out = new Map<string, { sala: Sala; puesto: Puesto; lider: boolean }>();
    for (const a of activos) {
      const sala = salaDeAgente(a, s.projects, plano.salas);
      const n = usados.get(sala.slug) ?? 0;
      if (n >= sala.puestos.length) continue; // sala llena
      usados.set(sala.slug, n + 1);
      out.set(a.slug, { sala, puesto: sala.puestos[n], lider: n === 0 });
    }
    return out;
  }, [activos, s.projects, plano]);

  const trabajando = useCallback((a: AgentRow) => a.status === "working" || enCurso(ultimoRun.get(a.id)), [ultimoRun]);

  // Robots ← agentes (altas, bajas y si están trabajando)
  useEffect(() => {
    for (const slug of [...mundo.robots.keys()]) if (!asignacion.has(slug)) mundo.quitar(slug);
    for (const a of activos) {
      const as = asignacion.get(a.slug);
      if (!as) continue;
      mundo.colocar(a.slug, as.sala, as.puesto, trabajando(a));
      mundo.setTrabajando(a.slug, trabajando(a));
    }
  }, [mundo, activos, asignacion, trabajando]);

  // Entregas y gestos: solo para ejecuciones nuevas o que cambiaron (no en la primera carga)
  useEffect(() => {
    const vistos = runsVistos.current;
    const ahora = Date.now();
    if (vistos) {
      for (const r of [...s.runs].reverse()) {
        const antes = vistos.get(r.id);
        const agente = porId.get(r.agent_id);
        if (!agente) continue;
        if (antes === undefined && enCurso(r)) {
          // ¿Quién le entrega el trabajo? El agente de la ejecución padre o de la anterior del mismo video; si no, JARVIS
          const previa = r.parent_run_id
            ? s.runs.find((x) => x.id === r.parent_run_id)
            : r.video_id
              ? s.runs.find((x) => x.video_id === r.video_id && x.id !== r.id && x.created_at <= r.created_at)
              : undefined;
          const quien = previa ? porId.get(previa.agent_id)?.slug : "jarvis";
          if (quien && quien !== agente.slug) {
            mundo.entregar(quien, agente.slug);
            notas.current.set(quien, { tipo: "ok", texto: `Entregando a ${agente.name}…`, hasta: ahora + 9000 });
          }
        }
        if (antes !== undefined && antes !== r.status) {
          if (r.status === "done") {
            mundo.gesto(agente.slug, "ThumbsUp", 2600);
            notas.current.set(agente.slug, { tipo: "ok", texto: r.summary ?? "Trabajo terminado", hasta: ahora + NOTA_MS });
          } else if (r.status === "error") {
            mundo.gesto(agente.slug, "No", 2600);
            notas.current.set(agente.slug, { tipo: "error", texto: r.error ?? "Se detuvo", hasta: ahora + NOTA_MS });
          }
        }
      }
    }
    runsVistos.current = new Map(s.runs.map((r) => [r.id, r.status]));
  }, [s.runs, porId, mundo]);

  // Refresca globos y notas cada segundo
  useEffect(() => {
    const t = window.setInterval(() => setReloj((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const pcConectado = s.heartbeat ? Date.now() - new Date(s.heartbeat).getTime() < 3 * 60 * 1000 : false;
  const errores24h = s.runs.filter((r) => r.status === "error" && Date.now() - new Date(r.created_at).getTime() < 86400000).length;
  const nTrabajando = activos.filter(trabajando).length;

  const robots: InfoRobot[] = activos
    .filter((a) => asignacion.has(a.slug))
    .map((a) => {
      const run = ultimoRun.get(a.id);
      const nota = notas.current.get(a.slug);
      const viva = nota && nota.hasta > Date.now() ? nota : undefined;
      const sel = seleccion === a.slug;
      const texto = viva?.texto ?? (trabajando(a) ? run?.current_step || "Trabajando…" : sel ? a.last_summary || "Libre" : null);
      return {
        slug: a.slug,
        nombre: a.name,
        esJarvis: a.slug === "jarvis",
        armadura: asignacion.get(a.slug)?.lider ? 0 : a.position,
        globo: texto ? { texto: texto.length > 70 && !sel ? `${texto.slice(0, 67)}…` : texto, tipo: viva?.tipo ?? "trabajo" } : null,
        seleccionado: sel,
      };
    });

  const puestosEncendidos = new Set<Puesto>(
    activos.filter(trabajando).map((a) => asignacion.get(a.slug)?.puesto).filter((p): p is Puesto => !!p),
  );

  const paredes: InfoSala[] = plano.salas.map((sala) => {
    const proyecto = s.projects.find((p) => p.slug === sala.slug);
    const tareas = proyecto ? s.tasks.filter((t) => t.project_id === proyecto.id) : [];
    const hechas = tareas.filter((t) => t.status === "hecha").length;
    const curso = tareas.filter((t) => t.status === "en_curso").length;
    const deSala = activos.filter((a) => asignacion.get(a.slug)?.sala.slug === sala.slug);
    const errSala = s.runs.filter(
      (r) => r.status === "error" && deSala.some((a) => a.id === r.agent_id) && Date.now() - new Date(r.created_at).getTime() < 86400000,
    ).length;
    const pct = Math.round((s.spend.spent / Math.max(0.01, s.spend.budget)) * 100);
    return {
      slug: sala.slug,
      contenido: (
        <>
          <b>{sala.nombre}</b>
          {sala.tipo === "nucleo" ? (
            <span>
              API ${s.spend.spent.toFixed(2)}/{s.spend.budget} <i className="barra"><i style={{ width: `${Math.min(100, pct)}%` }} /></i>
              {" · "}PC {pcConectado ? <em className="ok">en línea</em> : <em className="mal">desconectado</em>}
              {errores24h > 0 && <> · <em className="mal">{errores24h} alerta{errores24h > 1 ? "s" : ""}</em></>}
            </span>
          ) : (
            <span>
              {proyecto?.status ?? ""} · {deSala.length} agente{deSala.length === 1 ? "" : "s"} · ◐ {curso} · ● {hechas}/{tareas.length}
              {errSala > 0 && <> · <em className="mal">⚠ {errSala}</em></>}
            </span>
          )}
        </>
      ),
    };
  });

  const agenteSel = seleccion ? s.agents.find((a) => a.slug === seleccion) : undefined;

  return (
    <section className="oficina">
      <div className="oficina-barra">
        <h2>Oficina</h2>
        <span className="muted small">
          {nTrabajando} trabajando · {activos.length} agentes · {specs.length} salas
        </span>
        <div className="oficina-acciones">
          <button className="btn btn-ghost small" onClick={() => { setSeleccion(null); setAjustar((n) => n + 1); }}>
            Ver todo
          </button>
        </div>
      </div>

      <div className="oficina-escena">
        <Escena
          plano={plano}
          mundo={mundo}
          robots={robots}
          paredes={paredes}
          puestosEncendidos={puestosEncendidos}
          onSeleccionar={setSeleccion}
          enfocar={seleccion}
          ajustarClave={ajustar}
        />
      </div>

      {agenteSel && <PanelAgente a={agenteSel} runs={s.runs.filter((r) => r.agent_id === agenteSel.id)} onClose={() => setSeleccion(null)} />}
      <p className="muted small oficina-ayuda">
        Toca un robot para ver qué hace · arrastra para girar · clic derecho o dos dedos para moverte · rueda o pellizco para acercar.
      </p>
    </section>
  );
}

function PanelAgente({ a, runs, onClose }: { a: AgentRow; runs: AgentRun[]; onClose: () => void }) {
  const actual = runs.find(enCurso);
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
        <span className={`estado-punto ${actual ? "working" : a.status}`} /> {actual || a.status === "working" ? "Trabajando" : a.status === "error" ? "Con error" : "Libre"}
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
