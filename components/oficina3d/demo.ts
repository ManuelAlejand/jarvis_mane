/**
 * Datos simulados para la demostración pública de la Oficina (/demo/oficina) y las pruebas e2e.
 * No toca Supabase: reproduce en bucle un pedido por Telegram que recorre el estudio de YouTube.
 */
import type { JarvisState } from "@/components/useJarvis";

const P = (id: string, slug: string, name: string, status: string) => ({
  id, slug, name, status, scope: "core", summary: null, spec_md: null, progress: 0, created_at: "", updated_at: "",
});
const A = (id: string, slug: string, name: string, role: string, position: number, runtime = "local", extra: Record<string, unknown> = {}) => ({
  id, slug, name, role, color: "", project_id: null, description: null, enabled: true, status: "idle", runtime,
  model: "claude-sonnet-5-5", position, current_run_id: null, last_summary: "Listo", last_run_at: new Date(Date.now() - 3600e3).toISOString(), ...extra,
});

export const DEMO_PASOS = 14;

export function estadoDemo(paso: number): JarvisState {
  const k = paso % DEMO_PASOS;
  const yt = { project_id: "p1" };
  const f = (emoji: string, personality: string, frases: string[]) => ({ emoji, personality, frases });
  const agents = [
    // JARVIS con proyecto asignado (como en la base real): debe quedarse en el Núcleo igual
    A("a0", "jarvis", "JARVIS", "Orquestador", 0, "chat", { ...yt, ...f("🤖", "Mayordomo digital: formal, preciso y con humor seco británico.", ["A sus órdenes, señor.", "Sistemas en línea al 100 %."]) }),
    A("a1", "explorador", "Explorador", "Explorador de tendencias", 1, "api", { ...yt, ...f("📈", "Curioso e inquieto.", ["Las tendencias no duermen."]) }),
    A("a2", "investigador", "Investigador", "Investigador de nichos", 2, "api", { ...yt, ...f("🔎", "Meticuloso.", ["Necesito una fuente más."]) }),
    A("a3", "guionista", "Guionista", "Guionista", 3, "local", { ...yt, ...f("✍️", "Dramático y creativo.", ["Pero aquí está lo extraño…"]) }),
    A("a4", "productor", "Productor", "Productor", 4, "local", { ...yt, ...f("🎞️", "Práctico y paciente.", ["Renderizando… paciencia."]) }),
    A("a5", "validador", "Validador", "Validador", 5, "local", { ...yt, ...f("🛡️", "Estricto.", ["Aprobado. Por ahora."]) }),
    A("a6", "publicador", "Publicador", "Publicador", 6, "local", { ...yt, ...f("🚀", "Entusiasta.", ["El botón público es tuyo, Manuel."]) }),
    A("a7", "friday", "F.R.I.D.A.Y.", "Líder del estudio de YouTube", 10, "chat", { ...yt, is_leader: true, ...f("🎬", "Directora del estudio: directa, rápida y orientada a resultados.", ["Equipo, el algoritmo no espera."]) }),
    A("a9", "radar", "Radar", "Explorador de nichos y locales", 7, "local", { project_id: "p2", ...f("📡", "Explorador de mercado: metódico y escéptico.", ["Sin fuente no hay dato."]) }),
    A("a10", "critico", "Crítico", "Validador de ideas de negocio", 8, "local", f("⚖️", "Abogado del diablo: directo y justo.", ["¿Y quién paga eso hoy?"])),
    A("a11", "arquitecto", "Arquitecto", "Arquitecto de software", 9, "local", f("📐", "Primero el plano, luego el martillo.", ["Sin plano no hay obra."])),
    A("a8", "edith", "E.D.I.T.H.", "Líder de la Auditoría GEO", 11, "chat", { project_id: "p2", is_leader: true, ...f("📍", "Analítica y estratégica.", ["Primero medir, luego vender."]) }),
  ];
  const ahora = Date.now();
  const runs: Record<string, unknown>[] = [];
  const run = (id: string, agent: string, status: string, step: string, extra: Record<string, unknown> = {}) =>
    runs.unshift({
      id: `${id}-${Math.floor(paso / DEMO_PASOS)}`, agent_id: agent, status, input: "Pedido de Telegram", current_step: step, output: null,
      summary: status === "done" ? "Trabajo entregado" : null, verdict: null, cost_usd: 0.012, source: "telegram",
      error: status === "error" ? "La voz se cortó; reintentando con Kokoro" : null,
      created_at: new Date(ahora - (20 - runs.length) * 1000).toISOString(), started_at: null, finished_at: null, result: null, ...extra,
    });
  run("r0", "a1", "running", "Revisando tendencias de CO y MX");
  if (k >= 1) run("r1", "a2", k >= 3 ? "done" : "running", "Investigando nichos de misterio");
  if (k >= 4) run("r2", "a3", k >= 6 ? "done" : "running", "Escribiendo el guion de V5", { parent_run_id: `r1-${Math.floor(paso / DEMO_PASOS)}`, video_id: "v5" });
  if (k >= 7) run("r3", "a4", k >= 10 ? (k >= 12 ? "done" : "error") : "running", "Generando voz 4/15", { video_id: "v5" });
  if (k >= 2) run("r5", "a9", k >= 9 ? "done" : "running", k < 5 ? "Leyendo la skill y preparando la búsqueda" : "Investigando en internet · 3 min", { input: "Explora nichos y locales para la Auditoría GEO en Colombia", summary: k >= 9 ? "3 nichos prioritarios y 24 locales candidatos" : null });
  if (k >= 3 && k < 12) run("r6", "a10", k >= 8 ? "done" : "running", "Poniendo a prueba la idea · clientes simulados", { input: "Valida la idea de la Auditoría GEO con clientes simulados", summary: k >= 8 ? "Construir: 26/35; probar precio en clínicas con extranjeros" : null });
  if (k >= 6) run("r7", "a11", k >= 12 ? "done" : "running", "Diseñando el plano · 2 min", { input: "Haz el plano del módulo GEO en JARVIS", summary: k >= 12 ? "Plano listo: 3 tablas, 4 agentes, 9 pasos" : null });
  if (k >= 11) run("r4", "a5", k >= 13 ? "done" : "running", "Validando el video V5", { video_id: "v5" });
  const projects = [P("p0", "jarvis-core", "JARVIS Core", "activo"), P("p1", "youtube-shorts", "YouTube Shorts", "idea"), P("p2", "auditoria-geo", "Auditoría GEO", "activo")];
  return {
    projects, tasks: [], logs: [], profiles: [], agents, runs, videos: [], heartbeat: new Date().toISOString(), spend: { spent: 0.42, budget: 5 },
    loading: false, live: true, error: null, setError: () => {}, me: null,
    updateTask: async () => {}, createTask: async () => {}, setAgentEnabled: async () => {}, reload: async () => {},
  } as unknown as JarvisState;
}

/** Respuestas simuladas de la consola en la demo (no llama al servidor ni gasta tokens). */
export async function enviarDemo(texto: string): Promise<{ ok: boolean; html: string }> {
  await new Promise((r) => setTimeout(r, 700));
  const t = texto.toLowerCase();
  if (t.startsWith("/estado") || t.includes("estado"))
    return { ok: true, html: "📊 <b>Estado</b>\n• YouTube Shorts: 3 agentes trabajando\n• Auditoría GEO: activo\n• Gasto API: $0.42 de $5" };
  if (/activo|pausa|terminad/.test(t)) return { ok: true, html: "✅ Proyecto <b>Auditoría GEO</b> → <b>activo</b> (demo)." };
  if (t.startsWith("/ayuda")) return { ok: true, html: "Comandos: <code>/estado</code>, <code>/tareas</code>, <code>/gasto</code>, <code>/tendencias</code>" };
  return { ok: true, html: `Entendido, señor: «${texto.replace(/[<>&]/g, "")}». <i>(Demo: en tu panel esta orden va al mismo router de Telegram.)</i>` };
}
