"use client";
/**
 * Ciudad decorativa alrededor de la Oficina: cielo con degradado y estrellas, rascacielos con ventanas
 * encendidas, balizas en las azoteas, avenidas luminosas, vehículos voladores y anuncios holográficos.
 * Es solo fondo: nada se puede tocar (raycast desactivado) y se genera siempre igual (semilla fija).
 */
import { Stars } from "@react-three/drei";
import type { Ambiente } from "@/lib/oficina/ambiente";
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

/** Torres emblemáticas (diseños originales): detrás de la oficina para que se vean desde la cámara inicial. */
function posicionesTorres(plano: Plano) {
  const cx = plano.cols / 2;
  const cz = plano.rows / 2;
  const fondo = cz - plano.rows / 2 - 30;
  return {
    vanguardia: { x: cx, z: fondo - 8 },
    aguja: { x: cx - plano.cols / 2 - 14, z: fondo + 6 },
    anillo: { x: cx + plano.cols / 2 + 14, z: fondo + 4 },
    gemelas: { x: cx + plano.cols / 4 + 6, z: fondo - 26 },
    cupula: { x: cx - plano.cols / 4 - 6, z: fondo - 24 },
  };
}

function generarEdificios(plano: Plano, cantidadMax: number): Edificio[] {
  const r = azar(20261021);
  const cx = plano.cols / 2;
  const cz = plano.rows / 2;
  const libreX = plano.cols / 2 + 9; // plaza libre alrededor de la oficina
  const libreZ = plano.rows / 2 + 9;
  const torres = Object.values(posicionesTorres(plano));
  const out: Edificio[] = [];
  const paso = 7; // manzana + calle
  for (let gx = -15; gx <= 15; gx++) {
    for (let gz = -15; gz <= 15; gz++) {
      const x = cx + gx * paso + (r() - 0.5) * 1.5;
      const z = cz + gz * paso + (r() - 0.5) * 1.5;
      if (Math.abs(x - cx) < libreX && Math.abs(z - cz) < libreZ) continue;
      if (torres.some((t) => Math.hypot(x - t.x, z - t.z) < 11)) continue; // espacio para las torres emblemáticas
      const dist = Math.hypot(x - cx, z - cz);
      if (dist > 115 || r() < 0.12) continue;
      // Bajos cerca de la oficina (no tapan la vista) y más altos hacia afuera, formando el horizonte
      const borde = Math.max(Math.abs(x - cx) - libreX, Math.abs(z - cz) - libreZ, 0);
      // la cámara llega hasta ~100: lo alto queda más allá para no meterse entre edificios
      const h = borde < 16 ? 1.5 + r() * 4 : borde < 40 ? 4 + r() * 10 : 14 + r() * 28;
      out.push({ x, z, w: 2.6 + r() * 2.6, d: 2.6 + r() * 2.6, h, tono: r() });
    }
  }
  // Los más cercanos primero: si hay que recortar (celular), se pierden los del fondo
  out.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  return out.slice(0, cantidadMax);
}

export function Ciudad({ plano, alta, ambiente }: { plano: Plano; alta: boolean; ambiente: Ambiente }) {
  const edificios = useMemo(() => generarEdificios(plano, alta ? 320 : 170), [plano, alta]);
  const cx = plano.cols / 2;
  const cz = plano.rows / 2;
  return (
    <group>
      <Cielo ambiente={ambiente} />
      {ambiente.luz < 0.6 && ambiente.clima !== "tormenta" && (
        <Stars radius={260} depth={60} count={alta ? 1500 : 700} factor={4} saturation={0} fade speed={0.4} />
      )}
      <SolLuna ambiente={ambiente} cx={cx} cz={cz} />
      <SueloCiudad cx={cx} cz={cz} luz={ambiente.luz} />
      <Plataforma plano={plano} />
      <Rascacielos edificios={edificios} luz={ambiente.luz} />
      <Balizas edificios={edificios} />
      <Vehiculos cx={cx} cz={cz} cantidad={alta ? 26 : 12} />
      <Anuncios cx={cx} cz={cz} plano={plano} />
      <TorresEmblematicas plano={plano} />
      {(ambiente.clima === "lluvia" || ambiente.clima === "tormenta") && <Lluvia plano={plano} cantidad={alta ? 2600 : 900} fuerte={ambiente.clima === "tormenta"} />}
    </group>
  );
}

/** Cúpula con degradado: azul noche arriba y un resplandor cian/ámbar en el horizonte. */
function Cielo({ ambiente }: { ambiente: Ambiente }) {
  const destino = useMemo(() => ambiente.cielo.map((c) => new THREE.Color(c)), [ambiente.cielo]);
  // Transición suave entre colores (el cambio de hora o de clima no salta de golpe)
  useFrame((_, dt) => {
    const u = mat.uniforms;
    const k = Math.min(1, dt * 1.5);
    u.cArriba.value.lerp(destino[0], k);
    u.cMedio.value.lerp(destino[1], k);
    u.cHorizonte.value.lerp(destino[2], k);
    u.cBrillo.value.lerp(destino[3], k);
  });
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
const SUELO_NOCHE = new THREE.Color("#03080e");
const SUELO_DIA = new THREE.Color("#22384a");

function SueloCiudad({ cx, cz, luz }: { cx: number; cz: number; luz: number }) {
  const suelo = useRef<THREE.MeshBasicMaterial>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    suelo.current?.color.lerp(tmp.copy(SUELO_NOCHE).lerp(SUELO_DIA, luz), Math.min(1, dt * 1.5));
  });
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
        <meshBasicMaterial ref={suelo} color="#03080e" />
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

function Rascacielos({ edificios, luz }: { edificios: Edificio[]; luz: number }) {
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
  // De día las ventanas brillan menos y las fachadas se ven más claras
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 1.5);
    for (const m of mats) {
      m.emissiveIntensity += (1.25 - luz * 0.75 - m.emissiveIntensity) * k;
      m.color.lerp(FACHADA_TMP.copy(FACHADA_NOCHE).lerp(FACHADA_DIA, luz), k);
    }
  });
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

/* ─────────────── Torres emblemáticas (originales, sin logos ni marcas) ─────────────── */

const metal = { color: "#1b2733", metalness: 0.9, roughness: 0.25 } as const;
const cristal = { color: "#1f4d66", metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 } as const;

function Luz({ color = "#7fe3ff", intensidad = 2.2 }: { color?: string; intensidad?: number }) {
  return <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensidad} toneMapped={false} />;
}

function TorresEmblematicas({ plano }: { plano: Plano }) {
  const t = useMemo(() => posicionesTorres(plano), [plano]);
  return (
    <group position={[0, SUELO_Y, 0]}>
      <Vanguardia x={t.vanguardia.x} z={t.vanguardia.z} />
      <Aguja x={t.aguja.x} z={t.aguja.z} />
      <TorreAnillo x={t.anillo.x} z={t.anillo.z} />
      <Gemelas x={t.gemelas.x} z={t.gemelas.z} />
      <Cupula x={t.cupula.x} z={t.cupula.z} />
    </group>
  );
}

/** Cuartel general: torre escalonada con aletas de luz, plataforma de aterrizaje y corona giratoria. */
function Vanguardia({ x, z }: { x: number; z: number }) {
  const corona = useRef<THREE.Group>(null);
  const faros = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (corona.current) corona.current.rotation.y = clock.elapsedTime * 0.3;
    if (faros.current) faros.current.rotation.y = clock.elapsedTime * 0.25;
  });
  const tramos: [number, number, number][] = [[12, 30, 10], [9, 26, 8], [6.5, 18, 6]];
  let y = 0;
  return (
    <group position={[x, 0, z]}>
      {tramos.map(([w, h, d], i) => {
        const base = y;
        y += h;
        return (
          <group key={i}>
            <mesh position={[0, base + h / 2, 0]} raycast={sinClic}>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial {...cristal} />
            </mesh>
            {[-1, 1].map((k) => (
              <mesh key={k} position={[k * (w / 2 + 0.05), base + h / 2, 0]} raycast={sinClic}>
                <boxGeometry args={[0.15, h * 0.96, 0.6]} />
                <Luz />
              </mesh>
            ))}
            <mesh position={[0, base + h, 0]} raycast={sinClic}>
              <boxGeometry args={[w + 0.6, 0.5, d + 0.6]} />
              <meshStandardMaterial {...metal} />
            </mesh>
          </group>
        );
      })}
      {/* plataforma de aterrizaje en voladizo */}
      <mesh position={[7, 46, 0]} raycast={sinClic}>
        <cylinderGeometry args={[3.2, 3.2, 0.4, 32]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[7, 46.21, 0]} rotation-x={-Math.PI / 2} raycast={sinClic}>
        <ringGeometry args={[2.2, 2.5, 32]} />
        <Luz color="#e8b04b" />
      </mesh>
      {/* corona */}
      <group ref={corona} position={[0, y + 4, 0]}>
        <mesh rotation-x={Math.PI / 2} raycast={sinClic}>
          <torusGeometry args={[4.2, 0.18, 10, 64]} />
          <Luz color="#e8b04b" intensidad={2.6} />
        </mesh>
        <mesh rotation-x={Math.PI / 2.4} raycast={sinClic}>
          <torusGeometry args={[3.2, 0.12, 10, 64]} />
          <Luz />
        </mesh>
      </group>
      <mesh position={[0, y + 6, 0]} raycast={sinClic}>
        <coneGeometry args={[0.5, 12, 8]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, y + 12.3, 0]} raycast={sinClic}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <Luz color="#ff4d3d" intensidad={3} />
      </mesh>
      {/* faros que barren el cielo */}
      <group ref={faros} position={[0, y + 1, 0]}>
        {[0, Math.PI].map((a) => (
          <mesh key={a} rotation={[0.55, a, 0]} position={[Math.sin(a) * 2, 18, Math.cos(a) * 2]} raycast={sinClic}>
            <coneGeometry args={[4, 40, 24, 1, true]} />
            <meshBasicMaterial color="#9fe9ff" transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Aguja retorcida: losas giradas una sobre otra con una antena luminosa. */
function Aguja({ x, z }: { x: number; z: number }) {
  const pisos = 26;
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: pisos }, (_, i) => {
        const esc = 1 - i / (pisos * 1.6);
        return (
          <group key={i} position={[0, i * 2.4 + 1.2, 0]} rotation-y={(i * Math.PI) / 36}>
            <mesh raycast={sinClic}>
              <boxGeometry args={[7 * esc, 2.2, 7 * esc]} />
              <meshStandardMaterial {...cristal} color={i % 2 ? "#1d4a63" : "#183c52"} />
            </mesh>
            <mesh position={[0, 1.12, 0]} raycast={sinClic}>
              <boxGeometry args={[7 * esc + 0.1, 0.08, 7 * esc + 0.1]} />
              <Luz color={i % 6 === 0 ? "#e8b04b" : "#36c9ff"} intensidad={1.8} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, pisos * 2.4 + 6, 0]} raycast={sinClic}>
        <cylinderGeometry args={[0.08, 0.4, 12, 8]} />
        <Luz />
      </mesh>
    </group>
  );
}

/** Torre cilíndrica con dos grandes anillos de energía girando en la parte alta. */
function TorreAnillo({ x, z }: { x: number; z: number }) {
  const anillos = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    anillos.current?.children.forEach((c, i) => (c.rotation.z = clock.elapsedTime * (i ? -0.4 : 0.3)));
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 27, 0]} raycast={sinClic}>
        <cylinderGeometry args={[3.2, 4.2, 54, 32]} />
        <meshStandardMaterial {...cristal} />
      </mesh>
      {[10, 20, 30, 40, 50].map((h) => (
        <mesh key={h} position={[0, h, 0]} raycast={sinClic}>
          <cylinderGeometry args={[4.25 - h / 54, 4.25 - h / 54, 0.25, 32]} />
          <Luz intensidad={1.4} />
        </mesh>
      ))}
      <group ref={anillos} position={[0, 46, 0]}>
        <mesh rotation-x={Math.PI / 2.2} raycast={sinClic}>
          <torusGeometry args={[7, 0.35, 12, 72]} />
          <Luz color="#36c9ff" intensidad={2.4} />
        </mesh>
        <mesh rotation-x={Math.PI / 1.8} raycast={sinClic}>
          <torusGeometry args={[5.6, 0.25, 12, 72]} />
          <Luz color="#e8b04b" intensidad={2.4} />
        </mesh>
      </group>
      <mesh position={[0, 56, 0]} raycast={sinClic}>
        <sphereGeometry args={[2, 24, 16]} />
        <meshStandardMaterial color="#dff8ff" emissive="#7fe3ff" emissiveIntensity={1.6} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

/** Dos torres unidas por un puente aéreo iluminado. */
function Gemelas({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[-5, 5].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 24, 0]} raycast={sinClic}>
            <boxGeometry args={[5, 48, 5]} />
            <meshStandardMaterial {...cristal} color="#173a50" />
          </mesh>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[(k % 2 ? 1 : -1) * 2.55, 24, (k > 1 ? 1 : -1) * 2.55]} raycast={sinClic}>
              <boxGeometry args={[0.12, 48, 0.12]} />
              <Luz color="#e8b04b" intensidad={1.6} />
            </mesh>
          ))}
          <mesh position={[0, 50, 0]} raycast={sinClic}>
            <coneGeometry args={[2.6, 4, 4]} />
            <meshStandardMaterial {...metal} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 32, 0]} raycast={sinClic}>
        <boxGeometry args={[5, 1.6, 2.4]} />
        <meshStandardMaterial {...cristal} color="#2a6f8f" />
      </mesh>
      <mesh position={[0, 31.1, 0]} raycast={sinClic}>
        <boxGeometry args={[5.2, 0.12, 2.5]} />
        <Luz />
      </mesh>
    </group>
  );
}

/** Observatorio: torre delgada rematada con una cúpula de cristal y un telescopio de luz. */
function Cupula({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.2;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 20, 0]} raycast={sinClic}>
        <cylinderGeometry args={[2.2, 3.4, 40, 24]} />
        <meshStandardMaterial {...cristal} color="#183c52" />
      </mesh>
      <mesh position={[0, 40.5, 0]} raycast={sinClic}>
        <cylinderGeometry args={[5, 5, 1, 32]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 41, 0]} raycast={sinClic}>
        <sphereGeometry args={[4.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#9fe9ff" transparent opacity={0.35} emissive="#2bb8ff" emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={ref} position={[0, 43, 0]} raycast={sinClic}>
        <cylinderGeometry args={[0.5, 0.8, 5, 12]} />
        <Luz color="#e8b04b" intensidad={1.6} />
      </mesh>
    </group>
  );
}

const FACHADA_NOCHE = new THREE.Color("#0b1724");
const FACHADA_DIA = new THREE.Color("#7f9bb4");
const FACHADA_TMP = new THREE.Color();

/** Sol de día y luna de noche, recorriendo un arco detrás de las torres según la hora real. */
function SolLuna({ ambiente, cx, cz }: { ambiente: Ambiente; cx: number; cz: number }) {
  const dia = ambiente.hora >= 6 && ambiente.hora < 18;
  // 6 h → horizonte izquierdo, 12 h → arriba, 18 h → horizonte derecho (igual la luna de 18 a 6)
  const t = (((dia ? ambiente.hora - 6 : ambiente.hora - 18 + 24) % 24) / 12) * Math.PI;
  const R = 330;
  const x = cx - Math.cos(t) * R * 0.75;
  const y = Math.max(-20, Math.sin(t) * R * 0.55) + 10;
  const z = cz - R * 0.62;
  const oculto = ambiente.clima === "tormenta" || ambiente.clima === "lluvia" || ambiente.clima === "niebla";
  const halo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 uColor; varying vec2 vUv; void main(){ float d = length(vUv-0.5)*2.0; float a = smoothstep(1.0,0.0,d); a = a*a*0.55 + smoothstep(0.24,0.2,d); gl_FragColor = vec4(uColor*a, a); }",
      }),
    [],
  );
  halo.uniforms.uColor.value.set(dia ? (ambiente.fase === "dia" ? "#fff1c9" : "#ffb35c") : "#cfe6ff");
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => ref.current?.quaternion.copy(camera.quaternion));
  if (oculto) return null;
  return (
    <mesh ref={ref} position={[x, y, z]} material={halo} raycast={sinClic} renderOrder={-1}>
      <planeGeometry args={[dia ? 90 : 60, dia ? 90 : 60]} />
    </mesh>
  );
}

/**
 * Lluvia sobre la ciudad (cuando llueve de verdad): segmentos que caen en la GPU (sin trabajo por fotograma
 * en la CPU). No llueve dentro de la oficina: tiene techo de cristal invisible.
 */
function Lluvia({ plano, cantidad, fuerte }: { plano: Plano; cantidad: number; fuerte: boolean }) {
  const { geo, mat } = useMemo(() => {
    const r = azar(99);
    const pos: number[] = [];
    const ext: number[] = [];
    const cx = plano.cols / 2;
    const cz = plano.rows / 2;
    let n = 0;
    while (n < cantidad) {
      const x = cx + (r() - 0.5) * 220;
      const z = cz + (r() - 0.5) * 220;
      if (x > -3 && x < plano.cols + 3 && z > -3 && z < plano.rows + 3) continue;
      const y = r() * 70;
      pos.push(x, y, z, x, y, z);
      ext.push(0, 1);
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("extremo", new THREE.Float32BufferAttribute(ext, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uT: { value: 0 }, uVel: { value: fuerte ? 42 : 30 }, uAlpha: { value: fuerte ? 0.55 : 0.4 } },
      vertexShader: `
        attribute float extremo; uniform float uT; uniform float uVel; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uT * uVel, 70.0) - 6.0;
          p.y += extremo * 1.1; p.x += extremo * 0.12;
          vA = extremo;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: "uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(0.65, 0.85, 1.0, uAlpha * (0.3 + vA)); }",
    });
    return { geo: g, mat: m };
  }, [plano, cantidad, fuerte]);
  const destello = useRef<THREE.PointLight>(null);
  const proximo = useRef(0);
  useFrame(({ clock }) => {
    mat.uniforms.uT.value = clock.elapsedTime;
    // Relámpagos en tormenta: un destello breve cada pocos segundos
    const l = destello.current;
    if (!l) return;
    const t = clock.elapsedTime;
    if (fuerte && t > proximo.current) {
      proximo.current = t + 4 + Math.random() * 8;
      l.position.set(plano.cols / 2 + (Math.random() - 0.5) * 200, 90, plano.rows / 2 - 140 - Math.random() * 60);
      l.intensity = 900;
    }
    l.intensity *= 0.86;
  });
  return (
    <group>
      <lineSegments geometry={geo} material={mat} raycast={sinClic} frustumCulled={false} />
      {fuerte && <pointLight ref={destello} color="#cfe6ff" intensity={0} distance={400} decay={1} />}
    </group>
  );
}
