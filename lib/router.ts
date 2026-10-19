import "server-only";
import { adminClient, log } from "@/lib/supabase/admin";
import type { Project, Task, TaskStatus } from "@/lib/types";
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
}

export interface Reply {
  text: string;
}

const DEFAULT_PROJECT = "jarvis-core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, "").trim();

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
  "/gasto — gasto de API del mes",
  "",
  "También entiendo: <i>pendientes</i>, <i>cómo va todo</i>, <i>cómo va youtube</i>, <i>gasto</i>.",
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
      case "proyectos":
        return await proyecto(args);
      case "gasto":
        return await gasto();
      case "_inbox":
        return await inbox(args, actor);
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

async function inbox(text: string, actor: Actor): Promise<Reply> {
  const r = await nueva(text.slice(0, 200), actor, ["por_clasificar"]);
  return {
    text:
      r.text.replace("✅ Tarea", "📥 Lo guardé como tarea") +
      "\n\n<i>Aún no interpreto texto libre (llega con el clasificador IA, hito 4). Usa /ayuda para ver comandos.</i>",
  };
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
