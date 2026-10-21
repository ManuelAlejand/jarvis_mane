import { test } from "node:test";
import assert from "node:assert/strict";
import { ambientePara, climaDeCodigo, faseDe, horaEn, luzDelDia } from "../lib/oficina/ambiente";
import { htmlSeguro, quitarActivacion, sinEmojis } from "../lib/oficina/texto";
import { estadisticasDe } from "../lib/oficina/estadisticas";
import { generarPlano } from "../lib/oficina/plano";
import { Mundo } from "../lib/oficina/mundo";
import type { AgentRun } from "../lib/types";

test("hora de Colombia y luz del día", () => {
  // 2026-10-21 17:00 UTC = 12:00 en Bogotá (UTC-5)
  assert.equal(horaEn(new Date("2026-10-21T17:00:00Z")), 12);
  assert.equal(luzDelDia(12), 1);
  assert.equal(luzDelDia(2), 0);
  assert.ok(luzDelDia(6) > 0 && luzDelDia(6) < 1);
  assert.equal(faseDe(18), "atardecer");
  assert.equal(faseDe(23), "noche");
});

test("códigos de clima de Open-Meteo", () => {
  assert.equal(climaDeCodigo(0), "despejado");
  assert.equal(climaDeCodigo(3), "nublado");
  assert.equal(climaDeCodigo(45), "niebla");
  assert.equal(climaDeCodigo(61), "lluvia");
  assert.equal(climaDeCodigo(81), "lluvia");
  assert.equal(climaDeCodigo(95), "tormenta");
  assert.equal(climaDeCodigo(undefined), "despejado");
  const dia = ambientePara(new Date(), "despejado", 18, 13);
  const noche = ambientePara(new Date(), "despejado", 18, 23);
  assert.notDeepEqual(dia.cielo, noche.cielo);
  assert.match(dia.cielo[0], /^#[0-9a-f]{6}$/);
});

test("la consola solo deja pasar el HTML del router", () => {
  assert.equal(htmlSeguro("<b>Hola</b> <i>x</i> <code>/estado</code>"), "<b>Hola</b> <i>x</i> <code>/estado</code>");
  assert.ok(!htmlSeguro("<img src=x onerror=alert(1)>").includes("<img"));
  assert.ok(!htmlSeguro('<b onclick="x">a</b>').includes("<b onclick"));
  assert.equal(htmlSeguro("a\nb"), "a<br>b");
  assert.equal(htmlSeguro("&lt;ya escapado&gt;"), "&lt;ya escapado&gt;");
});

test("palabra de activación «Jarvis»", () => {
  assert.equal(quitarActivacion("Jarvis, dame el estado"), "dame el estado");
  assert.equal(quitarActivacion("oye jarvis pasa auditoría a activo"), "pasa auditoría a activo");
  assert.equal(quitarActivacion("Yarvis muestra el gasto"), "muestra el gasto");
  assert.equal(quitarActivacion("hola qué tal"), null);
});

test("estadísticas de 7 días del agente", () => {
  const hoy = new Date("2026-10-21T15:00:00");
  const r = (dias: number, status: string): AgentRun =>
    ({
      id: String(Math.random()), status,
      created_at: new Date(hoy.getTime() - dias * 86400000).toISOString(),
      started_at: new Date(hoy.getTime() - dias * 86400000).toISOString(),
      finished_at: new Date(hoy.getTime() - dias * 86400000 + 60000).toISOString(),
    }) as unknown as AgentRun;
  const e = estadisticasDe([r(0, "done"), r(0, "error"), r(1, "done"), r(10, "done")], hoy);
  assert.equal(e.dias.length, 7);
  assert.equal(e.dias[6].ok + e.dias[6].error, 2);
  assert.equal(e.dias[5].ok, 1);
  assert.equal(e.exito, 75);
  assert.equal(Math.round(e.durMedia!), 60);
});

test("efectos del mundo: se registran y tienen tope", () => {
  const plano = generarPlano([{ slug: "nucleo", nombre: "N", tipo: "nucleo", tono: 0 }]);
  const m = new Mundo(plano);
  const s = plano.salas[0];
  m.colocar("jarvis", s, s.puestos[0], false);
  m.efecto("ok", "jarvis");
  m.efecto("error", "nadie"); // agente inexistente: se ignora
  assert.equal(m.efectos.length, 1);
  for (let i = 0; i < 40; i++) m.efecto("entrega", "jarvis");
  assert.equal(m.efectos.length, 24);
  assert.equal(m.voz, "normal");
});

test("la interfaz quita los emojis (quedan para Telegram)", () => {
  assert.equal(sinEmojis("📊 <b>Estado</b> ✅ listo"), "<b>Estado</b> listo");
  assert.equal(sinEmojis("Tomando café ☕"), "Tomando café ");
  assert.equal(sinEmojis("• Gasto API: $0.42 → ok"), "• Gasto API: $0.42 → ok");
});
