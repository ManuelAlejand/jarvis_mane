"use client";
/**
 * Efectos vivos de la Oficina: haces de datos (escritorio activo → Núcleo), chispas al terminar, destello rojo al
 * fallar, aura de voz de JARVIS (escucha / piensa / habla) y proyectos orbitando la mesa holográfica.
 * Todo se calcula en la GPU o con un solo objeto por tipo para no bajar los FPS.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Mundo } from "@/lib/oficina/mundo";
import type { Plano, Puesto } from "@/lib/oficina/plano";

const sinClic = () => null;

/** Material de los haces: pulsos de luz que viajan por el tubo hacia el Núcleo. */
function materialHaz(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      uniform float uT; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float p = fract(vUv.x * 4.0 - uT * 0.9);
        float pulso = smoothstep(0.0, 0.08, p) * smoothstep(0.28, 0.08, p);
        float bordes = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        float a = (0.1 + pulso * 0.9) * bordes;
        gl_FragColor = vec4(uColor * (0.6 + pulso * 1.6), a);
      }`,
  });
}

/** Un arco de datos desde el monitor de cada escritorio activo hasta la mesa holográfica del Núcleo. */
export function HacesDatos({ plano, encendidos }: { plano: Plano; encendidos: Set<Puesto> }) {
  const nucleo = plano.salas.find((s) => s.tipo === "nucleo");
  const mat = useMemo(() => materialHaz("#5fd4ff"), []);
  const matOro = useMemo(() => materialHaz("#e8b04b"), []);
  // Clave estable: el Set llega nuevo en cada render, pero los arcos solo cambian si cambian los escritorios activos
  const clave = plano.salas
    .flatMap((sala) => (sala.tipo === "nucleo" ? [] : sala.puestos.map((p, i) => (encendidos.has(p) ? `${sala.slug}:${i}` : ""))))
    .filter(Boolean)
    .join("|");
  const arcos = useMemo(() => {
    if (!nucleo?.holo) return [];
    const destino = new THREE.Vector3(nucleo.holo.c + 1, 1.7, nucleo.holo.r + 1);
    const out: { clave: string; geo: THREE.TubeGeometry; oro: boolean }[] = [];
    for (const sala of plano.salas) {
      if (sala.tipo === "nucleo") continue;
      sala.puestos.forEach((p, i) => {
        if (!encendidos.has(p)) return;
        const desde = new THREE.Vector3(p.mesa.c + 1.5, 1.6, p.mesa.r + 0.65);
        const medio = desde.clone().lerp(destino, 0.5);
        medio.y += 3 + desde.distanceTo(destino) * 0.18;
        const curva = new THREE.QuadraticBezierCurve3(desde, medio, destino);
        out.push({ clave: `${sala.slug}:${i}`, geo: new THREE.TubeGeometry(curva, 64, 0.035, 5, false), oro: i === 0 });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano, clave, nucleo]);
  useEffect(() => () => arcos.forEach((a) => a.geo.dispose()), [arcos]);
  useFrame(({ clock }) => {
    mat.uniforms.uT.value = clock.elapsedTime;
    matOro.uniforms.uT.value = clock.elapsedTime + 0.4;
  });
  return (
    <group>
      {arcos.map((a) => (
        <mesh key={a.clave} geometry={a.geo} material={a.oro ? matOro : mat} raycast={sinClic} renderOrder={2} />
      ))}
    </group>
  );
}

const POR_EFECTO = 36;
const MAX_EFECTOS = 24;
const VIDA = 2.2; // segundos

/** Chispas (ok), anillo rojo con interferencia (error) y pulso cian (entrega). Un solo objeto Points para todos. */
export function Chispas({ mundo }: { mundo: Mundo }) {
  const total = POR_EFECTO * MAX_EFECTOS;
  const { geo, vel } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3).fill(-999), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    const v = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.6 + Math.random() * 1.6;
      v[i * 3] = Math.cos(ang) * rad;
      v[i * 3 + 1] = 2 + Math.random() * 3.2;
      v[i * 3 + 2] = Math.sin(ang) * rad;
    }
    return { geo: g, vel: v };
  }, [total]);
  const c = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const ahora = performance.now();
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    P.fill(-999);
    mundo.efectos = mundo.efectos.filter((e) => (ahora - e.t0) / 1000 < VIDA);
    mundo.efectos.forEach((e, k) => {
      const a = (ahora - e.t0) / 1000;
      const vida = 1 - a / VIDA;
      for (let j = 0; j < POR_EFECTO; j++) {
        const i = k * POR_EFECTO + j;
        const ang = (j / POR_EFECTO) * Math.PI * 2;
        if (e.tipo === "ok") {
          P[i * 3] = e.x + vel[i * 3] * a;
          P[i * 3 + 1] = 1.4 + vel[i * 3 + 1] * a - 4.2 * a * a;
          P[i * 3 + 2] = e.z + vel[i * 3 + 2] * a;
          c.set(j % 3 === 0 ? "#ffd36b" : "#7fe3ff");
        } else if (e.tipo === "error") {
          const r = 0.3 + a * 1.6 + (Math.random() - 0.5) * 0.12; // anillo que se expande con interferencia
          P[i * 3] = e.x + Math.cos(ang) * r;
          P[i * 3 + 1] = 0.15 + (j % 4) * 0.35 + Math.random() * 0.08;
          P[i * 3 + 2] = e.z + Math.sin(ang) * r;
          c.set("#ff4d3d");
        } else {
          const r = 0.2 + a * 1.1;
          P[i * 3] = e.x + Math.cos(ang) * r;
          P[i * 3 + 1] = 0.08;
          P[i * 3 + 2] = e.z + Math.sin(ang) * r;
          c.set("#9fe9ff");
        }
        C[i * 3] = c.r * vida;
        C[i * 3 + 1] = c.g * vida;
        C[i * 3 + 2] = c.b * vida;
      }
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <points geometry={geo} raycast={sinClic} frustumCulled={false}>
      <pointsMaterial size={0.13} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  );
}

/** Aura del holograma de JARVIS según la voz: ondas al escuchar, anillo dorado al pensar, ecualizador al hablar. */
export function AuraJarvis({ mundo }: { mundo: Mundo }) {
  const grupo = useRef<THREE.Group>(null);
  const ondas = useRef<THREE.Group>(null);
  const piensa = useRef<THREE.Group>(null);
  const barras = useRef<THREE.InstancedMesh>(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  const N = 28;
  useFrame(({ clock }) => {
    const r = mundo.robots.get("jarvis");
    const g = grupo.current;
    if (!g) return;
    g.visible = !!r && mundo.voz !== "normal";
    if (!r || !g.visible) return;
    g.position.set(r.x, 0, r.z);
    const t = clock.elapsedTime;
    if (ondas.current) {
      ondas.current.visible = mundo.voz === "escuchando";
      ondas.current.children.forEach((m, i) => {
        const f = (t * 0.8 + i / 3) % 1;
        m.scale.setScalar(0.4 + f * 1.8);
        ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.8;
      });
    }
    if (piensa.current) {
      piensa.current.visible = mundo.voz === "pensando";
      piensa.current.rotation.y = t * 4;
      piensa.current.rotation.x = Math.sin(t * 2) * 0.3;
    }
    const b = barras.current;
    if (b) {
      b.visible = mundo.voz === "hablando";
      for (let i = 0; i < N; i++) {
        const ang = (i / N) * Math.PI * 2;
        const h = 0.08 + Math.abs(Math.sin(t * 9 + i * 1.7) * Math.sin(t * 5.3 + i)) * 0.55;
        o.position.set(Math.cos(ang) * 0.75, 0.9 + h / 2, Math.sin(ang) * 0.75);
        o.rotation.set(0, -ang, 0);
        o.scale.set(1, h, 1);
        o.updateMatrix();
        b.setMatrixAt(i, o.matrix);
      }
      b.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group ref={grupo} visible={false}>
      <group ref={ondas}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.05, 0]} raycast={sinClic}>
            <ringGeometry args={[0.5, 0.56, 48]} />
            <meshBasicMaterial color="#7fe3ff" transparent opacity={0.6} toneMapped={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <group ref={piensa} position={[0, 1.15, 0]}>
        <mesh raycast={sinClic}>
          <torusGeometry args={[0.7, 0.02, 8, 64, Math.PI * 1.4]} />
          <meshBasicMaterial color="#e8b04b" toneMapped={false} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI * 2) / 3) * 0.7, 0, Math.sin((i * Math.PI * 2) / 3) * 0.7]} raycast={sinClic}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshBasicMaterial color="#ffd36b" toneMapped={false} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={barras} args={[undefined, undefined, N]} raycast={sinClic}>
        <boxGeometry args={[0.05, 1, 0.05]} />
        <meshBasicMaterial color="#9fe9ff" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export interface ProyectoHolo {
  slug: string;
  tono: number;
  /** 0-100 */
  avance: number;
  activo: boolean;
}

/** Sobre la mesa holográfica del Núcleo: cada proyecto es una esfera que orbita (más grande = más avance). */
export function OrbitaProyectos({ x, z, proyectos }: { x: number; z: number; proyectos: ProyectoHolo[] }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    g.current?.children.forEach((m, i) => {
      const n = Math.max(1, proyectos.length);
      const ang = t * (0.35 + (i % 3) * 0.08) + (i / n) * Math.PI * 2;
      const r = 1.05 + (i % 2) * 0.25;
      m.position.set(Math.cos(ang) * r, 1.55 + Math.sin(t * 1.3 + i) * 0.12, Math.sin(ang) * r);
    });
  });
  return (
    <group ref={g} position={[x, 0, z]}>
      {proyectos.map((p) => {
        const color = new THREE.Color().setHSL(p.tono / 360, 0.75, 0.62);
        return (
          <mesh key={p.slug} raycast={sinClic}>
            <sphereGeometry args={[0.07 + (p.avance / 100) * 0.1, 16, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={p.activo ? 2.4 : 0.8} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}
