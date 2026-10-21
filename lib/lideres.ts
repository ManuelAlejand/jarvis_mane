import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Líderes de sala (Oficina): cada proyecto tiene un agente líder que firma los avisos de Telegram
 * de su equipo. Ej.: "🎬 F.R.I.D.A.Y. · YouTube Shorts" antes del mensaje del Productor.
 */
export interface Lider {
  nombre: string;
  emoji: string;
  proyecto: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Líder del proyecto de un agente (por slug) o de un proyecto (por id o slug). */
export async function liderDe(q: { agentSlug?: string; projectId?: string | null; projectSlug?: string }): Promise<Lider | null> {
  try {
    const db = adminClient();
    let projectId = q.projectId ?? null;
    if (!projectId && q.agentSlug) {
      const { data } = await db.from("agents").select("project_id").eq("slug", q.agentSlug).maybeSingle();
      projectId = (data?.project_id as string | null) ?? null;
    }
    if (!projectId && q.projectSlug) {
      const { data } = await db.from("projects").select("id").eq("slug", q.projectSlug).maybeSingle();
      projectId = (data?.id as string | null) ?? null;
    }
    if (!projectId) return null;
    const [{ data: lider }, { data: proyecto }] = await Promise.all([
      db.from("agents").select("name,emoji").eq("project_id", projectId).eq("is_leader", true).eq("enabled", true).limit(1).maybeSingle(),
      db.from("projects").select("name").eq("id", projectId).maybeSingle(),
    ]);
    if (!lider) return null;
    return { nombre: String(lider.name), emoji: String(lider.emoji ?? "🧭"), proyecto: String(proyecto?.name ?? "") };
  } catch {
    return null; // la firma es decorativa: nunca debe impedir que salga el aviso
  }
}

/** Encabezado HTML con la firma del líder (vacío si no hay líder). */
export function firma(l: Lider | null): string {
  if (!l) return "";
  return `${l.emoji} <b>${esc(l.nombre)}</b>${l.proyecto ? ` <i>· ${esc(l.proyecto)}</i>` : ""}\n`;
}
