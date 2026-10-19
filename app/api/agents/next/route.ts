import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * El motor local pide aquí la siguiente orden de un agente y la reclama.
 * GET /api/agents/next?agent=productor   Authorization: Bearer <WORKER_SECRET>
 * Responde { run: null } si no hay nada pendiente.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const slug = req.nextUrl.searchParams.get("agent");
  if (!slug) return NextResponse.json({ ok: false, error: "Falta ?agent=" }, { status: 400 });

  const db = adminClient();
  const { data: agent } = await db.from("agents").select("id,enabled").eq("slug", slug).maybeSingle();
  if (!agent) return NextResponse.json({ ok: false, error: "Agente no existe" }, { status: 404 });
  if (!agent.enabled) return NextResponse.json({ ok: true, run: null, reason: "desactivado" });

  const { data: next } = await db
    .from("agent_runs")
    .select("id")
    .eq("agent_id", agent.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!next) return NextResponse.json({ ok: true, run: null });

  const { data: run } = await db
    .from("agent_runs")
    .update({ status: "running", started_at: new Date().toISOString(), current_step: "Motor local: iniciando" })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id,input,parent_run_id,created_at")
    .maybeSingle();
  if (run) await db.from("agents").update({ status: "working", current_run_id: run.id }).eq("id", agent.id);
  return NextResponse.json({ ok: true, run: run ?? null });
}
