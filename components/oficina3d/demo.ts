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
  const agents = [
    A("a0", "jarvis", "JARVIS", "Orquestador", 0, "chat"),
    A("a1", "explorador", "Explorador", "Explorador de tendencias", 1, "api"),
    A("a2", "investigador", "Investigador", "Investigador de nichos", 2, "api"),
    A("a3", "guionista", "Guionista", "Guionista", 3),
    A("a4", "productor", "Productor", "Productor", 4),
    A("a5", "validador", "Validador", "Validador", 5),
    A("a6", "publicador", "Publicador", "Publicador", 6),
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
  if (k >= 11) run("r4", "a5", k >= 13 ? "done" : "running", "Validando el video V5", { video_id: "v5" });
  const projects = [P("p0", "jarvis-core", "JARVIS Core", "activo"), P("p1", "youtube-shorts", "YouTube Shorts", "idea"), P("p2", "auditoria-geo", "Auditoría GEO", "activo")];
  return {
    projects, tasks: [], logs: [], profiles: [], agents, runs, videos: [], heartbeat: new Date().toISOString(), spend: { spent: 0.42, budget: 5 },
    loading: false, live: true, error: null, setError: () => {}, me: null,
    updateTask: async () => {}, createTask: async () => {}, setAgentEnabled: async () => {}, reload: async () => {},
  } as unknown as JarvisState;
}
