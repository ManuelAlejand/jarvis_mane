import { NextResponse, type NextRequest } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
import { syncAgentRun } from "@/lib/studio";

export const dynamic = "force-dynamic";

/**
 * El puente del PC reporta aquí el avance de un video.
 * POST Authorization: Bearer <WORKER_SECRET>
 * {
 *   "video_id": "...",
 *   "estado": "produciendo",            // opcional: nuevo estado del video
 *   "fase_detalle": "Generando voz 3/8", // opcional
 *   "agente": "productor", "paso": "Generando voz 3/8", "resumen": "...", "fin": true,
 *   "error": "...", "veredicto": "APROBADO", "problemas": [...], "guion_resumen": {...},
 *   "costo_estimado_usd": 0, "duracion_seg": 48.2, "carpeta": "...", "intentos": 1,
 *   "youtube_id": "...", "youtube_url": "...",
 *   "notificar": "texto HTML para Telegram"
 * }
 */

const CAMPOS = [
  "estado", "fase_detalle", "veredicto", "problemas", "guion_resumen", "costo_estimado_usd",
  "duracion_seg", "carpeta", "intentos", "youtube_id", "youtube_url", "error", "titulo",
] as const;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const videoId = String(r.video_id ?? "");
  const db = adminClient();
  const { data: video } = await db.from("videos").select("id,ref,chat_id").eq("id", videoId).maybeSingle();
  if (!video) return NextResponse.json({ ok: false, error: "Video no existe" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  for (const k of CAMPOS) if (r[k] !== undefined) patch[k] = r[k];
  if (Object.keys(patch).length) await db.from("videos").update(patch).eq("id", videoId);

  if (typeof r.agente === "string") {
    await syncAgentRun(videoId, r.agente, {
      step: (r.paso as string) ?? (r.fase_detalle as string) ?? null,
      summary: r.resumen as string | undefined,
      done: r.fin === true,
      error: r.error as string | undefined,
      verdict: r.veredicto as string | undefined,
    });
  }

  if (r.estado || r.error) {
    await log("studio", `V${video.ref}: ${r.error ? `error — ${String(r.error).slice(0, 120)}` : r.estado}`, r.error ? "error" : "info");
  }
  if (typeof r.notificar === "string" && video.chat_id) await sendMessage(video.chat_id, r.notificar);

  return NextResponse.json({ ok: true });
}
