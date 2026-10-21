"use client";
/**
 * "Habla con JARVIS" dentro de la Oficina: consola holográfica con micrófono.
 * Usa el mismo router que Telegram (`/api/command`), así que entiende las mismas órdenes y gasta lo mismo.
 * Voz → texto con el reconocimiento de voz del navegador (Chrome/Edge; el audio lo procesa el servicio de voz
 * del navegador). Texto → voz con speechSynthesis (opcional).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ModoVoz } from "@/lib/oficina/mundo";
import { htmlSeguro, quitarActivacion } from "@/lib/oficina/texto";
import { callar, hablar, sonar, textoParaVoz, vozJarvisActiva } from "@/lib/oficina/sonido";

export type Enviar = (texto: string) => Promise<{ ok: boolean; html: string }>;

interface Mensaje {
  id: number;
  quien: "yo" | "jarvis";
  html: string;
}

/* Tipos mínimos del reconocimiento de voz (no están en lib.dom en todos los navegadores) */
interface ResultadoVoz {
  isFinal: boolean;
  0: { transcript: string };
}
interface EventoVoz {
  resultIndex: number;
  results: ArrayLike<ResultadoVoz>;
}
interface Reconocedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function crearReconocedor(): Reconocedor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

export const hayReconocimiento = () =>
  typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

export interface ConsolaApi {
  enfocar: () => void;
  microfono: () => void;
}

interface Props {
  enviar: Enviar;
  onModo: (m: ModoVoz) => void;
  /** Respuesta lista (para el globo sobre JARVIS) */
  onRespuesta: (texto: string, ok: boolean) => void;
  compacta: boolean;
}

export const ConsolaJarvis = forwardRef<ConsolaApi, Props>(function ConsolaJarvis({ enviar, onModo, onRespuesta, compacta }, ref) {
  const [abierta, setAbierta] = useState(!compacta);
  const [texto, setTexto] = useState("");
  const [msgs, setMsgs] = useState<Mensaje[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [modoEscucha, setModoEscucha] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [puedeVoz, setPuedeVoz] = useState(false);
  const [verMsgs, setVerMsgs] = useState(true);
  const entrada = useRef<HTMLInputElement>(null);
  const rec = useRef<Reconocedor | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const nMsg = useRef(0);
  const escuchaContinua = useRef(false);

  useEffect(() => setPuedeVoz(hayReconocimiento()), []);
  useEffect(() => setAbierta(!compacta), [compacta]);
  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [msgs]);

  const agregar = (quien: Mensaje["quien"], html: string) => {
    setVerMsgs(true);
    setMsgs((m) => [...m.slice(-7), { id: ++nMsg.current, quien, html }]);
  };

  const mandar = useCallback(
    async (valor: string) => {
      const v = valor.trim();
      if (!v || ocupado) return;
      agregar("yo", htmlSeguro(v));
      setTexto("");
      setOcupado(true);
      onModo("pensando");
      sonar("clic");
      try {
        const r = await enviar(v);
        agregar("jarvis", htmlSeguro(r.html));
        onRespuesta(textoParaVoz(r.html), r.ok);
        sonar(r.ok ? "respuesta" : "error");
        onModo("hablando");
        const dijo = hablar(r.html, () => onModo(escuchaContinua.current ? "escuchando" : "normal"));
        if (!dijo) window.setTimeout(() => onModo(escuchaContinua.current ? "escuchando" : "normal"), 2200);
      } catch {
        agregar("jarvis", "⚠️ No pude contactar al servidor. Revisa tu conexión.");
        onModo("normal");
      } finally {
        setOcupado(false);
      }
    },
    [enviar, ocupado, onModo, onRespuesta],
  );

  const detener = useCallback(() => {
    escuchaContinua.current = false;
    setModoEscucha(false);
    rec.current?.abort();
    rec.current = null;
    setEscuchando(false);
    onModo("normal");
  }, [onModo]);

  /** Escuchar: una frase (botón del micrófono) o continuo con palabra de activación ("Jarvis, …"). */
  const escuchar = useCallback(
    (continuo: boolean) => {
      const r = crearReconocedor();
      if (!r) {
        setAviso("Tu navegador no reconoce voz. Usa Chrome o Edge, o escribe la orden.");
        return;
      }
      callar();
      rec.current?.abort();
      rec.current = r;
      escuchaContinua.current = continuo;
      r.lang = "es-CO";
      r.interimResults = true;
      r.continuous = continuo;
      r.onresult = (e) => {
        let parcial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const t = res[0].transcript;
          if (res.isFinal) {
            if (continuo) {
              const orden = quitarActivacion(t);
              if (orden) void mandar(orden);
            } else void mandar(t);
            parcial = "";
          } else parcial += t;
        }
        if (!continuo || quitarActivacion(parcial) !== null) setTexto(continuo ? quitarActivacion(parcial) ?? "" : parcial);
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setAviso("Sin permiso para el micrófono. Actívalo en el candado de la barra de direcciones.");
          detener();
        } else if (e.error === "no-speech" && !continuo) setAviso("No te escuché. Intenta de nuevo.");
      };
      r.onend = () => {
        // En modo escucha el navegador corta cada cierto tiempo: se vuelve a encender solo
        if (escuchaContinua.current && rec.current === r) {
          try {
            r.start();
            return;
          } catch {
            /* sigue abajo */
          }
        }
        if (rec.current === r) {
          rec.current = null;
          setEscuchando(false);
          setModoEscucha(false);
        }
      };
      try {
        r.start();
        setAviso(continuo ? "Modo escucha: di «Jarvis, …» y tu orden." : null);
        setEscuchando(true);
        setModoEscucha(continuo);
        onModo("escuchando");
        sonar("escucha");
      } catch {
        setAviso("No pude encender el micrófono.");
      }
    },
    [mandar, detener, onModo],
  );

  useEffect(() => () => rec.current?.abort(), []);

  useImperativeHandle(ref, () => ({
    enfocar: () => {
      setAbierta(true);
      window.setTimeout(() => entrada.current?.focus(), 30);
    },
    microfono: () => {
      setAbierta(true);
      if (escuchando) detener();
      else escuchar(false);
    },
  }));

  if (!abierta) {
    return (
      <button className="consola-jarvis-boton" onClick={() => setAbierta(true)} aria-label="Hablar con JARVIS">
        <span className="consola-reactor" aria-hidden="true" /> Hablar con JARVIS
      </button>
    );
  }

  return (
    <div className={`consola-jarvis ${escuchando ? "escuchando" : ""} ${ocupado ? "pensando" : ""}`} role="region" aria-label="Consola de JARVIS">
      {msgs.length > 0 && (
        <button type="button" className="consola-plegar" onClick={() => setVerMsgs((v) => !v)} aria-expanded={verMsgs}>
          {verMsgs ? "Ocultar conversación ▾" : `Ver conversación (${msgs.length}) ▸`}
        </button>
      )}
      {msgs.length > 0 && verMsgs && (
        <div className="consola-msgs" ref={lista} aria-live="polite">
          {msgs.map((m) => (
            <p key={m.id} className={m.quien} dangerouslySetInnerHTML={{ __html: m.html }} />
          ))}
        </div>
      )}
      {aviso && <p className="consola-aviso">{aviso}</p>}
      <form
        className="consola-fila"
        onSubmit={(e) => {
          e.preventDefault();
          void mandar(texto);
        }}
      >
        <span className="consola-reactor" aria-hidden="true" />
        <input
          ref={entrada}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={escuchando ? "Te escucho…" : "Dile algo a JARVIS: /estado, «pasa Auditoría a activo»…"}
          aria-label="Orden para JARVIS"
          maxLength={500}
          disabled={ocupado}
        />
        {puedeVoz && (
          <>
            <button
              type="button"
              className={`consola-mic ${escuchando && !modoEscucha ? "on" : ""}`}
              onClick={() => (escuchando ? detener() : escuchar(false))}
              aria-label={escuchando ? "Dejar de escuchar" : "Hablar"}
              title="Hablar (atajo: V)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
            <button
              type="button"
              className={`consola-mic ${modoEscucha ? "on" : ""}`}
              onClick={() => (modoEscucha ? detener() : escuchar(true))}
              aria-pressed={modoEscucha}
              title="Modo escucha: JARVIS atiende cuando dices «Jarvis, …». Apágalo cuando no lo uses."
            >
              <span aria-hidden="true">◎</span>
              <span className="sr-only">Modo escucha</span>
            </button>
          </>
        )}
        <button type="submit" className="btn small" disabled={ocupado || !texto.trim()}>
          {ocupado ? "…" : "Enviar"}
        </button>
        {compacta && (
          <button type="button" className="btn btn-ghost small" onClick={() => setAbierta(false)} aria-label="Cerrar consola">
            ✕
          </button>
        )}
      </form>
      {vozJarvisActiva() ? null : msgs.length === 0 && <p className="consola-aviso tenue">Activa «🗣 Voz» arriba para que JARVIS te responda hablando.</p>}
    </div>
  );
});
