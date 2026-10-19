import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { createVideosFromRun } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** Dashboard: enviar ideas elegidas de una investigación al Guionista. Solo admin. */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const db = adminClient();
  const { data: auth } = await db.auth.getUser(token);
  if (!auth?.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
  const { data: profile } = await db.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Solo el admin puede enviar ideas a producción." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { run_id?: string; selected?: number[] };
  // Notificaciones del video al chat de Telegram del admin, si tiene uno vinculado
  const { data: tgUser } = await db.from("telegram_users").select("chat_id").eq("profile_id", auth.user.id).limit(1).maybeSingle();
  const res = await createVideosFromRun(String(body.run_id ?? ""), body.selected ?? [], tgUser?.chat_id ?? null, auth.user.id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, refs: res.refs, text: res.text.replace(/<[^>]+>/g, "") });
}
