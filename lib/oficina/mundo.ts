/**
 * Estado vivo de los robots de la Oficina 3D (fuera de React: se lee en cada fotograma).
 * La vista traduce lo que pasa en Supabase a órdenes: sentarse a trabajar, levantarse,
 * entregar trabajo a otro agente, celebrar o negar. Cuando un agente está libre, de vez en
 * cuando se va a la zona de descanso (sofá, café, agua, juego, arcade, puff o pista de baile).
 */
import { camino, celdaLibre, type Celda, type Descanso, type Plano, type Puesto, type Sala } from "./plano";

export type Anim = "Idle" | "Walking" | "Sitting" | "ThumbsUp" | "No" | "Wave" | "Yes" | "Dance";

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
  ocupadoHasta: number; // mientras entrega algo no se sienta ni descansa
  /** Lleva un "paquete" holográfico en la mano (entregando trabajo) */
  llevando: boolean;
  /** Lugar de descanso reservado (camino a él o ya allí) */
  descanso: Descanso | null;
  /** Ya llegó al lugar de descanso */
  descansando: boolean;
  hastaDescanso: number;
  proximoGesto: number;
}

const centro = (c: Celda) => ({ x: c.c + 0.5, z: c.r + 0.5 });
const VEL = 2.4; // celdas por segundo

const TEXTO_DESCANSO: Record<Descanso["tipo"], string> = {
  sofa: "Descansando en el sofá",
  cafe: "Tomando café",
  agua: "Tomando agua",
  juego: "Jugando en la mesa holográfica",
  arcade: "En la máquina arcade",
  puff: "Relajándose en el puff",
  baile: "Bailando en la pista",
};

/** Estado de la voz de JARVIS (lo dibuja el aura del holograma) */
export type ModoVoz = "normal" | "escuchando" | "pensando" | "hablando";

/** Efecto visual de un solo uso: chispas al terminar, destello rojo al fallar, pulso al entregar */
export interface Efecto {
  id: number;
  tipo: "ok" | "error" | "entrega";
  x: number;
  z: number;
  t0: number;
}

export class Mundo {
  robots = new Map<string, Robot>();
  voz: ModoVoz = "normal";
  efectos: Efecto[] = [];
  private nEfecto = 0;
  /** Velocidad del reloj de descansos (las pruebas la aceleran) */
  constructor(public plano: Plano, private opciones: { descansoMs?: [number, number]; pausaMs?: [number, number] } = {}) {}

  colocar(slug: string, sala: Sala, puesto: Puesto, trabajando: boolean) {
    const existente = this.robots.get(slug);
    if (existente && existente.sala.slug === sala.slug && existente.puesto === puesto) return existente;
    if (existente) this.liberar(existente);
    const p = centro(trabajando ? puesto.silla : puesto.entrega);
    const r: Robot = {
      slug, sala, puesto, x: p.x, z: p.z, rot: Math.PI, ruta: [], trabajando, sentado: trabajando,
      gesto: null, alLlegar: null, proximoPaseo: performance.now() + this.azar(this.opciones.pausaMs ?? [3000, 12000]),
      ocupadoHasta: 0, llevando: false, descanso: null, descansando: false, hastaDescanso: 0, proximoGesto: 0,
    };
    this.robots.set(slug, r);
    return r;
  }

  quitar(slug: string) {
    const r = this.robots.get(slug);
    if (r) this.liberar(r);
    this.robots.delete(slug);
  }

  private azar([a, b]: [number, number]) {
    return a + Math.random() * (b - a);
  }

  private liberar(r: Robot) {
    r.descanso = null;
    r.descansando = false;
  }

  private ir(r: Robot, destino: Celda, alLlegar: (() => void) | null = null) {
    const desde = { c: Math.floor(r.x), r: Math.floor(r.z) };
    r.ruta = camino(this.plano, desde, destino);
    r.sentado = false;
    r.descansando = false;
    r.alLlegar = alLlegar;
    if (!r.ruta.length) alLlegar?.();
  }

  setTrabajando(slug: string, si: boolean) {
    const r = this.robots.get(slug);
    if (!r || r.trabajando === si) return;
    r.trabajando = si;
    this.liberar(r);
    if (si) this.ir(r, r.puesto.silla, () => (r.sentado = true));
    else {
      r.sentado = false;
      r.proximoPaseo = performance.now() + this.azar(this.opciones.pausaMs ?? [3000, 12000]);
      this.ir(r, r.puesto.entrega);
    }
  }

  /** Lanza un efecto sobre un agente (las chispas duran ~2 s; se guardan como mucho 24). */
  efecto(tipo: Efecto["tipo"], slug: string) {
    const r = this.robots.get(slug);
    if (!r) return;
    this.efectos.push({ id: ++this.nEfecto, tipo, x: r.x, z: r.z, t0: performance.now() });
    if (this.efectos.length > 24) this.efectos.shift();
  }

  gesto(slug: string, anim: Anim, ms = 2600) {
    const r = this.robots.get(slug);
    if (r) r.gesto = { anim, hasta: performance.now() + ms };
  }

  /** `de` camina hasta el puesto de `para`, saluda y vuelve a lo suyo. `luego` se llama tras el saludo. */
  entregar(de: string, para: string, luego?: () => void) {
    const a = this.robots.get(de);
    const b = this.robots.get(para);
    if (!a || !b || a === b) {
      luego?.();
      return;
    }
    this.liberar(a);
    a.ocupadoHasta = performance.now() + 30000;
    a.llevando = true;
    this.ir(a, b.puesto.entrega, () => {
      a.llevando = false;
      this.efecto("entrega", para);
      a.rot = Math.atan2(centro(b.puesto.silla).x - a.x, centro(b.puesto.silla).z - a.z);
      this.gesto(de, "Wave", 2200);
      this.gesto(para, "Yes", 1800);
      setTimeout(() => {
        a.ocupadoHasta = 0;
        luego?.();
        if (a.trabajando) this.ir(a, a.puesto.silla, () => (a.sentado = true));
        else this.ir(a, a.puesto.entrega);
      }, 2300);
    });
  }

  /** Lugar de descanso libre (que nadie tenga reservado) en la sala del robot. */
  private lugarLibre(r: Robot): Descanso | null {
    const ocupados = new Set([...this.robots.values()].map((x) => x.descanso).filter(Boolean));
    const libres = r.sala.descansos.filter((d) => !ocupados.has(d));
    return libres.length ? libres[Math.floor(Math.random() * libres.length)] : null;
  }

  /** Avanza un fotograma: movimiento por la ruta, descansos y paseos de los que están libres. */
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
      if (r.descansando && r.descanso) {
        const c = centro(r.descanso.celda);
        const enSofa = r.descanso.tipo === "sofa" || r.descanso.tipo === "puff";
        r.x = c.x;
        r.z = c.z + (enSofa ? Math.cos(r.descanso.rot) * -0.15 : 0);
        r.rot = r.descanso.rot;
        // En la mesa de juego celebran de vez en cuando
        if (r.descanso.tipo === "juego" && ahora > r.proximoGesto && !r.gesto) {
          r.proximoGesto = ahora + 5000 + Math.random() * 6000;
          this.gesto(r.slug, Math.random() < 0.5 ? "Yes" : "ThumbsUp", 1600);
        }
        if (ahora > r.hastaDescanso) {
          // Termina el descanso: vuelve a su puesto
          this.liberar(r);
          r.proximoPaseo = ahora + this.azar(this.opciones.pausaMs ?? [6000, 18000]);
          this.ir(r, r.puesto.entrega);
        }
        continue;
      }
      // Libre: la mayoría de las veces va a descansar; a veces solo da una vuelta
      if (!r.trabajando && ahora > r.proximoPaseo && ahora > r.ocupadoHasta && !r.gesto) {
        r.proximoPaseo = ahora + this.azar(this.opciones.pausaMs ?? [12000, 25000]);
        const lugar = Math.random() < 0.8 ? this.lugarLibre(r) : null;
        if (lugar) {
          r.descanso = lugar;
          this.ir(r, lugar.celda, () => {
            if (r.descanso !== lugar || r.trabajando) return;
            r.descansando = true;
            r.hastaDescanso = performance.now() + this.azar(this.opciones.descansoMs ?? [25000, 55000]);
          });
          r.descanso = lugar; // ir() limpia "descansando", no la reserva
        } else {
          this.ir(r, celdaLibre(this.plano, r.sala));
        }
      }
    }
  }

  anim(r: Robot): Anim {
    if (r.gesto && r.gesto.hasta > performance.now()) return r.gesto.anim;
    if (r.gesto) r.gesto = null;
    if (r.ruta.length) return "Walking";
    if (r.sentado) return "Sitting";
    if (r.descansando && r.descanso) {
      if (r.descanso.tipo === "sofa" || r.descanso.tipo === "puff") return "Sitting";
      if (r.descanso.tipo === "baile") return "Dance";
    }
    return "Idle";
  }

  /** Tipo de actividad libre (para el icono junto al nombre) */
  tipoActividad(slug: string): Descanso["tipo"] | "yendo" | null {
    const r = this.robots.get(slug);
    if (!r || r.trabajando || !r.descanso) return null;
    return r.descansando ? r.descanso.tipo : "yendo";
  }

  /** Qué está haciendo, en palabras (para el globo y el panel). */
  actividad(slug: string): string | null {
    const r = this.robots.get(slug);
    if (!r || r.trabajando) return null;
    if (r.descanso && r.descansando) return TEXTO_DESCANSO[r.descanso.tipo];
    if (r.descanso) return "Yendo a descansar";
    return null;
  }
}
