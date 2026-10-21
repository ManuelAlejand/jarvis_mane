// Pruebas de la lógica de la Oficina 3D (sin navegador): npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { camino, generarPlano, SALA_H, SALA_W } from "../lib/oficina/plano";
import { Mundo } from "../lib/oficina/mundo";

const salas = [
  { slug: "nucleo", nombre: "Núcleo", tipo: "nucleo" as const, tono: 195 },
  { slug: "geo", nombre: "GEO", tipo: "proyecto" as const, tono: 30 },
  { slug: "yt", nombre: "YouTube", tipo: "proyecto" as const, tono: 300 },
  { slug: "x4", nombre: "Cuarta", tipo: "proyecto" as const, tono: 120 },
];

test("el plano reparte las salas en filas de 3 con su tamaño", () => {
  const p = generarPlano(salas);
  assert.equal(p.salas.length, 4);
  assert.equal(p.cols, 3 * (SALA_W + 1) + 1);
  assert.equal(p.rows, 2 * (SALA_H + 1) + 1);
  assert.equal(p.salas[0].puestos.length, 1, "el Núcleo tiene un puesto (JARVIS)");
  assert.equal(p.salas[1].puestos.length, 6, "cada proyecto tiene 6 puestos");
  assert.ok(p.salas[0].holo, "el Núcleo tiene mesa holográfica");
});

test("las sillas y mesas bloquean el paso; las entregas quedan libres", () => {
  const p = generarPlano(salas);
  for (const s of p.salas) for (const pu of s.puestos) {
    assert.equal(p.bloqueo[pu.mesa.r * p.cols + pu.mesa.c], 1);
    assert.equal(p.bloqueo[pu.silla.r * p.cols + pu.silla.c], 1);
    assert.equal(p.bloqueo[pu.entrega.r * p.cols + pu.entrega.c], 0);
  }
});

test("hay camino entre todas las salas (puertas abiertas), incluida la fila de abajo", () => {
  const p = generarPlano(salas);
  const desde = p.salas[0].puestos[0].silla;
  for (const s of p.salas) for (const pu of s.puestos) {
    const ruta = camino(p, desde, pu.entrega);
    assert.ok(ruta.length > 0, `sin camino hasta ${s.slug}`);
    for (const c of ruta.slice(0, -1)) assert.equal(p.bloqueo[c.r * p.cols + c.c], 0, "la ruta no atraviesa obstáculos");
  }
});

test("el robot camina a su silla, se sienta y se levanta al terminar", () => {
  const p = generarPlano(salas);
  const m = new Mundo(p);
  const s = p.salas[1];
  m.colocar("a", s, s.puestos[2], false);
  assert.equal(m.anim(m.robots.get("a")!), "Idle");
  m.setTrabajando("a", true);
  assert.equal(m.anim(m.robots.get("a")!), "Walking");
  for (let i = 0; i < 200; i++) m.paso(0.05);
  const r = m.robots.get("a")!;
  assert.equal(r.sentado, true);
  assert.equal(m.anim(r), "Sitting");
  m.setTrabajando("a", false);
  for (let i = 0; i < 200; i++) m.paso(0.05);
  assert.equal(m.robots.get("a")!.sentado, false);
});

test("una entrega lleva al robot hasta el puesto del otro y lo devuelve", async () => {
  const p = generarPlano(salas);
  const m = new Mundo(p);
  m.colocar("jarvis", p.salas[0], p.salas[0].puestos[0], false);
  m.colocar("b", p.salas[2], p.salas[2].puestos[0], true);
  m.entregar("jarvis", "b");
  let llego = false;
  const meta = p.salas[2].puestos[0].entrega;
  for (let i = 0; i < 800 && !llego; i++) {
    m.paso(0.05);
    const j = m.robots.get("jarvis")!;
    llego = Math.floor(j.x) === meta.c && Math.floor(j.z) === meta.r && j.ruta.length === 0;
  }
  assert.ok(llego, "JARVIS llega al puesto de destino");
  assert.equal(m.anim(m.robots.get("jarvis")!), "Wave");
  await new Promise((ok) => setTimeout(ok, 2500));
  assert.ok(m.robots.get("jarvis")!.ruta.length > 0, "después de saludar vuelve a su puesto");
});
