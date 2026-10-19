import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * El puente del PC pide aquí el siguiente trabajo del estudio y lo reclama.
 * GET /api/studio/next   Authorization: Bearer <WORKER_SECRET>
 * → { trabajo: null } o { trabajo: { accion: "guion" | "publicar", video: {...} } }
 * También registra un latido para que el dashboard sepa que el PC está conectado.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const db = adminClient();
  await db.from("settings").upsert({ key: "studio_heartbeat", value: { at: new Date().toISOString(), host: req.nextUrl.searchParams.get("host") ?? "pc" } });
  if (req.nextUrl.searchParams.get("probar")) return NextResponse.json({ ok: true, trabajo: null, prueba: true });

  const { data: next } = await db
    .from("videos")
    .select("id,estado")
    .in("estado", ["guion_pendiente", "cambios", "publicar"])
    .order("updated_at")
    .limit(1)
    .maybeSingle();
  if (!next) return NextResponse.json({ ok: true, trabajo: null });

  const publicar = next.estado === "publicar";
  const { data: video } = await db
    .from("videos")
    .update(publicar ? { estado: "publicando", fase_detalle: "Subiendo a YouTube" } : { estado: "guionando", fase_detalle: "Escribiendo el guion" })
    .eq("id", next.id)
    .eq("estado", next.estado) // reclamo atómico
    .select("*")
    .maybeSingle();
  if (!video) return NextResponse.json({ ok: true, trabajo: null });

  return NextResponse.json({ ok: true, trabajo: { accion: publicar ? "publicar" : "guion", video } });
}
