import { NextResponse, type NextRequest } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * El motor local (o cualquier agente fuera del servidor) reporta aquí su avance.
 * POST con Authorization: Bearer <WORKER_SECRET>
 * { "run_id": "...", "status": "running|done|error|paused", "step": "Generando voz 2/6",
 *   "summary": "…", "output": "…markdown…", "verdict": "APROBADO|RECHAZADO", "cost_usd": 0.12 }
 * Sin run_id, se puede crear uno nuevo con { "agent": "productor", "input": "…" }.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Report {
  run_id?: string;
  agent?: string;
  input?: string;
  status?: "running" | "done" | "error" | "paused";
  step?: string;
  summary?: string;
  output?: string;
  verdict?: "APROBADO" | "RECHAZADO";
  cost_usd?: number;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = (await req.json().catch(() => ({}))) as Report;
  const db = adminClient();

  let runId = r.run_id;
  if (!runId) {
    if (!r.agent) return NextResponse.json({ ok: false, error: "Falta run_id o agent" }, { status: 400 });
    const { data: agent } = await db.from("agents").select("id").eq("slug", r.agent).maybeSingle();
    if (!agent) return NextResponse.json({ ok: false, error: "Agente no existe" }, { status: 404 });
    const { data: run, error } = await db
      .from("agent_runs")
      .insert({ agent_id: agent.id, input: r.input ?? "(iniciado por el motor local)", source: "local", status: "running", started_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    runId = run.id;
  }

  const { data: run } = await db.from("agent_runs").select("id,agent_id,source_chat,started_at,agents!agent_runs_agent_id_fkey(name)").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ ok: false, error: "Run no existe" }, { status: 404 });
  const agentName = (run as unknown as { agents: { name: string } }).agents?.name ?? "Agente";

  const status = r.status ?? "running";
  const final = status === "done" || status === "error";
  const now = new Date().toISOString();

  await db
    .from("agent_runs")
    .update({
      status,
      current_step: final ? null : (r.step ?? null),
      ...(r.summary !== undefined ? { summary: r.summary.slice(0, 140) } : {}),
      ...(r.output !== undefined ? { output: r.output } : {}),
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ...(r.cost_usd !== undefined ? { cost_usd: r.cost_usd } : {}),
      ...(status === "error" ? { error: r.summary ?? r.step ?? "Error reportado" } : {}),
      ...(!run.started_at ? { started_at: now } : {}),
      ...(final ? { finished_at: now } : {}),
    })
    .eq("id", runId);

  await db
    .from("agents")
    .update(
      final
        ? { status: status === "error" ? "error" : "idle", current_run_id: null, ...(r.summary ? { last_summary: r.summary.slice(0, 140), last_run_at: now } : {}) }
        : { status: "working", current_run_id: runId },
    )
    .eq("id", run.agent_id);

  if (final) {
    await log("agent", `${agentName} ${status === "done" ? "terminó" : "falló"}: ${r.summary ?? ""}`, status === "done" ? "info" : "error", { run: runId });
    if (run.source_chat) {
      await sendMessage(run.source_chat, `${status === "done" ? "✅" : "⚠️"} <b>${esc(agentName)}</b> ${status === "done" ? "terminó" : "no pudo terminar"}\n\n${esc(r.summary ?? "")}`);
    }
  }
  return NextResponse.json({ ok: true, run_id: runId });
}
