import "server-only";
import { adminClient, log } from "@/lib/supabase/admin";
import { aiAvailable, BudgetExceeded, classify, RateLimited, type Classification } from "@/lib/ai";
import { findAgent, listAgents, matchAgentByKeyword, startRun } from "@/lib/agents";
import { runExplorador } from "@/lib/trends";
import { after } from "next/server";
import type { Project, ProjectStatus, Task, TaskStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";

/**
 * Router de comandos de JARVIS (niveles 1 y 2 del spec: 0 tokens).
 * Lo usan Telegram (/api/telegram) y la Consola del dashboard (/api/command).
 * Devuelve HTML compatible con Telegram (<b>, <i>, <code>). Todo dato del usuario se escapa.
 */

export interface Actor {
  source: "telegram" | "dashboard";
  profileId: string | null;
  isAdmin: boolean;
  name?: string;
  chatId?: number | null;
}

export interface Reply {
  text: string;
}

const DEFAULT_PROJECT = "jarvis-core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, "").trim();

const PROJECT_STATUS_ALIASES: Record<string, ProjectStatus> = {
  idea: "idea", ideas: "idea",
  activo: "activo", activa: "activo", activar: "activo", activalo: "activo", empezar: "activo", empieza: "activo",
  iniciar: "activo", inicia: "activo", arrancar: "activo", arranca: "activo", en_curso: "activo", curso: "activo", progreso: "activo",
  pausado: "pausado", pausa: "pausado", pausar: "pausado", pausalo: "pausado", congelar: "pausado",
  terminado: "terminado", terminar: "terminado", termina: "terminado", cerrar: "terminado", cierra: "terminado", finalizar: "terminado",
};
const PROJECT_STATUS_ICON: Record<ProjectStatus, string> = { idea: "💡", activo: "🚀", pausado: "⏸️", terminado: "🏁" };

const STATUS_ALIASES: Record<string, TaskStatus> = {
  backlog: "backlog", pendiente: "backlog", todo: "backlog",
  curso: "en_curso", en_curso: "en_curso", encurso: "en_curso", haciendo: "en_curso", doing: "en_curso",
  bloqueada: "bloqueada", bloq: "bloqueada", bloqueado: "bloqueada",
  hecha: "hecha", hecho: "hecha", done: "hecha", lista: "hecha", terminada: "hecha",
};

const STATUS_ICON: Record<TaskStatus, string> = { backlog: "○", en_curso: "◐", bloqueada: "⛔", hecha: "●" };
const PRIORITY_ICON: Record<number, string> = { 1: "🔴", 2: "🟡", 3: "⚪" };

const HELP = [
  "<b>JARVIS · Comandos</b>",
  "/estado — resumen general",
  "/tareas [proyecto] — tareas abiertas",
  "/nueva título #proyecto !1 — crear tarea (!1 alta, !3 baja)",
  "/hecho 12 — marcar la tarea 12 como hecha",
  "/mover 12 en_curso — backlog · en_curso · bloqueada · hecha",
  "/proyecto [nombre] — detalle (sin nombre: lista)",
  "/activar auditoria · /pausar · /terminar — cambiar estado de un proyecto",
  "/gasto — gasto de API del mes",
  "/tendencias — 5 ideas basadas en lo más visto hoy",
  "/agentes — quién está trabajando y en qué",
  "/videos — Shorts en el estudio y su estado",
  "/reintentar V1 — relanzar un Short que falló",
  "/agente investigador busca nichos de misterio — darle una orden",
  "/agente radar explora nichos y locales para la Auditoría GEO en Bogotá — Radar (en tu PC, 0 USD)",
  "/agente critico valida la idea de la Auditoría GEO — Crítico: clientes simulados y veredicto",
  "/agente arquitecto haz el plano del módulo GEO en JARVIS — Arquitecto: plano técnico",
  "",
  "También entiendo: <i>pendientes</i>, <i>cómo va todo</i>, <i>cómo va youtube</i>, <i>gasto</i>.",
  "Y texto libre: <i>recuérdame comprar el dominio, es urgente</i> 🧠",
].join("\n");

export async function route(input: string, actor: Actor): Promise<Reply> {
  const raw = input.trim();
  if (!raw) return { text: HELP };

  let cmd: string;
  let args: string;

  if (raw.startsWith("/")) {
    const m = raw.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    cmd = (m?.[1] ?? "").toLowerCase();
    args = (m?.[2] ?? "").trim();
  } else {
    [cmd, args] = shortcut(raw);
  }

  try {
    switch (cmd) {
      case "start":
      case "ayuda":
      case "help":
        return { text: HELP };
      case "estado":
        return await estado();
      case "tareas":
        return await tareas(args);
      case "nueva":
        return await nueva(args, actor);
      case "hecho":
        return await mover(`${args} hecha`, actor);
      case "mover":
        return await mover(args, actor);
      case "proyecto":
      case "proyectos": {
        // "/proyecto auditoria activo" también cambia el estado
        const m = args.match(/^(.+?)\s+(\S+)$/);
        const st = m ? PROJECT_STATUS_ALIASES[norm(m[2])] : undefined;
        return m && st ? await estadoProyecto(m[1], st, actor) : await proyecto(args);
      }
      case "activar":
        return await estadoProyecto(args, "activo", actor);
      case "pausar":
        return await estadoProyecto(args, "pausado", actor);
      case "terminar":
        return await estadoProyecto(args, "terminado", actor);
      case "_proyecto_estado": {
        const [st, ...resto] = args.split(" ");
        return await estadoProyecto(resto.join(" "), PROJECT_STATUS_ALIASES[st], actor);
      }
      case "gasto":
        return await gasto();
      case "agentes":
        return await agentes();
      case "tendencias": {
        after(() => runExplorador({ chatIds: actor.chatId ? [actor.chatId] : undefined, source: actor.source }).then(() => undefined));
        return { text: "📈 El <b>Explorador</b> está revisando lo más visto en YouTube hoy (CO, MX, ES, US). Te llegan 5 ideas con botones en unos segundos." };
      }
      case "reintentar":
        return await reintentar(args, actor);
      case "videos":
        return await videos();
      case "agente": {
        const m = args.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) return { text: "Uso: /agente &lt;nombre&gt; &lt;orden&gt;. Ve los nombres con /agentes." };
        const agent = await findAgent(m[1]);
        if (!agent) return { text: `No conozco al agente «${esc(m[1])}». Usa /agentes.` };
        return await startRun(agent, m[2], { requestedBy: actor.profileId, source: actor.source, chatId: actor.chatId });
      }
      case "_inbox":
        return await freeText(args, actor);
      default:
        return { text: `No conozco el comando /${esc(cmd)}.\n\n${HELP}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(actor.source, `Error en comando "${raw.slice(0, 80)}": ${msg}`, "error");
    return { text: "⚠️ Algo falló al consultar la base de datos. Quedó registrado en Actividad." };
  }
}

/** Nivel 2: atajos por palabras clave (0 tokens). Si nada coincide → bandeja de entrada. */
function shortcut(raw: string): [string, string] {
  const t = norm(raw);
  if (/^(hola|hey|buenas|jarvis)\b/.test(t) && t.split(" ").length <= 3) return ["estado", ""];
  if (/^(pendientes|tareas|que (hay|falta|tengo)|que hay pendiente)/.test(t)) {
    const m = t.match(/(?:de|en)\s+(.+)$/);
    return ["tareas", m?.[1] ?? ""];
  }
  const comoVa = t.match(/^como va(?:n)?\s*(.*)$/);
  if (comoVa) {
    const what = comoVa[1].replace(/^(el|la|los|las|todo|proyecto)\s*/g, "").trim();
    return what ? ["proyecto", what] : ["estado", ""];
  }
  if (/^(estado|resumen|status)$/.test(t)) return ["estado", ""];
  // "empezaremos el proyecto auditoría, pásalo a activo" · "pon el proyecto clipping en pausa"
  const frase = t.match(/proyecto\s+([\w\s-]+?)\b.*\b(?:a|en)\s+(activo|pausa|pausado|terminado|idea)\b/);
  if (frase && PROJECT_STATUS_ALIASES[frase[2]]) return ["_proyecto_estado", `${frase[2]} ${frase[1]}`];
  const accion = t.match(/^(activa|activar|pausa|pausar|termina|terminar|cierra|cerrar)\s+(?:el\s+|la\s+)?(?:proyecto\s+)?(?:de\s+)?(.+)$/);
  if (accion) {
    const st = PROJECT_STATUS_ALIASES[accion[1]];
    return [st === "activo" ? "activar" : st === "pausado" ? "pausar" : "terminar", accion[2]];
  }
  if (/^(tendencias|que esta de moda|que es tendencia|lo mas visto)/.test(t)) return ["tendencias", ""];
  if (/(gasto|cuanto (llevo|he gastado|gastamos)|presupuesto)/.test(t)) return ["gasto", ""];
  if (/^(ayuda|comandos|help)$/.test(t)) return ["ayuda", ""];
  return ["_inbox", raw];
}

async function findProject(q: string): Promise<Project | null> {
  const db = adminClient();
  const key = norm(q).replace(/\s+/g, "-");
  if (!key) return null;
  const { data } = await db.from("projects").select("*").order("created_at");
  const list = (data ?? []) as Project[];
  return (
    list.find((p) => p.slug === key) ??
    list.find((p) => p.slug.includes(key) || norm(p.name).includes(norm(q))) ??
    null
  );
}

async function spend() {
  const db = adminClient();
  const [{ data: s }, { data: b }] = await Promise.all([
    db.from("api_spend_month").select("spent_usd").single(),
    db.from("settings").select("value").eq("key", "api_budget_usd").single(),
  ]);
  return { spent: Number(s?.spent_usd ?? 0), budget: Number(b?.value ?? 5) };
}

async function estado(): Promise<Reply> {
  const db = adminClient();
  const [{ data: projects }, { data: tasks }, money] = await Promise.all([
    db.from("projects").select("id,name,status,progress").order("created_at"),
    db.from("tasks").select("status,priority,project_id"),
    spend(),
  ]);
  const ps = (projects ?? []) as Pick<Project, "id" | "name" | "status" | "progress">[];
  const ts = (tasks ?? []) as Pick<Task, "status" | "priority" | "project_id">[];
  const count = (s: TaskStatus) => ts.filter((t) => t.status === s).length;
  const urgent = ts.filter((t) => t.status !== "hecha" && t.priority === 1).length;

  const lines = [
    "<b>⬡ JARVIS · Estado</b>",
    `Proyectos activos: <b>${ps.filter((p) => p.status === "activo").length}</b> de ${ps.length}`,
    `Tareas: ○ ${count("backlog")} · ◐ ${count("en_curso")} · ⛔ ${count("bloqueada")} · ● ${count("hecha")}`,
    urgent ? `🔴 ${urgent} tarea(s) de prioridad alta abiertas` : "Sin urgencias abiertas",
    `API: <b>$${money.spent.toFixed(2)}</b> / $${money.budget.toFixed(2)} este mes`,
    "",
    ...ps.map((p) => {
      const open = ts.filter((t) => t.project_id === p.id && t.status !== "hecha").length;
      return `• ${esc(p.name)} — ${p.status} · ${p.progress}% · ${open} abiertas`;
    }),
  ];
  return { text: lines.join("\n") };
}

async function tareas(args: string): Promise<Reply> {
  const db = adminClient();
  let query = db
    .from("tasks")
    .select("ref,title,status,priority,project_id,projects(name)")
    .neq("status", "hecha")
    .order("priority")
    .order("ref")
    .limit(30);

  let header = "<b>Tareas abiertas</b>";
  if (args) {
    const p = await findProject(args);
    if (!p) return { text: `No encontré el proyecto «${esc(args)}». Usa /proyecto para ver la lista.` };
    query = query.eq("project_id", p.id);
    header = `<b>Tareas abiertas · ${esc(p.name)}</b>`;
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as (Task & { projects: { name: string } | null })[];
  if (!rows.length) return { text: `${header}\nNada pendiente. 🎯` };

  return {
    text: [
      header,
      ...rows.map(
        (t) =>
          `${PRIORITY_ICON[t.priority] ?? ""} <code>#${t.ref}</code> ${STATUS_ICON[t.status]} ${esc(t.title)}` +
          (args ? "" : ` <i>· ${esc(t.projects?.name ?? "")}</i>`),
      ),
      "",
      "Marca una con /hecho &lt;número&gt;",
    ].join("\n"),
  };
}

async function nueva(args: string, actor: Actor, extraTags: string[] = []): Promise<Reply> {
  if (!args) return { text: "Uso: /nueva título de la tarea #proyecto !1" };
  let title = args;
  let priority = 2;
  const pr = title.match(/(?:^|\s)!([123])\b/);
  if (pr) {
    priority = Number(pr[1]);
    title = title.replace(pr[0], " ");
  }
  const tag = title.match(/(?:^|\s)#([\w-]+)/);
  let project: Project | null = null;
  if (tag) {
    project = await findProject(tag[1]);
    if (!project) return { text: `No encontré el proyecto «${esc(tag[1])}». Usa /proyecto para ver la lista.` };
    title = title.replace(tag[0], " ");
  } else {
    project = await findProject(DEFAULT_PROJECT);
  }
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return { text: "La tarea necesita un título." };
  if (!project) return { text: "No hay proyectos creados todavía." };

  const { data, error } = await adminClient()
    .from("tasks")
    .insert({ project_id: project.id, title, priority, tags: extraTags, assignee: actor.profileId })
    .select("ref")
    .single();
  if (error) throw error;
  await log(actor.source, `Tarea #${data.ref} creada: ${title}`, "info", { project: project.slug });
  return { text: `✅ Tarea <code>#${data.ref}</code> creada en <b>${esc(project.name)}</b>\n${esc(title)}` };
}

/** Sin IA disponible: el mensaje no se pierde, queda como tarea por clasificar. */
export async function inbox(text: string, actor: Actor, note?: string): Promise<Reply> {
  const clean = text.replace(/[#!]/g, "").slice(0, 200);
  const r = await nueva(clean, actor, ["por_clasificar"]);
  return {
    text:
      r.text.replace("✅ Tarea", "📥 Lo guardé como tarea") +
      `\n\n<i>${note ?? "No pude interpretarlo con IA ahora. Usa /ayuda para ver comandos."}</i>`,
  };
}

/** Nivel 3: texto libre → Haiku clasifica → se ejecuta la acción equivalente. */
async function freeText(text: string, actor: Actor): Promise<Reply> {
  // Atajo sin IA: si el texto trae palabras clave de un agente ("busca ideas de video…"), va directo a él
  const direct = await matchAgentByKeyword(text);
  if (direct) return startRun(direct, text, { requestedBy: actor.profileId, source: actor.source, chatId: actor.chatId });

  const avail = await aiAvailable();
  if (!avail.ok) {
    return inbox(
      text,
      actor,
      avail.reason === "budget"
        ? `Freno de gasto activo ($${avail.spent.toFixed(2)} de $${avail.limit.toFixed(2)}): este mes solo funcionan los comandos.`
        : undefined,
    );
  }
  const [{ data }, agents] = await Promise.all([
    adminClient().from("projects").select("slug,name").order("created_at"),
    listAgents(),
  ]);
  try {
    const c = await classify(text, data ?? [], agents);
    return await applyClassification(c, text, actor);
  } catch (e) {
    if (e instanceof RateLimited) {
      await adminClient().from("job_queue").insert({
        kind: "classify",
        status: "paused",
        payload: { text, actor },
        source_chat: actor.chatId ?? null,
        retry_at: new Date(Date.now() + e.retryAfterSec * 1000).toISOString(),
        last_error: e.message,
      });
      await log(actor.source, "Clasificación pausada por límite de cuota; quedó en cola", "warn");
      return { text: "⏸️ La API está en su límite de cuota. Guardé tu mensaje en la cola y te aviso aquí en cuanto lo procese." };
    }
    if (e instanceof BudgetExceeded) return inbox(text, actor, "Freno de gasto activo: este mes solo funcionan los comandos.");
    await log(actor.source, `Clasificador falló: ${e instanceof Error ? e.message : e}`, "error");
    return inbox(text, actor);
  }
}

export async function applyClassification(c: Classification, original: string, actor: Actor): Promise<Reply> {
  const slug = c.project_slug ? ` #${c.project_slug}` : "";
  const title = (c.title ?? original).replace(/[#!]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  const prio = [1, 2, 3].includes(c.priority) ? c.priority : 2;
  const ai = "\n\n<i>🧠 Interpretado con IA</i>";
  let r: Reply;

  switch (c.intent) {
    case "run_agent": {
      const agent = c.agent_slug ? await findAgent(c.agent_slug) : null;
      if (agent) {
        r = await startRun(agent, c.title ?? original, { requestedBy: actor.profileId, source: actor.source, chatId: actor.chatId });
        break;
      }
      r = await nueva(`${title}${slug} !${prio}`, actor, ["ia"]);
      break;
    }
    case "set_project_status": {
      const st = c.new_status ? PROJECT_STATUS_ALIASES[norm(c.new_status)] : undefined;
      if (c.project_slug && st) {
        r = await estadoProyecto(c.project_slug, st, actor);
      } else {
        r = { text: "Entendí que quieres cambiar el estado de un proyecto, pero no supe cuál o a qué estado. Usa: /activar &lt;proyecto&gt;, /pausar o /terminar." };
      }
      break;
    }
    case "move_task": {
      const st = c.new_status ? STATUS_ALIASES[norm(c.new_status)] : undefined;
      r = c.task_ref && st
        ? await mover(`${c.task_ref} ${st}`, actor)
        : { text: "Entendí que quieres mover una tarea, pero me faltó el número o el estado. Usa: /mover 12 en_curso" };
      break;
    }
    case "create_task":
      r = await nueva(`${title}${slug} !${prio}`, actor, ["ia"]);
      break;
    case "complex":
      r = await nueva(`${title}${slug} !${prio}`, actor, ["para_chat"]);
      r = { text: `${r.text}\n\nEsto requiere trabajo profundo: lo desarrollamos en el chat de Claude. Quedó marcado como <b>para_chat</b>.` };
      break;
    case "query_status":
      r = await estado();
      break;
    case "query_tasks":
      r = await tareas(c.project_slug ?? "");
      break;
    case "query_project":
      r = await proyecto(c.project_slug ?? "");
      break;
    case "query_spend":
      r = await gasto();
      break;
    default:
      r = { text: esc(c.reply ?? "A la orden. Escribe /ayuda para ver lo que puedo hacer.") };
  }
  await log(actor.source, `IA → ${c.intent}${c.project_slug ? ` (${c.project_slug})` : ""}: "${original.slice(0, 60)}"`);
  return { text: r.text + ai };
}

async function mover(args: string, actor: Actor): Promise<Reply> {
  const m = args.match(/#?(\d+)\s+(\S+)/);
  if (!m) return { text: "Uso: /mover 12 en_curso  ·  /hecho 12" };
  const ref = Number(m[1]);
  const status = STATUS_ALIASES[norm(m[2])];
  if (!status) return { text: "Estados válidos: backlog · en_curso · bloqueada · hecha" };

  const db = adminClient();
  const { data: task } = await db.from("tasks").select("id,title,assignee,status").eq("ref", ref).maybeSingle();
  if (!task) return { text: `No existe la tarea #${ref}.` };
  if (!actor.isAdmin && task.assignee !== actor.profileId)
    return { text: "Solo puedes mover tareas asignadas a ti." };
  if (task.status === status) return { text: `La tarea #${ref} ya está en ${STATUS_LABEL[status]}.` };

  const { error } = await db.from("tasks").update({ status }).eq("id", task.id);
  if (error) throw error;
  await log(actor.source, `Tarea #${ref} → ${STATUS_LABEL[status]}: ${task.title}`);
  return { text: `${STATUS_ICON[status]} Tarea <code>#${ref}</code> → <b>${STATUS_LABEL[status]}</b>\n${esc(task.title)}` };
}

async function estadoProyecto(q: string, status: ProjectStatus, actor: Actor): Promise<Reply> {
  if (!actor.isAdmin) return { text: "Solo un administrador puede cambiar el estado de un proyecto." };
  const query = q.trim();
  if (!query) return { text: "¿Cuál proyecto? Ejemplo: /activar auditoria. Lista: /proyecto" };
  const p = await findProject(query);
  if (!p) return { text: `No encontré el proyecto «${esc(query)}». Usa /proyecto para ver la lista.` };
  if (p.status === status) return { text: `${PROJECT_STATUS_ICON[status]} <b>${esc(p.name)}</b> ya está en <b>${status}</b>.` };
  const db = adminClient();
  const { error } = await db.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", p.id);
  if (error) throw error;
  await log(actor.source, `Proyecto ${p.slug}: ${p.status} → ${status}`);
  const extra: string[] = [];
  if (status === "activo") {
    const { data } = await db.from("tasks").select("ref,title,status").eq("project_id", p.id)
      .neq("status", "hecha").order("position").limit(3);
    const prox = (data ?? []) as Pick<Task, "ref" | "title" | "status">[];
    if (prox.length) {
      extra.push("", "<b>Primeras tareas:</b>", ...prox.map((t) => `${STATUS_ICON[t.status]} <code>#${t.ref}</code> ${esc(t.title)}`));
      extra.push("", `Empezar una: /mover ${prox[0].ref} en_curso · Ver todas: /tareas ${p.slug}`);
    }
  }
  return { text: [`${PROJECT_STATUS_ICON[status]} Proyecto <b>${esc(p.name)}</b>: ${p.status} → <b>${status}</b>`, ...extra].join("\n") };
}

async function proyecto(args: string): Promise<Reply> {
  const db = adminClient();
  if (!args) {
    const { data } = await db.from("projects").select("slug,name,status,progress").order("created_at");
    const rows = (data ?? []) as Project[];
    return {
      text: [
        "<b>Proyectos</b>",
        ...rows.map((p) => `• <b>${esc(p.name)}</b> <code>${p.slug}</code> — ${p.status} · ${p.progress}%`),
        "",
        "Detalle: /proyecto &lt;slug&gt;",
      ].join("\n"),
    };
  }
  const p = await findProject(args);
  if (!p) return { text: `No encontré el proyecto «${esc(args)}».` };
  const { data } = await db.from("tasks").select("status").eq("project_id", p.id);
  const ts = (data ?? []) as Pick<Task, "status">[];
  const c = (s: TaskStatus) => ts.filter((t) => t.status === s).length;
  return {
    text: [
      `<b>${esc(p.name)}</b> <code>${p.slug}</code>`,
      `Estado: ${p.status} · Avance: ${p.progress}%`,
      p.summary ? `<i>${esc(p.summary)}</i>` : "",
      `Tareas: ○ ${c("backlog")} · ◐ ${c("en_curso")} · ⛔ ${c("bloqueada")} · ● ${c("hecha")}`,
      "",
      `Ver tareas: /tareas ${p.slug}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const RUNTIME_LABEL: Record<string, string> = { api: "servidor", chat: "chat Claude", local: "motor local" };

async function agentes(): Promise<Reply> {
  const db = adminClient();
  const [agents, { data: runs }] = await Promise.all([
    listAgents(),
    db.from("agent_runs").select("agent_id,current_step,status").in("status", ["queued", "running", "paused"]),
  ]);
  const rows = agents;
  return {
    text: [
      "<b>Agentes</b>",
      ...rows.map((a) => {
        const active = (runs ?? []).filter((r) => r.agent_id === a.id);
        const running = active.find((r) => r.status === "running");
        const icon = !a.enabled ? "⚫" : a.status === "error" ? "🔴" : running ? "🟢" : active.length ? "🟡" : "⚪";
        const doing = running?.current_step ?? (active.length ? `${active.length} orden(es) en cola` : !a.enabled ? "Desactivado" : "En espera");
        return `${icon} <b>${esc(a.name)}</b> · ${esc(a.role)} <i>(${RUNTIME_LABEL[a.runtime]})</i>\n    ${esc(doing)}`;
      }),
    ].join("\n"),
  };
}

const VIDEO_TXT: Record<string, string> = {
  guion_pendiente: "en cola para el guion", guionando: "escribiendo el guion", cambios: "aplicando cambios",
  produciendo: "produciendo", validando: "validando", revision: "listo para revisar", publicar: "en cola para subir",
  publicando: "subiendo", publicado: "subido en privado", descartado: "descartado", error: "error",
};

async function videos(): Promise<Reply> {
  const { data } = await adminClient()
    .from("videos")
    .select("ref,titulo,estado,fase_detalle,error")
    .neq("estado", "descartado")
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data?.length) return { text: "Aún no hay Shorts. Pide ideas: <i>busca ideas de video sobre…</i>" };
  return {
    text: [
      "<b>Shorts en el estudio</b>",
      ...data.map(
        (v) =>
          `<code>V${v.ref}</code> ${esc(v.titulo)}\n    ${VIDEO_TXT[v.estado] ?? v.estado}` +
          (v.estado === "error" && v.error ? ` — ${esc(String(v.error).slice(0, 90))}` : v.fase_detalle ? ` · ${esc(v.fase_detalle)}` : ""),
      ),
    ].join("\n"),
  };
}

async function reintentar(args: string, actor: Actor): Promise<Reply> {
  if (!actor.isAdmin) return { text: "Solo el admin puede relanzar videos." };
  const ref = Number(args.replace(/^#?v/i, "").trim());
  if (!ref) return { text: "Uso: /reintentar V1" };
  const db = adminClient();
  const { data: v } = await db.from("videos").select("id,ref,titulo,estado").eq("ref", ref).maybeSingle();
  if (!v) return { text: `No existe el video V${ref}.` };
  if (!["error", "revision", "descartado"].includes(v.estado)) return { text: `V${ref} está «${VIDEO_TXT[v.estado] ?? v.estado}»: no hace falta relanzarlo.` };
  await db.from("videos").update({ estado: "guion_pendiente", error: null, intentos: 0, veredicto: null, fase_detalle: "En cola (reintento)" }).eq("id", v.id);
  await log(actor.source, `V${ref} relanzado`);
  return { text: `🔁 <code>V${ref}</code> «${esc(v.titulo)}» vuelve a la cola. Tu PC lo tomará en unos segundos.` };
}

async function gasto(): Promise<Reply> {
  const { spent, budget } = await spend();
  const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const bar = "▰".repeat(Math.round(pct / 10)) + "▱".repeat(10 - Math.round(pct / 10));
  return {
    text: [
      "<b>Gasto de API · este mes</b>",
      `${bar} ${pct}%`,
      `$${spent.toFixed(4)} de $${budget.toFixed(2)}`,
      spent >= budget * 0.9 ? "⚠️ Cerca del tope: solo comandos sin IA." : "Dentro del presupuesto.",
    ].join("\n"),
  };
}
