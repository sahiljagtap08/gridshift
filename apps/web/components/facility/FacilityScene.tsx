"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Grid, Line, OrbitControls, SoftShadows } from "@react-three/drei";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Line2 } from "three-stdlib";
import type { FacilityState } from "@/lib/useFacilityState";
import { Badge, stateBadge } from "@/components/ui";
import {
  CAB_D,
  CAB_H,
  CAB_W,
  COOLER_POS,
  PITCH,
  ROW_BACK_Z,
  ROW_FRONT_Z,
  ROW_X0,
  STRIPS,
  SUBSTATION_CENTER,
  SUBSTATION_SIZE,
  SWITCHGEAR_COUNT,
  SWITCHGEAR_X0,
  SWITCHGEAR_Z,
  TOWER_POS,
  layoutRacks,
  type RackGroupLayout,
} from "./layout";
import { LED_AMBER, describeAction, ledTarget } from "./visuals";

/* ------------------------------------------------------------------ */
/* Hover model                                                          */
/* ------------------------------------------------------------------ */

export type HoverTarget =
  | { kind: "rack"; id: string }
  | { kind: "cooling"; index: number }
  | { kind: "switchgear" }
  | { kind: "substation" };

interface HoverApi {
  hover: HoverTarget | null;
  pinned: boolean;
  set: (t: HoverTarget | null) => void;
  pin: (t: HoverTarget) => void;
  unpin: () => void;
}

function useHover(): HoverApi {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);
  const set = useCallback((t: HoverTarget | null) => {
    if (!pinnedRef.current) setHover(t);
  }, []);
  const pin = useCallback((t: HoverTarget) => {
    setHover(t);
    setPinned((p) => !p);
  }, []);
  const unpin = useCallback(() => {
    setPinned(false);
    setHover(null);
  }, []);
  useEffect(() => {
    document.body.style.cursor = hover && !pinned ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover, pinned]);
  return useMemo(() => ({ hover, pinned, set, pin, unpin }), [hover, pinned, set, pin, unpin]);
}

const sameTarget = (a: HoverTarget | null, b: HoverTarget) =>
  !!a && a.kind === b.kind && (a.kind !== "rack" || a.id === (b as { id: string }).id) && (a.kind !== "cooling" || a.index === (b as { index: number }).index);

/* ------------------------------------------------------------------ */
/* DOM projection: world anchors -> absolutely positioned overlay divs  */
/* (avoids drei <Html>, which mounts extra React roots per label)       */
/* ------------------------------------------------------------------ */

class Projection {
  anchors = new Map<string, THREE.Vector3>();
  elements = new Map<string, HTMLElement>();
  setAnchor(id: string, x: number, y: number, z: number) {
    const v = this.anchors.get(id);
    if (v) v.set(x, y, z);
    else this.anchors.set(id, new THREE.Vector3(x, y, z));
  }
  clearAnchor(id: string) {
    this.anchors.delete(id);
  }
  /** Project every registered anchor into CSS transforms on its overlay element. */
  update(camera: THREE.Camera, width: number, height: number) {
    for (const [id, el] of this.elements) {
      const a = this.anchors.get(id);
      if (!a) {
        el.style.opacity = "0";
        continue;
      }
      tmpV.copy(a).project(camera);
      const x = (tmpV.x * 0.5 + 0.5) * width;
      const y = (-tmpV.y * 0.5 + 0.5) * height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = tmpV.z < 1 ? "" : "0";
    }
  }
}

const tmpV = new THREE.Vector3();

function Projector({ projection }: { projection: Projection }) {
  const { camera, size } = useThree();
  useFrame(() => projection.update(camera, size.width, size.height));
  return null;
}

function useAnchor(projection: Projection, id: string, x: number, y: number, z: number, active = true) {
  useEffect(() => {
    if (!active) return;
    projection.setAnchor(id, x, y, z);
    return () => projection.clearAnchor(id);
  }, [projection, id, x, y, z, active]);
}

/* ------------------------------------------------------------------ */
/* Shared materials & geometries (module-level, created once)          */
/* ------------------------------------------------------------------ */

const MAT = {
  cabinet: new THREE.MeshStandardMaterial({ color: "#2b2d30", roughness: 0.48, metalness: 0.32 }),
  door: new THREE.MeshPhysicalMaterial({ color: "#1d1f22", roughness: 0.22, metalness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
  vent: new THREE.MeshStandardMaterial({ color: "#3a3d41", roughness: 0.7, metalness: 0.2 }),
  band: new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.4, metalness: 0.4 }),
  led: new THREE.MeshBasicMaterial({ toneMapped: false }),
  lampGreen: new THREE.MeshBasicMaterial({ color: "#3ccf6f", toneMapped: false }),
  lampAmber: new THREE.MeshBasicMaterial({ color: "#e0a030", toneMapped: false }),
  cooler: new THREE.MeshStandardMaterial({ color: "#2a2c2f", roughness: 0.5, metalness: 0.38 }),
  coolerGrille: new THREE.MeshStandardMaterial({ color: "#3b3e42", roughness: 0.75, metalness: 0.25 }),
  fanHousing: new THREE.MeshStandardMaterial({ color: "#141517", roughness: 0.6, metalness: 0.3 }),
  fanBlade: new THREE.MeshStandardMaterial({ color: "#8d9094", roughness: 0.5, metalness: 0.6 }),
  pipeRed: new THREE.MeshStandardMaterial({ color: "#b5342c", roughness: 0.32, metalness: 0.55 }),
  pipeBlue: new THREE.MeshStandardMaterial({ color: "#2d64b3", roughness: 0.32, metalness: 0.55 }),
  support: new THREE.MeshStandardMaterial({ color: "#4a4c4f", roughness: 0.7, metalness: 0.4 }),
  gear: new THREE.MeshStandardMaterial({ color: "#a2a4a0", roughness: 0.42, metalness: 0.5 }),
  gearDark: new THREE.MeshStandardMaterial({ color: "#7d807c", roughness: 0.5, metalness: 0.5 }),
  tray: new THREE.MeshStandardMaterial({ color: "#1b1c1e", roughness: 0.6, metalness: 0.4 }),
  pad: new THREE.MeshStandardMaterial({ color: "#c7c3b6", roughness: 0.98, metalness: 0 }),
  gravel: new THREE.MeshStandardMaterial({ color: "#b4b0a3", roughness: 1, metalness: 0 }),
  fencePost: new THREE.MeshStandardMaterial({ color: "#8f918d", roughness: 0.5, metalness: 0.6 }),
  fenceMesh: new THREE.MeshStandardMaterial({ color: "#9ea19c", roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  tank: new THREE.MeshStandardMaterial({ color: "#8e928f", roughness: 0.38, metalness: 0.62 }),
  fin: new THREE.MeshStandardMaterial({ color: "#7c807d", roughness: 0.5, metalness: 0.6 }),
  bushing: new THREE.MeshStandardMaterial({ color: "#d9d2bd", roughness: 0.35, metalness: 0.1 }),
  tower: new THREE.MeshStandardMaterial({ color: "#8c8f8a", roughness: 0.5, metalness: 0.7 }),
  floor: new THREE.MeshStandardMaterial({ color: "#e4e1d8", roughness: 0.96, metalness: 0 }),
  walkway: new THREE.MeshStandardMaterial({ color: "#d3d0c5", roughness: 0.9, metalness: 0 }),
};

const GEO = {
  cabinet: new THREE.BoxGeometry(CAB_W, CAB_H, CAB_D),
  door: new THREE.BoxGeometry(CAB_W - 0.08, CAB_H - 0.18, 0.035),
  vent: new THREE.BoxGeometry(CAB_W - 0.2, 0.16, 0.02),
  strip: new THREE.BoxGeometry(0.1, 0.13, 0.02),
  lamp: new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12),
  unit: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
};

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Rack group                                                           */
/* ------------------------------------------------------------------ */

function RackGroup({
  layout,
  liveMw,
  hovered,
  hoverApi,
  tooltipOpen,
  projection,
}: {
  layout: RackGroupLayout;
  liveMw: number | undefined;
  hovered: boolean;
  hoverApi: HoverApi;
  tooltipOpen: boolean;
  projection: Projection;
}) {
  const { workload: w, cabinets: n, x0, z, width } = layout;
  useAnchor(projection, "tooltip", x0 + width / 2, CAB_H + 0.35, z, tooltipOpen);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const doors = useRef<THREE.InstancedMesh>(null);
  const vents = useRef<THREE.InstancedMesh>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const bodyMat = useMemo(() => MAT.cabinet.clone(), []);
  const cur = useRef({ color: new THREE.Color("#3fb3ad"), intensity: 0.0, standby: 0 });
  const target = ledTarget(w, liveMw);
  const targetRef = useRef(target);
  const hoveredRef = useRef(hovered);
  useLayoutEffect(() => {
    targetRef.current = target;
    hoveredRef.current = hovered;
  });
  const facing = z < 0 ? 1 : 1; // both rows face +z (toward the camera)

  useLayoutEffect(() => {
    const b = bodies.current, d = doors.current, v = vents.current, l = leds.current;
    if (!b || !d || !v || !l) return;
    for (let i = 0; i < n; i++) {
      const x = x0 + PITCH * (i + 0.5);
      tmpM.makeTranslation(x, CAB_H / 2, 0);
      b.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(x, CAB_H / 2 + 0.02, facing * (CAB_D / 2 + 0.01));
      d.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(x, CAB_H - 0.2, facing * (CAB_D / 2 + 0.03));
      v.setMatrixAt(i, tmpM);
      for (let s = 0; s < STRIPS; s++) {
        const y = 0.32 + s * ((CAB_H - 0.7) / (STRIPS - 1));
        tmpM.makeTranslation(x - 0.13, y, facing * (CAB_D / 2 + 0.035));
        l.setMatrixAt(i * STRIPS + s, tmpM);
        l.setColorAt(i * STRIPS + s, tmpC.set("#000000"));
      }
    }
    b.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = v.instanceMatrix.needsUpdate = l.instanceMatrix.needsUpdate = true;
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
  }, [n, x0, facing]);

  useFrame(({ clock }, dt) => {
    const l = leds.current, g = group.current;
    if (!l || !g) return;
    const t = targetRef.current;
    const k = 1 - Math.exp(-dt / 0.22);
    const c = cur.current;
    c.color.lerp(t.color, k);
    c.intensity += (t.intensity - c.intensity) * k;
    c.standby += ((t.standby ? 1 : 0) - c.standby) * k;
    const time = clock.elapsedTime;
    for (let i = 0; i < n; i++) {
      const breathe = t.breathe ? 0.92 + 0.08 * Math.sin(time * 1.7 + i * 0.9) : 1;
      for (let s = 0; s < STRIPS; s++) {
        const idx = i * STRIPS + s;
        if (s === 0 && c.standby > 0.02) {
          tmpC.copy(c.color).multiplyScalar(c.intensity * breathe).lerp(LED_AMBER, c.standby);
        } else {
          tmpC.copy(c.color).multiplyScalar(c.intensity * breathe);
        }
        l.setColorAt(idx, tmpC);
      }
    }
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
    // hover lift + emissive rim
    const lift = hoveredRef.current ? 0.03 : 0;
    g.position.y += (lift - g.position.y) * k;
    const em = hoveredRef.current ? 0.22 : 0;
    bodyMat.emissive.setRGB(0.19 * em, 0.47 * em, 0.48 * em);
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoverApi.set({ kind: "rack", id: w.id });
  };
  const onOut = () => hoverApi.set(null);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    hoverApi.pin({ kind: "rack", id: w.id });
  };
  const cx = x0 + width / 2;

  return (
    <group ref={group} position={[0, 0, z]}>
      <instancedMesh ref={bodies} args={[GEO.cabinet, bodyMat, n]} castShadow receiveShadow onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} />
      <instancedMesh ref={doors} args={[GEO.door, MAT.door, n]} />
      <instancedMesh ref={vents} args={[GEO.vent, MAT.vent, n]} />
      <instancedMesh ref={leds} args={[GEO.strip, MAT.led, n * STRIPS]} />
      {w.protected && (
        <>
          <mesh position={[cx, CAB_H + 0.04, 0]} material={MAT.band} castShadow>
            <boxGeometry args={[width + 0.06, 0.08, CAB_D + 0.06]} />
          </mesh>
          <mesh position={[cx, CAB_H + 0.09, facing * (CAB_D / 2 - 0.12)]} material={MAT.lampGreen} geometry={GEO.lamp} />
        </>
      )}
    </group>
  );
}

function TooltipCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-[260px] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface/95 px-3.5 py-3 text-[12px] leading-snug text-ink shadow-[0_8px_24px_rgba(28,29,26,0.12)] backdrop-blur-sm"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span className="num text-right font-medium">{v}</span>
    </div>
  );
}

function RackTooltip({ w, liveMw, action }: { w: FacilityState["workloads"][number]; liveMw?: number; action?: FacilityState["actionsById"][string] }) {
  const mwNow = liveMw ?? w.current_power_mw;
  return (
    <TooltipCard>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold">{w.name}</div>
          <div className="mono text-[11px] text-muted">{w.namespace ?? w.id}</div>
        </div>
        {stateBadge(w.state, w.throttle_percent)}
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <Row k="Power" v={`${mwNow.toFixed(2)} / ${w.nominal_power_mw.toFixed(2)} MW`} />
        <Row k="Criticality" v={w.criticality} />
        <Row k="Owner" v={w.owner ?? "—"} />
      </div>
      {(w.protected || action) && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {w.protected && (
            <span>
              <Badge tone="ink">PROTECTED</Badge> <span className="text-muted">never touched by any plan</span>
            </span>
          )}
          {action && <span className={action.status === "FAILED" ? "text-risk" : "text-signal-ink"}>{describeAction(action)}</span>}
        </div>
      )}
    </TooltipCard>
  );
}

/* ------------------------------------------------------------------ */
/* Cooling unit                                                         */
/* ------------------------------------------------------------------ */

function CoolingUnit({
  position,
  index,
  loadRatio,
  hoverApi,
  tooltipOpen,
  projection,
}: {
  position: [number, number, number];
  index: number;
  loadRatio: number;
  hoverApi: HoverApi;
  tooltipOpen: boolean;
  projection: Projection;
}) {
  const fans = useRef<THREE.Group[]>([]);
  useAnchor(projection, "tooltip", position[0], position[1] + 2.3, position[2], tooltipOpen);
  const speed = useRef(0);
  useFrame((_, dt) => {
    const targetSpeed = 3 + 9 * loadRatio;
    speed.current += (targetSpeed - speed.current) * (1 - Math.exp(-dt / 0.8));
    for (const f of fans.current) if (f) f.rotation.y += speed.current * dt;
  });
  const W = 2.4, H = 1.8, D = 2.8;
  const fanPos: [number, number][] = [
    [-0.55, -0.7],
    [0.55, -0.7],
    [-0.55, 0.7],
    [0.55, 0.7],
  ];
  const t = { kind: "cooling", index } as const;
  return (
    <group
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverApi.set(t);
      }}
      onPointerOut={() => hoverApi.set(null)}
      onClick={(e) => {
        e.stopPropagation();
        hoverApi.pin(t);
      }}
    >
      <mesh position={[0, H / 2, 0]} material={MAT.cooler} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
      </mesh>
      {/* side grilles */}
      <mesh position={[W / 2 + 0.01, H / 2, 0]} material={MAT.coolerGrille}>
        <boxGeometry args={[0.02, H - 0.4, D - 0.5]} />
      </mesh>
      <mesh position={[-W / 2 - 0.01, H / 2, 0]} material={MAT.coolerGrille}>
        <boxGeometry args={[0.02, H - 0.4, D - 0.5]} />
      </mesh>
      {/* control panel */}
      <mesh position={[0, 0.9, D / 2 + 0.01]} material={MAT.coolerGrille}>
        <boxGeometry args={[0.6, 0.5, 0.02]} />
      </mesh>
      <mesh position={[0.18, 1.02, D / 2 + 0.03]} material={MAT.lampGreen} geometry={GEO.lamp} rotation={[Math.PI / 2, 0, 0]} />
      {fanPos.map(([fx, fz], i) => (
        <group key={i} position={[fx, H, fz]}>
          <mesh material={MAT.fanHousing} position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.48, 0.48, 0.12, 28]} />
          </mesh>
          <mesh material={MAT.cooler} position={[0, 0.13, 0]}>
            <torusGeometry args={[0.48, 0.04, 8, 28]} />
          </mesh>
          <group ref={(el) => { if (el) fans.current[i] = el; }} position={[0, 0.14, 0]}>
            <mesh material={MAT.fanBlade}>
              <cylinderGeometry args={[0.09, 0.09, 0.08, 12]} />
            </mesh>
            {[0, 1, 2].map((b) => (
              <mesh key={b} material={MAT.fanBlade} rotation={[0.35, (b * Math.PI * 2) / 3, 0]} position={[0, 0, 0]}>
                <boxGeometry args={[0.1, 0.02, 0.84]} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Pipes                                                                */
/* ------------------------------------------------------------------ */

function Pipe({ points, material, radius = 0.1 }: { points: [number, number, number][]; material: THREE.Material; radius?: number }) {
  const geo = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "catmullrom", 0.02);
    return new THREE.TubeGeometry(curve, Math.max(64, points.length * 24), radius, 14, false);
  }, [points, radius]);
  return <mesh geometry={geo} material={material} castShadow receiveShadow />;
}

function PipeSupports({ points, every = 2.2 }: { points: [number, number, number][]; every?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const supports = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "catmullrom", 0.02);
    const len = curve.getLength();
    const count = Math.max(1, Math.floor(len / every));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) out.push(curve.getPointAt((i + 0.5) / count));
    return out;
  }, [points, every]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    supports.forEach((p, i) => {
      tmpM.makeTranslation(p.x, p.y / 2, p.z);
      tmpM.scale(new THREE.Vector3(0.36, p.y, 0.14));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [supports]);
  return <instancedMesh ref={ref} args={[GEO.unit, MAT.support, supports.length]} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* Switchgear                                                           */
/* ------------------------------------------------------------------ */

function Switchgear({ hoverApi, tooltipOpen, projection }: { hoverApi: HoverApi; tooltipOpen: boolean; projection: Projection }) {
  const t = { kind: "switchgear" } as const;
  const W = 0.95, H = 2.05, D = 0.95;
  useAnchor(projection, "tooltip", SWITCHGEAR_X0 + (SWITCHGEAR_COUNT * (W + 0.06)) / 2, H + 0.5, SWITCHGEAR_Z, tooltipOpen);
  return (
    <group
      position={[SWITCHGEAR_X0, 0, SWITCHGEAR_Z]}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverApi.set(t);
      }}
      onPointerOut={() => hoverApi.set(null)}
      onClick={(e) => {
        e.stopPropagation();
        hoverApi.pin(t);
      }}
    >
      {Array.from({ length: SWITCHGEAR_COUNT }).map((_, i) => (
        <group key={i} position={[i * (W + 0.06), 0, 0]}>
          <mesh position={[0, H / 2, 0]} material={MAT.gear} castShadow receiveShadow>
            <boxGeometry args={[W, H, D]} />
          </mesh>
          <mesh position={[0, H / 2 + 0.3, D / 2 + 0.01]} material={MAT.gearDark}>
            <boxGeometry args={[W - 0.2, 0.5, 0.02]} />
          </mesh>
          <mesh position={[0, 0.7, D / 2 + 0.01]} material={MAT.gearDark}>
            <boxGeometry args={[W - 0.3, 0.9, 0.02]} />
          </mesh>
          <mesh position={[-0.25, H - 0.3, D / 2 + 0.03]} material={i % 3 === 1 ? MAT.lampAmber : MAT.lampGreen} geometry={GEO.lamp} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}
      {/* end transformer cabinet */}
      <mesh position={[SWITCHGEAR_COUNT * (W + 0.06) + 0.7, 1.15, 0]} material={MAT.gear} castShadow receiveShadow>
        <boxGeometry args={[1.8, 2.3, 1.4]} />
      </mesh>
    </group>
  );
}

function CableTrays() {
  const trays: { from: [number, number]; to: [number, number] }[] = [
    { from: [SWITCHGEAR_X0 - 0.3, SWITCHGEAR_Z - 0.6], to: [SWITCHGEAR_X0 - 0.3, ROW_FRONT_Z + 0.8] },
    { from: [SWITCHGEAR_X0 - 0.3, ROW_FRONT_Z + 0.8], to: [ROW_X0 - 0.6, ROW_FRONT_Z + 0.8] },
    { from: [SWITCHGEAR_X0 + 0.3, SWITCHGEAR_Z - 0.6], to: [SWITCHGEAR_X0 + 0.3, ROW_BACK_Z + 0.8] },
    { from: [SWITCHGEAR_X0 + 0.3, ROW_BACK_Z + 0.8], to: [ROW_X0 - 0.6, ROW_BACK_Z + 0.8] },
  ];
  return (
    <>
      {trays.map((t, i) => {
        const dx = t.to[0] - t.from[0], dz = t.to[1] - t.from[1];
        const len = Math.hypot(dx, dz);
        return (
          <mesh key={i} position={[(t.from[0] + t.to[0]) / 2, 0.05, (t.from[1] + t.to[1]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]} material={MAT.tray} receiveShadow castShadow>
            <boxGeometry args={[len, 0.09, 0.42]} />
          </mesh>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Substation                                                           */
/* ------------------------------------------------------------------ */

function Transformer({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.85, 0]} material={MAT.tank} castShadow receiveShadow geometry={GEO.cyl} scale={[0.75, 1.7, 0.75]} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.95, 0.8, 0]}>
          {Array.from({ length: 5 }).map((_, i) => (
            <mesh key={i} position={[0, 0, (i - 2) * 0.16]} material={MAT.fin} castShadow>
              <boxGeometry args={[0.45, 1.2, 0.05]} />
            </mesh>
          ))}
        </group>
      ))}
      {[-0.3, 0, 0.3].map((x) => (
        <group key={x} position={[x, 1.7, 0]}>
          <mesh material={MAT.bushing} geometry={GEO.cyl} scale={[0.07, 0.7, 0.07]} position={[0, 0.35, 0]} />
          <mesh material={MAT.tank} geometry={GEO.cyl} scale={[0.1, 0.12, 0.1]} position={[0, 0.72, 0]} />
        </group>
      ))}
      <mesh position={[0, 0.06, 0]} material={MAT.gearDark} receiveShadow>
        <boxGeometry args={[2.6, 0.12, 1.8]} />
      </mesh>
    </group>
  );
}

function Tower({ position }: { position: [number, number, number] }) {
  const segments = useMemo(() => {
    const H = 8, base = 0.9, top = 0.32, levels = 7;
    const pts: [number, number, number][] = [];
    const corner = (i: number, y: number) => {
      const r = base + (top - base) * (y / H);
      const sx = i === 0 || i === 3 ? -1 : 1, sz = i < 2 ? -1 : 1;
      return [sx * r, y, sz * r] as [number, number, number];
    };
    for (let i = 0; i < 4; i++) pts.push(corner(i, 0), corner(i, H));
    for (let l = 0; l < levels; l++) {
      const y0 = (l / levels) * H, y1 = ((l + 1) / levels) * H;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        pts.push(corner(i, y0), corner(j, y1));
        pts.push(corner(j, y0), corner(i, y1));
        pts.push(corner(i, y1), corner(j, y1));
      }
    }
    // crossarms
    for (const y of [5.4, 6.6]) {
      pts.push([-1.6, y, 0], [1.6, y, 0]);
      pts.push([-1.6, y, 0], [-0.3, y + 0.6, 0]);
      pts.push([1.6, y, 0], [0.3, y + 0.6, 0]);
    }
    return pts;
  }, []);
  const catenaries = useMemo(() => {
    const lines: [number, number, number][][] = [];
    for (const [x, y] of [
      [-1.5, 5.4],
      [1.5, 5.4],
      [-1.5, 6.6],
      [1.5, 6.6],
    ]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push([x + t * 1.2, y - Math.sin(t * Math.PI) * 1.4 + t * 0.4, -t * 22]);
      }
      lines.push(pts);
    }
    return lines;
  }, []);
  return (
    <group position={position}>
      <Line segments points={segments} color="#7d817c" lineWidth={1.1} />
      {catenaries.map((pts, i) => (
        <Line key={i} points={pts} color="#5b5e5a" lineWidth={0.9} />
      ))}
      <mesh position={[0, 0.05, 0]} material={MAT.gearDark} receiveShadow>
        <boxGeometry args={[2.2, 0.1, 2.2]} />
      </mesh>
    </group>
  );
}

function Feeder({ mwRatio, points }: { mwRatio: number; points: [number, number, number][] }) {
  const ref = useRef<Line2>(null);
  useFrame((_, dt) => {
    const l = ref.current;
    if (!l) return;
    l.material.dashOffset -= dt * (0.6 + 2.4 * mwRatio);
  });
  return <Line ref={ref} points={points} color="#315460" lineWidth={2} dashed dashSize={0.35} gapSize={0.22} />;
}

function Substation({ hoverApi, tooltipOpen, projection, mwRatio }: { hoverApi: HoverApi; tooltipOpen: boolean; projection: Projection; mwRatio: number }) {
  const [cx, , cz] = SUBSTATION_CENTER;
  const [W, D] = SUBSTATION_SIZE;
  useAnchor(projection, "tooltip", cx, 3.2, cz + 1.5, tooltipOpen);
  const posts = useRef<THREE.InstancedMesh>(null);
  const postPositions = useMemo(() => {
    const out: [number, number][] = [];
    const step = 1.5;
    for (let x = -W / 2; x <= W / 2 + 0.01; x += step) out.push([x, -D / 2], [x, D / 2]);
    for (let z = -D / 2 + step; z < D / 2; z += step) out.push([-W / 2, z], [W / 2, z]);
    return out;
  }, [W, D]);
  useLayoutEffect(() => {
    const m = posts.current;
    if (!m) return;
    postPositions.forEach(([x, z], i) => {
      tmpM.makeTranslation(x, 0.9, z);
      tmpM.scale(new THREE.Vector3(0.04, 1.8, 0.04));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [postPositions]);
  const t = { kind: "substation" } as const;
  const feeder: [number, number, number][] = [
    [TOWER_POS[0] - cx, 5.4, TOWER_POS[2] - cz],
    [TOWER_POS[0] - cx - 1.2, 2.6, TOWER_POS[2] - cz + 1.6],
    [2.6, 2.4, 1.5],
    [0, 2.4, 1.5],
    [-2.6, 2.4, 1.5],
    [-W / 2 - 0.4, 0.35, 1.5],
    [SWITCHGEAR_X0 + 6.6 - cx, 0.35, SWITCHGEAR_Z - 1.2 - cz],
  ];
  return (
    <group
      position={[cx, 0, cz]}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverApi.set(t);
      }}
      onPointerOut={() => hoverApi.set(null)}
      onClick={(e) => {
        e.stopPropagation();
        hoverApi.pin(t);
      }}
    >
      <mesh position={[0, 0.03, 0]} material={MAT.gravel} receiveShadow>
        <boxGeometry args={[W, 0.06, D]} />
      </mesh>
      <mesh position={[0, 0.07, 0]} material={MAT.pad} receiveShadow>
        <boxGeometry args={[W - 1.2, 0.02, D - 1.2]} />
      </mesh>
      <instancedMesh ref={posts} args={[GEO.unit, MAT.fencePost, postPositions.length]} castShadow />
      {/* fence panels */}
      <mesh position={[0, 0.95, -D / 2]} material={MAT.fenceMesh}>
        <planeGeometry args={[W, 1.7]} />
      </mesh>
      <mesh position={[0, 0.95, D / 2]} material={MAT.fenceMesh}>
        <planeGeometry args={[W, 1.7]} />
      </mesh>
      <mesh position={[-W / 2, 0.95, 0]} rotation={[0, Math.PI / 2, 0]} material={MAT.fenceMesh}>
        <planeGeometry args={[D, 1.7]} />
      </mesh>
      <mesh position={[W / 2, 0.95, 0]} rotation={[0, Math.PI / 2, 0]} material={MAT.fenceMesh}>
        <planeGeometry args={[D, 1.7]} />
      </mesh>
      <Transformer position={[-2.6, 0.1, 1.5]} />
      <Transformer position={[0, 0.1, 1.5]} />
      <Transformer position={[2.6, 0.1, 1.5]} />
      <Tower position={[TOWER_POS[0] - cx, 0.1, TOWER_POS[2] - cz]} />
      <Feeder mwRatio={mwRatio} points={feeder} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Floor, callouts                                                      */
/* ------------------------------------------------------------------ */

function Floor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3, 0, -1]} material={MAT.floor} receiveShadow>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <Grid
        position={[3, 0.003, -1]}
        args={[70, 50]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#d6d3c9"
        sectionSize={5}
        sectionThickness={0.8}
        sectionColor="#c9c6ba"
        fadeDistance={55}
        fadeStrength={1.2}
        infiniteGrid={false}
      />
      {/* painted walkway lines between the rows */}
      {[ROW_BACK_Z + 2.9, ROW_FRONT_Z - 2.9].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[ROW_X0 + 6, 0.004, z]} material={MAT.walkway}>
          <planeGeometry args={[14, 0.06]} />
        </mesh>
      ))}
      {/* slab edge for the compute hall */}
      <mesh position={[-1, 0.01, -0.4]} material={MAT.walkway} receiveShadow>
        <boxGeometry args={[24, 0.02, 12.5]} />
      </mesh>
    </group>
  );
}

function CalloutAnchor({ projection, id, position }: { projection: Projection; id: string; position: [number, number, number] }) {
  useAnchor(projection, id, position[0], position[1], position[2]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Camera framing: fit the campus bounding sphere for any aspect ratio  */
/* ------------------------------------------------------------------ */

const SCENE_CENTER = new THREE.Vector3(4.5, 1.2, -1.5);
const SCENE_RADIUS = 12;
const VIEW_DIR = new THREE.Vector3(-8, 21, 40).sub(new THREE.Vector3(3.5, 0.3, -0.5)).normalize();

function FitCamera({ fit = 1 }: { fit?: number }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const half = Math.min(vfov, hfov) / 2;
    const dist = (SCENE_RADIUS / Math.sin(half)) * fit;
    cam.position.copy(SCENE_CENTER).addScaledVector(VIEW_DIR, dist);
    cam.lookAt(SCENE_CENTER);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height, fit]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Scene root                                                           */
/* ------------------------------------------------------------------ */

export interface FacilitySceneProps {
  state: FacilityState;
  /** Report whether a tooltip is open so overlays can react. */
  onHoverChange?: (t: HoverTarget | null) => void;
  /** Camera distance multiplier: <1 zooms in (used for the compact Live Ops card). */
  fit?: number;
  /** Cinematic idle: slow auto-orbit, no interaction, no labels. Used on the landing page. */
  ambient?: boolean;
}

/** Slow, eased orbit around the campus for ambient mode. ~60 s per cycle, respects reduced motion. */
function AmbientOrbit({ fit = 1 }: { fit?: number }) {
  const { camera, size } = useThree();
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const basePolar = 0.98;
  const baseAzimuth = -0.2;
  useFrame(({ clock }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const half = Math.min(vfov, hfov) / 2;
    const dist = (SCENE_RADIUS / Math.sin(half)) * fit;
    const t = reduced ? 0 : clock.getElapsedTime();
    const azimuth = baseAzimuth + Math.sin((t / 60) * Math.PI * 2) * 0.42;
    const polar = basePolar + Math.sin((t / 60) * Math.PI * 4) * 0.04;
    cam.position.set(
      SCENE_CENTER.x + dist * Math.sin(polar) * Math.sin(azimuth),
      SCENE_CENTER.y + dist * Math.cos(polar),
      SCENE_CENTER.z + dist * Math.sin(polar) * Math.cos(azimuth),
    );
    cam.lookAt(SCENE_CENTER);
    cam.updateProjectionMatrix();
  });
  return null;
}

function SceneContent({ state, hoverApi, projection, fit, ambient = false }: { state: FacilityState; hoverApi: HoverApi; projection: Projection; fit: number; ambient?: boolean }) {
  const { hover } = hoverApi;

  const groups = useMemo(() => layoutRacks(state.workloads), [state.workloads]);
  const nominal = state.workloads.reduce((s, w) => s + w.nominal_power_mw, 0) || 12.6;
  const loadRatio = Math.min(1, Math.max(0, state.itMw / nominal));

  const supply: [number, number, number][] = [
    [COOLER_POS[0][0] + 1.25, 0.9, COOLER_POS[0][2]],
    [COOLER_POS[0][0] + 1.9, 0.25, COOLER_POS[0][2]],
    [COOLER_POS[0][0] + 2.4, 0.25, ROW_FRONT_Z + 1.6],
    [ROW_X0 + 13.2, 0.25, ROW_FRONT_Z + 1.6],
    [ROW_X0 + 13.2, 0.25, ROW_BACK_Z + 1.6],
    [ROW_X0 - 0.9, 0.25, ROW_BACK_Z + 1.6],
  ];
  const ret: [number, number, number][] = [
    [COOLER_POS[1][0] + 1.25, 0.9, COOLER_POS[1][2]],
    [COOLER_POS[1][0] + 1.9, 0.25, COOLER_POS[1][2]],
    [COOLER_POS[1][0] + 2.9, 0.25, ROW_FRONT_Z + 2.05],
    [ROW_X0 + 13.7, 0.25, ROW_FRONT_Z + 2.05],
    [ROW_X0 + 13.7, 0.25, ROW_BACK_Z + 2.05],
    [ROW_X0 - 0.9, 0.25, ROW_BACK_Z + 2.05],
  ];

  return (
    <>
      <color attach="background" args={["#eeece6"]} />
      <fog attach="fog" args={["#eeece6", 85, 170]} />
      <SoftShadows size={14} samples={10} focus={0.6} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#f7f6f0", "#b5b1a4", 0.55]} />
      <directionalLight
        position={[14, 24, 12]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-camera-near={1}
        shadow-camera-far={80}
      />
      <directionalLight position={[-18, 10, -8]} intensity={0.55} />

      <Floor />
      <ContactShadows position={[3, 0.002, -1]} opacity={0.32} scale={60} blur={2.2} far={5} resolution={1024} frames={1} />

      {groups.map((g) => (
        <RackGroup
          key={g.workload.id}
          layout={g}
          liveMw={state.mwById[g.workload.id]}
          hovered={sameTarget(hover, { kind: "rack", id: g.workload.id })}
          hoverApi={hoverApi}
          tooltipOpen={sameTarget(hover, { kind: "rack", id: g.workload.id })}
          projection={projection}
        />
      ))}

      {COOLER_POS.map((p, i) => (
        <CoolingUnit key={i} position={p} index={i} loadRatio={loadRatio} hoverApi={hoverApi} tooltipOpen={sameTarget(hover, { kind: "cooling", index: i })} projection={projection} />
      ))}
      <Pipe points={supply} material={MAT.pipeRed} />
      <Pipe points={ret} material={MAT.pipeBlue} />
      <PipeSupports points={supply} />
      <PipeSupports points={ret} />

      <Switchgear hoverApi={hoverApi} tooltipOpen={hover?.kind === "switchgear"} projection={projection} />
      <CableTrays />
      <Substation hoverApi={hoverApi} tooltipOpen={hover?.kind === "substation"} projection={projection} mwRatio={loadRatio} />

      <CalloutAnchor projection={projection} id="callout-racks" position={[ROW_X0 + 5.5, CAB_H + 0.3, ROW_BACK_Z]} />
      <CalloutAnchor projection={projection} id="callout-cooling" position={[COOLER_POS[0][0], 2.4, COOLER_POS[0][2]]} />
      <CalloutAnchor projection={projection} id="callout-power" position={[SWITCHGEAR_X0 + 3, 2.3, SWITCHGEAR_Z]} />
      <CalloutAnchor projection={projection} id="callout-substation" position={[SUBSTATION_CENTER[0], 3.6, SUBSTATION_CENTER[2] + 1.5]} />
      <Projector projection={projection} />

      {ambient ? (
        <AmbientOrbit fit={fit} />
      ) : (
        <>
          <FitCamera fit={fit} />
          <OrbitControls
            target={SCENE_CENTER}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={14}
            maxDistance={80}
            minPolarAngle={0.45}
            maxPolarAngle={1.18}
            minAzimuthAngle={-1.35}
            maxAzimuthAngle={0.95}
            makeDefault
          />
        </>
      )}
    </>
  );
}

const CALLOUTS: { id: string; label: string }[] = [
  { id: "callout-racks", label: "GPU / Compute Racks" },
  { id: "callout-cooling", label: "Cooling Infrastructure" },
  { id: "callout-power", label: "Power Distribution" },
  { id: "callout-substation", label: "Utility Substation" },
];

function Overlay({ projection, hover, state, loadRatio }: { projection: Projection; hover: HoverTarget | null; state: FacilityState; loadRatio: number }) {
  const register = (id: string) => (el: HTMLDivElement | null) => {
    if (el) projection.elements.set(id, el);
    else projection.elements.delete(id);
  };
  const w = hover?.kind === "rack" ? state.workloads.find((x) => x.id === hover.id) : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ fontFamily: "var(--font-sans)" }}>
      {CALLOUTS.map((c) => (
        <div key={c.id} ref={register(c.id)} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0, transition: "opacity 200ms ease-out" }}>
          <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center" style={{ opacity: hover ? 0 : 1, transition: "opacity 200ms ease-out" }}>
            <span className="whitespace-nowrap rounded border border-border bg-surface/90 px-2 py-0.5 text-[11px] font-medium tracking-wide text-ink backdrop-blur-sm">{c.label}</span>
            <span className="h-7 w-px bg-ink/50" />
            <span className="h-1.5 w-1.5 rounded-full bg-ink/70" />
          </div>
        </div>
      ))}
      <div ref={register("tooltip")} className="absolute left-0 top-0 z-10 will-change-transform" style={{ opacity: 0 }}>
        {hover && (
          <div className="-translate-x-1/2 -translate-y-full pb-2">
            {w && <RackTooltip w={w} liveMw={state.mwById[w.id]} action={state.actionsById[w.id]} />}
            {hover.kind === "cooling" && (
              <TooltipCard>
                <div className="text-[13px] font-semibold">Cooling plant · unit {hover.index + 1}</div>
                <div className="mono text-[11px] text-muted">chilled-water CRAH</div>
                <div className="mt-2 border-t border-border pt-2">
                  <Row k="IT load served" v={`${state.itMw.toFixed(2)} MW`} />
                  <Row k="Fan duty" v={`${Math.round(30 + 70 * loadRatio)}%`} />
                  <Row k="PUE" v={`${state.pue.toFixed(2)} (demo)`} />
                </div>
              </TooltipCard>
            )}
            {hover.kind === "switchgear" && (
              <TooltipCard>
                <div className="text-[13px] font-semibold">Power distribution</div>
                <div className="mono text-[11px] text-muted">switchgear · busbar · UPS</div>
                <div className="mt-2 border-t border-border pt-2">
                  <Row k="Facility" v={`${state.facilityMw.toFixed(2)} MW`} />
                  <Row k="Protected" v={`${state.protectedMw.toFixed(2)} MW`} />
                  <Row k="Flexible" v={`${state.flexibleMw.toFixed(2)} MW`} />
                </div>
              </TooltipCard>
            )}
            {hover.kind === "substation" && (
              <TooltipCard>
                <div className="text-[13px] font-semibold">Utility substation</div>
                <div className="mono text-[11px] text-muted">Dominion / PJM feed</div>
                <div className="mt-2 border-t border-border pt-2">
                  <Row k="Site draw" v={`${state.facilityMw.toFixed(2)} MW`} />
                  {state.activeEvent ? (
                    <>
                      <Row k="Event baseline" v={`${state.activeEvent.baseline_mw.toFixed(2)} MW`} />
                      <Row k="Target reduction" v={`${state.activeEvent.target_reduction_mw.toFixed(2)} MW`} />
                      <Row k="Status" v={state.activeEvent.status.replace(/_/g, " ")} />
                    </>
                  ) : (
                    <Row k="Grid event" v="none" />
                  )}
                </div>
              </TooltipCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FacilityScene({ state, onHoverChange, fit = 1, ambient = false }: FacilitySceneProps) {
  const hoverApi = useHover();
  const projection = useMemo(() => new Projection(), []);
  const { hover, unpin } = hoverApi;
  useEffect(() => onHoverChange?.(hover), [hover, onHoverChange]);
  const nominal = state.workloads.reduce((s, w) => s + w.nominal_power_mw, 0) || 12.6;
  const loadRatio = Math.min(1, Math.max(0, state.itMw / nominal));
  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [-8, 21, 40], fov: 26, near: 0.5, far: 220 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.02 }}
        style={{ width: "100%", height: "100%", pointerEvents: ambient ? "none" : "auto" }}
        onPointerMissed={unpin}
      >
        <SceneContent state={state} hoverApi={hoverApi} projection={projection} fit={fit} ambient={ambient} />
      </Canvas>
      {!ambient && <Overlay projection={projection} hover={hover} state={state} loadRatio={loadRatio} />}
    </div>
  );
}
