import "server-only";
import { after } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { BudgetExceeded, callClaude, RateLimited } from "@/lib/ai";
import { sendMessage } from "@/lib/telegram";

/**
 * Agentes: miembros "virtuales" del equipo con nombre, rol y estado visible en el dashboard.
 * Una orden crea un agent_run; se ejecuta en segundo plano justo después de responder
 * (after()) y, si la API está en su límite, queda en job_queue y el worker la retoma.
 */

export interface Agent {
  id: string;
  slug: string;
  name: string;
  role: string;
  enabled: boolean;
  status: "idle" | "working" | "error";
  runtime: "api" | "chat" | "local";
  model: string;
  system_prompt: string;
  max_tokens: number;
  keywords: string[];
  project_id: string | null;
  position: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export async function listAgents(): Promise<Agent[]> {
  const { data } = await adminClient().from("agents").select("*").order("position");
  return (data ?? []) as Agent[];
}

/** Atajo sin IA: "busca ideas de…" coincide con las palabras clave de un agente activo. */
export async function matchAgentByKeyword(text: string): Promise<Agent | null> {
  const t = norm(text);
  if (t.split(/\s+/).length < 3) return null; // frases muy cortas: mejor no adivinar
  const agents = (await listAgents()).filter((a) => a.enabled);
  let best: { a: Agent; len: number } | null = null;
  for (const a of agents) {
    for (const k of a.keywords) {
      const kn = norm(k);
      if (new RegExp(`(^|\\s)${kn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(t) && (!best || kn.length > best.len)) {
        best = { a, len: kn.length };
      }
    }
  }
  return best?.a ?? null;
}

export async function findAgent(q: string): Promise<Agent | null> {
  const k = norm(q.trim());
  const agents = await listAgents();
  return agents.find((a) => a.slug === k || norm(a.name) === k) ?? null;
}

export async function startRun(
  agent: Agent,
  input: string,
  opts: { requestedBy: string | null; source: string; chatId?: number | null },
): Promise<{ ok: boolean; text: string }> {
  if (!agent.enabled) return { ok: false, text: `${esc(agent.name)} (${esc(agent.role)}) está desactivado.` };
  const db = adminClient();
  const waiting =
    agent.runtime === "chat" ? "Esperando al chat de Claude" : agent.runtime === "local" ? "Esperando al motor local" : "En cola";
  const { data: run, error } = await db
    .from("agent_runs")
    .insert({
      agent_id: agent.id,
      input: input.slice(0, 2000),
      requested_by: opts.requestedBy,
      source: opts.source,
      source_chat: opts.chatId ?? null,
      current_step: waiting,
    })
    .select("id")
    .single();
  if (error) throw error;

  await log(opts.source, `${agent.name} recibió una orden: "${input.slice(0, 70)}"`, "info", { agent: agent.slug, run: run.id });

  if (agent.runtime !== "api") {
    const where =
      agent.runtime === "chat"
        ? "Ábrela en el chat de Claude (proyecto Jarvis) con «procesa las órdenes pendientes»."
        : "El motor local la tomará cuando tu PC esté encendido.";
    return { ok: true, text: `📋 <b>${esc(agent.name)}</b> · ${esc(agent.role)} tiene la orden en cola.\n${where}` };
  }

  // Ejecutar en segundo plano, después de responder a Telegram / la Consola
  after(() => executeRun(run.id).catch(() => undefined));

  const busy = agent.status === "working" ? " Está terminando otra orden; esta va justo después." : "";
  return {
    ok: true,
    text: `🛰️ <b>${esc(agent.name)}</b> · ${esc(agent.role)} tomó la orden.${busy}\nTe aviso aquí cuando termine. Puedes seguir su avance en <b>Agentes</b> del dashboard.`,
  };
}

async function setAgent(agentId: string, patch: Record<string, unknown>) {
  await adminClient().from("agents").update(patch).eq("id", agentId);
}

/** Ejecuta un run. Seguro de llamar varias veces: solo uno lo "reclama". */
export async function executeRun(runId: string): Promise<"done" | "paused" | "error" | "skipped"> {
  const db = adminClient();
  const { data: pre } = await db.from("agent_runs").select("agents(runtime)").eq("id", runId).maybeSingle();
  if ((pre as unknown as { agents: { runtime: string } } | null)?.agents?.runtime !== "api") return "skipped";
  const { data: claimed } = await db
    .from("agent_runs")
    .update({ status: "running", started_at: new Date().toISOString(), current_step: "Preparando contexto" })
    .eq("id", runId)
    .in("status", ["queued", "paused"])
    .select("id,input,source_chat,agent_id,agents(*)")
    .maybeSingle();
  if (!claimed) return "skipped";

  const agent = (claimed as unknown as { agents: Agent }).agents;
  await setAgent(agent.id, { status: "working", current_run_id: runId });

  try {
    // Contexto compacto: resumen del proyecto + últimos 3 resultados del agente (para no repetir)
    const [{ data: project }, { data: recent }] = await Promise.all([
      agent.project_id
        ? db.from("projects").select("name,summary").eq("id", agent.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("agent_runs").select("summary").eq("agent_id", agent.id).eq("status", "done").order("finished_at", { ascending: false }).limit(3),
    ]);
    const context = [
      project ? `Proyecto: ${project.name}. ${project.summary ?? ""}` : "",
      recent?.length ? `Trabajos recientes (no repetir):\n${recent.map((r) => `- ${r.summary}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    await db.from("agent_runs").update({ current_step: `Trabajando en: ${claimed.input.slice(0, 80)}` }).eq("id", runId);

    const { text, cost } = await callClaude({
      model: agent.model,
      system: agent.system_prompt,
      maxTokens: agent.max_tokens,
      agentRunId: runId,
      user: `${context ? `${context}\n\n` : ""}Orden:\n${claimed.input}`,
    });

    const m = text.match(/^\s*Resumen:\s*(.+)$/im);
    const summary = (m?.[1] ?? text.replace(/[#*_`>|-]/g, " ").replace(/\s+/g, " ").slice(0, 100)).trim().slice(0, 140);
    const output = text.replace(/^\s*Resumen:.*$/im, "").trim();
    const now = new Date().toISOString();

    await db.from("agent_runs").update({ status: "done", output, summary, cost_usd: cost, finished_at: now, current_step: null }).eq("id", runId);
    await setAgent(agent.id, { last_summary: summary, last_run_at: now });
    await log("agent", `${agent.name} terminó: ${summary}`, "info", { agent: agent.slug, run: runId, cost });

    if (claimed.source_chat) {
      await sendMessage(
        claimed.source_chat,
        `✅ <b>${esc(agent.name)}</b> terminó\n\n${esc(output).slice(0, 3500)}${output.length > 3500 ? "\n\n…(completo en el dashboard)" : ""}`,
      );
    }
    return "done";
  } catch (e) {
    if (e instanceof RateLimited) {
      await db.from("agent_runs").update({ status: "paused", current_step: "En pausa: límite de cuota de la API" }).eq("id", runId);
      await db.from("job_queue").insert({
        kind: "agent_run",
        status: "paused",
        payload: { run_id: runId },
        source_chat: claimed.source_chat,
        retry_at: new Date(Date.now() + e.retryAfterSec * 1000).toISOString(),
        last_error: e.message,
      });
      await log("agent", `${agent.name} en pausa por límite de cuota; se reanuda solo`, "warn", { run: runId });
      return "paused";
    }
    const msg = e instanceof BudgetExceeded ? "Freno de gasto activo: el presupuesto de API del mes llegó al tope." : e instanceof Error ? e.message : String(e);
    await db.from("agent_runs").update({ status: "error", error: msg, finished_at: new Date().toISOString(), current_step: null }).eq("id", runId);
    await setAgent(agent.id, { status: "error" });
    await log("agent", `${agent.name} falló: ${msg}`, "error", { run: runId });
    if (claimed.source_chat) await sendMessage(claimed.source_chat, `⚠️ <b>${esc(agent.name)}</b> no pudo terminar: ${esc(msg)}`);
    return "error";
  } finally {
    // Si no quedan runs activos, el agente vuelve a "en espera" (salvo error)
    const { count } = await db.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).in("status", ["queued", "running"]);
    const { data: a } = await db.from("agents").select("status").eq("id", agent.id).single();
    if (!count) await setAgent(agent.id, { status: a?.status === "error" ? "error" : "idle", current_run_id: null });
    // Siguiente orden en cola del mismo agente
    const { data: next } = await db.from("agent_runs").select("id").eq("agent_id", agent.id).eq("status", "queued").order("created_at").limit(1).maybeSingle();
    if (next) await executeRun(next.id);
  }
}
