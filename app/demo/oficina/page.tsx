"use client";
// Demostración pública de la Oficina 3D con datos simulados (no usa la base de datos).
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { enviarDemo, estadoDemo } from "@/components/oficina3d/demo";

const OficinaView = dynamic(() => import("@/components/OficinaView").then((m) => m.OficinaView), { ssr: false });

export default function DemoOficina() {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPaso((p) => p + 1), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="main" style={{ padding: 16 }}>
      <p className="muted small" style={{ margin: "0 0 8px" }} data-paso={paso}>
        Demostración con datos simulados · paso {paso}
      </p>
      <OficinaView s={estadoDemo(paso)} enviar={enviarDemo} />
    </main>
  );
}
