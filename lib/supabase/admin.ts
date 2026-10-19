import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Cliente con service_role: ignora RLS. Solo para rutas de servidor (bot, worker). */
export function adminClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export async function log(
  source: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
  meta?: Record<string, unknown>,
) {
  try {
    await adminClient().from("execution_logs").insert({ source, message, level, meta: meta ?? null });
  } catch {
    // Nunca romper una respuesta por un log fallido
  }
}
