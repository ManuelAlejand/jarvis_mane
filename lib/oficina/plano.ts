/**
 * Plano de la Oficina 3D de JARVIS: salas por proyecto sobre una rejilla de celdas de 1×1.
 * Cada celda (c, r) tiene su centro en el mundo en x = c + 0.5, z = r + 0.5 (y hacia arriba).
 * Se usa para colocar muebles y para que los robots encuentren el camino (A*).
 *
 * Cada sala de proyecto (20×14) tiene: zona de trabajo (6 escritorios + el del líder al fondo) y
 * zona de descanso (sofá, café, agua, mesa de juego holográfica, arcade, puffs y pista de baile).
 * Rotación (rot): 0 = mira hacia +z, π/2 = +x, −π/2 = −x, π = −z (hacia la pared de las pantallas).
 */

export interface SalaSpec {
  slug: string;
  nombre: string;
  tipo: "nucleo" | "proyecto";
  tono: number; // 0-360
}

export interface Celda {
  c: number;
  r: number;
}

export interface Puesto {
  /** Esquina del escritorio (3×2 celdas) */
  mesa: Celda;
  /** Celda de la silla: el robot se sienta aquí mirando hacia la mesa (−z) */
  silla: Celda;
  /** Celda donde se para quien viene a entregar algo */
  entrega: Celda;
}

export type TipoDescanso = "sofa" | "cafe" | "agua" | "juego" | "arcade" | "puff" | "baile";

/** Lugar de la zona de descanso donde un agente libre puede pasar el rato. */
export interface Descanso {
  celda: Celda;
  tipo: TipoDescanso;
  rot: number;
}

/** Mueble decorativo (solo se dibuja; si bloquea, ya está marcado en `bloqueo`). */
export interface Mueble {
  tipo:
    | "sofa" | "mesita" | "cafetera" | "dispensador" | "mesaJuego" | "arcade" | "puff" | "alfombra"
    | "planta" | "estanteria" | "pantalla" | "divisor" | "pista";
  c: number;
  r: number;
  w: number;
  h: number;
  rot?: number;
}

export interface Sala extends SalaSpec {
  c0: number;
  r0: number;
  w: number;
  h: number;
  puestos: Puesto[];
  descansos: Descanso[];
  muebles: Mueble[];
  /** Mesa holográfica del Núcleo (2×2) */
  holo?: Celda;
}

export interface Plano {
  cols: number;
  rows: number;
  /** 1 = pared u obstáculo */
  bloqueo: Uint8Array;
  /** 1 = pared (para dibujar) */
  pared: Uint8Array;
  salas: Sala[];
}

export const SALA_W = 20;
export const SALA_H = 14;
const POR_FILA = 3;

/** El primero es el del líder: al fondo de la zona de trabajo, mirando hacia su equipo. */
const ESCRITORIOS = [
  { x: 5, y: 10 },
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 9, y: 1 },
  { x: 1, y: 5 },
  { x: 5, y: 5 },
  { x: 9, y: 5 },
];

const D = Math.PI / 2;

export function generarPlano(specs: SalaSpec[]): Plano {
  const filas = Math.max(1, Math.ceil(specs.length / POR_FILA));
  const enFila = Math.min(POR_FILA, Math.max(1, specs.length));
  const cols = enFila * (SALA_W + 1) + 1;
  const rows = filas * (SALA_H + 1) + 1;
  const pared = new Uint8Array(cols * rows).fill(1);
  const bloqueo = new Uint8Array(cols * rows).fill(1);
  const at = (c: number, r: number) => r * cols + c;
  const libre = (c: number, r: number) => {
    pared[at(c, r)] = 0;
    bloqueo[at(c, r)] = 0;
  };
  const ocupar = (c: number, r: number, w: number, h: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bloqueo[at(c + x, r + y)] = 1;
  };
  const salas: Sala[] = [];

  specs.forEach((s, i) => {
    const fc = i % POR_FILA;
    const fr = Math.floor(i / POR_FILA);
    const c0 = 1 + fc * (SALA_W + 1);
    const r0 = 1 + fr * (SALA_H + 1);
    for (let y = 0; y < SALA_H; y++) for (let x = 0; x < SALA_W; x++) libre(c0 + x, r0 + y);
    if (fc > 0) for (const y of [4, 9, 10]) libre(c0 - 1, r0 + y); // puertas a la sala de la izquierda
    if (fr > 0) for (const x of [3, 4, 14]) libre(c0 + x, r0 - 1); // puertas a la sala de arriba

    const puestos: Puesto[] = [];
    const descansos: Descanso[] = [];
    const muebles: Mueble[] = [];
    let holo: Celda | undefined;
    const m = (tipo: Mueble["tipo"], x: number, y: number, w: number, h: number, bloquea: boolean, rot = 0) => {
      muebles.push({ tipo, c: c0 + x, r: r0 + y, w, h, rot });
      if (bloquea) ocupar(c0 + x, r0 + y, w, h);
    };
    const lugar = (tipo: TipoDescanso, x: number, y: number, rot: number) => descansos.push({ tipo, celda: { c: c0 + x, r: r0 + y }, rot });
    const escritorio = (x: number, y: number) => {
      const mesa = { c: c0 + x, r: r0 + y };
      ocupar(mesa.c, mesa.r, 3, 3); // mesa (3×2) + fila de la silla: nadie camina por las sillas
      bloqueo[at(mesa.c, mesa.r + 2)] = 0;
      bloqueo[at(mesa.c + 2, mesa.r + 2)] = 0;
      puestos.push({ mesa, silla: { c: mesa.c + 1, r: mesa.r + 2 }, entrega: { c: mesa.c + 2, r: mesa.r + 2 } });
    };

    if (s.tipo === "nucleo") {
      // Consola de JARVIS, mesa holográfica grande y una sala de estar
      escritorio(8, 1);
      holo = { c: c0 + 9, r: r0 + 6 };
      ocupar(holo.c, holo.r, 2, 2);
      m("alfombra", 6, 4, 8, 6, false);
      m("sofa", 2, 11, 3, 1, true, Math.PI);
      m("mesita", 2, 9, 3, 1, true);
      m("sofa", 15, 11, 3, 1, true, Math.PI);
      m("mesita", 15, 9, 3, 1, true);
      for (const x of [2, 3, 4]) lugar("sofa", x, 11, Math.PI);
      for (const x of [15, 16, 17]) lugar("sofa", x, 11, Math.PI);
      m("cafetera", 19, 6, 1, 1, true);
      lugar("cafe", 18, 6, D);
      m("estanteria", 0, 0, 3, 1, true);
      m("estanteria", 17, 0, 3, 1, true);
      m("planta", 0, 13, 1, 1, true);
      m("planta", 19, 13, 1, 1, true);
      m("planta", 0, 5, 1, 1, true);
      m("pantalla", 3, -1, 4, 1, false);
      m("pantalla", 13, -1, 4, 1, false);
    } else {
      for (const d of ESCRITORIOS) escritorio(d.x, d.y);
      // Separador con jardineras entre trabajo y descanso (con paso en y = 4 y 8-9)
      m("divisor", 13, 0, 1, 4, true);
      m("divisor", 13, 5, 1, 3, true);
      m("divisor", 13, 10, 1, 4, true);
      // Zona de descanso
      m("alfombra", 14, 0, 6, 14, false);
      m("sofa", 15, 1, 3, 1, true, 0);
      m("mesita", 15, 3, 3, 1, true);
      for (const x of [15, 16, 17]) lugar("sofa", x, 1, 0);
      m("cafetera", 19, 6, 1, 1, true);
      lugar("cafe", 18, 6, D);
      m("dispensador", 19, 8, 1, 1, true);
      lugar("agua", 18, 8, D);
      m("mesaJuego", 15, 9, 2, 2, true);
      lugar("juego", 14, 9, D);
      lugar("juego", 17, 10, -D);
      m("arcade", 19, 12, 1, 1, true);
      lugar("arcade", 18, 12, D);
      m("puff", 14, 12, 1, 1, true);
      m("puff", 15, 13, 1, 1, true);
      lugar("puff", 14, 12, Math.PI);
      lugar("puff", 15, 13, Math.PI);
      m("pista", 15, 5, 2, 2, false);
      lugar("baile", 16, 6, 0);
      // Decoración de la zona de trabajo
      m("planta", 0, 13, 1, 1, true);
      m("planta", 12, 0, 1, 1, true);
      m("estanteria", 12, 10, 1, 3, true);
      m("pantalla", 2, -1, 4, 1, false);
      m("pantalla", 7, -1, 4, 1, false);
    }
    salas.push({ ...s, c0, r0, w: SALA_W, h: SALA_H, puestos, descansos, muebles, holo });
  });

  return { cols, rows, bloqueo, pared, salas };
}

/** Camino más corto entre dos celdas (A*, 4 direcciones). La celda destino puede estar ocupada (una silla). */
export function camino(p: Plano, desde: Celda, hasta: Celda): Celda[] {
  const { cols, rows, bloqueo } = p;
  const idx = (c: number, r: number) => r * cols + c;
  const meta = idx(hasta.c, hasta.r);
  const inicio = idx(desde.c, desde.r);
  if (inicio === meta) return [];
  const g = new Float32Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const cerrado = new Uint8Array(cols * rows);
  const abiertos: number[] = [inicio];
  g[inicio] = 0;
  const h = (i: number) => Math.abs((i % cols) - hasta.c) + Math.abs(Math.floor(i / cols) - hasta.r);
  while (abiertos.length) {
    let mejor = 0;
    for (let k = 1; k < abiertos.length; k++) if (g[abiertos[k]] + h(abiertos[k]) < g[abiertos[mejor]] + h(abiertos[mejor])) mejor = k;
    const cur = abiertos.splice(mejor, 1)[0];
    if (cur === meta) break;
    cerrado[cur] = 1;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = idx(nc, nr);
      if (cerrado[n] || (bloqueo[n] && n !== meta)) continue;
      const ng = g[cur] + 1;
      if (ng < g[n]) {
        g[n] = ng;
        prev[n] = cur;
        if (!abiertos.includes(n)) abiertos.push(n);
      }
    }
  }
  if (prev[meta] === -1) return [];
  const out: Celda[] = [];
  for (let i = meta; i !== inicio; i = prev[i]) out.push({ c: i % cols, r: Math.floor(i / cols) });
  return out.reverse();
}

/** Celda libre al azar dentro de una sala (para pasear). */
export function celdaLibre(p: Plano, s: Sala): Celda {
  for (let k = 0; k < 60; k++) {
    const c = s.c0 + Math.floor(Math.random() * s.w);
    const r = s.r0 + Math.floor(Math.random() * s.h);
    if (!p.bloqueo[r * p.cols + c]) return { c, r };
  }
  return { c: s.c0 + 1, r: s.r0 + 4 };
}
