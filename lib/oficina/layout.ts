/**
 * Genera el plano de la Oficina de JARVIS a partir de las salas (una por proyecto + el Núcleo).
 * Formato: OfficeLayout de Pixel Agents (MIT). Cada sala tiene un escritorio de líder y hasta
 * 5 de trabajadores, puertas en las paredes compartidas y un pasillo que cruza todas las salas.
 */
import type { ColorValue, OfficeLayout, PlacedFurniture, TileType } from "@/vendor/pixel-agents/webview-ui/src/office/types";

export interface SalaSpec {
  slug: string;
  nombre: string;
  tipo: "nucleo" | "proyecto";
  /** Tono del suelo (0-360) */
  tono: number;
}

export interface SalaPlano extends SalaSpec {
  /** Esquina superior izquierda del interior, en tiles */
  col: number;
  row: number;
  w: number;
  h: number;
  /** uid de las sillas en orden: [líder, trabajador1, …] */
  sillas: string[];
  /** Tile frente a cada silla donde se para quien viene a entregar algo */
  entregas: { col: number; row: number }[];
}

export interface Plano {
  layout: OfficeLayout;
  salas: SalaPlano[];
}

const WALL = 0 as TileType;
const VOID = 255 as TileType;
const FLOOR = 1 as TileType;

export const SALA_W = 12; // interior
export const SALA_H = 9;
const POR_FILA = 3;
const ARRIBA = 2; // filas vacías arriba para los objetos de pared (pantalla, pizarra)

/** Posiciones (dentro de la sala) de los escritorios: primero el del líder. */
const ESCRITORIOS = [
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 9, y: 1 },
  { x: 1, y: 5 },
  { x: 5, y: 5 },
  { x: 9, y: 5 },
];

export function generarPlano(specs: SalaSpec[]): Plano {
  const filas = Math.max(1, Math.ceil(specs.length / POR_FILA));
  const enFila = Math.min(POR_FILA, Math.max(1, specs.length));
  const cols = enFila * (SALA_W + 1) + 1;
  const rows = ARRIBA + filas * (SALA_H + 1) + 1;
  const tiles: TileType[] = new Array(cols * rows).fill(VOID);
  const colors: Array<ColorValue | null> = new Array(cols * rows).fill(null);
  const furniture: PlacedFurniture[] = [];
  const salas: SalaPlano[] = [];
  const at = (c: number, r: number) => r * cols + c;

  // Paredes del edificio completo: acero oscuro
  const pared: ColorValue = { h: 212, s: 22, b: -62, c: -20, colorize: true };
  for (let r = ARRIBA; r < rows; r++) for (let c = 0; c < cols; c++) { tiles[at(c, r)] = WALL; colors[at(c, r)] = pared; }

  specs.forEach((s, i) => {
    const fc = i % POR_FILA;
    const fr = Math.floor(i / POR_FILA);
    const c0 = 1 + fc * (SALA_W + 1);
    const r0 = ARRIBA + 1 + fr * (SALA_H + 1);
    const suelo: ColorValue = s.tipo === "nucleo"
      ? { h: 196, s: 40, b: -72, c: -35, colorize: true }
      : { h: s.tono, s: 18, b: -78, c: -40, colorize: true };
    const anillo: ColorValue = { h: 190, s: 70, b: -58, c: -25, colorize: true };
    for (let y = 0; y < SALA_H; y++) {
      for (let x = 0; x < SALA_W; x++) {
        // Núcleo: anillo luminoso alrededor del puesto de JARVIS
        const enAnillo = s.tipo === "nucleo" && y >= 0 && y <= 4 && x >= 3 && x <= 8 && (y === 0 || y === 4 || x === 3 || x === 8);
        tiles[at(c0 + x, r0 + y)] = FLOOR;
        colors[at(c0 + x, r0 + y)] = enAnillo ? anillo : suelo;
      }
    }
    // Puerta hacia la sala de la izquierda (pared compartida) y hacia la de arriba
    if (fc > 0) for (const y of [3, 4, 5]) { tiles[at(c0 - 1, r0 + y)] = FLOOR; colors[at(c0 - 1, r0 + y)] = suelo; }
    if (fr > 0) for (const x of [4, 7]) { tiles[at(c0 + x, r0 - 1)] = FLOOR; colors[at(c0 + x, r0 - 1)] = suelo; }

    const sillas: string[] = [];
    const entregas: { col: number; row: number }[] = [];
    const id = (k: string) => `${s.slug}-${k}`;
    if (s.tipo === "nucleo") {
      // JARVIS al centro, sala de reuniones con sofá y una pantalla grande
      furniture.push({ uid: id("mesa"), type: "DESK_FRONT", col: c0 + 4, row: r0 + 1 });
      furniture.push({ uid: id("pc"), type: "PC_FRONT_OFF", col: c0 + 5, row: r0 + 1 });
      furniture.push({ uid: id("silla-0"), type: "CUSHIONED_CHAIR_BACK", col: c0 + 5, row: r0 + 3 });
      sillas.push(id("silla-0"));
      entregas.push({ col: c0 + 5, row: r0 + 4 });
      furniture.push({ uid: id("sofa-f"), type: "SOFA_FRONT", col: c0 + 2, row: r0 + 5 });
      furniture.push({ uid: id("mesita"), type: "COFFEE_TABLE", col: c0 + 2, row: r0 + 6 });
      furniture.push({ uid: id("sofa-b"), type: "SOFA_BACK", col: c0 + 2, row: r0 + 8 });
      furniture.push({ uid: id("cafe"), type: "COFFEE", col: c0 + 3, row: r0 + 6 });
      furniture.push({ uid: id("planta-1"), type: "LARGE_PLANT", col: c0 + 9, row: r0 + 6 });
      furniture.push({ uid: id("planta-2"), type: "PLANT", col: c0 + 11, row: r0 + 0 });
      furniture.push({ uid: id("estante"), type: "BOOKSHELF", col: c0 + 8, row: r0 - 1 });
      furniture.push({ uid: id("reloj"), type: "CLOCK", col: c0 + 1, row: r0 - 2 });
    } else {
      ESCRITORIOS.forEach((d, k) => {
        furniture.push({ uid: id(`mesa-${k}`), type: "DESK_FRONT", col: c0 + d.x, row: r0 + d.y });
        furniture.push({ uid: id(`pc-${k}`), type: "PC_FRONT_OFF", col: c0 + d.x + 1, row: r0 + d.y });
        furniture.push({ uid: id(`silla-${k}`), type: "CUSHIONED_CHAIR_BACK", col: c0 + d.x + 1, row: r0 + d.y + 2 });
        sillas.push(id(`silla-${k}`));
        entregas.push({ col: c0 + d.x + (d.x + 2 < SALA_W ? 2 : 0), row: r0 + d.y + 2 });
      });
      furniture.push({ uid: id("planta"), type: "PLANT_2", col: c0 + 11, row: r0 + 7 });
      furniture.push({ uid: id("papelera"), type: "BIN", col: c0, row: r0 + 8 });
    }
    // Pizarra en la pared superior (solo en la primera fila: arriba hay espacio vacío)
    if (fr === 0) furniture.push({ uid: id("pizarra"), type: "WHITEBOARD", col: c0 + (s.tipo === "nucleo" ? 3 : 5), row: r0 - 2 });

    salas.push({ ...s, col: c0, row: r0, w: SALA_W, h: SALA_H, sillas, entregas });
  });

  return {
    layout: { version: 1, cols, rows, tiles, tileColors: colors, furniture, layoutRevision: 1, pets: [] },
    salas,
  };
}
