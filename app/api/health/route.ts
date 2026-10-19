import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Ping de salud. pg_cron lo llama a diario para que Supabase Free no pause el proyecto. */
export async function GET() {
  const vars = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "WORKER_SECRET"];
  const missing = vars.filter((k) => !process.env[k]);
  let db = false;
  try {
    const { error } = await adminClient().from("settings").select("key").limit(1);
    db = !error;
  } catch {
    db = false;
  }
  const ai = !!process.env.ANTHROPIC_API_KEY;
  return NextResponse.json({ ok: db && !missing.length, db, ai, missing }, { status: db ? 200 : 503 });
}
