"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Html,
  OrbitControls,
  PerspectiveCamera,
  Edges,
  Grid,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useGameClient } from "@/lib/game/hooks";
import type { GameState, PlayerSnapshot } from "@/types/game";
import { analyzeClusters, type AnnotatedCluster } from "@/lib/game/clusters";

const PLANE_SCALE = 0.03;
const FRONT_DEPTH_SCALE = 0.03;
const ORBIT_DEPTH_SCALE = 0.03;
const CAMERA_HEIGHT_FACTOR = 0.25;
const CAMERA_DISTANCE_FACTOR = 1.4;
const FRONT_PULLBACK = 5.6;
const ORBIT_PULLBACK = 2.4;
const WEAK_FOV = 26;
const FRONT_ZOOM = 6;
const ORBIT_ZOOM = 3;
const CAMERA_TRANSITION_MS = 1100;
const SPRING_SEGMENTS = 26;
const SPRING_WAVES = 4;
const SPRING_DAMPING = 0.8;
const SPRING_PHASE_SPEED = 0.012;
const SPRING_IDLE_BASE = 0.5;
const SPRING_DECAY_MS = 1600;
const SPRING_MAX_PX = 8;
const SPRING_GLOW_RADIUS = 0.08;
const SPRING_LINE_OPACITY = 0.1;

type ViewMode = "front" | "perspective";
type PlayerEntry = GameState["players"][string];

interface GlobalPerspectiveViewProps {
  showHud?: boolean;
  showModeToggle?: boolean;
}

interface CameraAnimatorProps {
  viewMode: ViewMode;
  frontPosition: THREE.Vector3;
  orbitPosition: THREE.Vector3;
  transitionRef: React.MutableRefObject<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    start: number;
  } | null>;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
}

const CameraAnimator = ({
  viewMode,
  frontPosition,
  orbitPosition,
  transitionRef,
  controlsRef,
  cameraRef,
}: CameraAnimatorProps) => {
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const target = viewMode === "front" ? frontPosition : orbitPosition;
    transitionRef.current = {
      from: camera.position.clone(),
      to: target.clone(),
      fromZoom: camera.zoom,
      toZoom: viewMode === "front" ? FRONT_ZOOM : ORBIT_ZOOM,
      start: performance.now(),
    };
  }, [viewMode, frontPosition, orbitPosition, cameraRef, transitionRef]);

  useFrame(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    const transition = transitionRef.current;
    if (transition) {
      const t = (performance.now() - transition.start) / CAMERA_TRANSITION_MS;
      const progress = Math.min(1, t);
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      camera.position.lerpVectors(transition.from, transition.to, eased);
      camera.zoom =
        transition.fromZoom + (transition.toZoom - transition.fromZoom) * eased;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      controls.update();
      if (progress >= 1) {
        transitionRef.current = null;
      }
      return;
    }
    controls.autoRotate = viewMode === "perspective";
    controls.enableRotate = viewMode === "perspective";
    controls.enablePan = viewMode === "perspective";
    controls.update();
  });

  return null;
};

const toWorldX = (x: number, width: number) => (x - width / 2) * PLANE_SCALE;
const toWorldY = (y: number, height: number) => (height / 2 - y) * PLANE_SCALE;

interface PlayerPlaneProps {
  player: PlayerSnapshot;
  planeWidth: number;
  planeHeight: number;
  depth: number;
  isFocused: boolean;
  worldX: number;
  worldY: number;
}

const PlayerParticleSphere = ({
  radius,
  color,
  isSelf,
  position,
  gravityDir,
  gravityDist,
}: {
  radius: number;
  color: string;
  isSelf: boolean;
  position: [number, number, number];
  gravityDir?: { x: number; y: number };
  gravityDist?: number;
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // 파티클 수를 줄여서 퍼포먼스와 시인성을 조절
    const count = 100;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const baseColor = new THREE.Color(color);

    // 중력 영향력 계산 (거리 기반)
    const hasGravityDist =
      typeof gravityDist === "number" && Number.isFinite(gravityDist);
    const maxVisualGravityDist = 900;
    const distFactor =
      hasGravityDist && gravityDist! < maxVisualGravityDist
        ? Math.max(0, 1 - Math.min(gravityDist! / maxVisualGravityDist, 1))
        : 0;

    // 중력 방향 정규화 (XY 평면 기준)
    let gx = 0;
    let gy = 0;
    let gz = 0;
    if (gravityDir) {
      const mag = Math.hypot(gravityDir.x, gravityDir.y);
      if (mag > 0.0001) {
        gx = gravityDir.x / mag;
        gy = gravityDir.y / mag;
      }
    }
    const hasGravity = distFactor > 0 && (gx !== 0 || gy !== 0);

    for (let i = 0; i < count; i += 1) {
      // 균일한 구 표면 분포
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.sin(phi) * Math.sin(theta);
      const dirZ = Math.cos(phi);

      // 중력 방향과의 정렬 정도 (0~1)
      let align = 0;
      if (hasGravity) {
        const dot = dirX * gx + dirY * gy + dirZ * gz;
        align = Math.max(0, dot);
      }
      const alignBoost = Math.pow(align, 1.6);

      // 중력 방향 쪽에서만 약간 더 바깥으로 밀어내기
      const radialBoost = 0.22 * distFactor * alignBoost;
      const r = radius * (1 + radialBoost * 1);

      const x = r * dirX;
      const y = r * dirY;
      const z = r * dirZ;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // 기본 밝기: 어두운(희미한) 점을 더 많이
      const baseBrightness = 0.25 + 0.75 * Math.pow(Math.random(), 2.0);
      const gravityHighlight =
        hasGravity && align > 0 ? 0.9 * distFactor * Math.pow(align, 1.4) : 0;
      const brightness = Math.min(1, baseBrightness + gravityHighlight);

      colors[i * 3] = baseColor.r * brightness;
      colors[i * 3 + 1] = baseColor.g * brightness;
      colors[i * 3 + 2] = baseColor.b * brightness;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [radius]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += 0.18 * delta;
    pointsRef.current.rotation.x += 0.07 * delta;
  });

  return (
    <points ref={pointsRef} position={position} geometry={geometry}>
      <pointsMaterial
        vertexColors
        // 공 반지름은 유지하면서 개별 파티클 크기는 조금 줄임
        size={radius * 0.01}
        sizeAttenuation
        transparent
        // 전체 opacity는 낮게, self일 때만 조금 더 진하게
        opacity={isSelf ? 0.85 : 0.55}
      />
    </points>
  );
};

const PlayerPlane = ({
  player,
  planeWidth,
  planeHeight,
  depth,
  isFocused,
  worldX,
  worldY,
}: PlayerPlaneProps) => {
  // 글로벌 3D 뷰에서는 공을 조금 더 크게 표시
  const radius = Math.max(player.cell.radius * PLANE_SCALE * 3.2, 0.36);
  return (
    <group position={[0, 0, depth]}>
      <PlayerParticleSphere
        radius={radius}
        color={player.cell.color || "#ffffff"}
        isSelf={Boolean(player.isSelf)}
        position={[worldX, worldY, 0.05]}
        gravityDir={player.gravityDir}
        gravityDist={player.gravityDist}
      />
    </group>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex h-full items-center justify-center text-white/70">
    {message}
  </div>
);

const PostProcessing = () => {
  const composerRef = useRef<EffectComposer | null>(null);
  const { gl, scene, camera, size } = useThree();

  useEffect(() => {
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      2.3,
      0.95,
      0
    );
    bloomPass.threshold = 0.08;
    bloomPass.strength = 2.1;
    bloomPass.radius = 0.9;

    const composer = new EffectComposer(gl);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.setSize(size.width, size.height);
    composerRef.current = composer;

    return () => {
      composer.dispose();
      composerRef.current = null;
    };
  }, [camera, gl, scene, size.height, size.width]);

  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height);
  }, [size.height, size.width]);

  useFrame(() => {
    composerRef.current?.render();
  }, 1);

  return null;
};

const GlobalPerspectiveView = ({
  showHud = true,
  showModeToggle = true,
}: GlobalPerspectiveViewProps) => {
  const { state, players } = useGameClient("global");
  const [viewMode, setViewMode] = useState<ViewMode>("front");
  const { clusters, assignments } = useMemo(
    () => analyzeClusters(players),
    [players]
  );
  const significantClusters = useMemo(
    () => clusters.filter((cluster) => cluster.isMulti),
    [clusters]
  );

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/background-landscape.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <GlobalSpace state={state} players={players} viewMode={viewMode} />
      {showModeToggle && (
        <ModeToggle viewMode={viewMode} onChange={setViewMode} />
      )}
      {showHud && (
        <GlobalHud
          state={state}
          players={players}
          significantClusters={significantClusters}
          clusterAssignments={assignments}
        />
      )}
    </div>
  );
};

const GlobalSpace = ({
  state,
  players,
  viewMode,
}: {
  state: GameState;
  players: PlayerEntry[];
  viewMode: ViewMode;
}) => {
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const transitionRef = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    start: number;
  } | null>(null);

  const planeWidth = state.gameSize.width * PLANE_SCALE;
  const planeHeight = state.gameSize.height * PLANE_SCALE;
  const viewportAspect =
    typeof window !== "undefined" && window.innerHeight > 0
      ? window.innerWidth / window.innerHeight
      : 16 / 9;

  // 카메라 FOV/zoom을 고려해, 가로·세로 모두에서
  // 월드 전체가 화면 안에 들어오도록 필요한 최소 거리 계산
  const fovRad = (WEAK_FOV * Math.PI) / 180;
  const halfFovTan = Math.tan(fovRad / 2);
  const computeRequiredDistance = (zoom: number) => {
    const minDistForHeight = (planeHeight * zoom) / (2 * halfFovTan);
    const minDistForWidth =
      (planeWidth * zoom) / (2 * halfFovTan * viewportAspect);
    return Math.max(24, minDistForHeight, minDistForWidth);
  };

  const frontDistance = computeRequiredDistance(FRONT_ZOOM);
  const orbitDistance = computeRequiredDistance(ORBIT_ZOOM);
  const cameraHeight = Math.max(12, planeHeight * CAMERA_HEIGHT_FACTOR);
  const frontPosition = useMemo(
    () => new THREE.Vector3(0, cameraHeight * 0.08, frontDistance),
    [frontDistance, cameraHeight]
  );
  const orbitPosition = useMemo(() => {
    return new THREE.Vector3(orbitDistance, cameraHeight * 0.9, 0);
  }, [orbitDistance, cameraHeight]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.copy(frontPosition);
    camera.zoom = FRONT_ZOOM;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [frontPosition]);

  const activeDepthScale =
    viewMode === "perspective" ? ORBIT_DEPTH_SCALE : FRONT_DEPTH_SCALE;
  const planeData = useMemo(() => {
    if (!players.length) return [];
    const fallbackGap = 600;
    const depthValues = players.map(
      (player, index) => player.depth ?? index * fallbackGap
    );
    const average =
      depthValues.reduce((sum, value) => sum + value, 0) / depthValues.length;

    return players.map((player, index) => {
      const targetDepth = depthValues[index];
      const depth = (targetDepth - average + index * 120) * activeDepthScale;
      return {
        player,
        depth,
        worldX: toWorldX(player.cell.position.x, state.gameSize.width),
        worldY: toWorldY(player.cell.position.y, state.gameSize.height),
      };
    });
  }, [players, state.gameSize.height, state.gameSize.width, activeDepthScale]);
  const playerWorldLookup = useMemo(() => {
    const map = new Map<
      string,
      { worldX: number; worldY: number; depth: number }
    >();
    planeData.forEach(({ player, depth, worldX, worldY }) => {
      map.set(player.id, { worldX, worldY, depth });
    });
    return map;
  }, [planeData]);

  // 게임 월드 비율에 맞춰 가로를 기준으로 세로를 축소(레터박스)
  const aspectRatio =
    state.gameSize.width > 0 && state.gameSize.height > 0
      ? state.gameSize.width / state.gameSize.height
      : 16 / 9;

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {players.length === 0 ? (
        <EmptyState message="아무도 없습니다" />
      ) : (
        <Suspense fallback={<EmptyState message="..." />}>
          <Canvas
            className="w-full h-full"
            style={{
              backgroundColor: "transparent",
              mixBlendMode: "screen",
            }}
            linear
            gl={{ alpha: true, antialias: true }}
            dpr={1}
            camera={{
              position: [
                0,
                Math.max(8, planeHeight * CAMERA_HEIGHT_FACTOR),
                Math.max(14, planeWidth * CAMERA_DISTANCE_FACTOR),
              ],
              fov: 55,
            }}
            shadows
            onCreated={({ gl }) => {
              gl.shadowMap.enabled = true;
              gl.shadowMap.type = THREE.PCFSoftShadowMap;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.0;
              gl.setClearColor(new THREE.Color("#020207"), 0);
              if ("physicallyCorrectLights" in gl) {
                (
                  gl as THREE.WebGLRenderer & {
                    physicallyCorrectLights?: boolean;
                  }
                ).physicallyCorrectLights = true;
              }
              gl.autoClear = false;
              if ("outputColorSpace" in gl) {
                gl.outputColorSpace = THREE.SRGBColorSpace;
              }
            }}
          >
            <ambientLight intensity={0.35} color="#94a3b8" />
            <pointLight
              position={[16, 18, 26]}
              intensity={5}
              distance={280}
              decay={2}
              color="#fff6e5"
              castShadow
            />
            <pointLight
              position={[-28, -10, -24]}
              intensity={3.2}
              distance={260}
              decay={1.8}
              color="#60a5fa"
            />
            <spotLight
              position={[0, 0, 90]}
              angle={0.6}
              penumbra={0.85}
              intensity={1.8}
              color="#f472b6"
              castShadow
            />
            <PerspectiveCamera
              ref={cameraRef}
              makeDefault
              position={[frontPosition.x, frontPosition.y, frontPosition.z]}
              fov={WEAK_FOV}
              near={0.1}
              far={4000}
              onUpdate={(camera) => camera.lookAt(0, 0, 0)}
            />
            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.08}
              autoRotate={viewMode === "perspective"}
              autoRotateSpeed={0.25}
              enableRotate={viewMode === "perspective"}
              enablePan={viewMode === "perspective"}
              enableZoom={false}
              minPolarAngle={0.3}
              maxPolarAngle={Math.PI - 0.4}
              target={[0, 0, 0]}
            />
            <CameraAnimator
              viewMode={viewMode}
              frontPosition={frontPosition}
              orbitPosition={orbitPosition}
              transitionRef={transitionRef}
              controlsRef={controlsRef}
              cameraRef={cameraRef}
            />
            <Grid
              args={[planeWidth * 2, planeHeight * 2]}
              position={[0, 0, 0]}
              cellSize={1}
              sectionSize={4}
              sectionThickness={0.25}
              cellColor="#04060d"
              sectionColor="#0b1227"
              fadeDistance={80}
              fadeStrength={1.2}
            />
            <CollisionSprings3D state={state} lookup={playerWorldLookup} />
            <PostProcessing />
            {planeData.map(({ player, depth, worldX, worldY }) => (
              <PlayerPlane
                key={player.id}
                player={player}
                depth={depth}
                planeWidth={planeWidth}
                planeHeight={planeHeight}
                isFocused={player.isSelf ?? false}
                worldX={worldX}
                worldY={worldY}
              />
            ))}
          </Canvas>
        </Suspense>
      )}
    </div>
  );
};

const computeSpringAmplitudePx = (
  now: number,
  startedAt: number,
  lastEvent?: number
) => {
  const lastImpulse = lastEvent ?? startedAt ?? now;
  const since = Math.max(0, now - lastImpulse);
  const decay = Math.exp(-since / SPRING_DECAY_MS);
  const idlePulse = SPRING_IDLE_BASE + 2 * Math.sin(now / 1000);
  return idlePulse + SPRING_MAX_PX * decay;
};

interface SpringSegment {
  id: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
  lastEvent?: number;
}

const CollisionSprings3D = ({
  state,
  lookup,
}: {
  state: GameState;
  lookup: Map<string, { worldX: number; worldY: number; depth: number }>;
}) => {
  const springs = useMemo(() => {
    return state.collisionLines
      .map<SpringSegment | null>((line) => {
        const a = lookup.get(line.players[0]);
        const b = lookup.get(line.players[1]);
        if (!a || !b) return null;
        return {
          id: line.id,
          startedAt: line.startedAt,
          lastEvent: line.lastEvent,
          from: new THREE.Vector3(a.worldX, a.worldY, a.depth + 0.05),
          to: new THREE.Vector3(b.worldX, b.worldY, b.depth + 0.05),
        };
      })
      .filter((segment): segment is SpringSegment => Boolean(segment));
  }, [lookup, state.collisionLines]);

  if (!springs.length) return null;

  return (
    <>
      {springs.map((spring) => (
        <CollisionSpring3D key={spring.id} {...spring} />
      ))}
    </>
  );
};

const CollisionSpring3D = ({
  from,
  to,
  startedAt,
  lastEvent,
}: SpringSegment) => {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const positions = useMemo(
    () => new Float32Array((SPRING_SEGMENTS + 1) * 3),
    []
  );
  const fromRef = useRef(from);
  const toRef = useRef(to);

  useEffect(() => {
    fromRef.current = from;
  }, [from]);
  useEffect(() => {
    toRef.current = to;
  }, [to]);

  useFrame(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const a = fromRef.current;
    const b = toRef.current;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const planarDist = Math.hypot(dx, dy);
    const nx = planarDist > 0 ? -dy / planarDist : 0;
    const ny = planarDist > 0 ? dx / planarDist : 0;
    const wallNow =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const amplitudePx = computeSpringAmplitudePx(wallNow, startedAt, lastEvent);
    const amplitude = amplitudePx * PLANE_SCALE;
    const phase = wallNow * SPRING_PHASE_SPEED;
    for (let i = 0; i <= SPRING_SEGMENTS; i += 1) {
      const t = i / SPRING_SEGMENTS;
      const sine = Math.sin(t * Math.PI * SPRING_WAVES + phase);
      const fade = Math.exp(-t * SPRING_DAMPING);
      const offset = amplitude * sine * fade;
      const idx = i * 3;
      positions[idx] = a.x + dx * t + nx * offset;
      positions[idx + 1] = a.y + dy * t + ny * offset;
      positions[idx + 2] = a.z + dz * t;
    }
    const attr = geometry.attributes.position;
    if (attr) {
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  });

  return (
    <>
      <line>
        <bufferGeometry ref={geometryRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color="#d2d8e0"
          transparent
          opacity={SPRING_LINE_OPACITY}
          toneMapped={false}
        />
      </line>
      <mesh position={[from.x, from.y, from.z]}>
        <sphereGeometry args={[SPRING_GLOW_RADIUS, 12, 12]} />
        <meshBasicMaterial
          color="#e2e8e0"
          toneMapped={false}
          transparent
          opacity={0.6}
        />
      </mesh>
      <mesh position={[to.x, to.y, to.z]}>
        <sphereGeometry args={[SPRING_GLOW_RADIUS, 12, 12]} />
        <meshBasicMaterial
          color="#f8fafc"
          toneMapped={false}
          transparent
          opacity={0.6}
        />
      </mesh>
    </>
  );
};

const ModeToggle = ({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) => (
  <div className="pointer-events-auto absolute right-6 top-6 z-30 flex gap-2">
    <button
      type="button"
      onClick={() => onChange("front")}
      className={`rounded-full px-4 py-2 text-sm ${
        viewMode === "front"
          ? "bg-white text-black"
          : "bg-white/10 text-white/70"
      }`}
    >
      Front
    </button>
    <button
      type="button"
      onClick={() => onChange("perspective")}
      className={`rounded-full px-4 py-2 text-sm ${
        viewMode === "perspective"
          ? "bg-white text-black"
          : "bg-white/10 text-white/70"
      }`}
    >
      Orbit
    </button>
  </div>
);

const GlobalHud = ({
  state,
  players,
  significantClusters,
  clusterAssignments,
}: {
  state: GameState;
  players: PlayerEntry[];
  significantClusters: AnnotatedCluster[];
  clusterAssignments: Map<string, AnnotatedCluster>;
}) => (
  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-6">
    <div className="pointer-events-auto w-full max-w-5xl rounded-2xl bg-black/70 p-5 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-white/70">
        <div>
          <p className="text-[10px] uppercase tracking-[0.45em] text-blue-300">
            Perspective
          </p>
          <p className="text-base font-semibold text-white">실시간 참여자</p>
        </div>
        <span>인원 {state.ui.population.toLocaleString()}</span>
      </div>
      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-[0.35em] text-emerald-300">
          Clusters
        </p>
        {significantClusters.length === 0 ? (
          <p className="mt-2 text-xs text-white/50">
            아직 근접한 클러스터가 없습니다.
          </p>
        ) : (
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1 pr-2 text-xs text-white/80">
            {significantClusters.map((cluster) => (
              <div
                key={cluster.id}
                className="min-w-[200px] rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="flex items-center justify-between text-white">
                  <span className="font-medium">{cluster.label}</span>
                  <span className="text-[11px] text-white/60">
                    {cluster.memberCount}명
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-white/60">
                  중심 ({cluster.centroid.x.toFixed(0)},{" "}
                  {cluster.centroid.y.toFixed(0)})
                </p>
                <p className="mt-1 text-[11px] text-white/50">
                  참여자{" "}
                  {cluster.members
                    .map((member) => member.name || "익명")
                    .join(", ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.35em] text-sky-300">
            Participants
          </p>
        </div>
        {players.length === 0 ? (
          <p className="mt-2 text-xs text-white/40">연결 대기 중...</p>
        ) : (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 pr-2 text-xs">
            {players.map((player) => {
              const clusterInfo = clusterAssignments.get(player.id);
              const clusterLabel = clusterInfo
                ? `${clusterInfo.label}${
                    clusterInfo.isMulti ? ` · ${clusterInfo.memberCount}명` : ""
                  }`
                : "단독";
              return (
                <div
                  key={player.id}
                  className="flex min-w-[200px] flex-col rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <span className="text-white">{player.name || "익명"}</span>
                  <span className="text-[11px] text-white/60">
                    {clusterLabel} · depth {(player.depth ?? 0).toFixed(0)} ·
                    좌표 {player.cell.position.x.toFixed(0)},{" "}
                    {player.cell.position.y.toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);

export default GlobalPerspectiveView;
