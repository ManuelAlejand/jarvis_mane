"use client";
/**
 * Carga los sprites de la Oficina en el navegador (adaptado de browserMock.ts de Pixel Agents, MIT).
 * Lee public/oficina/{asset-index,furniture-catalog}.json y decodifica los PNG con un canvas.
 * Se ejecuta una sola vez por pestaña.
 */
import { rgbaToHex } from "@/vendor/pixel-agents/core/src/assets/colorUtils";
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from "@/vendor/pixel-agents/core/src/assets/constants";
import type { AssetIndex, CatalogEntry, CharacterDirectionSprites } from "@/vendor/pixel-agents/core/src/assets/types";
import { setFloorSprites } from "@/vendor/pixel-agents/webview-ui/src/office/floorTiles";
import { buildDynamicCatalog } from "@/vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";
import { setCharacterTemplates } from "@/vendor/pixel-agents/webview-ui/src/office/sprites/spriteData";
import { setWallSprites } from "@/vendor/pixel-agents/webview-ui/src/office/wallTiles";

const BASE = "/oficina/";

interface Png {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function decodePng(url: string): Promise<Png> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude cargar ${url} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

function readSprite(png: Png, w: number, h: number, ox = 0, oy = 0): string[][] {
  const out: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const i = ((oy + y) * png.width + ox + x) * 4;
      row.push(rgbaToHex(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]));
    }
    out.push(row);
  }
  return out;
}

const path = (kind: string, rel: string) => (rel.startsWith(`${kind}/`) ? rel : `${kind}/${rel}`);

let cargando: Promise<void> | null = null;

/** Descarga y registra personajes, suelos, paredes y muebles en el motor. Idempotente. */
export function cargarAssetsOficina(): Promise<void> {
  cargando ??= (async () => {
    const [index, catalog] = await Promise.all([
      fetch(`${BASE}asset-index.json`).then((r) => r.json() as Promise<AssetIndex>),
      fetch(`${BASE}furniture-catalog.json`).then((r) => r.json() as Promise<CatalogEntry[]>),
    ]);

    const characters = await Promise.all(
      index.characters.map(async (rel) => {
        const png = await decodePng(BASE + path("characters", rel));
        const byDir: CharacterDirectionSprites = { down: [], up: [], right: [] };
        CHARACTER_DIRECTIONS.forEach((dir, d) => {
          const frames: string[][][] = [];
          for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) frames.push(readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, f * CHAR_FRAME_W, d * CHAR_FRAME_H));
          byDir[dir] = frames;
        });
        return byDir;
      }),
    );
    const floors = await Promise.all(
      index.floors.map(async (rel) => readSprite(await decodePng(BASE + path("floors", rel)), FLOOR_TILE_SIZE, FLOOR_TILE_SIZE)),
    );
    const walls = await Promise.all(
      index.walls.map(async (rel) => {
        const png = await decodePng(BASE + path("walls", rel));
        const set: string[][][] = [];
        for (let m = 0; m < WALL_BITMASK_COUNT; m++) {
          set.push(readSprite(png, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, (m % WALL_GRID_COLS) * WALL_PIECE_WIDTH, Math.floor(m / WALL_GRID_COLS) * WALL_PIECE_HEIGHT));
        }
        return set;
      }),
    );
    const furniture: Record<string, string[][]> = {};
    await Promise.all(
      catalog.map(async (e) => {
        furniture[e.id] = readSprite(await decodePng(BASE + e.furniturePath), e.width, e.height);
      }),
    );

    // Mismo orden que Pixel Agents: personajes → suelos → paredes → muebles (el layout va después)
    setCharacterTemplates(characters);
    setFloorSprites(floors);
    setWallSprites(walls);
    buildDynamicCatalog({ catalog: catalog as never, sprites: furniture });
  })();
  cargando.catch(() => {
    cargando = null; // permitir reintentar si falló la red
  });
  return cargando;
}
