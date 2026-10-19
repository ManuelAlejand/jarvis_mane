import { NextResponse, type NextRequest } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
import { route } from "@/lib/router";

export const dynamic = "force-dynamic";

interface TgUpdate {
  message?: { chat: { id: number }; from?: { first_name?: string }; text?: string; voice?: unknown };
}

export async function POST(req: NextRequest) {
  // Solo Telegram conoce este secreto (se registra en /api/telegram/setup)
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  if (!msg) return NextResponse.json({ ok: true }); // otros tipos de update: ignorar

  const chatId = msg.chat.id;
  const db = adminClient();
  const { data: user } = await db
    .from("telegram_users")
    .select("profile_id, profiles(role, full_name)")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!user) {
    await log("telegram", `Acceso denegado al chat ${chatId}`, "warn");
    await sendMessage(
      chatId,
      `⛔ Acceso no autorizado.\nTu chat_id es <code>${chatId}</code>. Pídele al admin que lo agregue.`,
    );
    return NextResponse.json({ ok: true });
  }

  if (!msg.text) {
    await sendMessage(chatId, "Por ahora solo entiendo texto. Las notas de voz llegan en una fase futura.");
    return NextResponse.json({ ok: true });
  }

  const profile = (user as unknown as { profiles: { role: string; full_name: string | null } | null }).profiles;
  const reply = await route(msg.text, {
    source: "telegram",
    profileId: user.profile_id,
    isAdmin: profile?.role === "admin",
    name: profile?.full_name ?? msg.from?.first_name,
  });
  await sendMessage(chatId, reply.text);

  // Siempre 200 rápido: si Telegram recibe error, reintenta el mismo mensaje.
  return NextResponse.json({ ok: true });
}
