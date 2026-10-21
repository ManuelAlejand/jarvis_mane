"use client";
/**
 * Muebles decorativos de cada sala: zona de descanso (sofás, café, agua, mesa de juego holográfica,
 * arcade, puffs, pista de baile), jardineras divisorias, estanterías, plantas y pantallas de pared.
 * Solo se dibujan (no reciben clics); los que estorban ya están bloqueados en el plano.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Mueble, Sala } from "@/lib/oficina/plano";

const sinClic = () => null;

export function Mobiliario({ sala }: { sala: Sala }) {
  const acento = useMemo(() => new THREE.Color().setHSL((sala.tipo === "nucleo" ? 195 : sala.tono) / 360, 0.75, 0.6), [sala]);
  return (
    <group>
      {sala.muebles.map((m, i) => (
        <Pieza key={i} m={m} acento={acento} />
      ))}
    </group>
  );
}

function Pieza({ m, acento }: { m: Mueble; acento: THREE.Color }) {
  const x = m.c + m.w / 2;
  const z = m.r + m.h / 2;
  switch (m.tipo) {
    case "alfombra":
      return (
        <mesh rotation-x={-Math.PI / 2} position={[x, 0.006, z]} raycast={sinClic}>
          <planeGeometry args={[m.w - 0.2, m.h - 0.2]} />
          <meshStandardMaterial color={acento.clone().multiplyScalar(0.18)} roughness={0.95} />
        </mesh>
      );
    case "pista":
      return <Pista x={x} z={z} w={m.w} h={m.h} />;
    case "sofa":
      return <Sofa x={x} z={z} w={m.w} rot={m.rot ?? 0} acento={acento} />;
    case "mesita":
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.32, 0]} raycast={sinClic}>
            <boxGeometry args={[m.w - 0.3, 0.06, m.h - 0.25]} />
            <meshStandardMaterial color="#9fd8ec" transparent opacity={0.45} metalness={0.3} roughness={0.05} />
          </mesh>
          <mesh position={[0, 0.16, 0]} raycast={sinClic}>
            <boxGeometry args={[m.w - 0.6, 0.3, 0.2]} />
            <meshStandardMaterial color="#202c38" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[-0.4, 0.4, 0]} raycast={sinClic}>
            <cylinderGeometry args={[0.07, 0.06, 0.13, 12]} />
            <meshStandardMaterial color="#f2f2f2" />
          </mesh>
        </group>
      );
    case "cafetera":
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} raycast={sinClic}>
            <boxGeometry args={[0.8, 1, 0.8]} />
            <meshStandardMaterial color="#1c2630" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 1.25, 0]} raycast={sinClic}>
            <boxGeometry args={[0.6, 0.5, 0.55]} />
            <meshStandardMaterial color="#b9c3cc" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[-0.31, 1.3, 0]} rotation-y={-Math.PI / 2} raycast={sinClic}>
            <planeGeometry args={[0.35, 0.18]} />
            <meshStandardMaterial color="#ffb347" emissive="#ff9d2e" emissiveIntensity={1.6} />
          </mesh>
          <Vapor x={-0.25} y={1.1} />
        </group>
      );
    case "dispensador":
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} raycast={sinClic}>
            <boxGeometry args={[0.55, 1, 0.55]} />
            <meshStandardMaterial color="#d9e2ea" metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.25, 0]} raycast={sinClic}>
            <cylinderGeometry args={[0.22, 0.22, 0.5, 16]} />
            <meshStandardMaterial color="#7fd7ff" transparent opacity={0.6} emissive="#2bb8ff" emissiveIntensity={0.4} />
          </mesh>
        </group>
      );
    case "mesaJuego":
      return <MesaJuego x={x} z={z} acento={acento} />;
    case "arcade":
      return <Arcade x={x} z={z} acento={acento} />;
    case "puff":
      return (
        <mesh position={[x, 0.22, z]} raycast={sinClic}>
          <sphereGeometry args={[0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.6]} />
          <meshStandardMaterial color={acento} roughness={0.8} />
        </mesh>
      );
    case "divisor":
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.3, 0]} raycast={sinClic}>
            <boxGeometry args={[0.7, 0.6, m.h - 0.1]} />
            <meshStandardMaterial color="#24313d" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.61, 0]} raycast={sinClic}>
            <boxGeometry args={[0.72, 0.02, m.h - 0.05]} />
            <meshStandardMaterial color={acento} emissive={acento} emissiveIntensity={1.2} />
          </mesh>
          {Array.from({ length: m.h }, (_, k) => (
            <mesh key={k} position={[0, 0.78, -m.h / 2 + 0.5 + k]} raycast={sinClic}>
              <sphereGeometry args={[0.32, 10, 8]} />
              <meshStandardMaterial color={k % 2 ? "#2f7d4f" : "#3c9a5f"} roughness={0.9} />
            </mesh>
          ))}
        </group>
      );
    case "planta":
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 0.3, 0]} raycast={sinClic}>
            <cylinderGeometry args={[0.28, 0.22, 0.6, 14]} />
            <meshStandardMaterial color="#e9eef2" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.0, 0]} raycast={sinClic}>
            <coneGeometry args={[0.45, 1.1, 10]} />
            <meshStandardMaterial color="#2f8a55" roughness={0.9} />
          </mesh>
          <mesh position={[0.1, 1.45, 0]} raycast={sinClic}>
            <coneGeometry args={[0.3, 0.7, 10]} />
            <meshStandardMaterial color="#3fa868" roughness={0.9} />
          </mesh>
        </group>
      );
    case "estanteria":
      return <Estanteria x={x} z={z} w={m.w} h={m.h} acento={acento} />;
    case "pantalla":
      return <PantallaPared x={x} z={m.r + 0.5} w={m.w} acento={acento} />;
  }
  return null;
}

function Sofa({ x, z, w, rot, acento }: { x: number; z: number; w: number; rot: number; acento: THREE.Color }) {
  const tela = acento.clone().multiplyScalar(0.55);
  return (
    <group position={[x, 0, z]} rotation-y={rot}>
      <mesh position={[0, 0.25, 0]} raycast={sinClic}>
        <boxGeometry args={[w - 0.1, 0.4, 0.85]} />
        <meshStandardMaterial color={tela} roughness={0.85} />
      </mesh>
      {/* respaldo detrás de quien se sienta (lado −z en el sistema del sofá) */}
      <mesh position={[0, 0.6, -0.38]} raycast={sinClic}>
        <boxGeometry args={[w - 0.1, 0.7, 0.18]} />
        <meshStandardMaterial color={tela} roughness={0.85} />
      </mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * (w / 2 - 0.12), 0.45, 0]} raycast={sinClic}>
          <boxGeometry args={[0.2, 0.5, 0.85]} />
          <meshStandardMaterial color={tela.clone().multiplyScalar(0.8)} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Vapor({ x, y }: { x: number; y: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    g.current?.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.6 + i / 3) % 1;
      c.position.y = t * 0.5;
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
    });
  });
  return (
    <group ref={g} position={[x, y, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} raycast={sinClic}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function MesaJuego({ x, z, acento }: { x: number; z: number; acento: THREE.Color }) {
  const piezas = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!piezas.current) return;
    piezas.current.rotation.y = clock.elapsedTime * 0.5;
    piezas.current.children.forEach((c, i) => (c.position.y = 0.25 + Math.sin(clock.elapsedTime * 2 + i) * 0.08));
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} raycast={sinClic}>
        <cylinderGeometry args={[0.85, 0.7, 0.8, 24]} />
        <meshStandardMaterial color="#17212b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.81, 0]} rotation-x={-Math.PI / 2} raycast={sinClic}>
        <circleGeometry args={[0.8, 32]} />
        <meshStandardMaterial color="#082030" emissive={acento} emissiveIntensity={0.6} />
      </mesh>
      <group ref={piezas} position={[0, 0.85, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.4, 0.25, Math.sin((i * Math.PI) / 2) * 0.4]} raycast={sinClic}>
            <octahedronGeometry args={[0.1]} />
            <meshStandardMaterial color="#dff8ff" emissive={i % 2 ? "#e8b04b" : "#36c9ff"} emissiveIntensity={2} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Arcade({ x, z, acento }: { x: number; z: number; acento: THREE.Color }) {
  const pantalla = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (pantalla.current) pantalla.current.emissive.setHSL((clock.elapsedTime * 0.15) % 1, 0.8, 0.5);
  });
  return (
    <group position={[x, 0, z]} rotation-y={-Math.PI / 2}>
      <mesh position={[0, 0.8, 0]} raycast={sinClic}>
        <boxGeometry args={[0.8, 1.6, 0.7]} />
        <meshStandardMaterial color="#141c26" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, 0.36]} raycast={sinClic}>
        <planeGeometry args={[0.6, 0.5]} />
        <meshStandardMaterial ref={pantalla} color="#000" emissive="#ff3fa4" emissiveIntensity={1.8} />
      </mesh>
      <mesh position={[0, 1.62, 0.1]} raycast={sinClic}>
        <boxGeometry args={[0.82, 0.12, 0.5]} />
        <meshStandardMaterial color={acento} emissive={acento} emissiveIntensity={1.5} />
      </mesh>
    </group>
  );
}

function Pista({ x, z, w, h }: { x: number; z: number; w: number; h: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.emissive.setHSL(((clock.elapsedTime * 0.2 + i * 0.27) % 1), 0.85, 0.5);
    });
  });
  const celdas: [number, number][] = [];
  for (let i = 0; i < w * 2; i++) for (let j = 0; j < h * 2; j++) celdas.push([i, j]);
  return (
    <group ref={ref} position={[x - w / 2 + 0.25, 0.008, z - h / 2 + 0.25]}>
      {celdas.map(([i, j]) => (
        <mesh key={`${i}-${j}`} rotation-x={-Math.PI / 2} position={[i * 0.5, 0, j * 0.5]} raycast={sinClic}>
          <planeGeometry args={[0.46, 0.46]} />
          <meshStandardMaterial color="#000" emissive="#ff00ff" emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Estanteria({ x, z, w, h, acento }: { x: number; z: number; w: number; h: number; acento: THREE.Color }) {
  const libros = useMemo(() => {
    const out: { p: [number, number, number]; c: string; s: [number, number, number] }[] = [];
    const largo = Math.max(w, h);
    const enX = w >= h;
    for (let nivel = 0; nivel < 3; nivel++)
      for (let k = 0; k < largo * 4; k++) {
        if ((k * 7 + nivel * 3) % 5 === 0) continue;
        const a = -largo / 2 + 0.15 + k * 0.24;
        out.push({
          p: enX ? [a, 0.32 + nivel * 0.55, 0] : [0, 0.32 + nivel * 0.55, a],
          c: ["#b3201b", "#e0a526", "#2e5c8a", "#cfd6dd", "#3d4248"][(k + nivel) % 5],
          s: enX ? [0.18, 0.38, 0.3] : [0.3, 0.38, 0.18],
        });
      }
    return out;
  }, [w, h]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.85, 0]} raycast={sinClic}>
        <boxGeometry args={[w - 0.1, 1.7, h - 0.1]} />
        <meshStandardMaterial color="#1a2430" metalness={0.6} roughness={0.5} transparent opacity={0.55} />
      </mesh>
      {libros.map((l, i) => (
        <mesh key={i} position={l.p} raycast={sinClic}>
          <boxGeometry args={l.s} />
          <meshStandardMaterial color={l.c} roughness={0.7} />
        </mesh>
      ))}
      {/* tapa oscura con un filo de luz (antes la tapa entera brillaba y se veía como un bloque blanco) */}
      <mesh position={[0, 1.71, 0]} raycast={sinClic}>
        <boxGeometry args={[w - 0.05, 0.04, h - 0.05]} />
        <meshStandardMaterial color="#121a22" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={w >= h ? [0, 1.74, h / 2 - 0.06] : [w / 2 - 0.06, 1.74, 0]} raycast={sinClic}>
        <boxGeometry args={w >= h ? [w - 0.1, 0.03, 0.04] : [0.04, 0.03, h - 0.1]} />
        <meshStandardMaterial color={acento} emissive={acento} emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/** Pantalla grande en la pared del fondo con gráficos animados (sin texto). */
function PantallaPared({ x, z, w, acento }: { x: number; z: number; w: number; acento: THREE.Color }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uT: { value: 0 }, uC: { value: acento } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `
          uniform float uT; uniform vec3 uC; varying vec2 vUv;
          void main(){
            float marco = step(0.96, max(abs(vUv.x-0.5), abs(vUv.y-0.5))*2.0);
            float col = floor(vUv.x * 12.0);
            float alto = 0.25 + 0.6 * fract(sin(col * 12.9 + floor(uT * 0.7)) * 43758.5);
            float barra = step(vUv.y, alto * step(0.5, vUv.x)) * step(0.2, fract(vUv.x * 12.0));
            float linea = smoothstep(0.02, 0.0, abs(vUv.y - (0.55 + 0.25 * sin(vUv.x * 14.0 + uT * 1.5))) ) * step(vUv.x, 0.48);
            float a = 0.25 + barra * 0.6 + linea + marco;
            gl_FragColor = vec4(uC * (0.6 + barra + linea * 1.5 + marco), a);
          }`,
      }),
    [acento],
  );
  useFrame(({ clock }) => (mat.uniforms.uT.value = clock.elapsedTime));
  return (
    <mesh material={mat} position={[x, 2.05, z]} raycast={sinClic}>
      <planeGeometry args={[w, 1.6]} />
    </mesh>
  );
}
