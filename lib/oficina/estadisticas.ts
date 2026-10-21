import type { AgentRun } from "@/lib/types";

/** Actividad de los últimos 7 días (barras), % de éxito y duración media. */
export function estadisticasDe(runs: AgentRun[], hoy = new Date()) {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(hoy);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return { ini: d.getTime(), ok: 0, error: 0, etiqueta: d.toLocaleDateString("es-CO", { weekday: "narrow" }) };
  });
  let ok = 0;
  let fallos = 0;
  let durTotal = 0;
  let durN = 0;
  for (const r of runs) {
    const t = new Date(r.created_at).getTime();
    const dia = [...dias].reverse().find((d) => t >= d.ini);
    if (r.status === "done") ok++;
    if (r.status === "error") fallos++;
    if (dia && t < dias[6].ini + 86400000) {
      if (r.status === "error") dia.error++;
      else dia.ok++;
    }
    if (r.started_at && r.finished_at) {
      const d = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
      if (d > 0) {
        durTotal += d;
        durN++;
      }
    }
  }
  return { dias, exito: ok + fallos ? Math.round((ok / (ok + fallos)) * 100) : null, durMedia: durN ? durTotal / durN / 1000 : null };
}
