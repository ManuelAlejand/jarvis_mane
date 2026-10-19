"use client";
import { useMemo, useRef, useState } from "react";
import { Reactor } from "@/components/Reactor";
import { projectProgress, type JarvisState } from "@/components/useJarvis";
import { browserClient } from "@/lib/supabase/browser";
import { SCOPE_LABEL, STATUS_LABEL, type Task, type TaskStatus } from "@/lib/types";

const STATUSES: TaskStatus[] = ["backlog", "en_curso", "bloqueada", "hecha"];

function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const part = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  return name ? `${part}, ${name.split(" ")[0]}.` : `${part}.`;
}

/* ------------------------------ HUD ------------------------------ */
export function HudView({ s, onGo }: { s: JarvisState; onGo: (v: string) => void }) {
  const open = s.tasks.filter((t) => t.status !== "hecha");
  const blocked = s.tasks.filter((t) => t.status === "bloqueada");
  const urgent = open.filter((t) => t.priority === 1);
  const active = s.projects.filter((p) => p.status === "activo");
  const projectName = (id: string) => s.projects.find((p) => p.id === id)?.name ?? "";
  const focus = [...open].sort((a, b) => a.priority - b.priority || (a.status === "en_curso" ? -1 : 1)).slice(0, 5);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="panel hud-hero">
        <Reactor spent={s.spend.spent} budget={s.spend.budget} openTasks={open.length} />
        <div className="grid" style={{ gap: 16 }}>
          <div>
            <h1>{greeting(s.me?.full_name)}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {blocked.length
                ? `${blocked.length} tarea(s) bloqueada(s) esperan una decisión.`
                : urgent.length
                  ? `${urgent.length} tarea(s) de prioridad alta en curso o pendientes.`
                  : "Todo bajo control. Sin bloqueos ni urgencias."}
            </p>
          </div>
          <div className="stats">
            <div className="stat"><span className="num">{active.length}</span><span className="small muted">proyectos activos</span></div>
            <div className="stat"><span className="num">{s.tasks.filter((t) => t.status === "en_curso").length}</span><span className="small muted">en curso</span></div>
            <div className="stat"><span className="num" style={{ color: blocked.length ? "var(--alert)" : undefined }}>{blocked.length}</span><span className="small muted">bloqueadas</span></div>
            <div className="stat"><span className="num">{s.tasks.filter((t) => t.status === "hecha").length}</span><span className="small muted">hechas</span></div>
          </div>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-title"><h2>Foco ahora</h2><button className="btn-ghost btn" onClick={() => onGo("kanban")}>Abrir tablero</button></div>
          {focus.length ? (
            <ul className="log">
              {focus.map((t) => (
                <li key={t.id}>
                  <span className="num" style={{ color: t.priority === 1 ? "var(--gold)" : "var(--muted)" }}>#{t.ref}</span>
                  <span>{t.title}<br /><span className="small muted">{projectName(t.project_id)} · {STATUS_LABEL[t.status]}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No hay tareas abiertas. Crea una desde el tablero o con /nueva en Telegram.</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Últimos eventos</h2><button className="btn-ghost btn" onClick={() => onGo("actividad")}>Ver todo</button></div>
          <LogList logs={s.logs.slice(0, 6)} />
        </section>
      </div>
    </div>
  );
}

/* ---------------------------- Proyectos ---------------------------- */
export function ProjectsView({ s }: { s: JarvisState }) {
  return (
    <div className="grid" style={{ gap: 14 }}>
      <h1>Proyectos</h1>
      <div className="grid grid-2">
        {s.projects.map((p) => {
          const pts = s.tasks.filter((t) => t.project_id === p.id);
          const progress = projectProgress(p.id, s.tasks, p.progress);
          return (
            <article key={p.id} className="panel">
              <div className="panel-title">
                <h2>{p.name}</h2>
                <span className={`chip ${p.status}`}>{p.status}</span>
              </div>
              <p className="small muted" style={{ marginBottom: 12 }}>{SCOPE_LABEL[p.scope]}</p>
              {p.summary && <p style={{ marginBottom: 16 }}>{p.summary}</p>}
              <div className="bar" aria-label={`Avance ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
              <div className="card-meta small muted">
                <span><span className="num">{progress}%</span> completado</span>
                <span>{pts.filter((t) => t.status !== "hecha").length} abiertas · {pts.length} total</span>
              </div>
            </article>
          );
        })}
      </div>
      {!s.projects.length && <p className="empty">Aún no hay proyectos.</p>}
    </div>
  );
}

/* ----------------------------- Kanban ----------------------------- */
export function KanbanView({ s }: { s: JarvisState }) {
  const [filter, setFilter] = useState<string>("all");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(2);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dragId = useRef<string | null>(null);
  const isAdmin = s.me?.role === "admin";
  const defaultProject = filter !== "all" ? filter : s.projects.find((p) => p.status === "activo")?.id ?? s.projects[0]?.id;

  const visible = useMemo(
    () => s.tasks.filter((t) => filter === "all" || t.project_id === filter),
    [s.tasks, filter],
  );
  const canEdit = (t: Task) => isAdmin || t.assignee === s.me?.id;

  const drop = (status: TaskStatus) => {
    const id = dragId.current;
    dragId.current = null;
    setOver(null);
    const t = s.tasks.find((x) => x.id === id);
    if (t && t.status !== status && canEdit(t)) s.updateTask(t.id, { status });
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !defaultProject) return;
    if (await s.createTask({ title: title.trim(), project_id: defaultProject, priority })) setTitle("");
  };

  return (
    <div>
      <div className="panel-title"><h1>Tablero</h1></div>
      <div className="board-tools">
        <label className="sr-only" htmlFor="pf">Proyecto</label>
        <select id="pf" className="field" style={{ maxWidth: 260 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todos los proyectos</option>
          {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <form className="row" style={{ flex: "1 1 320px" }} onSubmit={add}>
          <label className="sr-only" htmlFor="nt">Nueva tarea</label>
          <input id="nt" className="field" placeholder="Nueva tarea…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="sr-only" htmlFor="np">Prioridad</label>
          <select id="np" className="field" style={{ flex: "0 0 90px" }} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>Alta</option><option value={2}>Media</option><option value={3}>Baja</option>
          </select>
          <button className="btn" disabled={!title.trim()}>Crear</button>
        </form>
      </div>

      <div className="board">
        {STATUSES.map((st) => {
          const items = visible.filter((t) => t.status === st);
          return (
            <section
              key={st}
              data-s={st}
              className={`col ${over === st ? "drop" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(st); }}
              onDragLeave={() => setOver((o) => (o === st ? null : o))}
              onDrop={() => drop(st)}
              aria-label={STATUS_LABEL[st]}
            >
              <div className="col-head"><h3>{STATUS_LABEL[st]}</h3><span className="num muted">{items.length}</span></div>
              {items.map((t) => (
                <article
                  key={t.id}
                  className={`card p${t.priority}`}
                  draggable={canEdit(t)}
                  onDragStart={(e) => { dragId.current = t.id; e.currentTarget.classList.add("dragging"); }}
                  onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
                >
                  <div className="card-title">{t.title}</div>
                  {t.tags.length > 0 && <div className="tag">{t.tags.map((g) => `#${g}`).join(" ")}</div>}
                  <div className="card-meta">
                    <span className="num small muted">#{t.ref}{filter === "all" ? ` · ${s.projects.find((p) => p.id === t.project_id)?.slug ?? ""}` : ""}</span>
                    <select
                      aria-label={`Mover tarea ${t.ref}`}
                      value={t.status}
                      disabled={!canEdit(t)}
                      onChange={(e) => s.updateTask(t.id, { status: e.target.value as TaskStatus })}
                    >
                      {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                    </select>
                  </div>
                </article>
              ))}
              {!items.length && <p className="small muted" style={{ padding: "8px 2px" }}>Suelta una tarea aquí.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- Actividad ---------------------------- */
function LogList({ logs }: { logs: JarvisState["logs"] }) {
  if (!logs.length) return <p className="empty">Sin eventos todavía. Lo que hagan el bot y el equipo aparecerá aquí.</p>;
  return (
    <ul className="log">
      {logs.map((l) => (
        <li key={l.id}>
          <time dateTime={l.created_at}>{timeAgo(l.created_at)}</time>
          <span className={l.level}>{l.message}<br /><span className="small muted">{l.source}</span></span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityView({ s }: { s: JarvisState }) {
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="panel-title"><h1>Actividad</h1><span className={`live ${s.live ? "" : "off"}`}><i />{s.live ? "En vivo" : "Sin conexión"}</span></div>
      <section className="panel"><LogList logs={s.logs} /></section>
    </div>
  );
}

/* ----------------------------- Consola ----------------------------- */
type Msg = { who: "me" | "jarvis"; html: string };
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SUGGEST = ["/estado", "/tareas", "/gasto", "/proyecto", "/ayuda"];

export function ConsoleView() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: "jarvis", html: "Escribe aquí lo mismo que en Telegram. Prueba <code>/estado</code>." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    setMsgs((m) => [...m, { who: "me", html: escapeHtml(v) }]);
    setText("");
    setBusy(true);
    try {
      const { data } = await browserClient().auth.getSession();
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ text: v }),
      });
      const json = await res.json();
      setMsgs((m) => [...m, { who: "jarvis", html: res.ok ? json.text : `⚠️ ${escapeHtml(json.error ?? "Error")}` }]);
    } catch {
      setMsgs((m) => [...m, { who: "jarvis", html: "⚠️ No pude contactar al servidor. Revisa tu conexión." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="panel-title"><h1>Consola</h1></div>
      {/* El HTML viene del router del servidor, que escapa todo dato del usuario */}
      <div className="console-out" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.who}`} dangerouslySetInnerHTML={{ __html: m.html }} />
        ))}
      </div>
      <div className="suggest">{SUGGEST.map((c) => <button key={c} onClick={() => send(c)}>{c}</button>)}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label className="sr-only" htmlFor="cmd">Comando</label>
        <input id="cmd" className="field" autoComplete="off" placeholder="/nueva Revisar dominio #jarvis-core !1" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={busy || !text.trim()}>{busy ? "…" : "Enviar"}</button>
      </form>
    </div>
  );
}
