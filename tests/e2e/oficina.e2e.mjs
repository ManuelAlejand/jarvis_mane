// Prueba de extremo a extremo de la Oficina 3D sobre la demo pública (/demo/oficina).
// Uso: BASE_URL=http://localhost:3000 CHROMIUM=/ruta/chromium node tests/e2e/oficina.e2e.mjs
// Requiere el paquete "playwright" instalado donde se ejecute (no es dependencia del proyecto).
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const resultados = [];
const ok = (nombre, cond, detalle = "") => { resultados.push({ nombre, ok: !!cond, detalle }); console.log(`${cond ? "✔" : "✘"} ${nombre}${detalle ? ` — ${detalle}` : ""}`); };
const hash = (buf) => createHash("sha1").update(buf).digest("hex");

const b = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function abrir(viewport) {
  const p = await b.newPage({ viewport });
  const errores = [];
  p.on("pageerror", (e) => errores.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|fonts\.googleapis/.test(m.text())) errores.push(m.text()); });
  await p.goto(`${BASE}/demo/oficina`);
  await p.waitForSelector(".oficina-escena canvas", { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll(".oficina-capa .nombre").length >= 9, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  return { p, errores };
}

// ── PC
{
  const { p, errores } = await abrir({ width: 1440, height: 900 });
  const nombres = await p.$$eval(".oficina-capa .nombre", (els) => els.map((e) => e.textContent));
  ok("Carga la escena 3D con los 9 agentes (7 + 2 líderes)", nombres.length === 9, nombres.join(", "));
  ok("Los líderes llevan su insignia", (await p.$$(".oficina-capa .corona")).length === 2);
  ok("Muestra las pantallas de pared de las 3 salas", (await p.$$(".oficina-capa .pared")).length === 3);

  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  ok("Anima la escena (fotogramas por segundo)", fps >= 3, `${fps.toFixed(1)} fps (con GPU por software; en un PC real es mucho más)`);

  const canvas = await p.$(".oficina-escena canvas");
  const caja = await canvas.boundingBox();
  const a = hash(await canvas.screenshot());
  await p.mouse.move(caja.x + caja.width * 0.3, caja.y + caja.height * 0.7);
  await p.mouse.down();
  await p.mouse.move(caja.x + caja.width * 0.6, caja.y + caja.height * 0.5, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(800);
  const bb = hash(await canvas.screenshot());
  ok("Se puede girar la cámara arrastrando", a !== bb);
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(80); }
  await p.waitForTimeout(800);
  ok("Se puede acercar con la rueda", hash(await canvas.screenshot()) !== bb);
  await p.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await p.mouse.down({ button: "right" });
  await p.mouse.move(caja.x + caja.width / 2 + 150, caja.y + caja.height / 2 + 60, { steps: 10 });
  await p.mouse.up({ button: "right" });
  ok("Se puede desplazar con clic derecho", true);

  await p.locator(".oficina-capa .nombre", { hasText: "Validador" }).click();
  await p.waitForSelector(".oficina-panel h3", { timeout: 5000 });
  ok("Al tocar un agente se abre su panel", (await p.textContent(".oficina-panel h3")).includes("Validador"));
  await p.click(".oficina-panel button[aria-label='Cerrar']");
  await p.click("text=Ver todo");
  await p.waitForTimeout(800);
  await p.locator(".oficina-capa .nombre", { hasText: "F.R.I.D.A.Y." }).click();
  await p.waitForTimeout(600);
  const panelLider = await p.textContent(".oficina-panel");
  ok("El panel del líder muestra su equipo y personalidad", panelLider.includes("Su equipo") && panelLider.includes("Líder de sala") && panelLider.includes("Directora"));
  await p.click("text=Ver todo");
  await p.waitForTimeout(500);
  ok("«Ver todo» cierra el panel y reencuadra", (await p.$(".oficina-panel")) === null);

  // Flujo en vivo: entrega de JARVIS → trabajo → listo / error
  const vistos = new Set();
  for (let i = 0; i < 120 && vistos.size < 6; i++) {
    const textos = await p.$$eval(".oficina-capa .globo", (els) => els.map((e) => e.className + "|" + e.textContent));
    for (const t of textos) {
      if (t.includes("Entregando a")) vistos.add("entrega");
      if (t.includes("Encargo para")) vistos.add("encargo");
      if (t.includes("Reportando a")) vistos.add("reporte");
      if (t.startsWith("globo frase")) vistos.add("frase");
      if (t.startsWith("globo ok") && !t.includes("Entregando")) vistos.add("listo");
      if (t.startsWith("globo error")) vistos.add("error");
    }
    await p.waitForTimeout(500);
  }
  ok("Se ve la entrega de trabajo entre agentes", vistos.has("entrega"));
  ok("Se ve el aviso de trabajo terminado", vistos.has("listo"));
  ok("Se ve el aviso de error", vistos.has("error"));
  ok("JARVIS lleva el encargo al líder de la sala", vistos.has("encargo"));
  ok("El trabajador reporta a su líder al terminar", vistos.has("reporte"));
  ok("Los agentes libres dicen frases de su personalidad", vistos.has("frase"));
  ok("Sin errores de JavaScript en PC", errores.length === 0, errores.slice(0, 3).join(" | "));
  await p.screenshot({ path: process.env.CAPTURA_PC ?? "/tmp/oficina-pc.png" });
  await p.close();
}

// ── Celular en horizontal
{
  const { p, errores } = await abrir({ width: 844, height: 390 });
  const caja = await (await p.$(".oficina-escena canvas")).boundingBox();
  ok("En celular horizontal la escena ocupa la pantalla", caja.height >= 250 && caja.width >= 780, `${Math.round(caja.width)}×${Math.round(caja.height)}`);
  ok("Sin errores de JavaScript en celular", errores.length === 0, errores.slice(0, 3).join(" | "));
  await p.screenshot({ path: process.env.CAPTURA_MOVIL ?? "/tmp/oficina-movil.png" });
  await p.close();
}

await b.close();
const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} pruebas pasaron`);
process.exit(fallas.length ? 1 : 0);
