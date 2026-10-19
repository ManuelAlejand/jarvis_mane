"use client";
import { useState } from "react";
import type { JarvisState } from "@/components/useJarvis";
import { browserClient } from "@/lib/supabase/browser";
import { VIDEO_ESTADO, type AgentRow, type AgentRun } from "@/lib/types";

const RUNTIME: Record<AgentRow["runtime"], string> = { api: "Servidor", chat: "Chat Claude", local: "Motor local" };
const MODEL: Record<string, string> = { "claude-haiku-5-5": "Haiku", "claude-sonnet-5-5": "Sonnet", "claude-opus-5-5": "Opus" };
const RUN_LABEL: Record<AgentRun["status"], string> = { queued: "En cola", running: "Trabajando", paused: "En pausa", done: "Terminado", error: "Error" };

function ago(iso: string | null) {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

type State = "off" | "error" | "working" | "queued" | "idle";
function agentState(a: AgentRow, runs: AgentRun[]): { state: State; label: string; doing: string | null } {
  const mine = runs.filter((r) => r.agent_id === a.id);
  const running = mine.find((r) => r.status === "running");
  const waiting = mine.filter((r) => r.status === "queued" || r.status === "paused");
  if (!a.enabled) return { state: "off", label: "Desactivado", doing: null };
  if (running) return { state: "working", label: "Trabajando", doing: running.current_step ?? running.input };
  if (a.status === "error") return { state: "error", label: "Con error", doing: mine.find((r) => r.status === "error")?.error ?? null };
  if (waiting.length) return { state: "queued", label: `${waiting.length} en cola`, doing: waiting[0].current_step };
  return { state: "idle", label: "En espera", doing: null };
}

async function command(text: string) {
  const { data } = await browserClient().auth.getSession();
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ text }),
  });
  const json = await res.json();
  return res.ok ? String(json.text).replace(/<[^>]+>/g, "") : `⚠️ ${json.error ?? "Error"}`;
}

export function AgentsView({ s }: { s: JarvisState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = s.agents.find((a) => a.id === openId);
  if (open) return <AgentDetail s={s} a={open} onBack={() => setOpenId(null)} />;

  const states = s.agents.map((a) => agentState(a, s.runs).state);
  const working = states.filter((x) => x === "working").length;
  const crew = s.agents.filter((a) => a.slug !== "jarvis");
  const jarvis = s.agents.find((a) => a.slug === "jarvis");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="panel-title">
        <h1>Agentes</h1>
        <span className="muted small">{working ? `${working} trabajando ahora` : "Nadie trabajando ahora"}</span>
      </div>

      {jarvis && <AgentCard a={jarvis} s={s} onOpen={() => setOpenId(jarvis.id)} lead />}

      <StudioPanel s={s} />

      <ol className="crew" aria-label="Flujo del estudio de YouTube">
        {crew.map((a, i) => (
          <li key={a.id}>
            <span className="crew-step num" aria-hidden="true">{i + 1}</span>
            <AgentCard a={a} s={s} onOpen={() => setOpenId(a.id)} />
          </li>
        ))}
      </ol>
      {!s.agents.length && <p className="empty">Aún no hay agentes configurados.</p>}
    </div>
  );
}

function AgentCard({ a, s, onOpen, lead }: { a: AgentRow; s: JarvisState; onOpen: () => void; lead?: boolean }) {
  const st = agentState(a, s.runs);
  const isAdmin = s.me?.role === "admin";
  return (
    <article className={`panel agent ${lead ? "agent-lead" : ""}`} style={{ "--agent": a.color } as React.CSSProperties}>
      <div className="agent-head">
        <span className={`avatar ${st.state}`} aria-hidden="true">{a.name.slice(0, 1)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <button className="agent-name" onClick={onOpen}>{a.name}</button>
          <p className="small muted">{a.role} · {MODEL[a.model] ?? a.model} · {RUNTIME[a.runtime]}</p>
        </div>
        <span className={`state ${st.state}`}><i />{st.label}</span>
      </div>

      <dl className="agent-facts">
        <div>
          <dt className="small muted">En qué trabaja</dt>
          <dd>{st.doing ?? <span className="muted">{a.enabled ? "Nada ahora" : "Desactivado"}</span>}</dd>
        </div>
        <div>
          <dt className="small muted">Lo último que hizo</dt>
          <dd>{a.last_summary ? <>{a.last_summary} <span className="muted small">· {ago(a.last_run_at)}</span></> : <span className="muted">Todavía nada</span>}</dd>
        </div>
      </dl>

      <div className="card-meta">
        <button className="link-btn" onClick={onOpen}>Ver historial y dar una orden</button>
        {isAdmin && a.slug !== "jarvis" && (
          <label className="toggle small">
            <input type="checkbox" checked={a.enabled} onChange={(e) => s.setAgentEnabled(a.id, e.target.checked)} />
            <span>{a.enabled ? "Activo" : "Inactivo"}</span>
          </label>
        )}
      </div>
    </article>
  );
}

/* --------------------- Estudio: PC conectado + Shorts en producción --------------------- */
const ACTIVE = ["guion_pendiente", "guionando", "cambios", "produciendo", "validando", "publicar", "publicando"];

function StudioPanel({ s }: { s: JarvisState }) {
  const online = s.heartbeat ? Date.now() - new Date(s.heartbeat).getTime() < 3 * 60_000 : false;
  const shown = s.videos.filter((v) => v.estado !== "descartado").slice(0, 8);
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Shorts en el estudio</h2>
        <span className={`state ${online ? "working" : "off"}`} title={s.heartbeat ? `Último contacto ${ago(s.heartbeat)}` : "El puente nunca se ha conectado"}>
          <i />{online ? "PC conectado" : "PC desconectado"}
        </span>
      </div>
      {shown.length ? (
        <ul className="log">
          {shown.map((v) => {
            const tone = v.estado === "error" ? "error" : v.estado === "revision" ? "queued" : v.estado === "publicado" ? "done" : ACTIVE.includes(v.estado) ? "working" : "off";
            return (
              <li key={v.id} style={{ gridTemplateColumns: "54px 1fr" }}>
                <span className="num muted">V{v.ref}</span>
                <span>
                  {v.titulo}
                  <br />
                  <span className={`state ${tone}`}><i />{VIDEO_ESTADO[v.estado] ?? v.estado}</span>
                  {v.fase_detalle && ACTIVE.includes(v.estado) && <span className="small muted"> · {v.fase_detalle}</span>}
                  {v.error && <span className="small" style={{ color: "var(--alert)" }}> · {v.error}</span>}
                  {v.youtube_url && <> · <a className="small" href={v.youtube_url} target="_blank" rel="noreferrer">Abrir en YouTube</a></>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">Sin Shorts todavía. Pide ideas al Investigador y elige cuáles producir.</p>
      )}
      {!online && shown.some((v) => ACTIVE.includes(v.estado)) && (
        <p className="small" style={{ color: "var(--gold)", marginTop: 10 }}>Hay videos esperando: enciende el PC y abre el puente del estudio.</p>
      )}
    </section>
  );
}

function IdeaPicker({ run, isAdmin }: { run: AgentRun; isAdmin: boolean }) {
  const ideas = run.result?.ideas ?? [];
  const [sel, setSel] = useState<number[]>(run.result?.selected ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = !!run.result?.sent;

  const toggle = (n: number) => setSel((x) => (x.includes(n) ? x.filter((y) => y !== n) : [...x, n].sort()));
  const send = async () => {
    setBusy(true);
    const { data } = await browserClient().auth.getSession();
    const res = await fetch("/api/studio/select", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify({ run_id: run.id, selected: sel }),
    });
    const json = await res.json();
    setMsg(res.ok ? json.text : `⚠️ ${json.error}`);
    setBusy(false);
  };

  return (
    <fieldset className="ideas" disabled={sent || !isAdmin}>
      <legend className="small muted">{sent ? "Ideas enviadas al Guionista" : "Elige las ideas que quieres producir"}</legend>
      {ideas.map((i, n) => (
        <label key={n} className={`idea ${sel.includes(n) ? "on" : ""}`}>
          <input type="checkbox" checked={sel.includes(n)} onChange={() => toggle(n)} />
          <span>
            <b>{i.titulo}</b>
            <br />
            <span className="small muted">{i.gancho}</span>
          </span>
        </label>
      ))}
      {!sent && isAdmin && (
        <button type="button" className="btn" disabled={!sel.length || busy} onClick={send} style={{ justifySelf: "start" }}>
          {busy ? "Enviando…" : `Enviar ${sel.length || ""} al guionista`}
        </button>
      )}
      {msg && <p className="small">{msg}</p>}
    </fieldset>
  );
}

function AgentDetail({ s, a, onBack }: { s: JarvisState; a: AgentRow; onBack: () => void }) {
  const [order, setOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const runs = s.runs.filter((r) => r.agent_id === a.id);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order.trim()) return;
    setBusy(true);
    setReply(await command(`/agente ${a.slug} ${order.trim()}`));
    setOrder("");
    setBusy(false);
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div><button className="btn btn-ghost" onClick={onBack} style={{ minHeight: 36, padding: "4px 12px" }}>Volver a agentes</button></div>
      <AgentCard a={a} s={s} onOpen={() => undefined} lead />
      {a.description && <p style={{ maxWidth: "70ch" }}>{a.description}</p>}

      {a.slug !== "jarvis" && (
        <section className="panel">
          <h2 style={{ marginBottom: 10 }}>Darle una orden</h2>
          <form className="row" onSubmit={send}>
            <label className="sr-only" htmlFor="ord">Orden para {a.name}</label>
            <input id="ord" className="field" placeholder={a.slug === "investigador" ? "Busca nichos de misterio con buen RPM en inglés" : "Describe lo que necesitas"} value={order} onChange={(e) => setOrder(e.target.value)} disabled={!a.enabled} />
            <button className="btn" disabled={busy || !order.trim() || !a.enabled}>{busy ? "Enviando…" : "Enviar orden"}</button>
          </form>
          {!a.enabled && <p className="small muted" style={{ marginTop: 8 }}>Actívalo para darle órdenes.</p>}
          {a.runtime !== "api" && a.enabled && (
            <p className="small muted" style={{ marginTop: 8 }}>
              {a.runtime === "chat" ? "Este agente trabaja en el chat de Claude: la orden queda en cola hasta que la proceses allí." : "Este agente trabaja en el motor local: la orden queda en cola hasta que tu PC la tome."}
            </p>
          )}
          {reply && <p style={{ marginTop: 10 }}>{reply}</p>}
        </section>
      )}

      <section className="panel">
        <h2 style={{ marginBottom: 6 }}>Historial</h2>
        {runs.length ? (
          <ul className="log">
            {runs.map((r) => (
              <li key={r.id} style={{ gridTemplateColumns: "1fr" }}>
                <div className="card-meta" style={{ marginTop: 0 }}>
                  <span className={`state ${r.status === "running" ? "working" : r.status === "error" ? "error" : r.status === "done" ? "done" : "queued"}`}><i />{RUN_LABEL[r.status]}{r.verdict ? ` · ${r.verdict}` : ""}</span>
                  <span className="small muted">{ago(r.finished_at ?? r.created_at)}{Number(r.cost_usd) > 0 ? ` · $${Number(r.cost_usd).toFixed(4)}` : ""}</span>
                </div>
                <p style={{ marginTop: 6 }}><span className="muted small">Orden:</span> {r.input}</p>
                {r.summary && <p style={{ marginTop: 4 }}><span className="muted small">Resultado:</span> {r.summary}</p>}
                {r.status === "running" && r.current_step && <p className="small" style={{ color: "var(--arc)", marginTop: 4 }}>{r.current_step}</p>}
                {r.error && <p className="small" style={{ color: "var(--alert)", marginTop: 4 }}>{r.error}</p>}
                {r.result?.ideas?.length ? <IdeaPicker run={r} isAdmin={s.me?.role === "admin"} /> : null}
                {r.output && (
                  <>
                    <button className="link-btn" style={{ marginTop: 6 }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      {expanded === r.id ? "Ocultar resultado" : "Ver resultado completo"}
                    </button>
                    {expanded === r.id && <pre className="output">{r.output}</pre>}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Sin órdenes todavía.</p>
        )}
      </section>
    </div>
  );
}
