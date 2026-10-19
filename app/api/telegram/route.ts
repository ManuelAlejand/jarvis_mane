import { NextResponse, type NextRequest } from "next/server";
import { adminClient, log } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram";
import { route } from "@/lib/router";
import { applyPendingChange, handleCallback } from "@/lib/studio";

export const dynamic = "force-dynamic";

interface TgUpdate {
  message?: { chat: { id: number }; from?: { id: number; first_name?: string }; text?: string; voice?: unknown };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
  };
}

async function authorized(chatId: number) {
  const { data } = await adminClient()
    .from("telegram_users")
    .select("profile_id, pending, profiles(role, full_name)")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data) return null;
  const profile = (data as unknown as { profiles: { role: string; full_name: string | null } | null }).profiles;
  return {
    profileId: data.profile_id as string | null,
    isAdmin: profile?.role === "admin",
    name: profile?.full_name ?? undefined,
    pending: data.pending as { action: string; video_ref: number } | null,
  };
}

export async function POST(req: NextRequest) {
  // Solo Telegram conoce este secreto (se registra en /api/telegram/setup)
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null;

  // Botones (elegir ideas, publicar, cambiar, descartar)
  if (update?.callback_query) {
    const cb = update.callback_query;
    const user = await authorized(cb.from.id);
    if (user) await handleCallback(cb, user.profileId, user.isAdmin);
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  if (!msg) return NextResponse.json({ ok: true }); // otros tipos de update: ignorar

  const chatId = msg.chat.id;
  const user = await authorized(chatId);
  if (!user) {
    await log("telegram", `Acceso denegado al chat ${chatId}`, "warn");
    await sendMessage(chatId, `⛔ Acceso no autorizado.\nTu chat_id es <code>${chatId}</code>. Pídele al admin que lo agregue.`);
    return NextResponse.json({ ok: true });
  }

  if (!msg.text) {
    await sendMessage(chatId, "Por ahora solo entiendo texto. Las notas de voz llegan en una fase futura.");
    return NextResponse.json({ ok: true });
  }

  // Respuesta a "✏️ Cambiar": este texto son los cambios del video
  if (user.pending?.action === "cambios") {
    await sendMessage(chatId, await applyPendingChange(chatId, user.pending, msg.text));
    return NextResponse.json({ ok: true });
  }

  const reply = await route(msg.text, {
    source: "telegram",
    profileId: user.profileId,
    isAdmin: user.isAdmin,
    name: user.name ?? msg.from?.first_name,
    chatId,
  });
  await sendMessage(chatId, reply.text);

  // Siempre 200 rápido: si Telegram recibe error, reintenta el mismo mensaje.
  return NextResponse.json({ ok: true });
}
