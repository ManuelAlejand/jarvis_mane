import "server-only";

const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/${method}`;

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; description?: string; result?: unknown }>;
}

/** Envía texto con formato HTML. Telegram limita a 4096 caracteres. */
export async function sendMessage(chatId: number, text: string) {
  const r = await tg("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true });
  // Si el HTML quedó mal (p. ej. una etiqueta cortada por el límite), se reenvía como texto plano
  if (!r.ok && /parse|entit/i.test(r.description ?? "")) {
    const plano = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return tg("sendMessage", { chat_id: chatId, text: plano.slice(0, 4000), disable_web_page_preview: true });
  }
  return r;
}

/** Envía un archivo de texto (p. ej. el informe completo de un agente en Markdown). */
export async function sendDocument(chatId: number, nombre: string, contenido: string, caption?: string) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([contenido], { type: "text/markdown" }), nombre);
  if (caption) {
    form.append("caption", caption.slice(0, 1000));
    form.append("parse_mode", "HTML");
  }
  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  return res.json() as Promise<{ ok: boolean; description?: string }>;
}

/** Markdown → HTML simple de Telegram (negritas, títulos, código), con el resto escapado. */
export function mdATelegram(md: string) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return md
    .split("\n")
    .map((l) => {
      const h = l.match(/^#{1,6}\s+(.*)$/);
      if (h) return `<b>${esc(h[1].replace(/\*\*/g, ""))}</b>`;
      if (/^\s*(---|\|[-: |]+\|)\s*$/.test(l)) return "";
      return esc(l)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/^\s*[-*]\s+/, "• ");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Resumen legible de un informe largo: el inicio y, si existe, la sección de veredicto. */
export function resumenInforme(md: string, max = 3000) {
  const sinFront = md.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\n_Archivos en el PC:[\s\S]*$/, "");
  const secciones = sinFront.split(/\n(?=#{1,3}\s)/);
  const veredicto = secciones.find((s) => /^#{1,3}\s.*(veredicto|recomendaci)/i.test(s));
  const inicio = secciones.slice(0, 3).join("\n");
  const partes = [inicio.slice(0, veredicto ? max * 0.55 : max)];
  if (veredicto && !inicio.includes(veredicto)) partes.push(veredicto.slice(0, max * 0.45));
  return partes.join("\n\n…\n\n");
}

export const BOT_COMMANDS = [
  { command: "estado", description: "Resumen general de JARVIS" },
  { command: "tareas", description: "Tareas abiertas (opcional: proyecto)" },
  { command: "nueva", description: "Crear tarea: /nueva título #proyecto" },
  { command: "hecho", description: "Marcar tarea como hecha: /hecho 12" },
  { command: "mover", description: "Cambiar estado: /mover 12 en_curso" },
  { command: "proyecto", description: "Detalle de un proyecto" },
  { command: "gasto", description: "Gasto de API del mes" },
  { command: "tendencias", description: "5 ideas basadas en lo más visto hoy" },
  { command: "agentes", description: "Quién está trabajando y en qué" },
  { command: "informe", description: "Último informe de un agente: /informe critico" },
  { command: "videos", description: "Shorts en el estudio" },
  { command: "reintentar", description: "Relanzar un Short: /reintentar V1" },
  { command: "ayuda", description: "Lista de comandos" },
];
