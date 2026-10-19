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
export function sendMessage(chatId: number, text: string) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export const BOT_COMMANDS = [
  { command: "estado", description: "Resumen general de JARVIS" },
  { command: "tareas", description: "Tareas abiertas (opcional: proyecto)" },
  { command: "nueva", description: "Crear tarea: /nueva título #proyecto" },
  { command: "hecho", description: "Marcar tarea como hecha: /hecho 12" },
  { command: "mover", description: "Cambiar estado: /mover 12 en_curso" },
  { command: "proyecto", description: "Detalle de un proyecto" },
  { command: "gasto", description: "Gasto de API del mes" },
  { command: "ayuda", description: "Lista de comandos" },
];
