"use client";
import { useEffect, useMemo, useState } from "react";
import { ambientePara, CLIMA_LAT, CLIMA_LON, climaDeCodigo, type Ambiente, type Clima } from "@/lib/oficina/ambiente";

const CLIMAS: Clima[] = ["despejado", "nublado", "niebla", "lluvia", "tormenta"];

/**
 * Hora real y clima real para la ciudad. El clima se consulta a Open-Meteo cada 20 min (gratis, sin clave);
 * si falla, queda "despejado". Para probar: `?hora=14.5&clima=lluvia` en la dirección.
 */
export function useAmbiente(): Ambiente {
  const [ahora, setAhora] = useState(() => new Date());
  const [clima, setClima] = useState<{ clima: Clima; temp: number | null }>({ clima: "despejado", temp: null });
  const forzado = useMemo(() => {
    if (typeof window === "undefined") return { hora: undefined, clima: undefined };
    const q = new URLSearchParams(window.location.search);
    const h = q.get("hora");
    const c = q.get("clima") as Clima | null;
    return { hora: h !== null && !Number.isNaN(Number(h)) ? Math.min(23.99, Math.max(0, Number(h))) : undefined, clima: c && CLIMAS.includes(c) ? c : undefined };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (forzado.clima) return;
    let vivo = true;
    const consultar = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${CLIMA_LAT}&longitude=${CLIMA_LON}&current=weather_code,temperature_2m&timezone=auto`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { current?: { weather_code?: number; temperature_2m?: number } };
        if (vivo) setClima({ clima: climaDeCodigo(j.current?.weather_code), temp: j.current?.temperature_2m ?? null });
      } catch {
        /* sin red: se queda como está */
      }
    };
    void consultar();
    const t = window.setInterval(consultar, 20 * 60_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, [forzado.clima]);

  return useMemo(
    () => ambientePara(ahora, forzado.clima ?? clima.clima, clima.temp, forzado.hora),
    [ahora, clima, forzado],
  );
}
