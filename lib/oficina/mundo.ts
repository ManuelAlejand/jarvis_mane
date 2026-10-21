/**
 * Estado vivo de los robots de la Oficina 3D (fuera de React: se lee en cada fotograma).
 * La vista traduce lo que pasa en Supabase a órdenes: sentarse a trabajar, levantarse,
 * entregar trabajo a otro agente, celebrar o negar.
 */
import { camino, celdaLibre, type Celda, type Plano, type Puesto, type Sala } from "@/lib/oficina/plano";

export type Anim = "Idle" | "Walking" | "Sitting" | "ThumbsUp" | "No" | "Wave" | "Yes";

export interface Robot {
  slug: string;
  sala: Sala;
  puesto: Puesto;
  x: number;
  z: number;
  rot: number;
  ruta: Celda[];
  trabajando: boolean;
  sentado: boolean;
  /** Animación de un solo uso (pulgar arriba, "no", saludo) */
  gesto: { anim: Anim; hasta: number } | null;
  alLlegar: (() => void) | null;
  proximoPaseo: number;
  ocupadoHasta: number; // mientras entrega algo no se sienta
}

const centro = (c: Celda) => ({ x: c.c + 0.5, z: c.r + 0.5 });
const VEL = 2.4; // celdas por segundo

export class Mundo {
  robots = new Map<string, Robot>();
  constructor(public plano: Plano) {}

  colocar(slug: string, sala: Sala, puesto: Puesto, trabajando: boolean) {
    const existente = this.robots.get(slug);
    if (existente && existente.sala.slug === sala.slug && existente.puesto === puesto) return existente;
    const p = centro(puesto.silla);
    const r: Robot = {
      slug, sala, puesto, x: p.x, z: p.z, rot: Math.PI, ruta: [], trabajando, sentado: trabajando,
      gesto: null, alLlegar: null, proximoPaseo: performance.now() + 4000 + Math.random() * 12000, ocupadoHasta: 0,
    };
    if (!trabajando) {
      const e = centro(puesto.entrega);
      r.x = e.x;
      r.z = e.z;
    }
    this.robots.set(slug, r);
    return r;
  }

  quitar(slug: string) {
    this.robots.delete(slug);
  }

  private ir(r: Robot, destino: Celda, alLlegar: (() => void) | null = null) {
    const desde = { c: Math.floor(r.x), r: Math.floor(r.z) };
    r.ruta = camino(this.plano, desde, destino);
    r.sentado = false;
    r.alLlegar = alLlegar;
    if (!r.ruta.length) alLlegar?.();
  }

  setTrabajando(slug: string, si: boolean) {
    const r = this.robots.get(slug);
    if (!r || r.trabajando === si) return;
    r.trabajando = si;
    if (si) this.ir(r, r.puesto.silla, () => (r.sentado = true));
    else {
      r.sentado = false;
      this.ir(r, r.puesto.entrega);
    }
  }

  gesto(slug: string, anim: Anim, ms = 2600) {
    const r = this.robots.get(slug);
    if (r) r.gesto = { anim, hasta: performance.now() + ms };
  }

  /** `de` camina hasta el puesto de `para`, saluda y vuelve a lo suyo. */
  entregar(de: string, para: string) {
    const a = this.robots.get(de);
    const b = this.robots.get(para);
    if (!a || !b || a === b) return;
    a.ocupadoHasta = performance.now() + 30000;
    this.ir(a, b.puesto.entrega, () => {
      a.rot = Math.atan2(centro(b.puesto.silla).x - a.x, centro(b.puesto.silla).z - a.z);
      this.gesto(de, "Wave", 2200);
      this.gesto(para, "Yes", 1800);
      window.setTimeout(() => {
        a.ocupadoHasta = 0;
        if (a.trabajando) this.ir(a, a.puesto.silla, () => (a.sentado = true));
        else this.ir(a, a.puesto.entrega);
      }, 2300);
    });
  }

  /** Avanza un fotograma: movimiento por la ruta y paseos de los que están libres. */
  paso(dt: number) {
    const ahora = performance.now();
    for (const r of this.robots.values()) {
      if (r.ruta.length) {
        const sig = centro(r.ruta[0]);
        const dx = sig.x - r.x;
        const dz = sig.z - r.z;
        const d = Math.hypot(dx, dz);
        const avance = VEL * dt;
        r.rot = Math.atan2(dx, dz);
        if (d <= avance) {
          r.x = sig.x;
          r.z = sig.z;
          r.ruta.shift();
          if (!r.ruta.length) {
            const fn = r.alLlegar;
            r.alLlegar = null;
            fn?.();
          }
        } else {
          r.x += (dx / d) * avance;
          r.z += (dz / d) * avance;
        }
        continue;
      }
      if (r.sentado) {
        const s = centro(r.puesto.silla);
        r.x = s.x;
        r.z = s.z - 0.3; // pegado a la mesa
        r.rot = Math.PI; // mirando a la pantalla (−z)
        continue;
      }
      // Libre: de vez en cuando da una vuelta por su sala y vuelve
      if (!r.trabajando && ahora > r.proximoPaseo && ahora > r.ocupadoHasta && !r.gesto) {
        r.proximoPaseo = ahora + 15000 + Math.random() * 25000;
        const destino = Math.random() < 0.5 ? celdaLibre(this.plano, r.sala) : r.puesto.entrega;
        this.ir(r, destino);
      }
    }
  }

  anim(r: Robot): Anim {
    if (r.gesto && r.gesto.hasta > performance.now()) return r.gesto.anim;
    if (r.gesto) r.gesto = null;
    if (r.ruta.length) return "Walking";
    if (r.sentado) return "Sitting";
    return "Idle";
  }
}
