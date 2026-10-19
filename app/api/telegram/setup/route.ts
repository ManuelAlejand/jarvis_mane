import { NextResponse, type NextRequest } from "next/server";
import { BOT_COMMANDS, tg } from "@/lib/telegram";
import { log } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Registra el webhook y el menú de comandos en Telegram.
 * Abrir una vez en el navegador: https://<tu-app>.vercel.app/api/telegram/setup?key=<WORKER_SECRET>
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== process.env.WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "clave inválida" }, { status: 401 });
  }
  const missing = ["TELEGRAM_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) return NextResponse.json({ ok: false, missing }, { status: 500 });

  const url = `${req.nextUrl.origin}/api/telegram`;
  const webhook = await tg("setWebhook", {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const commands = await tg("setMyCommands", { commands: BOT_COMMANDS });
  const info = await tg("getWebhookInfo", {});

  await log("telegram", `Webhook configurado → ${url}`, webhook.ok ? "info" : "error");
  return NextResponse.json({ webhook, commands, info });
}
