import { browserClient } from "@/lib/supabase/browser";
import type { Enviar } from "@/components/oficina3d/ConsolaJarvis";

/** Envía una orden al mismo router de Telegram, con la sesión del dashboard. */
export const enviarComando: Enviar = async (texto) => {
  const { data } = await browserClient().auth.getSession();
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ text: texto }),
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  return res.ok ? { ok: true, html: json.text ?? "Listo." } : { ok: false, html: `⚠️ ${json.error ?? "Error"}` };
};
