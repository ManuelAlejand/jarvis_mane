import "server-only";
import { adminClient, log } from "@/lib/supabase/admin";
import { BudgetExceeded, callClaude, RateLimited } from "@/lib/ai";
import { INVESTIGADOR_SCHEMA, renderInvestigacion, sendIdeas, type Investigacion } from "@/lib/studio";
import { sendMessage } from "@/lib/telegram";

/**
 * Explorador de tendencias: lee lo que está funcionando HOY en YouTube (API pública, solo llave)
 * y propone 5 ideas de Shorts con botones, sin que el usuario escriba un tema.
 * Cuota de YouTube por ejecución: ~8 unidades + 4 búsquedas (de 10.000 unidades / 100 búsquedas diarias).
 */

const YT = "https://www.googleapis.com/youtube/v3";
const REGIONES: { code: string; lang: string; nombre: string }[] = [
  { code: "CO", lang: "es", nombre: "Colombia" },
  { code: "MX", lang: "es", nombre: "México" },
  { code: "ES", lang: "es", nombre: "España" },
  { code: "US", lang: "en", nombre: "EE. UU." },
];
// Categorías que no sirven para un canal faceless con stock (música, deportes, videojuegos en vivo…)
const EXCLUIR_CATEGORIAS = new Set(["10", "17", "20"]);

interface Video {
  titulo: string;
  vistas: number;
  canal: string;
  categoria: string;
  tags: string[];
  segundos: number;
}

function segundosISO(d: string | undefined) {
  const m = d?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

async function yt(path: string, params: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY ?? "";
  const url = `${YT}/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${body?.error?.message ?? "error"}`);
  return body as { items?: Record<string, unknown>[] };
}

function aVideo(it: Record<string, unknown>): Video {
  const sn = (it.snippet ?? {}) as { title?: string; channelTitle?: string; categoryId?: string; tags?: string[] };
  const st = (it.statistics ?? {}) as { viewCount?: string };
  const cd = (it.contentDetails ?? {}) as { duration?: string };
  return {
    titulo: sn.title ?? "",
    vistas: Number(st.viewCount ?? 0),
    canal: sn.channelTitle ?? "",
    categoria: sn.categoryId ?? "",
    tags: (sn.tags ?? []).slice(0, 4),
    segundos: segundosISO(cd.duration),
  };
}

async function datosRegion(r: (typeof REGIONES)[number]) {
  const semana = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [populares, busqueda] = await Promise.all([
    yt("videos", { part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: r.code, maxResults: "30" }),
    yt("search", {
      part: "id", type: "video", q: "#shorts", order: "viewCount", publishedAfter: semana,
      regionCode: r.code, relevanceLanguage: r.lang, videoDuration: "short", maxResults: "30",
    }),
  ]);
  const ids = (busqueda.items ?? []).map((i) => (i.id as { videoId?: string })?.videoId).filter(Boolean).join(",");
  const shorts = ids ? await yt("videos", { part: "snippet,statistics,contentDetails", id: ids }) : { items: [] };
  const limpiar = (vs: Video[]) => vs.filter((v) => !EXCLUIR_CATEGORIAS.has(v.categoria)).sort((a, b) => b.vistas - a.vistas).slice(0, 12);
  return {
    region: r,
    populares: limpiar((populares.items ?? []).map(aVideo)),
    shorts: limpiar((shorts.items ?? []).map(aVideo).filter((v) => v.segundos > 0 && v.segundos <= 180)),
  };
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const PROMPT = `Eres el Explorador de tendencias del estudio de YouTube de JARVIS (canal faceless de Shorts de 60 a 75 s,
producidos con clips de stock, voz sintética y subtítulos, desde Colombia).
Recibes datos REALES de hoy: los videos más populares y los Shorts más vistos de la última semana en varios países.

Tu trabajo:
1. Detectar 2 o 3 patrones de lo que funciona (temas, formatos de título, emociones: curiosidad, misterio, sorpresa, "datos que no sabías").
2. Elegir el nicho con mejor combinación de demanda visible en los datos + pago por vista + viabilidad con stock.
3. Proponer exactamente 5 ideas ORIGINALES inspiradas en esos patrones. Nunca copies títulos ni ideas concretas de otros canales;
   toma el patrón y aplícalo a un tema propio.

Reglas:
- Descarta: personas reales o celebridades, marcas, música, deportes, política, noticias de última hora, salud/finanzas/legal
  con presentador IA, contenido infantil, violencia gráfica. Nada que dependa de imágenes concretas imposibles de encontrar en stock.
- Las ideas deben dar para 60–75 s de narración con un giro o revelación (no una lista plana de datos).
- rpm_estimado es un rango orientativo en USD por 1.000 vistas, marcado como estimación.
- En por_que cita brevemente qué señal de los datos respalda la elección (ej. "4 de los 12 Shorts más vistos en MX son de misterios").
- No repitas temas de los trabajos recientes que se indiquen.
Campos en español, salvo títulos y ganchos, que van en el idioma elegido. palabras_clave: 3 a 5 términos en inglés para buscar clips de stock.`;

async function admins(): Promise<number[]> {
  const { data } = await adminClient().from("telegram_users").select("chat_id, profiles(role)");
  return (data ?? [])
    .filter((u) => (u as unknown as { profiles: { role: string } | null }).profiles?.role === "admin")
    .map((u) => Number(u.chat_id));
}

/** Ejecuta el Explorador y envía las ideas con botones a los chats indicados (por defecto, todos los admin). */
export async function runExplorador(opts: { chatIds?: number[]; source?: string } = {}): Promise<{ ok: boolean; text: string }> {
  const db = adminClient();
  const { data: agent } = await db.from("agents").select("id,enabled,model").eq("slug", "explorador").maybeSingle();
  if (!agent?.enabled) return { ok: false, text: "El Explorador de tendencias está desactivado." };
  const chats = opts.chatIds?.length ? opts.chatIds : await admins();

  if (!process.env.YOUTUBE_API_KEY) {
    const msg = "Falta YOUTUBE_API_KEY en Vercel: el Explorador necesita una llave de la API de YouTube Data (gratis) para leer tendencias.";
    for (const c of chats) await sendMessage(c, `⚠️ ${msg}`);
    return { ok: false, text: msg };
  }

  const now = () => new Date().toISOString();
  const { data: run } = await db
    .from("agent_runs")
    .insert({
      agent_id: agent.id, input: "Tendencias de hoy en CO, MX, ES y US", source: opts.source ?? "cron",
      status: "running", started_at: now(), current_step: "Leyendo YouTube: populares y Shorts de la semana",
      source_chat: chats[0] ?? null,
    })
    .select("id")
    .single();
  await db.from("agents").update({ status: "working", current_run_id: run?.id }).eq("id", agent.id);

  try {
    const regiones = await Promise.all(REGIONES.map(datosRegion));
    const datos = regiones
      .map(({ region, populares, shorts }) =>
        [
          `## ${region.nombre} (${region.code})`,
          "Shorts más vistos de la semana:",
          ...shorts.map((v) => `- ${v.titulo} · ${fmt(v.vistas)} vistas · ${v.segundos}s${v.tags.length ? ` · tags: ${v.tags.join(", ")}` : ""}`),
          "Más populares hoy:",
          ...populares.map((v) => `- ${v.titulo} · ${fmt(v.vistas)} vistas · cat ${v.categoria}`),
        ].join("\n"),
      )
      .join("\n\n");

    if (run?.id) await db.from("agent_runs").update({ current_step: "Analizando patrones y proponiendo ideas" }).eq("id", run.id);
    const [{ data: pref }, { data: recientes }] = await Promise.all([
      db.from("settings").select("value").eq("key", "studio_idioma").maybeSingle(),
      db.from("videos").select("titulo").order("created_at", { ascending: false }).limit(15),
    ]);
    const idioma = String(pref?.value ?? "es");

    const { text, cost } = await callClaude({
      model: agent.model,
      system: `${PROMPT}\n\nIdioma por defecto del canal: ${idioma}. Úsalo salvo que los datos muestren una oportunidad clara en otro idioma (explícalo en por_que).`,
      maxTokens: 2000,
      schema: INVESTIGADOR_SCHEMA,
      agentRunId: run?.id,
      user: `Fecha: ${now().slice(0, 10)}\n\nTemas ya producidos (no repetir):\n${(recientes ?? []).map((v) => `- ${v.titulo}`).join("\n") || "(ninguno)"}\n\nDatos de YouTube:\n${datos.slice(0, 14000)}`,
    });

    const r = JSON.parse(text) as Investigacion;
    r.ideas = (r.ideas ?? []).slice(0, 5);
    r.selected = [];
    const summary = `Tendencias: ${r.ideas.length} ideas de ${r.nicho}`.slice(0, 140);
    if (run?.id) {
      await db.from("agent_runs").update({
        status: "done", output: renderInvestigacion(r), summary, result: r, cost_usd: cost, finished_at: now(), current_step: null,
      }).eq("id", run.id);
      for (const c of chats) await sendIdeas(c, run.id, { ...r, nicho: `📈 Tendencias de hoy · ${r.nicho}` });
    }
    await db.from("agents").update({ status: "idle", current_run_id: null, last_summary: summary, last_run_at: now() }).eq("id", agent.id);
    await log("agent", `Explorador: ${summary}`, "info", { cost });
    return { ok: true, text: summary };
  } catch (e) {
    const msg = e instanceof BudgetExceeded ? "Freno de gasto activo: no se pudo analizar tendencias este mes."
      : e instanceof RateLimited ? "La API de Claude está en su límite; reintenta /tendencias en unos minutos."
      : e instanceof Error ? e.message : String(e);
    if (run?.id) await db.from("agent_runs").update({ status: "error", error: msg, finished_at: now(), current_step: null }).eq("id", run.id);
    await db.from("agents").update({ status: "error", current_run_id: null }).eq("id", agent.id);
    await log("agent", `Explorador falló: ${msg}`, "error");
    for (const c of chats) await sendMessage(c, `⚠️ Explorador de tendencias: ${msg.replace(/</g, "&lt;")}`);
    return { ok: false, text: msg };
  }
}
