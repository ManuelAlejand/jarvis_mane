/**
 * Sonidos de la Oficina sintetizados con WebAudio (sin archivos ni licencias). Apagados por defecto.
 * La voz de JARVIS usa la síntesis de voz del navegador (speechSynthesis), en español.
 */

export type Sonido = "clic" | "entrega" | "ok" | "error" | "escucha" | "respuesta" | "arranque" | "vuelo";

let ctx: AudioContext | null = null;
let activo = leer("jarvis.sonido") === "1";
let vozActiva = leer("jarvis.voz") === "1";

function leer(clave: string) {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardar(clave: string, v: string) {
  try {
    window.localStorage.setItem(clave, v);
  } catch {
    /* almacenamiento bloqueado: solo dura esta visita */
  }
}

export const sonidoActivo = () => activo;
export const vozJarvisActiva = () => vozActiva;

export function activarSonido(si: boolean) {
  activo = si;
  guardar("jarvis.sonido", si ? "1" : "0");
  if (si) sonar("arranque");
}

export function activarVoz(si: boolean) {
  vozActiva = si;
  guardar("jarvis.voz", si ? "1" : "0");
  if (!si) callar();
}

/** Notas: [frecuencia Hz, inicio s, duración s, tipo de onda, volumen] */
const PARTITURAS: Record<Sonido, [number, number, number, OscillatorType, number][]> = {
  clic: [[1320, 0, 0.05, "sine", 0.05]],
  entrega: [[660, 0, 0.08, "triangle", 0.05], [990, 0.07, 0.1, "triangle", 0.05]],
  ok: [[784, 0, 0.12, "sine", 0.06], [1046, 0.1, 0.12, "sine", 0.06], [1568, 0.2, 0.22, "sine", 0.05]],
  error: [[220, 0, 0.18, "sawtooth", 0.035], [165, 0.16, 0.25, "sawtooth", 0.035]],
  escucha: [[880, 0, 0.08, "sine", 0.05], [1320, 0.08, 0.1, "sine", 0.05]],
  respuesta: [[1046, 0, 0.07, "sine", 0.045], [784, 0.06, 0.09, "sine", 0.045]],
  arranque: [[392, 0, 0.18, "sine", 0.04], [587, 0.12, 0.18, "sine", 0.04], [784, 0.24, 0.3, "sine", 0.04]],
  vuelo: [[300, 0, 0.35, "sine", 0.025]],
};

export function sonar(s: Sonido) {
  if (!activo || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const [f, ini, dur, onda, vol] of PARTITURAS[s]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = onda;
      o.frequency.setValueAtTime(f, t0 + ini);
      if (s === "vuelo") o.frequency.exponentialRampToValueAtTime(900, t0 + ini + dur);
      g.gain.setValueAtTime(0, t0 + ini);
      g.gain.linearRampToValueAtTime(vol, t0 + ini + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + ini);
      o.stop(t0 + ini + dur + 0.02);
    }
  } catch {
    /* sin audio: no pasa nada */
  }
}

/** Quita etiquetas HTML y emojis decorativos para leer en voz alta. */
export function textoParaVoz(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function hayVozSintetica() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** JARVIS habla. `alTerminar` se llama al acabar (o enseguida si no hay voz). */
export function hablar(texto: string, alTerminar?: () => void, forzar = false) {
  const limpio = textoParaVoz(texto);
  if (!limpio || (!vozActiva && !forzar) || !hayVozSintetica()) {
    alTerminar?.();
    return false;
  }
  try {
    const sintesis = window.speechSynthesis;
    sintesis.cancel();
    const u = new SpeechSynthesisUtterance(limpio);
    const voces = sintesis.getVoices();
    const es = voces.filter((v) => v.lang?.toLowerCase().startsWith("es"));
    u.voice = es.find((v) => /co|419|mx|us/i.test(v.lang)) ?? es[0] ?? null;
    u.lang = u.voice?.lang ?? "es-CO";
    u.rate = 1.04;
    u.pitch = 0.85; // un poco más grave: tono de mayordomo
    u.onend = () => alTerminar?.();
    u.onerror = () => alTerminar?.();
    sintesis.speak(u);
    return true;
  } catch {
    alTerminar?.();
    return false;
  }
}

export function callar() {
  try {
    if (hayVozSintetica()) window.speechSynthesis.cancel();
  } catch {
    /* nada */
  }
}
