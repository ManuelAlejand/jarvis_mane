/** Utilidades de texto de la consola de JARVIS (puras, con pruebas). */

/** Deja pasar solo <b>, <i>, <code> y <br> (lo que manda el router de Telegram); el resto se escapa. */
export function htmlSeguro(html: string) {
  const esc = html.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/&lt;(\/?)(b|i|code|u|s)&gt;/g, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/g, "<br>")
    .replace(/\n/g, "<br>");
}

/** Palabra de activación: "Jarvis, …" (también "yarvis" y "jarvi", como suele transcribirse). */
export function quitarActivacion(texto: string): string | null {
  const m = texto.trim().match(/^(?:oye\s+|hey\s+|ok\s+)?(?:j|y)arvi[sz]?[,.:!\s]+(.*)$/i);
  return m ? m[1].trim() : null;
}
