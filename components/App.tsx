"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { useJarvis } from "@/components/useJarvis";
import { ActivityView, ConsoleView, HudView, KanbanView, ProjectsView } from "@/components/views";
import { AgentsView } from "@/components/AgentsView";
import dynamic from "next/dynamic";
import { enviarComando } from "@/components/oficina3d/comando";

// La oficina usa canvas y window: solo en el navegador
const OficinaView = dynamic(() => import("@/components/OficinaView").then((m) => m.OficinaView), { ssr: false });

const ICONS: Record<string, React.ReactNode> = {
  hud: <circle cx="12" cy="12" r="8" />,
  proyectos: <path d="M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z" />,
  kanban: <path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z" />,
  oficina: <path d="M3 20V8l9-5 9 5v12M8 20v-6h8v6M3 20h18" />,
  agentes: <path d="M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 20c0-3.9 3.1-7 7-7s7 3.1 7 7M19 7.5a2 2 0 1 1 0 .01M5 7.5a2 2 0 1 1 0 .01" />,
  actividad: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  consola: <path d="M4 6l6 6-6 6M12 18h8" />,
};
const NAV = [
  { id: "hud", label: "Inicio" },
  { id: "proyectos", label: "Proyectos" },
  { id: "kanban", label: "Tablero" },
  { id: "oficina", label: "Oficina" },
  { id: "agentes", label: "Agentes" },
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
  const [account, setAccount] = useState(false);

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
            <button className="btn btn-ghost small" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => setAccount((a) => !a)}>
              Cuenta
            </button>
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

        {account && <AccountPanel email={email} onClose={() => setAccount(false)} />}

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
        ) : view === "oficina" ? (
          <OficinaView s={s} enviar={enviarComando} />
        ) : view === "agentes" ? (
          <AgentsView s={s} />
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
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const { error } = await browserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setState("error");
      setMsg(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : error.message);
    }
  };

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
        {mode === "password" ? (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>Entra con tu correo y contraseña. Tu sesión queda guardada en este dispositivo.</p>
            <form className="grid" style={{ gap: 12 }} onSubmit={submitPassword}>
              <label htmlFor="em" className="small muted">Correo</label>
              <input id="em" type="email" required autoComplete="username" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="pw" className="small muted">Contraseña</label>
              <input id="pw" type="password" required autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="btn" disabled={state === "sending"}>{state === "sending" ? "Entrando…" : "Entrar"}</button>
              {state === "error" && <p role="alert" style={{ color: "var(--alert)" }}>{msg}</p>}
              <button type="button" className="link-btn" onClick={() => { setMode("link"); setState("idle"); }}>
                ¿No tienes contraseña? Entra con un enlace al correo
              </button>
            </form>
          </>
        ) : (
          <>
        <p className="muted" style={{ marginBottom: 20 }}>Te enviamos un enlace de acceso al correo. Luego puedes crear tu contraseña en Cuenta.</p>
        {state === "sent" ? (
          <p>Revisa <b>{email}</b> y abre el enlace en este mismo dispositivo.</p>
        ) : (
          <form className="grid" style={{ gap: 12 }} onSubmit={submit}>
            <label htmlFor="em" className="small muted">Correo</label>
            <input id="em" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn" disabled={state === "sending"}>{state === "sending" ? "Enviando…" : "Enviar enlace"}</button>
            {state === "error" && <p role="alert" style={{ color: "var(--alert)" }}>{msg}</p>}
            <button type="button" className="link-btn" onClick={() => { setMode("password"); setState("idle"); }}>
              Entrar con contraseña
            </button>
          </form>
        )}
          </>
        )}
      </div>
    </div>
  );
}

function AccountPanel({ email, onClose }: { email: string; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { setState("error"); setMsg("Usa al menos 8 caracteres."); return; }
    if (pw !== pw2) { setState("error"); setMsg("Las contraseñas no coinciden."); return; }
    setState("saving");
    const { error } = await browserClient().auth.updateUser({ password: pw });
    if (error) { setState("error"); setMsg(error.message); } else { setState("done"); setPw(""); setPw2(""); }
  };

  return (
    <section className="panel" style={{ marginBottom: 16 }} aria-label="Cuenta">
      <div className="panel-title"><h2>Cuenta</h2><button className="btn btn-ghost" onClick={onClose}>Cerrar</button></div>
      <p className="muted small" style={{ marginBottom: 12 }}>{email}</p>
      {state === "done" ? (
        <p>Contraseña guardada. La próxima vez entra con correo y contraseña; tu navegador puede recordarla.</p>
      ) : (
        <form className="grid" style={{ gap: 10, maxWidth: 380 }} onSubmit={save}>
          <label htmlFor="np1" className="small muted">Nueva contraseña</label>
          <input id="np1" type="password" autoComplete="new-password" className="field" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="np2" className="small muted">Repítela</label>
          <input id="np2" type="password" autoComplete="new-password" className="field" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button className="btn" disabled={state === "saving"}>{state === "saving" ? "Guardando…" : "Guardar contraseña"}</button>
          {state === "error" && <p role="alert" style={{ color: "var(--alert)" }}>{msg}</p>}
        </form>
      )}
    </section>
  );
}
