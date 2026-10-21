"use client";
/**
 * Escena 3D de la Oficina (three.js + React Three Fiber + drei, MIT).
 * Robot: "RobotExpressive" de Tomás Laulhé / Quaternius (CC0), del repositorio de ejemplos de three.js.
 */
import { OrbitControls, Sparkles, useAnimations, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type React from "react";
import * as THREE from "three";
import { clone as clonarEsqueleto } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import type { Anim, Mundo } from "@/lib/oficina/mundo";
import type { Plano, Puesto, Sala } from "@/lib/oficina/plano";

const ROBOT_URL = "/oficina3d/robot.glb";
const ALTURA_ROBOT = 1.6;

/** Armaduras estilo Iron Man: [principal, secundario] */
const ARMADURAS: [string, string][] = [
  ["#b3201b", "#e0a526"], // Mark clásico
  ["#e0a526", "#9c1c17"], // dorado
  ["#8f98a3", "#b3201b"], // plata
  ["#3d4248", "#9aa3ad"], // War Machine
  ["#7a1212", "#cfd6dd"], // granate
  ["#2e5c8a", "#cfd6dd"], // acero azul
];

export interface InfoRobot {
  slug: string;
  nombre: string;
  emoji: string | null;
  lider: boolean;
  esJarvis: boolean;
  trabajando: boolean;
  armadura: number;
  globo: { texto: string; tipo: "trabajo" | "ok" | "error" | "frase" } | null;
  seleccionado: boolean;
}

export interface InfoSala {
  slug: string;
  contenido: ReactNode;
}

interface Props {
  plano: Plano;
  mundo: Mundo;
  robots: InfoRobot[];
  paredes: InfoSala[];
  puestosEncendidos: Set<Puesto>;
  onSeleccionar: (slug: string | null) => void;
  enfocar: string | null;
  ajustarClave: number;
}

/** Etiquetas HTML ancladas a puntos 3D: se mueven en cada fotograma sin re-renderizar React. */
type Anclas = Map<string, HTMLDivElement>;

/** PC con mouse y pantalla grande: brillo (bloom) y más partículas. Celular: versión ligera. */
function calidadAlta() {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(pointer: coarse)").matches && window.innerWidth >= 900;
}

export function Escena(props: Props) {
  const anclas = useRef<Anclas>(new Map());
  const alta = useMemo(calidadAlta, []);
  const registrar = (clave: string) => (el: HTMLDivElement | null) => {
    if (el) anclas.current.set(clave, el);
    else anclas.current.delete(clave);
  };
  return (
    <>
    <Canvas
      dpr={alta ? [1, 1.75] : [1, 1.5]}
      camera={{ fov: 38, near: 0.1, far: 300, position: [20, 22, 40] }}
      gl={{ antialias: true }}
      onPointerMissed={() => props.onSeleccionar(null)}
    >
      <color attach="background" args={["#050c14"]} />
      <fog attach="fog" args={["#050c14", 45, 120]} />
      <ambientLight intensity={0.6} color="#a9d2ff" />
      <hemisphereLight args={["#d6f0ff", "#0a1220", 0.9]} />
      <directionalLight position={[15, 30, 22]} intensity={1.8} />
      <directionalLight position={[-20, 15, -10]} intensity={0.5} color="#5fb8ff" />
      <Contenido {...props} alta={alta} />
      <Proyector plano={props.plano} mundo={props.mundo} anclas={anclas} />
      {alta && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} />
          <Vignette eskil={false} offset={0.25} darkness={0.55} />
        </EffectComposer>
      )}
    </Canvas>
    <div className="oficina-capa">
      {props.plano.salas.map((sala) => (
        <div key={sala.slug} ref={registrar(`pared:${sala.slug}`)} className="ancla">
          <div className={`pared ${sala.tipo}`}>{props.paredes.find((p) => p.slug === sala.slug)?.contenido}</div>
        </div>
      ))}
      {props.robots.map((r) => (
        <div key={r.slug} ref={registrar(`robot:${r.slug}`)} className="ancla">
          <div className="agente-capa">
            {r.globo && <div className={`globo ${r.globo.tipo}`}>{r.globo.texto}</div>}
            <div
              className={`nombre ${r.esJarvis ? "jarvis" : ""} ${r.seleccionado ? "sel" : ""} ${r.globo?.tipo === "trabajo" ? "activo" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => props.onSeleccionar(r.slug)}
              onKeyDown={(e) => e.key === "Enter" && props.onSeleccionar(r.slug)}
            >
              {r.esJarvis ? "J.A.R.V.I.S." : `${r.emoji ? `${r.emoji} ` : ""}${r.nombre}`}
              {r.lider && <span className="corona" aria-label="líder">★</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

function Proyector({ plano, mundo, anclas }: { plano: Plano; mundo: Mundo; anclas: React.MutableRefObject<Anclas> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [clave, el] of anclas.current) {
      const [tipo, slug] = clave.split(":");
      if (tipo === "robot") {
        const r = mundo.robots.get(slug);
        if (!r) continue;
        v.set(r.x, ALTURA_ROBOT + 0.2 + (slug === "jarvis" ? 0.1 : 0), r.z);
      } else {
        const sala = plano.salas.find((x) => x.slug === slug);
        if (!sala) continue;
        v.set(sala.c0 + sala.w / 2, 1.3, sala.r0 - 0.5);
      }
      const dist = camera.position.distanceTo(v);
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) {
        el.style.display = "none";
        continue;
      }
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const escala = THREE.MathUtils.clamp((tipo === "robot" ? 16 : 26) / dist, 0.45, 1.4);
      el.style.display = "";
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${escala})`;
      el.style.zIndex = String(1000 - Math.round(dist));
    }
  });
  return null;
}

function Contenido({ plano, mundo, robots, puestosEncendidos, onSeleccionar, enfocar, ajustarClave, alta }: Props & { alta: boolean }) {
  const centro = useMemo(() => new THREE.Vector3(plano.cols / 2, 0, plano.rows / 2), [plano]);
  return (
    <>
      <Camara plano={plano} centro={centro} mundo={mundo} enfocar={enfocar} ajustarClave={ajustarClave} />
      <Suelo plano={plano} />
      <Paredes plano={plano} />
      {plano.salas.map((s) => (
        <group key={s.slug}>
          {s.puestos.map((p, i) => (
            <Escritorio key={i} puesto={p} encendido={puestosEncendidos.has(p)} nucleo={s.tipo === "nucleo"} />
          ))}
          {s.holo && <MesaHolografica sala={s} />}
          {s.holo && (
            <Sparkles count={alta ? 60 : 25} scale={[5, 2.5, 5]} size={2.5} speed={0.35} color="#7fe3ff" position={[s.holo.c + 1, 1.5, s.holo.r + 1]} />
          )}
        </group>
      ))}
      <Suspense fallback={null}>
        {robots.map((r) => (
          <RobotAgente key={r.slug} info={r} mundo={mundo} onSeleccionar={onSeleccionar} />
        ))}
      </Suspense>
      <MotorMundo mundo={mundo} />
      <RelojHolograma />
    </>
  );
}

function MotorMundo({ mundo }: { mundo: Mundo }) {
  useFrame((_, dt) => mundo.paso(Math.min(dt, 0.1)));
  return null;
}

function Camara({ plano, centro, mundo, enfocar, ajustarClave }: { plano: Plano; centro: THREE.Vector3; mundo: Mundo; enfocar: string | null; ajustarClave: number }) {
  const controles = useRef<OrbitImpl>(null);
  const { camera, size } = useThree();
  const siguiendo = useRef<string | null>(null);

  // Encuadre inicial: todo el edificio visible desde arriba y en diagonal
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const aspecto = size.width / Math.max(1, size.height);
    const mediaV = THREE.MathUtils.degToRad(persp.fov / 2);
    const ancho = plano.cols * 1.12;
    const fondo = plano.rows * 1.15;
    const d = Math.max(ancho / 2 / (Math.tan(mediaV) * aspecto), fondo / 2 / Math.tan(mediaV));
    const dir = new THREE.Vector3(0, 1.0, 0.62).normalize();
    camera.position.copy(centro).addScaledVector(dir, d);
    controles.current?.target.copy(centro);
    controles.current?.update();
    siguiendo.current = null;
  }, [camera, size.width, size.height, plano, centro, ajustarClave]);

  useEffect(() => {
    siguiendo.current = enfocar;
  }, [enfocar]);

  useFrame(() => {
    const c = controles.current;
    const slug = siguiendo.current;
    if (!c || !slug) return;
    const r = mundo.robots.get(slug);
    if (!r) return;
    const objetivo = new THREE.Vector3(r.x, 0.6, r.z);
    const delta = objetivo.clone().sub(c.target).multiplyScalar(0.08);
    c.target.add(delta);
    camera.position.add(delta);
    // acercarse un poco si está muy lejos
    const dist = camera.position.distanceTo(c.target);
    if (dist > 14) camera.position.lerp(c.target, 0.03);
    c.update();
  });

  return (
    <OrbitControls
      ref={controles}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={1.2}
      minDistance={4}
      maxDistance={120}
      onStart={() => (siguiendo.current = null)}
    />
  );
}

function Suelo({ plano }: { plano: Plano }) {
  const lineas = useMemo(() => {
    const pts: number[] = [];
    for (let c = 0; c <= plano.cols; c++) pts.push(c, 0.012, 0, c, 0.012, plano.rows);
    for (let r = 0; r <= plano.rows; r++) pts.push(0, 0.012, r, plano.cols, 0.012, r);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [plano]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[plano.cols / 2, -0.01, plano.rows / 2]}>
        <planeGeometry args={[plano.cols + 6, plano.rows + 6]} />
        <meshStandardMaterial color="#070f18" metalness={0.6} roughness={0.7} />
      </mesh>
      {plano.salas.map((s) => (
        <mesh key={s.slug} rotation-x={-Math.PI / 2} position={[s.c0 + s.w / 2, 0, s.r0 + s.h / 2]}>
          <planeGeometry args={[s.w, s.h]} />
          <meshStandardMaterial
            color={s.tipo === "nucleo" ? "#103a4f" : new THREE.Color().setHSL(s.tono / 360, 0.22, 0.16)}
            metalness={0.7}
            roughness={0.45}
          />
        </mesh>
      ))}
      <lineSegments geometry={lineas}>
        <lineBasicMaterial color="#1f6f8f" transparent opacity={0.25} />
      </lineSegments>
    </group>
  );
}

function Paredes({ plano }: { plano: Plano }) {
  const cristal = useRef<THREE.InstancedMesh>(null);
  const borde = useRef<THREE.InstancedMesh>(null);
  const celdas = useMemo(() => {
    const out: [number, number, boolean][] = []; // [c, r, la pared corre en x]
    const es = (c: number, r: number) => c >= 0 && r >= 0 && c < plano.cols && r < plano.rows && plano.pared[r * plano.cols + c] === 1;
    for (let r = 0; r < plano.rows; r++)
      for (let c = 0; c < plano.cols; c++) if (es(c, r)) out.push([c, r, es(c - 1, r) || es(c + 1, r) || !(es(c, r - 1) || es(c, r + 1))]);
    return out;
  }, [plano]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const giro = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    celdas.forEach(([c, r, enX], i) => {
      m.makeTranslation(c + 0.5, 0.55, r + 0.5);
      cristal.current?.setMatrixAt(i, m);
      m.makeTranslation(c + 0.5, 1.12, r + 0.5);
      if (!enX) m.multiply(giro);
      borde.current?.setMatrixAt(i, m);
    });
    if (cristal.current) cristal.current.instanceMatrix.needsUpdate = true;
    if (borde.current) borde.current.instanceMatrix.needsUpdate = true;
  }, [celdas]);
  return (
    <group>
      <instancedMesh ref={cristal} args={[undefined, undefined, celdas.length]} key={`c${celdas.length}`}>
        <boxGeometry args={[1, 1.1, 1]} />
        <meshStandardMaterial color="#2a6f8f" emissive="#0d3a52" emissiveIntensity={0.6} transparent opacity={0.32} metalness={0.5} roughness={0.15} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={borde} args={[undefined, undefined, celdas.length]} key={`b${celdas.length}`}>
        <boxGeometry args={[1.002, 0.04, 0.22]} />
        <meshStandardMaterial color="#7fe3ff" emissive="#2bb8ff" emissiveIntensity={1.2} />
      </instancedMesh>
    </group>
  );
}

function Escritorio({ puesto, encendido, nucleo }: { puesto: Puesto; encendido: boolean; nucleo: boolean }) {
  const pantalla = useRef<THREE.MeshStandardMaterial>(null);
  const x = puesto.mesa.c + 1.5;
  const z = puesto.mesa.r + 1;
  useFrame(({ clock }) => {
    const m = pantalla.current;
    if (!m) return;
    m.emissiveIntensity = encendido ? 1.6 + Math.sin(clock.elapsedTime * 7 + x) * 0.25 : 0.15;
  });
  const acento = nucleo ? "#e8b04b" : "#7fe3ff";
  return (
    <group>
      {/* tablero y patas */}
      <mesh position={[x, 0.76, z]}>
        <boxGeometry args={[2.7, 0.07, 1.3]} />
        <meshStandardMaterial color="#5a7590" metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[x, 0.76, z + 0.66]}>
        <boxGeometry args={[2.7, 0.03, 0.03]} />
        <meshStandardMaterial color={acento} emissive={acento} emissiveIntensity={encendido ? 1.5 : 0.4} />
      </mesh>
      {[-1.25, 1.25].map((dx) => (
        <mesh key={dx} position={[x + dx, 0.38, z]}>
          <boxGeometry args={[0.08, 0.76, 1.1]} />
          <meshStandardMaterial color="#121b25" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* monitor */}
      <mesh position={[x, 1.2, z - 0.35]}>
        <boxGeometry args={[1.25, 0.72, 0.05]} />
        <meshStandardMaterial color="#0c141c" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[x, 1.2, z - 0.32]}>
        <planeGeometry args={[1.15, 0.62]} />
        <meshStandardMaterial ref={pantalla} color="#06202c" emissive={nucleo ? "#ffb347" : "#36c9ff"} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[x, 0.9, z - 0.35]}>
        <boxGeometry args={[0.08, 0.28, 0.08]} />
        <meshStandardMaterial color="#0c141c" />
      </mesh>
      {/* silla */}
      <mesh position={[puesto.silla.c + 0.5, 0.42, puesto.silla.r + 0.2]}>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color="#26313d" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[puesto.silla.c + 0.5, 0.72, puesto.silla.r + 0.5]}>
        <boxGeometry args={[0.55, 0.55, 0.07]} />
        <meshStandardMaterial color="#26313d" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

function MesaHolografica({ sala }: { sala: Sala }) {
  const anillos = useRef<THREE.Group>(null);
  const h = sala.holo!;
  const x = h.c + 1;
  const z = h.r + 1;
  useFrame(({ clock }) => {
    const g = anillos.current;
    if (!g) return;
    g.children.forEach((m, i) => {
      m.rotation.x = clock.elapsedTime * (0.4 + i * 0.25) + i;
      m.rotation.y = clock.elapsedTime * (0.6 - i * 0.15);
    });
    g.position.y = 1.55 + Math.sin(clock.elapsedTime * 1.5) * 0.06;
  });
  return (
    <group>
      <mesh position={[x, 0.3, z]}>
        <cylinderGeometry args={[0.85, 0.95, 0.6, 32]} />
        <meshStandardMaterial color="#141f2b" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[x, 0.61, z]}>
        <cylinderGeometry args={[0.8, 0.8, 0.02, 32]} />
        <meshStandardMaterial color="#7fe3ff" emissive="#2bb8ff" emissiveIntensity={1.8} transparent opacity={0.85} />
      </mesh>
      <group ref={anillos} position={[x, 1.55, z]}>
        {[0.7, 0.52, 0.34].map((r, i) => (
          <mesh key={r}>
            <torusGeometry args={[r, 0.025, 12, 64]} />
            <meshStandardMaterial color={i === 1 ? "#e8b04b" : "#7fe3ff"} emissive={i === 1 ? "#e8b04b" : "#2bb8ff"} emissiveIntensity={2} />
          </mesh>
        ))}
        <mesh>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial color="#dff8ff" emissive="#7fe3ff" emissiveIntensity={3} />
        </mesh>
      </group>
      <pointLight position={[x, 1.6, z]} color="#5fd4ff" intensity={6} distance={7} />
    </group>
  );
}

function RobotAgente({ info, mundo, onSeleccionar }: { info: InfoRobot; mundo: Mundo; onSeleccionar: (slug: string) => void }) {
  const { scene, animations } = useGLTF(ROBOT_URL);
  const grupo = useRef<THREE.Group>(null);
  const modelo = useMemo(() => {
    const m = clonarEsqueleto(scene) as THREE.Group;
    m.updateMatrixWorld(true);
    const caja = new THREE.Box3().setFromObject(m, true);
    const alto = Math.max(0.01, caja.max.y - caja.min.y);
    m.scale.setScalar(ALTURA_ROBOT / alto);
    const [principal, secundario] = ARMADURAS[info.armadura % ARMADURAS.length];
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const base = mesh.material as THREE.MeshStandardMaterial;
      if (info.esJarvis) {
        mesh.material = materialHolograma();
        return;
      }
      const mat = base.clone();
      if (base.name === "Main") mat.color.set(principal);
      else if (base.name === "Grey") mat.color.set(secundario);
      mat.metalness = 0.75;
      mat.roughness = 0.32;
      mesh.material = mat;
    });
    return m;
  }, [scene, info.esJarvis, info.armadura]);
  const { actions } = useAnimations(animations, grupo);
  const actual = useRef<Anim | null>(null);
  const torso = useMemo(() => {
    let hueso: THREE.Object3D | null = null;
    modelo.traverse((o) => {
      if (!hueso && o.name === "Torso" && (o as THREE.Bone).isBone) hueso = o;
    });
    return hueso as THREE.Object3D | null;
  }, [modelo]);
  const reactor = useRef<THREE.Group>(null);
  const anillo = useRef<THREE.Group>(null);
  const paquete = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const r = mundo.robots.get(info.slug);
    const g = grupo.current;
    if (!r || !g) return;
    g.position.set(r.x, 0, r.z);
    // girar suave hacia la dirección deseada
    const diff = Math.atan2(Math.sin(r.rot - g.rotation.y), Math.cos(r.rot - g.rotation.y));
    g.rotation.y += diff * 0.2;
    const quiero = mundo.anim(r);
    if (quiero !== actual.current) {
      const nueva = actions[quiero];
      const vieja = actual.current ? actions[actual.current] : null;
      if (nueva) {
        const unaVez = quiero === "ThumbsUp" || quiero === "No" || quiero === "Wave" || quiero === "Yes";
        nueva.reset();
        nueva.setLoop(unaVez ? THREE.LoopOnce : THREE.LoopRepeat, unaVez ? 1 : Infinity);
        nueva.clampWhenFinished = unaVez;
        nueva.fadeIn(0.25).play();
        vieja?.fadeOut(0.25);
        actual.current = quiero;
      }
    }
    // el holograma de JARVIS flota un poco
    if (info.esJarvis) g.position.y = 0.06 + Math.sin(performance.now() / 600) * 0.04;
    // reactor en el pecho: sigue al hueso del torso
    if (torso && reactor.current) {
      torso.getWorldPosition(tmp);
      g.worldToLocal(tmp);
      reactor.current.position.set(tmp.x, tmp.y + 0.05, tmp.z + 0.2);
    }
    const t = performance.now() / 1000;
    if (anillo.current) {
      anillo.current.visible = info.trabajando;
      anillo.current.rotation.y = t * 1.4;
    }
    if (paquete.current) {
      paquete.current.visible = r.llevando;
      paquete.current.rotation.set(t * 2, t * 3, 0);
      paquete.current.position.y = 1.0 + Math.sin(t * 5) * 0.04;
    }
  });

  return (
    <group
      ref={grupo}
      onClick={(e) => {
        e.stopPropagation();
        onSeleccionar(info.slug);
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <primitive object={modelo} />
      {!info.esJarvis && (
        <group ref={reactor}>
          <mesh>
            <circleGeometry args={[0.07, 20]} />
            <meshStandardMaterial color="#e6fbff" emissive="#7fe3ff" emissiveIntensity={3.2} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0, -0.005]}>
            <ringGeometry args={[0.07, 0.1, 20]} />
            <meshStandardMaterial color="#5a6670" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      <group ref={anillo} visible={false} position={[0, 0.03, 0]}>
        <mesh rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.62, 0.66, 48, 1, 0, Math.PI * 1.5]} />
          <meshBasicMaterial color="#7fe3ff" transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI}>
          <ringGeometry args={[0.72, 0.74, 48, 1, 0, Math.PI * 0.8]} />
          <meshBasicMaterial color="#e8b04b" transparent opacity={0.8} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={paquete} visible={false} position={[0.28, 1.0, 0.3]}>
        <boxGeometry args={[0.16, 0.16, 0.16]} />
        <meshStandardMaterial color="#bff3ff" emissive="#36c9ff" emissiveIntensity={2.5} transparent opacity={0.85} />
      </mesh>
      {/* zona de clic más grande que el robot */}
      <mesh position={[0, ALTURA_ROBOT / 2, 0]}>
        <cylinderGeometry args={[0.55, 0.55, ALTURA_ROBOT, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {info.esJarvis && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.35, 0.45, 40]} />
          <meshBasicMaterial color="#7fe3ff" transparent opacity={0.6} />
        </mesh>
      )}
      {info.lider && <InsigniaLider alto={ALTURA_ROBOT} />}
      {info.seleccionado && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.45, 0.55, 40]} />
          <meshBasicMaterial color="#e8b04b" />
        </mesh>
      )}
    </group>
  );
}

/** Holograma de JARVIS: azul translúcido con líneas de escaneo que suben (shader inyectado en el material estándar). */
const reloj = { value: 0 };
let materialHolo: THREE.MeshStandardMaterial | null = null;
function materialHolograma() {
  if (materialHolo) return materialHolo;
  const m = new THREE.MeshStandardMaterial({
    color: "#8fe9ff", emissive: "#2bb8ff", emissiveIntensity: 1.3, transparent: true, opacity: 0.6,
    metalness: 0.2, roughness: 0.2, depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTiempo = reloj;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vAltura;")
      .replace("#include <skinning_vertex>", "#include <skinning_vertex>\nvAltura = (modelMatrix * vec4(transformed, 1.0)).y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAltura;\nuniform float uTiempo;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nfloat linea = smoothstep(0.35, 0.5, fract(vAltura * 22.0 - uTiempo * 1.6));\nfloat barrido = smoothstep(0.08, 0.0, abs(fract(uTiempo * 0.35) * 2.2 - vAltura));\ngl_FragColor.rgb += vec3(0.35, 0.8, 1.0) * (barrido * 1.5);\ngl_FragColor.a *= 0.45 + 0.55 * linea + barrido;",
      );
  };
  materialHolo = m;
  return m;
}

function RelojHolograma() {
  useFrame(({ clock }) => {
    reloj.value = clock.elapsedTime;
  });
  return null;
}

/** Rombo dorado flotando sobre la cabeza de los líderes de sala */
function InsigniaLider({ alto }: { alto: number }) {
  const m = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!m.current) return;
    m.current.rotation.y = clock.elapsedTime * 1.6;
    m.current.position.y = alto + 0.12 + Math.sin(clock.elapsedTime * 2) * 0.04;
  });
  return (
    <mesh ref={m} position={[0, alto + 0.12, 0]}>
      <octahedronGeometry args={[0.09]} />
      <meshStandardMaterial color="#ffd36b" emissive="#e8b04b" emissiveIntensity={2.2} metalness={0.6} roughness={0.2} />
    </mesh>
  );
}

useGLTF.preload(ROBOT_URL);
