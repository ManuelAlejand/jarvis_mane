"use client";
/** Minimapa del edificio: salas y robots en vivo (se mueve sin re-renderizar React). Clic en una sala = volar a ella. */
import { useEffect, useRef } from "react";
import type { Mundo } from "@/lib/oficina/mundo";
import type { Plano } from "@/lib/oficina/plano";

interface Punto {
  slug: string;
  color: string;
}

export function Minimapa({ plano, mundo, puntos, salaActual, onSala }: {
  plano: Plano; mundo: Mundo; puntos: Punto[]; salaActual: string | null; onSala: (slug: string) => void;
}) {
  const refs = useRef(new Map<string, SVGCircleElement>());
  useEffect(() => {
    let id = 0;
    let ultimo = 0;
    const bucle = (t: number) => {
      id = requestAnimationFrame(bucle);
      if (t - ultimo < 100) return; // 10 veces por segundo es suficiente
      ultimo = t;
      for (const [slug, el] of refs.current) {
        const r = mundo.robots.get(slug);
        if (!r) continue;
        el.setAttribute("cx", r.x.toFixed(2));
        el.setAttribute("cy", r.z.toFixed(2));
      }
    };
    id = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(id);
  }, [mundo]);
  return (
    <svg className="minimapa" viewBox={`-0.5 -0.5 ${plano.cols + 1} ${plano.rows + 1}`} role="group" aria-label="Minimapa de salas">
      {plano.salas.map((s) => (
        <g key={s.slug}>
          <rect
            x={s.c0}
            y={s.r0}
            width={s.w}
            height={s.h}
            className={`mm-sala ${s.tipo} ${salaActual === s.slug ? "actual" : ""}`}
            style={{ ["--tono" as string]: s.tono }}
            onClick={() => onSala(s.slug)}
            role="button"
            tabIndex={0}
            aria-label={`Ir a ${s.nombre}`}
            onKeyDown={(e) => e.key === "Enter" && onSala(s.slug)}
          >
            <title>{s.nombre}</title>
          </rect>
          {s.puestos.map((p, i) => (
            <rect key={i} x={p.mesa.c} y={p.mesa.r} width={3} height={2} className="mm-mesa" />
          ))}
        </g>
      ))}
      {puntos.map((p) => (
        <circle
          key={p.slug}
          r={0.9}
          fill={p.color}
          className="mm-robot"
          ref={(el) => {
            if (el) refs.current.set(p.slug, el);
            else refs.current.delete(p.slug);
          }}
        />
      ))}
    </svg>
  );
}
