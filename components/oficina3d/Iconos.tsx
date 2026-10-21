"use client";
/**
 * Iconos de la Oficina (Lucide, licencia ISC): trazo fino que encaja con el HUD.
 * Los emojis de la base de datos (`agents.emoji`) se siguen usando en Telegram; en la interfaz van estos iconos.
 */
import {
  Activity, Armchair, Bot, CircleCheck, CircleDashed, Clapperboard, Cloud, DraftingCompass, Scale, CloudFog, CloudLightning, CloudMoon, CloudRain,
  CloudSun, Coffee, Cpu, Droplet, Film, Footprints, Gamepad2, Joystick, Loader, Mail, Microscope, Moon, Music, OctagonAlert,
  PenTool, Play, Radar, Rocket, Satellite, ShieldCheck, Sofa, Sun, Sunrise, Sunset, Telescope, TriangleAlert, type LucideIcon,
} from "lucide-react";
import type { Ambiente } from "@/lib/oficina/ambiente";
import type { TipoDescanso } from "@/lib/oficina/plano";

const POR_AGENTE: Record<string, LucideIcon> = {
  jarvis: Cpu,
  explorador: Telescope,
  investigador: Microscope,
  guionista: PenTool,
  productor: Clapperboard,
  validador: ShieldCheck,
  publicador: Rocket,
  friday: Film,
  edith: Satellite,
  radar: Radar,
  critico: Scale,
  arquitecto: DraftingCompass,
};

/** Si el agente es nuevo, se elige por palabras de su rol. */
const POR_ROL: [RegExp, LucideIcon][] = [
  [/local|prospect|mercado/i, Radar],
  [/idea|negocio|critic/i, Scale],
  [/arquitect|plano|blueprint/i, DraftingCompass],
  [/tendenc|explor/i, Telescope],
  [/investig|nicho|anális|analis/i, Microscope],
  [/guion|redact|escrib/i, PenTool],
  [/produc|video|edici/i, Clapperboard],
  [/valid|revis|calidad/i, ShieldCheck],
  [/public|lanz/i, Rocket],
  [/correo|gmail|mensaje|whatsapp/i, Mail],
];

export function iconoDeAgente(slug: string, rol?: string | null): LucideIcon {
  return POR_AGENTE[slug] ?? POR_ROL.find(([re]) => rol && re.test(rol))?.[1] ?? Bot;
}

type Props = { tam?: number; className?: string };

export function IconoAgente({ slug, rol, tam = 14, className }: Props & { slug: string; rol?: string | null }) {
  const I = iconoDeAgente(slug, rol);
  return <I size={tam} strokeWidth={1.8} className={`ico ${className ?? ""}`} aria-hidden="true" />;
}

const DESCANSO: Record<TipoDescanso | "yendo", LucideIcon> = {
  sofa: Sofa,
  cafe: Coffee,
  agua: Droplet,
  juego: Gamepad2,
  arcade: Joystick,
  puff: Armchair,
  baile: Music,
  yendo: Footprints,
};

export function IconoDescanso({ tipo, tam = 13, className }: Props & { tipo: TipoDescanso | "yendo" }) {
  const I = DESCANSO[tipo];
  return <I size={tam} strokeWidth={1.9} className={`ico ${className ?? ""}`} aria-hidden="true" />;
}

export function IconoAmbiente({ a, tam = 15 }: Props & { a: Pick<Ambiente, "fase" | "clima"> }) {
  const noche = a.fase === "noche";
  const I =
    a.clima === "tormenta" ? CloudLightning
    : a.clima === "lluvia" ? CloudRain
    : a.clima === "niebla" ? CloudFog
    : a.clima === "nublado" ? (noche ? CloudMoon : CloudSun)
    : noche ? Moon : a.fase === "dia" ? Sun : a.fase === "amanecer" ? Sunrise : Sunset;
  return <I size={tam} strokeWidth={1.8} className="ico" aria-hidden="true" />;
}

/** Icono de un evento o de un globo: empezó, terminó, falló, alerta, mensaje. */
export function IconoEvento({ tipo, tam = 13 }: Props & { tipo: "inicio" | "ok" | "error" | "alerta" | "trabajo" | "mensaje" | "nube" }) {
  const mapa: Record<typeof tipo, LucideIcon> = {
    inicio: Play, ok: CircleCheck, error: OctagonAlert, alerta: TriangleAlert, trabajo: Loader, mensaje: Mail, nube: Cloud,
  };
  const I = mapa[tipo];
  return <I size={tam} strokeWidth={2} className={`ico ${tipo === "trabajo" ? "girando" : ""}`} aria-hidden="true" />;
}

export { Activity, CircleDashed };
