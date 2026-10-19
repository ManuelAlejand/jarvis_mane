import { NextResponse, type NextRequest } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
import { BudgetExceeded, classify, RateLimited } from "@/lib/ai";
import { applyClassification, inbox, type Actor } from "@/lib/router";
import { executeRun, listAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Procesa la cola job_queue. Lo llama pg_cron cada 5 min (ver README).
 * Tipos: "notify" (mensaje de Telegram) y "classify" (texto libre que quedó pausado por límite de cuota).
 */

type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  status: string;
  source_chat: number | null;
};

const MAX_ATTEMPTS = 6;
const BATCH = 5;

async function runJob(job: Job): Promise<unknown> {
  switch (job.kind) {
    case "notify": {
      const chat = Number(job.payload.chat_id ?? job.source_chat);
      const r = await sendMessage(chat, String(job.payload.text ?? ""));
      if (!r.ok && /Too Many Requests/i.test(r.description ?? "")) throw new RateLimited(30);
      if (!r.ok) throw new Error(r.description ?? "telegram error");
      return { sent: true };
    }
    case "classify": {
      const text = String(job.payload.text ?? "");
      const actor = job.payload.actor as Actor;
      const { data: projects } = await adminClient().from("projects").select("slug,name").order("created_at");
      let reply;
      try {
        const c = await classify(text, projects ?? [], await listAgents(), job.id);
        reply = await applyClassification(c, text, actor);
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e; // RateLimited → vuelve a pausarse
        reply = await inbox(text, actor, "Freno de gasto activo: lo guardé sin clasificar.");
      }
      if (job.source_chat) await sendMessage(job.source_chat, `▶️ Procesé tu mensaje pendiente «${text.slice(0, 60).replace(/</g, "&lt;")}»:\n\n${reply.text}`);
      return { done: true };
    }
    case "agent_run": {
      // Si vuelve a pausarse, executeRun deja un job nuevo en la cola; este se cierra.
      return { result: await executeRun(String(job.payload.run_id)) };
    }
    default:
      throw new Error(`Tipo de trabajo desconocido: ${job.kind}`);
  }
}

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const db = adminClient();
  const { data: jobs, error } = await db
    .from("job_queue")
    .select("id,kind,payload,attempts,status,source_chat")
    .in("status", ["pending", "paused"])
    .lte("retry_at", new Date().toISOString())
    .order("created_at")
    .limit(BATCH);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Red de seguridad: órdenes de agentes del servidor que quedaron en cola más de 1 minuto
  const { data: api } = await db.from("agents").select("id").eq("runtime", "api").eq("enabled", true);
  const { data: stuck } = await db
    .from("agent_runs")
    .select("id")
    .in("agent_id", (api ?? []).map((a) => a.id))
    .eq("status", "queued")
    .lte("created_at", new Date(Date.now() - 60_000).toISOString())
    .order("created_at")
    .limit(3);
  const rescued: string[] = [];
  for (const r of stuck ?? []) rescued.push(`${r.id}:${await executeRun(r.id)}`);

  const results: { id: string; status: string }[] = [];
  for (const job of (jobs ?? []) as Job[]) {
    // Reclamar el trabajo (evita doble ejecución si dos crons coinciden)
    const { data: claimed } = await db
      .from("job_queue")
      .update({ status: "running", attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const resumed = job.status === "paused";
    try {
      const result = await runJob(job);
      await db.from("job_queue").update({ status: "done", result, last_error: null }).eq("id", job.id);
      if (resumed) {
        await log("worker", `Trabajo ${job.kind} reanudado y completado`, "info", { job: job.id });
        if (job.source_chat && job.kind !== "classify")
          await sendMessage(job.source_chat, `▶️ Reanudé y completé la tarea pendiente (${job.kind}).`);
      }
      results.push({ id: job.id, status: "done" });
    } catch (e) {
      const attempts = job.attempts + 1;
      const isLimit = e instanceof RateLimited;
      const failed = !isLimit && attempts >= MAX_ATTEMPTS;
      // Backoff exponencial: 1, 2, 4, 8… min (máx 6 h) o lo que pida el proveedor
      const waitSec = isLimit
        ? Math.max(e.retryAfterSec, 60 * 2 ** Math.min(attempts - 1, 8))
        : Math.min(60 * 2 ** (attempts - 1), 6 * 3600);
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("job_queue")
        .update({
          status: failed ? "failed" : isLimit ? "paused" : "pending",
          retry_at: new Date(Date.now() + waitSec * 1000).toISOString(),
          last_error: msg,
        })
        .eq("id", job.id);
      await log("worker", `Trabajo ${job.kind} ${failed ? "falló" : isLimit ? "pausado por límite de cuota" : "reintentará"}: ${msg}`, failed ? "error" : "warn", { job: job.id, waitSec });
      results.push({ id: job.id, status: failed ? "failed" : isLimit ? "paused" : "pending" });
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results, rescued });
}

export const POST = handle;
export const GET = handle;
