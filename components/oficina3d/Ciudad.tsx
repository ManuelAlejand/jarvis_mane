"use client";
/**
 * Ciudad decorativa alrededor de la Oficina: cielo con degradado y estrellas, rascacielos con ventanas
 * encendidas, balizas en las azoteas, avenidas luminosas, vehículos voladores y anuncios holográficos.
 * Es solo fondo: nada se puede tocar (raycast desactivado) y se genera siempre igual (semilla fija).
 */
import { Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Plano } from "@/lib/oficina/plano";

const sinClic = () => null; // los objetos del fondo no reciben clics
const SUELO_Y = -0.6;

function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Textura de ventanas: cuadrícula de ventanas con algunas encendidas (cian, ámbar o blancas). */
function texturaVentanas(semilla: number) {
  const r = azar(semilla);
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000000";
  g.fillRect(0, 0, 64, 128);
  const colores = ["#7fe3ff", "#ffc56b", "#e9f6ff", "#5fb0ff"];
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (r() < 0.38) {
        g.fillStyle = colores[Math.floor(r() * colores.length)];
        g.globalAlpha = 0.45 + r() * 0.55;
        g.fillRect(x, y, 5, 4);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

interface Edificio {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  tono: number;
}

function generarEdificios(plano: Plano, cantidadMax: number): Edificio[] {
  const r = azar(20261021);
  const cx = plano.cols / 2;
  const cz = plano.rows / 2;
  const libreX = plano.cols / 2 + 9; // plaza libre alrededor de la oficina
  const libreZ = plano.rows / 2 + 9;
  const out: Edificio[] = [];
  const paso = 7; // manzana + calle
  for (let gx = -15; gx <= 15; gx++) {
    for (let gz = -15; gz <= 15; gz++) {
      const x = cx + gx * paso + (r() - 0.5) * 1.5;
      const z = cz + gz * paso + (r() - 0.5) * 1.5;
      if (Math.abs(x - cx) < libreX && Math.abs(z - cz) < libreZ) continue;
      const dist = Math.hypot(x - cx, z - cz);
      if (dist > 105 || r() < 0.12) continue;
      // Bajos cerca de la oficina (no tapan la vista) y más altos hacia afuera, formando el horizonte
      const borde = Math.max(Math.abs(x - cx) - libreX, Math.abs(z - cz) - libreZ, 0);
      const h = borde < 14 ? 1.5 + r() * 4 : borde < 30 ? 5 + r() * 14 : 14 + r() * 30 + (r() < 0.08 ? 28 : 0);
      out.push({ x, z, w: 2.6 + r() * 2.6, d: 2.6 + r() * 2.6, h, tono: r() });
    }
  }
  // Los más cercanos primero: si hay que recortar (celular), se pierden los del fondo
  out.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  return out.slice(0, cantidadMax);
}

export function Ciudad({ plano, alta }: { plano: Plano; alta: boolean }) {
  const edificios = useMemo(() => generarEdificios(plano, alta ? 320 : 170), [plano, alta]);
  const cx = plano.cols / 2;
  const cz = plano.rows / 2;
  return (
    <group>
      <Cielo />
      <Stars radius={260} depth={60} count={alta ? 1500 : 700} factor={4} saturation={0} fade speed={0.4} />
      <SueloCiudad cx={cx} cz={cz} />
      <Plataforma plano={plano} />
      <Rascacielos edificios={edificios} />
      <Balizas edificios={edificios} />
      <Vehiculos cx={cx} cz={cz} cantidad={alta ? 26 : 12} />
      <Anuncios cx={cx} cz={cz} plano={plano} />
    </group>
  );
}

/** Cúpula con degradado: azul noche arriba y un resplandor cian/ámbar en el horizonte. */
function Cielo() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          cArriba: { value: new THREE.Color("#02060d") },
          cMedio: { value: new THREE.Color("#071a2b") },
          cHorizonte: { value: new THREE.Color("#0f4d66") },
          cBrillo: { value: new THREE.Color("#c27a2c") },
        },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `
          uniform vec3 cArriba; uniform vec3 cMedio; uniform vec3 cHorizonte; uniform vec3 cBrillo;
          varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 c = mix(cHorizonte, cMedio, smoothstep(0.0, 0.18, h));
            c = mix(c, cArriba, smoothstep(0.18, 0.7, h));
            c += cBrillo * 0.25 * exp(-abs(h) * 22.0);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );
  return (
    <mesh material={mat} raycast={sinClic} renderOrder={-1}>
      <sphereGeometry args={[380, 32, 16]} />
    </mesh>
  );
}

/** Suelo de la ciudad con calles y avenidas luminosas. */
function SueloCiudad({ cx, cz }: { cx: number; cz: number }) {
  const { calles, avenidas } = useMemo(() => {
    const c: number[] = [];
    const a: number[] = [];
    const L = 120;
    for (let k = -17; k <= 17; k++) {
      const off = k * 7 + 3.5;
      const lista = k % 4 === 0 ? a : c;
      lista.push(cx - L, 0, cz + off, cx + L, 0, cz + off);
      lista.push(cx + off, 0, cz - L, cx + off, 0, cz + L);
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute("position", new THREE.Float32BufferAttribute(c, 3));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(a, 3));
    return { calles: g1, avenidas: g2 };
  }, [cx, cz]);
  return (
    <group position={[0, SUELO_Y + 0.01, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.01, cz]} raycast={sinClic}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial color="#03080e" />
      </mesh>
      <lineSegments geometry={calles} raycast={sinClic}>
        <lineBasicMaterial color="#1b5f7a" transparent opacity={0.45} />
      </lineSegments>
      <lineSegments geometry={avenidas} raycast={sinClic}>
        <lineBasicMaterial color="#ffb347" transparent opacity={0.7} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Base elevada de la oficina, con un borde de luz que la separa de la ciudad. */
function Plataforma({ plano }: { plano: Plano }) {
  const w = plano.cols + 4;
  const d = plano.rows + 4;
  return (
    <group position={[plano.cols / 2, 0, plano.rows / 2]}>
      <mesh position={[0, SUELO_Y / 2 - 0.02, 0]} raycast={sinClic}>
        <boxGeometry args={[w, -SUELO_Y, d]} />
        <meshStandardMaterial color="#0a1520" metalness={0.8} roughness={0.35} />
      </mesh>
      {[
        [0, -d / 2, w, 0.08],
        [0, d / 2, w, 0.08],
        [-w / 2, 0, 0.08, d],
        [w / 2, 0, 0.08, d],
      ].map(([x, z, bw, bd], i) => (
        <mesh key={i} position={[x, -0.03, z]} raycast={sinClic}>
          <boxGeometry args={[bw, 0.06, bd]} />
          <meshStandardMaterial color="#7fe3ff" emissive="#2bb8ff" emissiveIntensity={2} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Rascacielos({ edificios }: { edificios: Edificio[] }) {
  const mats = useMemo(() => {
    const ventanas = [texturaVentanas(7), texturaVentanas(11)];
    return ventanas.map((tex) => {
      // Lambert: mucho más barato que el material físico y a esta distancia se ve igual
      const m = new THREE.MeshLambertMaterial({ color: "#0b1724", emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 1.25 });
      // Repite las ventanas según el tamaño de cada edificio (si no, se estiran en los altos)
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
           #if defined(USE_INSTANCING) && defined(USE_EMISSIVEMAP)
             vec2 escala = vec2(max(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)), length(instanceMatrix[1].xyz));
             vEmissiveMapUv *= escala * vec2(0.32, 0.16);
             if (abs(normal.y) > 0.5) vEmissiveMapUv = vec2(0.0); // azoteas sin ventanas
           #endif`,
        );
      };
      return m;
    });
  }, []);
  // Dos grupos con texturas distintas para que no se vean iguales
  const grupos = useMemo(() => [edificios.filter((_, i) => i % 2 === 0), edificios.filter((_, i) => i % 2 === 1)], [edificios]);
  return (
    <>
      {grupos.map((lista, k) => (
        <BloqueEdificios key={k} lista={lista} material={mats[k]} />
      ))}
    </>
  );
}

function BloqueEdificios({ lista, material }: { lista: Edificio[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    lista.forEach((e, i) => {
      o.position.set(e.x, SUELO_Y + e.h / 2, e.z);
      o.scale.set(e.w, e.h, e.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      col.setHSL(0.55 + e.tono * 0.1, 0.25, 0.08 + e.tono * 0.06);
      m.setColorAt(i, col);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [lista]);
  // Las ventanas se repiten según el tamaño: se escala la textura en el shader con la altura del edificio
  return (
    <instancedMesh ref={ref} args={[undefined, material, lista.length]} raycast={sinClic} key={lista.length}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

/** Luces rojas parpadeantes en las azoteas de los edificios altos. */
function Balizas({ edificios }: { edificios: Edificio[] }) {
  const altos = useMemo(() => edificios.filter((e) => e.h > 18), [edificios]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    altos.forEach((e, i) => {
      o.position.set(e.x, SUELO_Y + e.h + 0.35, e.z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [altos]);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(clock.elapsedTime * 2.2));
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, altos.length)]} raycast={sinClic} key={altos.length}>
      <sphereGeometry args={[0.28, 8, 8]} />
      <meshBasicMaterial ref={mat} color="#ff4d3d" transparent toneMapped={false} />
    </instancedMesh>
  );
}

/** Vehículos voladores en órbitas a distintas alturas y radios. */
function Vehiculos({ cx, cz, cantidad }: { cx: number; cz: number; cantidad: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const rutas = useMemo(() => {
    const r = azar(99);
    return Array.from({ length: cantidad }, () => ({
      radio: 30 + r() * 60,
      alto: 6 + r() * 22,
      vel: (0.04 + r() * 0.06) * (r() < 0.5 ? -1 : 1),
      fase: r() * Math.PI * 2,
      ovalo: 0.6 + r() * 0.5,
    }));
  }, [cantidad]);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    rutas.forEach((v, i) => {
      const a = v.fase + t * v.vel;
      const x = cx + Math.cos(a) * v.radio;
      const z = cz + Math.sin(a) * v.radio * v.ovalo;
      const ad = a + 0.05 * Math.sign(v.vel);
      o.position.set(x, v.alto + Math.sin(t * 0.8 + v.fase) * 0.6, z);
      o.lookAt(cx + Math.cos(ad) * v.radio, v.alto, cz + Math.sin(ad) * v.radio * v.ovalo);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cantidad]} raycast={sinClic} frustumCulled={false}>
      <capsuleGeometry args={[0.18, 0.9, 4, 8]} />
      <meshStandardMaterial color="#dff8ff" emissive="#5fd4ff" emissiveIntensity={2.4} toneMapped={false} />
    </instancedMesh>
  );
}

/** Pantallas holográficas gigantes flotando sobre la ciudad (ondas animadas, sin texto). */
function Anuncios({ cx, cz, plano }: { cx: number; cz: number; plano: Plano }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color("#36c9ff") } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `
          uniform float uT; uniform vec3 uColor; varying vec2 vUv;
          void main(){
            float borde = step(0.97, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
            float onda = 0.5 + 0.5 * sin(vUv.x * 18.0 - uT * 2.0 + sin(vUv.y * 6.0 + uT));
            float barras = step(0.6, fract(vUv.x * 9.0)) * step(vUv.y, 0.25 + 0.6 * fract(sin(floor(vUv.x * 9.0) * 12.9 + floor(uT)) * 43758.5));
            float lineas = 0.6 + 0.4 * step(0.5, fract(vUv.y * 40.0 - uT * 3.0));
            float a = (0.12 + 0.25 * onda * step(0.5, vUv.y) + 0.5 * barras + borde) * lineas;
            gl_FragColor = vec4(uColor * (1.2 + borde), a * 0.85);
          }`,
      }),
    [],
  );
  const mat2 = useMemo(() => {
    const m = mat.clone();
    m.uniforms.uColor = { value: new THREE.Color("#ffb347") };
    return m;
  }, [mat]);
  useFrame(({ clock }) => {
    mat.uniforms.uT.value = clock.elapsedTime;
    mat2.uniforms.uT.value = clock.elapsedTime + 3;
  });
  const lejos = Math.max(plano.cols, plano.rows) / 2 + 22;
  return (
    <group>
      <mesh material={mat} position={[cx - lejos, 16, cz - lejos * 0.6]} rotation-y={Math.PI / 4} raycast={sinClic}>
        <planeGeometry args={[16, 9]} />
      </mesh>
      <mesh material={mat2} position={[cx + lejos, 20, cz - lejos * 0.7]} rotation-y={-Math.PI / 4} raycast={sinClic}>
        <planeGeometry args={[14, 8]} />
      </mesh>
      <mesh material={mat} position={[cx, 26, cz - lejos - 14]} raycast={sinClic}>
        <planeGeometry args={[22, 7]} />
      </mesh>
    </group>
  );
}
