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

async function abrir(viewport, query = "") {
  const p = await b.newPage({ viewport, acceptDownloads: true });
  const errores = [];
  p.on("pageerror", (e) => errores.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|fonts\.googleapis/.test(m.text())) errores.push(m.text()); });
  await p.goto(`${BASE}/demo/oficina${query}`);
  await p.waitForSelector(".oficina-escena canvas", { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll(".oficina-capa .nombre").length >= 9, null, { timeout: 60000, polling: 500 });
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
  ok("Anima la escena (fotogramas por segundo)", fps >= 1.5, `${fps.toFixed(1)} fps (con GPU por software; en un PC real es mucho más)`);

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

  await p.locator(".oficina-capa .nombre", { hasText: "Validador" }).dispatchEvent("click"); // la etiqueta se mueve con el robot
  await p.waitForSelector(".oficina-panel h3", { timeout: 5000 });
  ok("Al tocar un agente se abre su panel", (await p.textContent(".oficina-panel h3")).includes("Validador"));
  await p.click(".oficina-panel button[aria-label='Cerrar']");
  await p.click("text=Ver todo");
  await p.waitForTimeout(800);
  await p.locator(".oficina-capa .nombre", { hasText: "F.R.I.D.A.Y." }).dispatchEvent("click");
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
  let descansando = 0;
  for (let i = 0; i < 40 && !descansando; i++) { descansando = (await p.$$(".oficina-capa .actividad")).length; if (!descansando) await p.waitForTimeout(500); }
  ok("Los agentes libres se van a la zona de descanso", descansando > 0, `${descansando} descansando`);
  ok("Sin errores de JavaScript en PC", errores.length === 0, errores.slice(0, 3).join(" | "));
  await p.screenshot({ path: process.env.CAPTURA_PC ?? "/tmp/oficina-pc.png" });
  await p.close();
}

// ── PC: navegación, consola de JARVIS, HUD, foto, ambiente (v2)
{
  const { p, errores } = await abrir({ width: 1440, height: 900 }, "?hora=13&clima=lluvia");
  const canvas = await p.$(".oficina-escena canvas");
  ok("Muestra el minimapa con todos los agentes", (await p.$$(".minimapa .mm-robot")).length === 9);
  ok("El ambiente refleja la hora y el clima pedidos", ((await p.textContent(".hud-ambiente")) ?? "").includes("lluvia"), await p.textContent(".hud-ambiente"));
  ok("El registro de misión lista eventos", (await p.$$(".hud-registro li")).length >= 1);

  const antes = hash(await canvas.screenshot());
  await p.click(".oficina-salas .chip:has-text('YouTube Shorts')");
  await p.waitForTimeout(2200);
  ok("Los botones de sala vuelan la cámara a esa sala", hash(await canvas.screenshot()) !== antes && (await p.$(".oficina-salas .chip.actual:has-text('YouTube')")) !== null);
  const enSala = hash(await canvas.screenshot());
  await p.keyboard.press("2");
  await p.waitForTimeout(2200);
  ok("El atajo de teclado 2 vuela a la segunda sala", hash(await canvas.screenshot()) !== enSala && (await p.$(".oficina-salas .chip.actual:has-text('Auditor')")) !== null);
  await p.click(".minimapa .mm-sala.nucleo");
  await p.waitForTimeout(1500);
  ok("Clic en el minimapa vuela a la sala", (await p.$(".oficina-salas .chip.actual:has-text('Núcleo')")) !== null);

  await p.keyboard.press("?");
  ok("«?» abre la ayuda de atajos", (await p.$(".oficina-ayuda-modal")) !== null);
  await p.keyboard.press("Escape");
  ok("Esc cierra la ayuda", (await p.$(".oficina-ayuda-modal")) === null);

  await p.fill(".consola-fila input", "/estado");
  await p.press(".consola-fila input", "Enter");
  await p.waitForSelector(".consola-msgs p.jarvis", { timeout: 8000 });
  ok("La consola manda la orden y JARVIS responde", ((await p.textContent(".consola-msgs p.jarvis")) ?? "").includes("Estado"));
  let globoJarvis = false;
  for (let i = 0; i < 10 && !globoJarvis; i++) {
    globoJarvis = await p.$$eval(".oficina-capa .agente-capa", (els) => els.some((e) => e.querySelector(".nombre.jarvis") && e.querySelector(".globo")?.textContent?.includes("Estado")));
    if (!globoJarvis) await p.waitForTimeout(300);
  }
  ok("La respuesta aparece en el globo de JARVIS", globoJarvis);
  await p.fill(".consola-fila input", "<img src=x onerror=alert(1)>");
  await p.press(".consola-fila input", "Enter");
  await p.waitForTimeout(1200);
  ok("La consola no ejecuta HTML del usuario", (await p.$(".consola-msgs img")) === null);

  await p.locator(".hud-registro .enlace").first().click();
  await p.waitForSelector(".oficina-panel h3", { timeout: 5000 });
  ok("Clic en el registro abre el agente", true);
  ok("El panel muestra las estadísticas de 7 días", (await p.$(".oficina-panel .estadisticas svg")) !== null);
  await p.click(".oficina-panel button[aria-label='Cerrar']");

  const descarga = p.waitForEvent("download", { timeout: 30000 }).catch(() => null);
  await p.keyboard.press("f", { noWaitAfter: true });
  const d = await descarga;
  const ruta = d ? await d.path() : null;
  const { statSync } = await import("node:fs");
  const peso = ruta ? statSync(ruta).size : 0;
  ok("La foto de la escena se descarga (con imagen, no en blanco)", !!d && d.suggestedFilename().startsWith("jarvis-oficina-") && peso > 60000, `${d?.suggestedFilename() ?? "sin descarga"} · ${Math.round(peso / 1024)} KB`);
  if (ruta && process.env.CAPTURA_FOTO) (await import("node:fs")).copyFileSync(ruta, process.env.CAPTURA_FOTO);

  await p.click(".oficina-acciones button[title^='Recorrido']");
  await p.waitForTimeout(400);
  ok("El tour automático se enciende", (await p.$(".hud-tour")) !== null);
  const t1 = hash(await canvas.screenshot());
  await p.waitForTimeout(2500);
  ok("El tour mueve la cámara solo", hash(await canvas.screenshot()) !== t1);
  const cb = await canvas.boundingBox();
  await p.mouse.move(cb.x + 300, cb.y + 300);
  await p.mouse.down();
  await p.mouse.move(cb.x + 360, cb.y + 320, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  ok("Arrastrar la cámara detiene el tour", (await p.$(".hud-tour")) === null);
  await p.click(".oficina-salas .chip:has-text('Ver todo')");
  await p.waitForTimeout(2000);
  const conEmojis = await p.evaluate(() => (document.querySelector(".oficina")?.innerText ?? "").match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []);
  ok("La interfaz usa iconos, no emojis", conEmojis.length === 0, conEmojis.slice(0, 5).join(" "));
  ok("Los agentes llevan su icono junto al nombre", (await p.$$(".oficina-capa .nombre svg")).length >= 9);
  ok("Sin errores de JavaScript con las funciones nuevas", errores.length === 0, errores.slice(0, 3).join(" | "));
  await p.screenshot({ path: process.env.CAPTURA_LLUVIA ?? "/tmp/oficina-lluvia.png" });
  await p.close();
}

// ── Celular en horizontal
{
  const { p, errores } = await abrir({ width: 844, height: 390 });
  const caja = await (await p.$(".oficina-escena canvas")).boundingBox();
  const fpsMovil = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  ok("En celular también se anima (versión ligera, sin brillo)", fpsMovil >= 1.5, `${fpsMovil.toFixed(1)} fps con GPU por software`);
  ok("En celular horizontal la escena ocupa la pantalla", caja.height >= 250 && caja.width >= 780, `${Math.round(caja.width)}×${Math.round(caja.height)}`);
  ok("En celular la consola de JARVIS empieza recogida", (await p.$(".consola-jarvis-boton")) !== null);
  ok("Sin errores de JavaScript en celular", errores.length === 0, errores.slice(0, 3).join(" | "));
  await p.screenshot({ path: process.env.CAPTURA_MOVIL ?? "/tmp/oficina-movil.png" });
  await p.close();
}

await b.close();

// ── Navegador sin 3D (WebGL desactivado): debe mostrar la lista de respaldo
{
  const sin3d = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] });
  const p = await sin3d.newPage({ viewport: { width: 1280, height: 800 } });
  const errores = [];
  p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(`${BASE}/demo/oficina`);
  await p.waitForSelector(".oficina-respaldo li", { timeout: 30000 });
  ok("Sin WebGL muestra el equipo en lista", (await p.$$(".oficina-respaldo li")).length === 9);
  await p.locator(".oficina-respaldo .enlace", { hasText: "Validador" }).click();
  await p.waitForSelector(".oficina-panel h3", { timeout: 5000 });
  ok("Sin WebGL también se abre el panel del agente", (await p.textContent(".oficina-panel h3")).includes("Validador"));
  ok("Sin errores de JavaScript sin WebGL", errores.length === 0, errores.slice(0, 3).join(" | "));
  await sin3d.close();
}

const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} pruebas pasaron`);
process.exit(fallas.length ? 1 : 0);
