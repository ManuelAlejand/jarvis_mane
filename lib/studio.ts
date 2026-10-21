import "server-only";
import { adminClient, log } from "@/lib/supabase/admin";
import { tg } from "@/lib/telegram";

/**
 * Estudio de YouTube Shorts.
 * Investigador (API) → el usuario elige ideas con botones → cada idea es un "video" →
 * el puente del PC lo toma (/api/studio/next): Guionista → Productor → Validador →
 * Telegram con el video y botones Publicar / Cambiar / Descartar.
 */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------- Investigador: salida estructurada ------------------------- */

export const INVESTIGADOR_SCHEMA = {
  type: "object",
  properties: {
    nicho: { type: "string" },
    mercado: { type: "string" },
    idioma: { type: "string", enum: ["es", "en", "pt"] },
    rpm_estimado: { type: "string" },
    por_que: { type: "string" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          gancho: { type: "string" },
          angulo: { type: "string" },
          palabras_clave: { type: "array", items: { type: "string" } },
        },
        required: ["titulo", "gancho", "angulo", "palabras_clave"],
        additionalProperties: false,
      },
    },
    riesgos: { type: "string" },
    resumen: { type: "string" },
  },
  required: ["nicho", "mercado", "idioma", "rpm_estimado", "por_que", "ideas", "riesgos", "resumen"],
  additionalProperties: false,
};

export const INVESTIGADOR_PROMPT = `Eres el Investigador de nichos del estudio de YouTube de JARVIS. Trabajas solo con YouTube Shorts (verticales, 30 a 55 s) producidos con IA desde Colombia.
Objetivo: elegir un nicho con buen pago por vista (RPM) y ángulo propio, comparando mercados en inglés (EE. UU., Reino Unido, Canadá, Australia), español (EE. UU. hispano, España, México) y portugués (Brasil), y proponer ideas concretas de Shorts.

Reglas:
- Descarta temas que rompan las políticas de YouTube: salud, finanzas o legal con presentador IA; personas reales o celebridades; marcas o personajes con copyright; violencia gráfica; contenido para niños; contenido reutilizado sin aporte.
- Las ideas deben poder contarse con clips de stock genéricos (paisajes, objetos, ciudades, naturaleza, espacio, historia) y narración. Evita ideas que exijan rostros concretos o escenas imposibles de encontrar en stock.
- No inventes cifras exactas: rpm_estimado es un rango orientativo en USD por 1.000 vistas, marcado como estimación.
- Si la orden menciona un tema o nicho, respétalo. No repitas temas de los trabajos recientes que te pasen como contexto.

Campos de salida (en español, salvo títulos y ganchos, que van en el idioma elegido):
- nicho, mercado, idioma (es, en o pt), rpm_estimado, por_que (2 frases).
- ideas: exactamente 5. titulo (máx. 60 caracteres), gancho (frase de los primeros 2 s), angulo (qué lo hace distinto, 1 frase), palabras_clave (3 a 5 términos en inglés para buscar clips de stock).
- riesgos: riesgos de política, o "Ninguno detectado".
- resumen: menos de 15 palabras.`;

export interface Idea {
  titulo: string;
  gancho: string;
  angulo: string;
  palabras_clave: string[];
}
export interface Investigacion {
  nicho: string;
  mercado: string;
  idioma: "es" | "en" | "pt";
  rpm_estimado: string;
  por_que: string;
  ideas: Idea[];
  riesgos: string;
  resumen: string;
  selected?: number[];
}

export function renderInvestigacion(r: Investigacion): string {
  return [
    `## Nicho: ${r.nicho}`,
    `Mercado: ${r.mercado} · Idioma: ${r.idioma} · RPM estimado: ${r.rpm_estimado}`,
    r.por_que,
    "",
    "## Ideas de Shorts",
    ...r.ideas.map((i, n) => `${n + 1}. ${i.titulo}\n   Gancho: ${i.gancho}\n   Ángulo: ${i.angulo}`),
    "",
    `Riesgos de política: ${r.riesgos}`,
  ].join("\n");
}

/* ------------------------------- Telegram: ideas con botones ------------------------------- */

function ideasKeyboard(runId: string, r: Investigacion) {
  const sel = new Set(r.selected ?? []);
  return {
    inline_keyboard: [
      ...r.ideas.map((i, n) => [
        { text: `${sel.has(n) ? "☑" : "☐"} ${n + 1}. ${i.titulo}`.slice(0, 60), callback_data: `sel:${runId}:${n}` },
      ]),
      [{ text: sel.size ? `🎬 Enviar ${sel.size} al guionista` : "Elige una o varias ideas", callback_data: `go:${runId}` }],
    ],
  };
}

export function ideasMessage(r: Investigacion) {
  return [
    `🔎 <b>Investigador</b> · ${esc(r.nicho)}`,
    `${esc(r.mercado)} · idioma <b>${r.idioma}</b> · RPM est. ${esc(r.rpm_estimado)}`,
    `<i>${esc(r.por_que)}</i>`,
    "",
    ...r.ideas.map((i, n) => `<b>${n + 1}. ${esc(i.titulo)}</b>\n   🪝 ${esc(i.gancho)}\n   ✨ ${esc(i.angulo)}`),
    "",
    r.riesgos && !/ninguno/i.test(r.riesgos) ? `⚠️ ${esc(r.riesgos)}\n` : "",
    "Toca las ideas que quieras producir y luego <b>Enviar al guionista</b>.",
  ].join("\n");
}

export async function sendIdeas(chatId: number, runId: string, r: Investigacion, encabezado = "") {
  return tg("sendMessage", {
    chat_id: chatId,
    text: (encabezado + ideasMessage(r)).slice(0, 4000),
    parse_mode: "HTML",
    reply_markup: ideasKeyboard(runId, r),
  });
}

/* ------------------------------- Callbacks de botones ------------------------------- */

interface Callback {
  id: string;
  data?: string;
  from: { id: number };
  message?: { chat: { id: number }; message_id: number };
}

async function answer(cb: Callback, text?: string) {
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: false });
}

export async function handleCallback(cb: Callback, profileId: string | null, isAdmin: boolean) {
  const db = adminClient();
  const [kind, id, extra] = (cb.data ?? "").split(":");
  const chatId = cb.message?.chat.id ?? cb.from.id;

  if (kind === "sel" || kind === "go") {
    const { data: run } = await db.from("agent_runs").select("id,result").eq("id", id).maybeSingle();
    const r = run?.result as Investigacion | null;
    if (!run || !r?.ideas) return answer(cb, "Esa investigación ya no existe.");

    if (kind === "sel") {
      const n = Number(extra);
      const sel = new Set(r.selected ?? []);
      if (sel.has(n)) sel.delete(n);
      else sel.add(n);
      r.selected = [...sel].sort((a, b) => a - b);
      await db.from("agent_runs").update({ result: r }).eq("id", id);
      await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message?.message_id, reply_markup: ideasKeyboard(id, r) });
      return answer(cb, sel.has(n) ? `Idea ${n + 1} elegida` : `Idea ${n + 1} quitada`);
    }

    // go: crear un video por idea elegida
    if (!r.selected?.length) return answer(cb, "Primero elige al menos una idea.");
    const res = await createVideosFromRun(id, r.selected, chatId, profileId);
    if (!res.ok) return answer(cb, res.error);
    // El teclado ya no se puede volver a usar
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message?.message_id, reply_markup: { inline_keyboard: [] } });
    await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: res.text });
    return answer(cb, "Enviado al guionista");
  }

  if (kind === "pub" || kind === "chg" || kind === "del") {
    if (!isAdmin) return answer(cb, "Solo el admin puede decidir sobre un video.");
    const ref = Number(id);
    const { data: v } = await db.from("videos").select("id,ref,titulo,estado").eq("ref", ref).maybeSingle();
    if (!v) return answer(cb, "Ese video ya no existe.");
    if (v.estado !== "revision") return answer(cb, `El video está en «${v.estado}».`);

    if (kind === "pub") {
      await db.from("videos").update({ estado: "publicar", fase_detalle: "En cola para subir a YouTube" }).eq("id", v.id);
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `📤 <code>V${v.ref}</code> en cola para subir a YouTube <b>en privado</b>. Te aviso con el enlace.` });
      await log("telegram", `V${v.ref} aprobado para publicar`);
      return answer(cb, "Aprobado para publicar");
    }
    if (kind === "del") {
      await db.from("videos").update({ estado: "descartado", fase_detalle: null }).eq("id", v.id);
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🗑️ <code>V${v.ref}</code> descartado.` });
      await log("telegram", `V${v.ref} descartado`);
      return answer(cb, "Descartado");
    }
    // chg: el próximo mensaje de texto de este chat son los cambios
    await db.from("telegram_users").update({ pending: { action: "cambios", video_ref: v.ref } }).eq("chat_id", cb.from.id);
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `✏️ ¿Qué cambio quieres en <code>V${v.ref}</code> «${esc(v.titulo)}»?\nEscríbelo en tu próximo mensaje (por ejemplo: <i>el gancho es flojo, hazlo más misterioso</i>). Envía /cancelar para dejarlo como está.`,
    });
    return answer(cb);
  }

  return answer(cb);
}

/** Crea un video por cada idea elegida de una investigación y los deja en cola para el Guionista. */
export async function createVideosFromRun(
  runId: string,
  selected: number[],
  chatId: number | null,
  profileId: string | null,
): Promise<{ ok: true; text: string; refs: number[] } | { ok: false; error: string }> {
  const db = adminClient();
  const { data: run } = await db.from("agent_runs").select("id,result").eq("id", runId).maybeSingle();
  const r = run?.result as Investigacion | null;
  if (!r?.ideas) return { ok: false, error: "Esa investigación ya no existe." };
  const picks = [...new Set(selected)].filter((n) => n >= 0 && n < r.ideas.length);
  if (!picks.length) return { ok: false, error: "Primero elige al menos una idea." };
  if (r.selected?.length && (r as { sent?: boolean }).sent) return { ok: false, error: "Esas ideas ya se enviaron." };

  const { data: project } = await db.from("projects").select("id").eq("slug", "youtube-shorts").maybeSingle();
  const rows = picks.map((n) => ({
    project_id: project?.id ?? null,
    idea: { ...r.ideas[n], nicho: r.nicho, mercado: r.mercado, idioma: r.idioma, rpm_estimado: r.rpm_estimado, por_que: r.por_que },
    titulo: r.ideas[n].titulo,
    source_run_id: runId,
    chat_id: chatId,
    requested_by: profileId,
  }));
  const { data: created, error } = await db.from("videos").insert(rows).select("ref,titulo");
  if (error) return { ok: false, error: "No pude crear los videos." };
  await db.from("agent_runs").update({ result: { ...r, selected: picks, sent: true } }).eq("id", runId);
  await queueGuionista(created ?? []);
  await log("studio", `${created?.length} idea(s) enviadas al Guionista`, "info", { run: runId });
  return {
    ok: true,
    refs: (created ?? []).map((v) => v.ref),
    text:
      `🎬 Enviado al <b>Guionista</b>:\n${(created ?? []).map((v) => `• <code>V${v.ref}</code> ${esc(v.titulo)}`).join("\n")}\n\n` +
      "Tu PC los tomará en orden. Te aviso cuando cada video esté listo para revisar.",
  };
}

/** Texto de "Cambiar" recibido: el video vuelve al guionista con la corrección. */
export async function applyPendingChange(chatId: number, pending: { action: string; video_ref: number }, text: string) {
  const db = adminClient();
  await db.from("telegram_users").update({ pending: null }).eq("chat_id", chatId);
  if (/^\/cancelar/i.test(text.trim())) return "Listo, el video queda como estaba.";
  const { data: v } = await db.from("videos").select("id,ref,titulo").eq("ref", pending.video_ref).maybeSingle();
  if (!v) return "Ese video ya no existe.";
  await db.from("videos").update({ estado: "cambios", feedback: text.slice(0, 2000), veredicto: null, intentos: 0, fase_detalle: "Cambios pedidos: en cola" }).eq("id", v.id);
  await queueGuionista([{ ref: v.ref, titulo: v.titulo }], text);
  await log("telegram", `Cambios pedidos para V${v.ref}`);
  return `✏️ Anotado. <code>V${v.ref}</code> vuelve al <b>Guionista</b> con tus cambios y te aviso cuando esté de nuevo listo.`;
}

/** Deja una orden visible para el Guionista en la vista Agentes (la ejecuta el puente del PC). */
async function queueGuionista(videos: { ref: number; titulo: string }[], feedback?: string) {
  const db = adminClient();
  const { data: agent } = await db.from("agents").select("id").eq("slug", "guionista").maybeSingle();
  if (!agent) return;
  for (const v of videos) {
    const { data: row } = await db.from("videos").select("id").eq("ref", v.ref).maybeSingle();
    await db.from("agent_runs").insert({
      agent_id: agent.id,
      video_id: row?.id ?? null,
      input: feedback ? `Corregir V${v.ref} «${v.titulo}»: ${feedback.slice(0, 300)}` : `Guion para V${v.ref} «${v.titulo}»`,
      source: "telegram",
      current_step: "Esperando al PC (puente del estudio)",
    });
  }
}

/* ------------------------------- Puente del PC ------------------------------- */

const ESTADO_AGENTE: Record<string, string> = {
  guionando: "guionista",
  produciendo: "productor",
  validando: "validador",
  publicando: "publicador",
};

/** Actualiza el agent_run del agente que trabaja en este video (o lo crea) para que se vea en vivo. */
export async function syncAgentRun(videoId: string, agentSlug: string, patch: { step?: string | null; summary?: string; done?: boolean; error?: string; verdict?: string; cost?: number }) {
  const db = adminClient();
  const { data: agent } = await db.from("agents").select("id").eq("slug", agentSlug).maybeSingle();
  if (!agent) return;
  const { data: open } = await db
    .from("agent_runs")
    .select("id,started_at")
    .eq("agent_id", agent.id)
    .eq("video_id", videoId)
    .in("status", ["queued", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let runId = open?.id;
  const now = new Date().toISOString();
  if (!runId) {
    const { data: v } = await db.from("videos").select("ref,titulo").eq("id", videoId).maybeSingle();
    const { data: created } = await db
      .from("agent_runs")
      .insert({ agent_id: agent.id, video_id: videoId, input: `V${v?.ref} «${v?.titulo}»`, source: "local", status: "running", started_at: now })
      .select("id")
      .single();
    runId = created?.id;
  }
  if (!runId) return;

  const final = patch.done || !!patch.error;
  await db
    .from("agent_runs")
    .update({
      status: patch.error ? "error" : patch.done ? "done" : "running",
      current_step: final ? null : (patch.step ?? null),
      ...(open && !open.started_at ? { started_at: now } : {}),
      ...(patch.summary ? { summary: patch.summary.slice(0, 140) } : {}),
      ...(patch.verdict ? { verdict: patch.verdict } : {}),
      ...(patch.cost !== undefined ? { cost_usd: patch.cost } : {}),
      ...(patch.error ? { error: patch.error.slice(0, 500) } : {}),
      ...(final ? { finished_at: now } : {}),
    })
    .eq("id", runId);

  await db
    .from("agents")
    .update(
      final
        ? { status: patch.error ? "error" : "idle", current_run_id: null, ...(patch.summary ? { last_summary: patch.summary.slice(0, 140), last_run_at: now } : {}) }
        : { status: "working", current_run_id: runId },
    )
    .eq("id", agent.id);
}

export { ESTADO_AGENTE };
