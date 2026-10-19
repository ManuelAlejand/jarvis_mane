import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { route } from "@/lib/router";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // los agentes del servidor terminan su trabajo con after()

/** Consola del dashboard: mismo router que Telegram, autenticado con la sesión de Supabase. */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const db = adminClient();
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

  const { data: profile } = await db.from("profiles").select("role, full_name").eq("id", auth.user.id).maybeSingle();
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").slice(0, 500);

  const reply = await route(text, {
    source: "dashboard",
    profileId: auth.user.id,
    isAdmin: profile?.role === "admin",
    name: profile?.full_name ?? auth.user.email ?? undefined,
  });
  return NextResponse.json(reply);
}
