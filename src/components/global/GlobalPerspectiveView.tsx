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
const ORBIT_DEPTH_SCALE = 0.1;
const CAMERA_HEIGHT_FACTOR = 0.25;
const CAMERA_DISTANCE_FACTOR = 1.4;
const FRONT_PULLBACK = 5.6;
const ORBIT_PULLBACK = 2.4;
const WEAK_FOV = 26;
const FRONT_ZOOM = 6;
const ORBIT_ZOOM = 3;
const CAMERA_TRANSITION_MS = 1100;

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

const PlayerPlane = ({
  player,
  planeWidth,
  planeHeight,
  depth,
  isFocused,
  worldX,
  worldY,
}: PlayerPlaneProps) => {
  const radius = Math.max(player.cell.radius * PLANE_SCALE, 0.12);
  return (
    <group position={[0, 0, depth]}>
      <mesh>
        <planeGeometry args={[planeWidth, planeHeight, 1, 1]} />
        <meshStandardMaterial
          color={isFocused ? "#1d3d7a" : "#060b1c"}
          transparent
          opacity={isFocused ? 0.18 : 0.01}
          depthWrite={false}
          metalness={0.1}
          roughness={0.8}
        />
        <Edges color={isFocused ? "#1e293b" : "#0f172a"} />
      </mesh>
      <Html
        position={[planeWidth / 2 - 0.4, planeHeight / 2 - 0.4, 0.01]}
        transform
        occlude
      >
        <div className="rounded bg-black/70 px-2 py-1 text-xs text-white">
          {player.name || "익명"}
        </div>
      </Html>
      <mesh position={[worldX, worldY, 0.05]} castShadow receiveShadow>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshPhysicalMaterial
          color={player.cell.color || "#38bdf8"}
          emissive={player.cell.color || "#38bdf8"}
          emissiveIntensity={player.isSelf ? 2 : 1.2}
          metalness={0.6}
          roughness={0.18}
          clearcoat={0.75}
          clearcoatRoughness={0.08}
        />
      </mesh>
      <mesh
        position={[worldX, worldY, 0]}
        scale={[1.6, 1.6, 1.6]}
        renderOrder={-10}
      >
        <sphereGeometry args={[radius * 1.15, 32, 32]} />
        <meshBasicMaterial
          color={player.cell.color || "#93c5fd"}
          side={THREE.BackSide}
          transparent
          opacity={player.isSelf ? 0.55 : 0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {player.isSelf && (
        <Html position={[worldX, worldY - radius - 0.4, 0.06]} transform>
          <div className="rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-black">
            YOU
          </div>
        </Html>
      )}
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
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
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
  const cameraDistance = Math.max(24, planeWidth * CAMERA_DISTANCE_FACTOR);
  const cameraHeight = Math.max(12, planeHeight * CAMERA_HEIGHT_FACTOR);
  const frontPosition = useMemo(
    () =>
      new THREE.Vector3(
        0,
        cameraHeight * 0.08,
        cameraDistance * FRONT_PULLBACK
      ),
    [cameraDistance, cameraHeight]
  );
  const orbitPosition = useMemo(() => {
    return new THREE.Vector3(
      cameraDistance * ORBIT_PULLBACK,
      cameraHeight * 0.9,
      0
    );
  }, [cameraDistance, cameraHeight]);

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

  return (
    <div className="absolute inset-0">
      {players.length === 0 ? (
        <EmptyState message="연결 대기 중..." />
      ) : (
        <Suspense fallback={<EmptyState message="3D 뷰 로딩 중..." />}>
          <Canvas
            className="h-full w-full"
            linear
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
              gl.toneMappingExposure = 1.4;
              gl.setClearColor(new THREE.Color("#020207"));
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
