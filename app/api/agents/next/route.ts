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
  const { data: agent } = await db.from("agents").select("id,enabled,project_id").eq("slug", slug).maybeSingle();
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
  return NextResponse.json({ ok: true, run: run ?? null, contexto: run ? await contextoDe(run.input ?? "", agent.project_id) : null });
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Contexto para los agentes del PC: la ficha (spec) del proyecto que menciona la orden
 * ("Auditoría GEO", "auditoria-geo"…) o, si no menciona ninguno, la del proyecto del agente.
 */
async function contextoDe(input: string, projectId: string | null) {
  const { data: projects } = await adminClient().from("projects").select("id,slug,name,status,summary,spec_md");
  const t = norm(input);
  const menciona = (p: { slug: string; name: string }) => {
    const partes = p.slug.split("-").filter((w) => w.length > 2);
    return t.includes(norm(p.name)) || t.includes(p.slug) || partes.every((w) => t.includes(w)) || (partes[0]?.length >= 8 && t.includes(partes[0]));
  };
  const mencionado = (projects ?? []).filter((p) => p.slug !== "jarvis-core").find(menciona);
  const p = mencionado ?? (projects ?? []).find((x) => x.id === projectId);
  if (!p) return null;
  return { proyecto: p.name, slug: p.slug, estado: p.status, spec_md: String(p.spec_md ?? p.summary ?? "").slice(0, 20000) };
}
