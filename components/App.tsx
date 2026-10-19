"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { useJarvis } from "@/components/useJarvis";
import { ActivityView, ConsoleView, HudView, KanbanView, ProjectsView } from "@/components/views";

const ICONS: Record<string, React.ReactNode> = {
  hud: <circle cx="12" cy="12" r="8" />,
  proyectos: <path d="M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z" />,
  kanban: <path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z" />,
  actividad: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  consola: <path d="M4 6l6 6-6 6M12 18h8" />,
};
const NAV = [
  { id: "hud", label: "Inicio" },
  { id: "proyectos", label: "Proyectos" },
  { id: "kanban", label: "Tablero" },
  { id: "actividad", label: "Actividad" },
  { id: "consola", label: "Consola" },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const db = browserClient();
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="login"><span className="brand-dot" aria-label="Cargando" /></div>;
  if (!session) return <Login />;
  return <Shell userId={session.user.id} email={session.user.email ?? ""} />;
}

function Shell({ userId, email }: { userId: string; email: string }) {
  const s = useJarvis(userId);
  const [view, setView] = useState("hud");

  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (NAV.some((n) => n.id === fromHash)) setView(fromHash);
  }, []);
  const go = (v: string) => {
    setView(v);
    history.replaceState(null, "", `#${v}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <nav className="nav" aria-label="Secciones">
        {NAV.map((n) => (
          <button key={n.id} onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
              {ICONS[n.id]}
            </svg>
            {n.label}
          </button>
        ))}
      </nav>
      <main className="main">
        <header className="topbar">
          <div className="brand"><span className="brand-dot" aria-hidden="true" />JARVIS</div>
          <div className="row" style={{ alignItems: "center", gap: 14 }}>
            <span className={`live ${s.live ? "" : "off"}`}><i />{s.live ? "En vivo" : "Reconectando"}</span>
            <button
              className="btn btn-ghost small"
              style={{ minHeight: 34, padding: "4px 10px" }}
              title={email}
              onClick={() => browserClient().auth.signOut()}
            >
              Salir
            </button>
          </div>
        </header>

        {s.error && (
          <div className="panel" role="alert" style={{ marginBottom: 16, borderLeft: "3px solid var(--alert)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span>{s.error}</span>
              <button className="btn btn-ghost" onClick={() => s.setError(null)}>Cerrar</button>
            </div>
          </div>
        )}

        {s.loading ? (
          <p className="muted">Sincronizando con la base de datos…</p>
        ) : view === "hud" ? (
          <HudView s={s} onGo={go} />
        ) : view === "proyectos" ? (
          <ProjectsView s={s} />
        ) : view === "kanban" ? (
          <KanbanView s={s} />
        ) : view === "actividad" ? (
          <ActivityView s={s} />
        ) : (
          <ConsoleView />
        )}
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    });
    if (error) {
      setState("error");
      setMsg(
        /signups not allowed|not found/i.test(error.message)
          ? "Ese correo no tiene acceso. Pídele al admin que te invite."
          : error.message,
      );
    } else setState("sent");
  };

  return (
    <div className="login">
      <div className="panel">
        <div className="brand"><span className="brand-dot" aria-hidden="true" />JARVIS</div>
        <h1>Centro de control</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Entra con tu correo. Te enviamos un enlace de acceso, sin contraseña.</p>
        {state === "sent" ? (
          <p>Revisa <b>{email}</b> y abre el enlace en este mismo dispositivo.</p>
        ) : (
          <form className="grid" style={{ gap: 12 }} onSubmit={submit}>
            <label htmlFor="em" className="small muted">Correo</label>
            <input id="em" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn" disabled={state === "sending"}>{state === "sending" ? "Enviando…" : "Enviar enlace"}</button>
            {state === "error" && <p role="alert" style={{ color: "var(--alert)" }}>{msg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
