/** JARVIS: sin servidor de Pixel Agents. Los mensajes que la oficina quiere enviar
 *  (p. ej. al hacer clic en un agente) se publican como evento del navegador. */
export interface MessageTransport {
  send(msg: unknown): void;
}
export const transport: MessageTransport = {
  send(msg: unknown) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("oficina:send", { detail: msg }));
  },
};
