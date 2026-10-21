/**
 * Ambiente de la ciudad de la Oficina: hora del día real (Colombia) y clima real (Open-Meteo, gratis y sin clave).
 * Funciones puras para poder probarlas; el gancho que consulta el clima vive en `useAmbiente`.
 */

export type Clima = "despejado" | "nublado" | "niebla" | "lluvia" | "tormenta";

export interface Ambiente {
  /** Hora decimal 0-24 (zona horaria de la oficina) */
  hora: number;
  /** 0 = noche cerrada, 1 = pleno día */
  luz: number;
  fase: "noche" | "amanecer" | "dia" | "atardecer";
  clima: Clima;
  temperatura: number | null;
  /** Colores del cielo [arriba, medio, horizonte, brillo] */
  cielo: [string, string, string, string];
}

export const ZONA_OFICINA = "America/Bogota";
/** Coordenadas para el clima (se pueden cambiar con NEXT_PUBLIC_CLIMA_LAT / NEXT_PUBLIC_CLIMA_LON) */
export const CLIMA_LAT = Number(process.env.NEXT_PUBLIC_CLIMA_LAT ?? 4.711);
export const CLIMA_LON = Number(process.env.NEXT_PUBLIC_CLIMA_LON ?? -74.072);

/** Hora decimal en una zona horaria (sin librerías). */
export function horaEn(fecha: Date, zona = ZONA_OFICINA): number {
  try {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(fecha);
    const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const m = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
    return h + m / 60;
  } catch {
    return fecha.getHours() + fecha.getMinutes() / 60;
  }
}

/** Luz del día 0-1 con transiciones suaves (amanecer 5-7 h, atardecer 17:30-19 h; cerca del ecuador casi no cambia en el año). */
export function luzDelDia(hora: number): number {
  const suave = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return suave(5, 7, hora) * (1 - suave(17.5, 19, hora));
}

export function faseDe(hora: number): Ambiente["fase"] {
  if (hora >= 5 && hora < 7) return "amanecer";
  if (hora >= 7 && hora < 17.5) return "dia";
  if (hora >= 17.5 && hora < 19) return "atardecer";
  return "noche";
}

/** Códigos WMO de Open-Meteo → clima simplificado. */
export function climaDeCodigo(codigo: number | null | undefined): Clima {
  if (codigo == null || Number.isNaN(codigo)) return "despejado";
  if (codigo >= 95) return "tormenta";
  if ((codigo >= 51 && codigo <= 67) || (codigo >= 80 && codigo <= 82)) return "lluvia";
  if (codigo === 45 || codigo === 48) return "niebla";
  if (codigo >= 2 && codigo <= 3) return "nublado";
  if (codigo >= 71 && codigo <= 86) return "lluvia"; // nieve: en la ciudad se ve como lluvia fría
  return "despejado";
}

const mezclar = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

/** Paletas: la noche es la de siempre (neón); el día es un azul petróleo que no apaga los brillos. */
const NOCHE: Ambiente["cielo"] = ["#01040a", "#061a2e", "#0b3550", "#1d6f95"];
const DIA: Ambiente["cielo"] = ["#0d3a63", "#2f6f99", "#7fb4cf", "#e6f4ff"];
const ATARDECER: Ambiente["cielo"] = ["#0a1636", "#3b2f5c", "#c9653a", "#ffb35c"];

export function cieloPara(hora: number, clima: Clima): Ambiente["cielo"] {
  const luz = luzDelDia(hora);
  const fase = faseDe(hora);
  // Cerca del amanecer y atardecer se tiñe de naranja
  const calido = fase === "amanecer" || fase === "atardecer" ? 1 - Math.abs(luz - 0.5) * 2 : 0;
  let c = NOCHE.map((n, i) => mezclar(n, DIA[i], luz)) as Ambiente["cielo"];
  c = c.map((x, i) => mezclar(x, ATARDECER[i], calido * 0.85)) as Ambiente["cielo"];
  // Nubes, lluvia o niebla: cielo más gris y apagado
  const gris = clima === "tormenta" ? 0.6 : clima === "lluvia" ? 0.45 : clima === "niebla" ? 0.5 : clima === "nublado" ? 0.25 : 0;
  if (gris) c = c.map((x) => mezclar(x, luz > 0.4 ? "#55626e" : "#0b1118", gris)) as Ambiente["cielo"];
  return c;
}

export function ambientePara(fecha: Date, clima: Clima, temperatura: number | null, hora?: number): Ambiente {
  const h = hora ?? horaEn(fecha);
  return { hora: h, luz: luzDelDia(h), fase: faseDe(h), clima, temperatura, cielo: cieloPara(h, clima) };
}

export const NOMBRE_CLIMA: Record<Clima, string> = {
  despejado: "despejado",
  nublado: "nublado",
  niebla: "niebla",
  lluvia: "lluvia",
  tormenta: "tormenta",
};
