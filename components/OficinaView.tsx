"use client";
/**
 * Oficina 3D de JARVIS: los agentes son robots con armadura que trabajan en salas por proyecto.
 * Datos: los mismos de useJarvis (Supabase Realtime). No gasta tokens: solo dibuja lo que ya pasa.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JarvisState } from "@/components/useJarvis";
import type { AgentRow, AgentRun, Project } from "@/lib/types";
import { generarPlano, type Puesto, type Sala, type SalaSpec } from "@/lib/oficina/plano";
import { Mundo } from "@/lib/oficina/mundo";
import { Escena, type InfoRobot, type InfoSala } from "@/components/oficina3d/Escena";
import { projectProgress } from "@/components/useJarvis";
import { ConsolaJarvis, type ConsolaApi, type Enviar } from "@/components/oficina3d/ConsolaJarvis";
import { Minimapa } from "@/components/oficina3d/Minimapa";
import { useAmbiente } from "@/lib/oficina/useAmbiente";
import { iconoAmbiente, NOMBRE_CLIMA } from "@/lib/oficina/ambiente";
import { activarSonido, activarVoz, hablar, hayVozSintetica, sonar, sonidoActivo, vozJarvisActiva } from "@/lib/oficina/sonido";
import type { ModoVoz } from "@/lib/oficina/mundo";
import { estadisticasDe } from "@/lib/oficina/estadisticas";

const ESTUDIO = new Set(["explorador", "investigador", "guionista", "productor", "validador", "publicador"]);
const NOTA_MS = 25000; // tiempo que se ve "listo" o "error" sobre la cabeza

type Nota = { tipo: "ok" | "error" | "frase"; texto: string; hasta: number };

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Salas: el Núcleo (JARVIS) + cada proyecto activo o con agentes asignados. */
function salasDe(projects: Project[], agents: AgentRow[]): SalaSpec[] {
  const conAgentes = new Set(agents.map((a) => a.project_id).filter(Boolean));
  const out: SalaSpec[] = [{ slug: "nucleo", nombre: "Núcleo JARVIS", tipo: "nucleo", tono: 195 }];
  const lista = projects
    .filter((p) => p.slug !== "jarvis-core" && (p.status === "activo" || conAgentes.has(p.id) || p.slug === "youtube-shorts"))
    .sort((a, b) => (a.status === "activo" ? 0 : 1) - (b.status === "activo" ? 0 : 1));
  for (const p of lista) out.push({ slug: p.slug, nombre: p.name, tipo: "proyecto", tono: hash(p.slug) % 360 });
  return out;
}

/** Sala de cada agente: la de su proyecto; los agentes del estudio van a YouTube; si no, el Núcleo. */
function salaDeAgente(a: AgentRow, projects: Project[], salas: Sala[]): Sala {
  if (a.slug === "jarvis") return salas[0]; // JARVIS siempre en el Núcleo, aunque tenga proyecto asignado
  const porSlug = (slug: string) => salas.find((s) => s.slug === slug);
  const proyecto = a.project_id ? projects.find((p) => p.id === a.project_id) : undefined;
  return (proyecto && porSlug(proyecto.slug)) || (ESTUDIO.has(a.slug) && porSlug("youtube-shorts")) || salas[0];
}

function ago(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace segundos";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

const enCurso = (r?: AgentRun) => r?.status === "running" || r?.status === "queued";

/** ¿El navegador puede dibujar 3D? (WebGL desactivado, GPU bloqueada o navegador muy viejo → no) */
function hayWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Si la escena 3D falla (modelo que no carga, contexto WebGL perdido…), se muestra la vista de respaldo. */
class Respaldo3D extends Component<{ alterno: ReactNode; children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };
  static getDerivedStateFromError() {
    return { fallo: true };
  }
  render() {
    return this.state.fallo ? this.props.alterno : this.props.children;
  }
}

/** Colores de los puntos del minimapa (iguales a las armaduras) */
const COLOR_PUNTO = ["#e8b04b", "#d8433b", "#e0a526", "#b8c0c9", "#7d858e", "#b03030", "#5f8fbf"];
const ANUNCIO_MS = 20000; // como mucho un anuncio hablado cada 20 s

export function OficinaView({ s, enviar }: { s: JarvisState; enviar: Enviar }) {
  const [seleccion, setSeleccionBase] = useState<string | null>(null);
  const setSeleccion = useCallback((slug: string | null) => {
    if (slug) sonar("clic");
    setSeleccionBase(slug);
  }, []);
  const [vuelo, setVuelo] = useState<{ sala: string | null; clave: number }>({ sala: null, clave: 0 });
  const [salaActual, setSalaActual] = useState<string | null>(null);
  const [tour, setTour] = useState(false);
  const [fotoClave, setFotoClave] = useState(0);
  const [flash, setFlash] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [registroAbierto, setRegistroAbierto] = useState(true);
  const [sonidoOn, setSonidoOn] = useState(false);
  const [vozOn, setVozOn] = useState(false);
  const [compacta, setCompacta] = useState(false);
  const consola = useRef<ConsolaApi>(null);
  const ultimoUso = useRef(Date.now());
  const ultimoAnuncio = useRef(0);
  const ambiente = useAmbiente();
  useEffect(() => {
    setSonidoOn(sonidoActivo());
    setVozOn(vozJarvisActiva());
    const chica = window.innerWidth < 900 || window.matchMedia("(pointer: coarse)").matches;
    setCompacta(chica);
    if (chica) setRegistroAbierto(false);
    if (new URLSearchParams(window.location.search).get("tour") === "1") setTour(true);
  }, []);
  const [ajustar, setAjustar] = useState(0);
  const [arrancando, setArrancando] = useState(true);
  const [webgl] = useState(() => (typeof window === "undefined" ? true : hayWebGL()));
  useEffect(() => {
    const t = window.setTimeout(() => setArrancando(false), 2600);
    return () => window.clearTimeout(t);
  }, []);
  const [, setReloj] = useState(0);
  const notas = useRef(new Map<string, Nota>());
  const runsVistos = useRef<Map<string, AgentRun["status"]> | null>(null);

  const specs = useMemo(() => salasDe(s.projects, s.agents), [s.projects, s.agents]);
  const detenerTour = useCallback(() => {
    ultimoUso.current = Date.now();
    setTour(false);
    setSalaActual(null);
  }, []);
  const firma = specs.map((x) => `${x.slug}:${x.nombre}`).join("|");
  // El plano solo se regenera si cambian las salas (no en cada actualización de datos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plano = useMemo(() => generarPlano(specs), [firma]);
  const mundo = useMemo(() => new Mundo(plano), [plano]);

  // Los líderes van primero: se sientan en el primer escritorio de su sala
  const activos = useMemo(
    () => s.agents.filter((a) => a.enabled).sort((a, b) => Number(!!b.is_leader) - Number(!!a.is_leader) || a.position - b.position),
    [s.agents],
  );
  const porId = useMemo(() => new Map(s.agents.map((a) => [a.id, a])), [s.agents]);
  const ultimoRun = useMemo(() => {
    const m = new Map<string, AgentRun>();
    for (const r of s.runs) if (!m.has(r.agent_id)) m.set(r.agent_id, r); // vienen del más nuevo al más viejo
    return m;
  }, [s.runs]);

  // Puesto de cada agente: el primero de cada sala es el líder (primer escritorio)
  const asignacion = useMemo(() => {
    const usados = new Map<string, number>();
    const out = new Map<string, { sala: Sala; puesto: Puesto; lider: boolean }>();
    for (const a of activos) {
      const sala = salaDeAgente(a, s.projects, plano.salas);
      const n = usados.get(sala.slug) ?? 0;
      if (n >= sala.puestos.length) continue; // sala llena
      usados.set(sala.slug, n + 1);
      out.set(a.slug, { sala, puesto: sala.puestos[n], lider: !!a.is_leader || (n === 0 && sala.tipo === "proyecto" && !activos.some((x) => x.is_leader && salaDeAgente(x, s.projects, plano.salas).slug === sala.slug)) });
    }
    return out;
  }, [activos, s.projects, plano]);

  /** Líder de cada sala (slug del agente) */
  const liderSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const [slug, as] of asignacion) if (as.lider) m.set(as.sala.slug, slug);
    return m;
  }, [asignacion]);

  const trabajando = useCallback((a: AgentRow) => a.status === "working" || enCurso(ultimoRun.get(a.id)), [ultimoRun]);

  // Robots ← agentes (altas, bajas y si están trabajando)
  useEffect(() => {
    for (const slug of [...mundo.robots.keys()]) if (!asignacion.has(slug)) mundo.quitar(slug);
    for (const a of activos) {
      const as = asignacion.get(a.slug);
      if (!as) continue;
      mundo.colocar(a.slug, as.sala, as.puesto, trabajando(a));
      mundo.setTrabajando(a.slug, trabajando(a));
    }
  }, [mundo, activos, asignacion, trabajando]);

  // Entregas y gestos: solo para ejecuciones nuevas o que cambiaron (no en la primera carga).
  // Cadena: tu pedido → JARVIS → líder de la sala → trabajador. Al terminar, el trabajador reporta a su líder
  // (que firma el aviso de Telegram) o le entrega el trabajo al siguiente agente del flujo.
  useEffect(() => {
    const vistos = runsVistos.current;
    const ahora = Date.now();
    const nota = (slug: string, tipo: Nota["tipo"], texto: string, ms = NOTA_MS) => notas.current.set(slug, { tipo, texto, hasta: Date.now() + ms });
    const nombre = (slug: string) => s.agents.find((a) => a.slug === slug)?.name ?? slug;
    if (vistos) {
      const entregaron = new Set<string>();
      const terminados: { slug: string; r: AgentRun }[] = [];
      for (const r of [...s.runs].reverse()) {
        const antes = vistos.get(r.id);
        const agente = porId.get(r.agent_id);
        if (!agente) continue;
        if (antes === undefined && enCurso(r)) {
          const previa = r.parent_run_id
            ? s.runs.find((x) => x.id === r.parent_run_id)
            : r.video_id
              ? s.runs.find((x) => x.video_id === r.video_id && x.id !== r.id && x.created_at <= r.created_at)
              : undefined;
          const deAgente = previa ? porId.get(previa.agent_id)?.slug : undefined;
          const sala = asignacion.get(agente.slug)?.sala.slug;
          const lider = sala ? liderSala.get(sala) : undefined;
          if (deAgente && deAgente !== agente.slug) {
            // Relevo dentro del equipo
            entregaron.add(deAgente);
            mundo.entregar(deAgente, agente.slug);
            nota(deAgente, "ok", `Entregando a ${agente.name}…`, 9000);
            sonar("entrega");
          } else if (agente.slug !== "jarvis") {
            // Pedido nuevo: JARVIS se lo lleva al líder y el líder al trabajador
            if (lider && lider !== agente.slug) {
              nota("jarvis", "ok", `Encargo para ${nombre(lider)}…`, 12000);
              mundo.entregar("jarvis", lider, () => {
                nota(lider, "ok", `${agente.name}, esto es para ti`, 9000);
                mundo.entregar(lider, agente.slug);
              });
            } else {
              nota("jarvis", "ok", `Entregando a ${agente.name}…`, 9000);
              mundo.entregar("jarvis", agente.slug);
            }
          }
        }
        if (antes !== undefined && antes !== r.status) {
          if (r.status === "done") {
            mundo.gesto(agente.slug, "ThumbsUp", 2600);
            mundo.efecto("ok", agente.slug);
            nota(agente.slug, "ok", r.summary ?? "Trabajo terminado");
            terminados.push({ slug: agente.slug, r });
            sonar("ok");
          } else if (r.status === "error") {
            mundo.gesto(agente.slug, "No", 2600);
            mundo.efecto("error", agente.slug);
            nota(agente.slug, "error", r.error ?? "Se detuvo");
            terminados.push({ slug: agente.slug, r });
            sonar("error");
          }
          // JARVIS lo anuncia en voz alta (si activaste la voz)
          if ((r.status === "done" || r.status === "error") && Date.now() - ultimoAnuncio.current > ANUNCIO_MS && mundo.voz === "normal") {
            ultimoAnuncio.current = Date.now();
            hablar(r.status === "done" ? `Señor, ${agente.name} terminó. ${r.summary ?? ""}` : `Atención: ${agente.name} tuvo un problema. ${r.error ?? ""}`);
          }
        }
      }
      // Quien terminó y no le pasó el trabajo a nadie, va a reportarle a su líder
      for (const { slug, r } of terminados) {
        if (entregaron.has(slug)) continue;
        const sala = asignacion.get(slug)?.sala.slug;
        const lider = sala ? liderSala.get(sala) : undefined;
        if (!lider || lider === slug) continue;
        window.setTimeout(() => {
          nota(slug, r.status === "error" ? "error" : "ok", `Reportando a ${nombre(lider)}…`, 9000);
          mundo.entregar(slug, lider, () => nota(lider, "ok", "📨 Avisando a Manuel por Telegram", 8000));
        }, 2800);
      }
    }
    runsVistos.current = new Map(s.runs.map((r) => [r.id, r.status]));
    void ahora;
  }, [s.runs, s.agents, porId, mundo, asignacion, liderSala]);

  // Registro de misión: lo último que pasó (ejecuciones y alertas), del más nuevo al más viejo
  const registro = useMemo(() => {
    type Ev = { id: string; t: number; icono: string; texto: string; slug?: string; tipo: "info" | "ok" | "error" };
    const out: Ev[] = [];
    for (const r of s.runs.slice(0, 30)) {
      const a = porId.get(r.agent_id);
      if (!a) continue;
      const nombre = a.slug === "jarvis" ? "JARVIS" : a.name;
      const ini = new Date(r.started_at ?? r.created_at).getTime();
      out.push({ id: `${r.id}:i`, t: ini, icono: a.emoji ?? "▶", texto: `${nombre} empezó · ${(r.input ?? "").slice(0, 60)}`, slug: a.slug, tipo: "info" });
      if (r.status === "done" || r.status === "error") {
        const fin = r.finished_at ? new Date(r.finished_at).getTime() : ini + 1;
        out.push({
          id: `${r.id}:f`, t: Math.max(fin, ini + 1), icono: r.status === "done" ? "✔" : "⚠",
          texto: `${nombre} · ${(r.status === "done" ? r.summary ?? "terminó" : r.error ?? "falló").slice(0, 70)}`, slug: a.slug, tipo: r.status === "done" ? "ok" : "error",
        });
      }
    }
    for (const l of s.logs.slice(0, 20)) {
      if (l.level !== "error" && l.level !== "warn") continue;
      out.push({ id: `log:${l.id}`, t: new Date(l.created_at).getTime(), icono: l.level === "error" ? "⛔" : "⚠", texto: `${l.source} · ${l.message.slice(0, 70)}`, tipo: "error" });
    }
    return out.sort((a, b) => b.t - a.t).slice(0, 8);
  }, [s.runs, s.logs, porId]);

  // Frases de personalidad: de vez en cuando alguien libre comenta algo (refs: el intervalo no se reinicia con cada dato)
  const paraFrases = useRef({ activos, trabajando });
  paraFrases.current = { activos, trabajando };
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden) return;
      const { activos: lista, trabajando: ocupado } = paraFrases.current;
      const libres = lista.filter((a) => (a.frases?.length ?? 0) > 0 && !ocupado(a) && !((notas.current.get(a.slug)?.hasta ?? 0) > Date.now()));
      if (!libres.length) return;
      const a = libres[Math.floor(Math.random() * libres.length)];
      const f = a.frases![Math.floor(Math.random() * a.frases!.length)];
      notas.current.set(a.slug, { tipo: "frase", texto: f, hasta: Date.now() + 6000 });
    }, 8000);
    return () => window.clearInterval(t);
  }, []);

  // Refresca globos y notas cada segundo
  useEffect(() => {
    const t = window.setInterval(() => setReloj((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const irASala = useCallback((slug: string | null) => {
    setSeleccionBase(null);
    setTour(false);
    setSalaActual(slug);
    setVuelo((v) => ({ sala: slug, clave: v.clave + 1 }));
    sonar("vuelo");
  }, []);

  // Recorrido automático tras 2 min sin tocar nada (como un salvapantallas); cualquier gesto lo corta
  useEffect(() => {
    const uso = () => (ultimoUso.current = Date.now());
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, uso, { passive: true }));
    const t = window.setInterval(() => {
      if (!document.hidden && Date.now() - ultimoUso.current > 120_000) setTour(true);
    }, 5000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, uso));
      window.clearInterval(t);
    };
  }, []);

  // Atajos de teclado
  const salasRef = useRef(plano.salas);
  salasRef.current = plano.salas;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        setSeleccionBase(null);
        setAyuda(false);
        setTour(false);
      } else if (k === "0") irASala(null);
      else if (/^[1-9]$/.test(k)) {
        const sala = salasRef.current[Number(k) - 1];
        if (sala) irASala(sala.slug);
      } else if (k === "j") setSeleccion("jarvis");
      else if (k === "t") setTour((x) => !x);
      else if (k === "f") setFotoClave((n) => n + 1);
      else if (k === "m") {
        const v = !sonidoActivo();
        activarSonido(v);
        setSonidoOn(v);
      } else if (k === "v") consola.current?.microfono();
      else if (k === "/") {
        e.preventDefault();
        consola.current?.enfocar();
      } else if (k === "?" || (k === "h" && !e.shiftKey)) setAyuda((x) => !x);
      else return;
      ultimoUso.current = Date.now();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [irASala, setSeleccion]);

  /** Foto: la imagen de la escena + una marca con fecha, y se descarga. */
  const guardarFoto = useCallback((url: string) => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 450);
    sonar("ok");
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(img, 0, 0);
      const fecha = new Date().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
      const tam = Math.max(14, Math.round(img.width / 70));
      g.font = `600 ${tam}px "Chakra Petch", system-ui, sans-serif`;
      g.fillStyle = "rgba(127,227,255,.9)";
      g.textBaseline = "bottom";
      g.fillText(`J.A.R.V.I.S. · OFICINA · ${fecha}`, tam, img.height - tam * 0.8);
      const a = document.createElement("a");
      a.download = `jarvis-oficina-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
      a.href = c.toDataURL("image/png");
      a.click();
    };
    img.src = url;
  }, []);

  const modoVoz = useCallback((m: ModoVoz) => {
    mundo.voz = m;
  }, [mundo]);

  const alResponder = useCallback((texto: string, ok: boolean) => {
    notas.current.set("jarvis", { tipo: ok ? "ok" : "error", texto: texto.length > 90 ? `${texto.slice(0, 87)}…` : texto, hasta: Date.now() + 12000 });
    mundo.gesto("jarvis", ok ? "Yes" : "No", 1800);
  }, [mundo]);

  const pcConectado = s.heartbeat ? Date.now() - new Date(s.heartbeat).getTime() < 3 * 60 * 1000 : false;
  const errores24h = s.runs.filter((r) => r.status === "error" && Date.now() - new Date(r.created_at).getTime() < 86400000).length;
  const nTrabajando = activos.filter(trabajando).length;

  const robots: InfoRobot[] = activos
    .filter((a) => asignacion.has(a.slug))
    .map((a) => {
      const run = ultimoRun.get(a.id);
      const nota = notas.current.get(a.slug);
      const viva = nota && nota.hasta > Date.now() ? nota : undefined;
      const sel = seleccion === a.slug;
      const texto = viva?.texto ?? (trabajando(a) ? run?.current_step || "Trabajando…" : sel ? mundo.actividad(a.slug) ?? a.last_summary ?? "Libre" : null);
      const esLider = !!asignacion.get(a.slug)?.lider;
      return {
        slug: a.slug,
        nombre: a.name,
        emoji: a.emoji ?? null,
        lider: esLider,
        esJarvis: a.slug === "jarvis",
        trabajando: trabajando(a),
        actividad: mundo.actividad(a.slug),
        armadura: esLider ? 0 : 1 + (a.position % 5),
        globo: texto ? { texto: texto.length > 70 && !sel ? `${texto.slice(0, 67)}…` : texto, tipo: viva?.tipo ?? "trabajo" } : null,
        seleccionado: sel,
      };
    });

  const puestosEncendidos = new Set<Puesto>(
    activos.filter(trabajando).map((a) => asignacion.get(a.slug)?.puesto).filter((p): p is Puesto => !!p),
  );

  const paredes: InfoSala[] = plano.salas.map((sala) => {
    const proyecto = s.projects.find((p) => p.slug === sala.slug);
    const tareas = proyecto ? s.tasks.filter((t) => t.project_id === proyecto.id) : [];
    const hechas = tareas.filter((t) => t.status === "hecha").length;
    const curso = tareas.filter((t) => t.status === "en_curso").length;
    const deSala = activos.filter((a) => asignacion.get(a.slug)?.sala.slug === sala.slug);
    const errSala = s.runs.filter(
      (r) => r.status === "error" && deSala.some((a) => a.id === r.agent_id) && Date.now() - new Date(r.created_at).getTime() < 86400000,
    ).length;
    const pct = Math.round((s.spend.spent / Math.max(0.01, s.spend.budget)) * 100);
    return {
      slug: sala.slug,
      contenido: (
        <>
          <b>{sala.nombre}</b>
          {sala.tipo === "nucleo" ? (
            <span>
              API ${s.spend.spent.toFixed(2)}/{s.spend.budget} <i className="barra"><i style={{ width: `${Math.min(100, pct)}%` }} /></i>
              {" · "}PC {pcConectado ? <em className="ok">en línea</em> : <em className="mal">desconectado</em>}
              {errores24h > 0 && <> · <em className="mal">{errores24h} alerta{errores24h > 1 ? "s" : ""}</em></>}
            </span>
          ) : (
            <span>
              {proyecto?.status ?? ""} · {deSala.length} agente{deSala.length === 1 ? "" : "s"} · ◐ {curso} · ● {hechas}/{tareas.length}
              {errSala > 0 && <> · <em className="mal">⚠ {errSala}</em></>}
            </span>
          )}
        </>
      ),
    };
  });

  const alertas = new Set(
    plano.salas
      .filter((sala) =>
        s.runs.some((r) => {
          const a = porId.get(r.agent_id);
          return r.status === "error" && a && asignacion.get(a.slug)?.sala.slug === sala.slug && Date.now() - new Date(r.created_at).getTime() < 86400000;
        }),
      )
      .map((sala) => sala.slug),
  );
  const proyectosHolo = s.projects
    .filter((p) => p.slug !== "jarvis-core")
    .map((p) => ({ slug: p.slug, tono: hash(p.slug) % 360, avance: projectProgress(p.id, s.tasks, p.progress ?? 0), activo: p.status === "activo" }));

  const agenteSel = seleccion ? s.agents.find((a) => a.slug === seleccion) : undefined;
  const salaSel = agenteSel ? asignacion.get(agenteSel.slug)?.sala : undefined;
  const equipoSel = agenteSel && asignacion.get(agenteSel.slug)?.lider && salaSel
    ? activos.filter((a) => a.slug !== agenteSel.slug && asignacion.get(a.slug)?.sala.slug === salaSel.slug)
    : [];

  return (
    <section className="oficina">
      <div className="oficina-barra">
        <h2>Oficina</h2>
        <span className="muted small">
          {nTrabajando} trabajando · {activos.length} agentes · {specs.length} salas
        </span>
        <div className="oficina-acciones">
          <button className={`btn btn-ghost small ${tour ? "activo" : ""}`} onClick={() => setTour((x) => !x)} aria-pressed={tour} title="Recorrido automático (T)">
            {tour ? "■ Detener tour" : "▶ Tour"}
          </button>
          <button
            className={`btn btn-ghost small ${sonidoOn ? "activo" : ""}`}
            onClick={() => { const v = !sonidoOn; activarSonido(v); setSonidoOn(v); }}
            aria-pressed={sonidoOn}
            title="Sonidos (M)"
          >
            {sonidoOn ? "🔊" : "🔇"} Sonido
          </button>
          {hayVozSintetica() && (
            <button
              className={`btn btn-ghost small ${vozOn ? "activo" : ""}`}
              onClick={() => { const v = !vozOn; activarVoz(v); setVozOn(v); if (v) hablar("Voz activada. A sus órdenes, señor.", undefined, true); }}
              aria-pressed={vozOn}
              title="JARVIS responde y anuncia en voz alta"
            >
              🗣 Voz
            </button>
          )}
          <button className="btn btn-ghost small" onClick={() => setFotoClave((n) => n + 1)} title="Guardar foto de la escena (F)">📸 Foto</button>
          <button className="btn btn-ghost small" onClick={() => setAyuda((x) => !x)} aria-expanded={ayuda} title="Atajos (?)">?</button>
        </div>
      </div>
      <div className="oficina-salas" role="toolbar" aria-label="Ir a una sala">
        <button className={`chip ${salaActual === null && !tour ? "actual" : ""}`} onClick={() => irASala(null)}>
          <kbd>0</kbd> Ver todo
        </button>
        {plano.salas.map((sala, i) => {
          const n = activos.filter((a) => asignacion.get(a.slug)?.sala.slug === sala.slug && trabajando(a)).length;
          return (
            <button key={sala.slug} className={`chip ${salaActual === sala.slug ? "actual" : ""}`} onClick={() => irASala(sala.slug)} style={{ ["--tono" as string]: sala.tono }}>
              {i < 9 && <kbd>{i + 1}</kbd>} {sala.nombre}
              {n > 0 && <span className="chip-n" aria-label={`${n} trabajando`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="oficina-escena">
        {arrancando && (
          <div className="arranque" aria-hidden="true">
            <div className="arranque-reactor"><i /><i /><i /></div>
            <p>J.A.R.V.I.S. · inicializando la oficina</p>
          </div>
        )}
        {webgl ? (
          <Respaldo3D alterno={<ListaRespaldo robots={robots} onElegir={setSeleccion} motivo="La escena 3D tuvo un problema en este navegador." />}>
            <Escena
              plano={plano}
              mundo={mundo}
              robots={robots}
              paredes={paredes}
              puestosEncendidos={puestosEncendidos}
              onSeleccionar={setSeleccion}
              enfocar={seleccion}
              ajustarClave={ajustar}
              ambiente={ambiente}
              proyectosHolo={proyectosHolo}
              vuelo={vuelo}
              tour={tour}
              onUsuario={detenerTour}
              alertas={alertas}
              fotoClave={fotoClave}
              onFoto={guardarFoto}
            />
          </Respaldo3D>
        ) : (
          <ListaRespaldo robots={robots} onElegir={setSeleccion} motivo="Este navegador no tiene 3D (WebGL) activado." />
        )}
        {flash && <div className="foto-flash" aria-hidden="true" />}
        <div className="hud-registro" data-abierto={registroAbierto}>
          <button className="hud-titulo" onClick={() => setRegistroAbierto((x) => !x)} aria-expanded={registroAbierto}>
            <i className="hud-punto" aria-hidden="true" /> Registro de misión {registroAbierto ? "▾" : "▸"}
          </button>
          {registroAbierto && (
            <ol>
              {registro.map((ev) => (
                <li key={ev.id} className={ev.tipo}>
                  <span className="hud-hora">{new Date(ev.t).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                  {ev.slug ? (
                    <button className="enlace" onClick={() => setSeleccion(ev.slug!)}>{ev.icono} {ev.texto}</button>
                  ) : (
                    <span>{ev.icono} {ev.texto}</span>
                  )}
                </li>
              ))}
              {registro.length === 0 && <li className="muted">Sin actividad reciente. Pídele algo a JARVIS.</li>}
            </ol>
          )}
        </div>
        <div className="hud-derecha">
          {!compacta && (
            <Minimapa
              plano={plano}
              mundo={mundo}
              salaActual={salaActual}
              onSala={irASala}
              puntos={robots.map((r) => ({ slug: r.slug, color: r.esJarvis ? "#7fe3ff" : COLOR_PUNTO[r.armadura % COLOR_PUNTO.length] }))}
            />
          )}
          <div className="hud-ambiente" title={`Hora y clima reales de la ciudad (${ambiente.fase}). La ciudad cambia de día, de noche y cuando llueve.`}>
            {iconoAmbiente(ambiente)} {`${String(Math.floor(ambiente.hora)).padStart(2, "0")}:${String(Math.floor((ambiente.hora % 1) * 60)).padStart(2, "0")}`}
            {ambiente.temperatura != null && ` · ${Math.round(ambiente.temperatura)}°C`} · {NOMBRE_CLIMA[ambiente.clima]}
          </div>
          {tour && <div className="hud-tour">▶ Recorrido automático · toca para detener</div>}
        </div>
        <ConsolaJarvis ref={consola} enviar={enviar} onModo={modoVoz} onRespuesta={alResponder} compacta={compacta} />
        {ayuda && (
          <div className="oficina-ayuda-modal" role="dialog" aria-label="Atajos de teclado" onClick={() => setAyuda(false)}>
            <div className="panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-title"><h3>Atajos</h3><button className="btn btn-ghost small" onClick={() => setAyuda(false)} aria-label="Cerrar">✕</button></div>
              <dl className="atajos">
                <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Volar a una sala</dd>
                <dt><kbd>0</kbd></dt><dd>Ver todo el edificio</dd>
                <dt><kbd>J</kbd></dt><dd>Ir con JARVIS</dd>
                <dt><kbd>/</kbd></dt><dd>Escribirle a JARVIS</dd>
                <dt><kbd>V</kbd></dt><dd>Hablarle a JARVIS (micrófono)</dd>
                <dt><kbd>T</kbd></dt><dd>Recorrido automático</dd>
                <dt><kbd>F</kbd></dt><dd>Foto de la escena</dd>
                <dt><kbd>M</kbd></dt><dd>Sonido sí / no</dd>
                <dt><kbd>Esc</kbd></dt><dd>Cerrar / soltar la cámara</dd>
              </dl>
              <p className="muted small">Si no tocas nada en 2 minutos empieza el recorrido solo. El micrófono usa el reconocimiento de voz de tu navegador (Chrome o Edge).</p>
            </div>
          </div>
        )}
        {/* Resumen para lectores de pantalla */}
        <ul className="sr-only" aria-live="polite">
          {robots.map((r) => (
            <li key={r.slug}>{r.nombre}{r.lider ? ", líder de sala" : ""}: {r.trabajando ? r.globo?.texto ?? "trabajando" : "libre"}</li>
          ))}
        </ul>
      </div>

      {agenteSel && (
        <PanelAgente
          a={agenteSel}
          sala={salaSel?.nombre}
          lider={!!asignacion.get(agenteSel.slug)?.lider}
          equipo={equipoSel.map((x) => ({ slug: x.slug, nombre: x.name, emoji: x.emoji ?? "", trabajando: trabajando(x), paso: ultimoRun.get(x.id)?.current_step ?? null }))}
          runs={s.runs.filter((r) => r.agent_id === agenteSel.id)}
          actividad={mundo.actividad(agenteSel.slug)}
          onClose={() => setSeleccion(null)}
          onElegir={setSeleccion}
        />
      )}
      <p className="muted small oficina-ayuda">
        Toca un robot para ver qué hace · arrastra para girar · clic derecho o dos dedos para moverte · rueda o pellizco para acercar · <kbd>?</kbd> atajos.
      </p>
    </section>
  );
}

interface Miembro {
  slug: string;
  nombre: string;
  emoji: string;
  trabajando: boolean;
  paso: string | null;
}

function PanelAgente({ a, sala, lider, equipo, runs, actividad, onClose, onElegir }: {
  a: AgentRow; sala?: string; lider: boolean; equipo: Miembro[]; runs: AgentRun[]; actividad: string | null; onClose: () => void; onElegir: (slug: string) => void;
}) {
  const actual = runs.find(enCurso);
  const costo = runs.reduce((t, r) => t + (Number(r.cost_usd) || 0), 0);
  return (
    <aside className="panel oficina-panel" aria-label={`Detalle de ${a.name}`}>
      <div className="panel-title">
        <h3>{a.emoji ? `${a.emoji} ` : ""}{a.name}</h3>
        <button className="btn btn-ghost small" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <p className="muted small">
        {lider && <span className="insignia-lider">Líder de sala</span>} {a.role}
        {sala ? ` · ${sala}` : ""}
        {!a.is_leader && <> · {a.runtime === "local" ? "motor local (tu PC)" : a.runtime === "api" ? "servidor" : "chat Claude"} · {a.model.replace("claude-", "")}</>}
      </p>
      {a.personality && <p className="small personalidad">“{a.personality}”</p>}
      {lider && equipo.length > 0 && (
        <>
          <p className="small" style={{ marginBottom: 4 }}><b>Su equipo</b></p>
          <ul className="oficina-historial">
            {equipo.map((m) => (
              <li key={m.slug}>
                <span className={`estado-punto ${m.trabajando ? "working" : "idle"}`} />
                <button className="enlace small" onClick={() => onElegir(m.slug)}>{m.emoji} {m.nombre}</button>
                <span className="muted small"> · {m.trabajando ? m.paso || "trabajando" : "libre"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.is_leader && (
        <p className="muted small">Coordina a su equipo y firma los avisos de Telegram del proyecto. No gasta tokens.</p>
      )}
      <p>
        <span className={`estado-punto ${actual ? "working" : a.status}`} /> {actual || a.status === "working" ? "Trabajando" : a.status === "error" ? "Con error" : actividad ?? "Libre"}
        {actual?.current_step && <> — <i>{actual.current_step}</i></>}
      </p>
      {a.last_summary && (
        <p className="small">
          <b>Último trabajo:</b> {a.last_summary} <span className="muted">({ago(a.last_run_at)})</span>
        </p>
      )}
      <Estadisticas runs={runs} />
      <p className="muted small">Gasto en las últimas {runs.length} ejecuciones: ${costo.toFixed(3)}</p>
      <ul className="oficina-historial">
        {runs.slice(0, 6).map((r) => (
          <li key={r.id}>
            <span className={`estado-punto ${r.status === "done" ? "idle" : r.status === "error" ? "error" : "working"}`} />
            <span className="small">{(r.summary || r.input || "").slice(0, 90)}</span>
            <span className="muted small"> · {ago(r.created_at)}</span>
          </li>
        ))}
        {runs.length === 0 && <li className="muted small">Sin trabajos todavía.</li>}
      </ul>
    </aside>
  );
}

function Estadisticas({ runs }: { runs: AgentRun[] }) {
  const e = estadisticasDe(runs);
  const max = Math.max(1, ...e.dias.map((d) => d.ok + d.error));
  if (!runs.length) return null;
  const dur = e.durMedia == null ? "—" : e.durMedia < 90 ? `${Math.round(e.durMedia)} s` : `${Math.round(e.durMedia / 60)} min`;
  return (
    <div className="estadisticas">
      <svg viewBox="0 0 70 26" className="barras7" role="img" aria-label="Trabajos de los últimos 7 días">
        {e.dias.map((d, i) => {
          const hOk = (d.ok / max) * 20;
          const hErr = (d.error / max) * 20;
          return (
            <g key={i}>
              <rect x={i * 10 + 1} y={21 - hOk - hErr} width={7} height={Math.max(hOk, d.ok ? 1 : 0)} className="b-ok" />
              {d.error > 0 && <rect x={i * 10 + 1} y={21 - hErr} width={7} height={hErr} className="b-err" />}
              <rect x={i * 10 + 1} y={21} width={7} height={0.6} className="b-base" />
              <text x={i * 10 + 4.5} y={25.6} textAnchor="middle">{d.etiqueta}</text>
            </g>
          );
        })}
      </svg>
      <div className="est-num">
        <span><b>{e.exito == null ? "—" : `${e.exito} %`}</b> éxito</span>
        <span><b>{dur}</b> por trabajo</span>
      </div>
    </div>
  );
}

function ListaRespaldo({ robots, onElegir, motivo }: { robots: InfoRobot[]; onElegir: (slug: string) => void; motivo: string }) {
  return (
    <div className="oficina-respaldo">
      <p className="muted small">{motivo} Te muestro el equipo en lista.</p>
      <ul>
        {robots.map((r) => (
          <li key={r.slug}>
            <span className={`estado-punto ${r.trabajando ? "working" : "idle"}`} />
            <button className="enlace" onClick={() => onElegir(r.slug)}>
              {r.esJarvis ? "J.A.R.V.I.S." : `${r.emoji ?? ""} ${r.nombre}`}
            </button>
            {r.lider && <span className="insignia-lider">Líder</span>}
            <span className="muted small"> {r.globo?.texto ?? (r.trabajando ? "trabajando" : "libre")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
