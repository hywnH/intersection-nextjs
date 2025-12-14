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
import {
  postNoiseCraftParams,
  resolveNoiseCraftEmbed,
} from "@/lib/audio/noiseCraft";
import type { ServerAudioGlobalV2 } from "@/types/server";
import {
  postMonoSeqGridDiff,
  resetNoiseCraftSequencerCache,
} from "@/lib/audio/noiseCraftSequencer";
import PerfOverlay from "@/components/shared/PerfOverlay";

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
const SPRING_WAVES = 1;
const SPRING_DAMPING = 0.2;
const SPRING_PHASE_SPEED = 0.003;
const SPRING_IDLE_BASE = 0.3;
const SPRING_DECAY_MS = 1600;
const SPRING_MAX_PX = 10;
const SPRING_GLOW_RADIUS = 0.8;
const SPRING_LINE_OPACITY = 0.6;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// NDC 기준 화면 가장자리 페이드 (0: 가장자리, 1: 충분히 안쪽)
const computeEdgeFadeNdc = (ndcX: number, ndcY: number) => {
  const margin = 0.18; // 화면 가장자리에서 약 18% 구간을 페이드
  const d = 1 - Math.max(Math.abs(ndcX), Math.abs(ndcY)); // 0(가장자리)~1(중앙)
  return smoothstep(0, margin, d);
};

// eslint(react-hooks/purity) 대응:
// - render/useMemo 중 Math.random/performance.now 같은 impure 호출을 피하고
// - id 기반의 결정적(재현 가능한) pseudo-random을 사용한다.
const hashStringToSeed = (input: string) => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

type ViewMode = "front" | "perspective";
type PlayerEntry = GameState["players"][string];

interface GlobalPerspectiveViewProps {
  showHud?: boolean;
  showModeToggle?: boolean;
  initialViewMode?: ViewMode;
  hideIframe?: boolean;
  hideIframeOnStart?: boolean;
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
  opacityScale?: number;
}

const PlayerParticleSphere = ({
  radius,
  color,
  isSelf,
  position,
  opacityScale = 1,
  gravityDir,
  gravityDist,
}: {
  radius: number;
  color: string;
  isSelf: boolean;
  position: [number, number, number];
  opacityScale?: number;
  gravityDir?: { x: number; y: number };
  gravityDist?: number;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pointsMatRef = useRef<THREE.PointsMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();
  const tmpWorld = useMemo(() => new THREE.Vector3(), []);
  const tmpNdc = useMemo(() => new THREE.Vector3(), []);

  const baseCoreOpacity = 1;
  const basePointsOpacity = isSelf ? 0.9 : 0.6;

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // 반지름 주변 껍질에만 배치될 파티클 수
    const count = 110;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const baseColor = new THREE.Color(color);
    const seedBase = hashStringToSeed(`${color}:${radius}:${isSelf ? 1 : 0}`);

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
    const gz = 0;
    if (gravityDir) {
      const mag = Math.hypot(gravityDir.x, gravityDir.y);
      if (mag > 0.0001) {
        gx = gravityDir.x / mag;
        gy = gravityDir.y / mag;
      }
    }
    const hasGravity = distFactor > 0 && (gx !== 0 || gy !== 0);

    for (let i = 0; i < count; i += 1) {
      // 균일한 구 표면 분포 (결정적 pseudo-random)
      const u = seededRandom(seedBase + i * 11.17);
      const v = seededRandom(seedBase + i * 29.31 + 13.7);
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
      // 반지름 주변의 얇은 띠에만 위치시키되, 중력 방향 쪽에서만 살짝 더 부풀리기
      const shellThickness = radius * 0.08;
      const radialOffset =
        (seededRandom(seedBase + i * 3.77 + 101.3) - 0.5) * shellThickness;
      const radialBoost = 0.14 * distFactor * alignBoost;
      const r = radius + radialOffset + radialBoost * radius;

      const x = r * dirX;
      const y = r * dirY;
      const z = r * dirZ;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // 기본 밝기: 어두운(희미한) 점을 더 많이
      const baseBrightness =
        0.25 + 0.75 * Math.pow(seededRandom(seedBase + i * 7.13 + 303.9), 2.0);
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
  }, [radius, color, isSelf, gravityDir, gravityDist]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    // 화면 가장자리 페이드: 현재 월드 위치를 NDC로 투영해 opacity에 반영
    if (groupRef.current) {
      groupRef.current.getWorldPosition(tmpWorld);
      tmpNdc.copy(tmpWorld).project(camera);
      const fade = computeEdgeFadeNdc(tmpNdc.x, tmpNdc.y);
      const combined = fade * opacityScale;
      if (pointsMatRef.current) {
        pointsMatRef.current.opacity = basePointsOpacity * combined;
      }
      if (coreMatRef.current) {
        coreMatRef.current.opacity = baseCoreOpacity * combined;
      }
    }
    pointsRef.current.rotation.y += 0.18 * delta;
    pointsRef.current.rotation.x += 0.07 * delta;
  });

  return (
    <group ref={groupRef} position={position}>
      {/* 중앙 solid 구 */}
      <mesh>
        <sphereGeometry args={[radius * 0.55, 28, 28]} />
        <meshBasicMaterial
          ref={coreMatRef}
          color="#ffffff"
          transparent
          opacity={baseCoreOpacity}
        />
      </mesh>
      {/* 반지름 주변의 파티클 껍질 */}
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial
          ref={pointsMatRef}
          vertexColors
          size={radius * 0.013}
          sizeAttenuation
          transparent
          opacity={basePointsOpacity}
          depthWrite={false}
        />
      </points>
    </group>
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
  opacityScale = 1,
}: PlayerPlaneProps) => {
  // 글로벌 3D 뷰에서는 공을 조금 더 크게 표시
  const radius = 100 * PLANE_SCALE;
  return (
    <group position={[0, 0, depth]}>
      <PlayerParticleSphere
        radius={radius}
        color={player.cell.color || "#ffffff"}
        isSelf={Boolean(player.isSelf)}
        position={[worldX, worldY, 0.05]}
        opacityScale={opacityScale}
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
    bloomPass.strength = 0.9;
    bloomPass.radius = 0.4;

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
  initialViewMode,
  hideIframe = false,
  hideIframeOnStart = false,
}: GlobalPerspectiveViewProps) => {
  const { state, players, socket } = useGameClient("global");
  const audioIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Hydration-safe: 서버/클라 첫 렌더는 about:blank로 맞추고,
  // 마운트 이후에만 실제 src/origin을 계산해 주입한다.
  const [noiseCraftConfig, setNoiseCraftConfig] = useState<{
    src: string;
    origin: string | null;
  }>({ src: "about:blank", origin: null });
  const noiseCraftOrigin = noiseCraftConfig.origin ?? null;
  const noiseCraftSrc = noiseCraftConfig.src ?? "about:blank";
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || "front");
  const [iframeVisible, setIframeVisible] = useState(true);
  const { clusters, assignments } = useMemo(
    () => analyzeClusters(players, undefined, state.gameSize),
    [players, state.gameSize]
  );
  const significantClusters = useMemo(
    () => clusters.filter((cluster) => cluster.isMulti),
    [clusters]
  );

  const showPerf = useMemo(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("perf") === "1";
  }, []);
  const [isGlobalDebugView, setIsGlobalDebugView] = useState(false);

  useEffect(() => {
    // eslint(react-hooks/set-state-in-effect): defer state update to avoid sync cascades
    const id = window.setTimeout(() => {
      setNoiseCraftConfig(resolveNoiseCraftEmbed());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname || "";
    // eslint(react-hooks/set-state-in-effect): defer state update to avoid sync cascades
    const id = window.setTimeout(() => {
      setIsGlobalDebugView(path.startsWith("/global/debug"));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // initialViewMode가 변경되면 viewMode 업데이트
  useEffect(() => {
    if (initialViewMode !== undefined) {
      setViewMode(initialViewMode);
    }
  }, [initialViewMode]);

  useEffect(() => {
    if (!audioIframeRef.current) return;
    // When swapping/reloading the NoiseCraft iframe, drop any cached MonoSeq grids
    // so the next update can do a clean sync.
    resetNoiseCraftSequencerCache();
    audioIframeRef.current.src = noiseCraftSrc;
  }, [noiseCraftSrc]);

  useEffect(() => {
    if (!socket) return;
    const iframe = audioIframeRef.current;
    if (!iframe) return;

    const handleAudioGlobalV2 = (...args: unknown[]) => {
      const payload = args[0] as ServerAudioGlobalV2 | undefined;
      if (!payload || payload.version !== 1) return;

      const params = Array.isArray(payload.params)
        ? payload.params.map((p) => ({
            nodeId: String(p.nodeId),
            paramName: p.paramName || "value",
            value: Number(p.value),
          }))
        : [];

      if (params.length) {
        postNoiseCraftParams(iframe, noiseCraftOrigin, params);
      }

      const sequencer = payload.sequencer;
      const grids = sequencer?.grids;
      const nodeIds = sequencer?.nodeIds || {
        bass: "211",
        baritone: "212",
        tenor: "213",
      };
      if (grids) {
        postMonoSeqGridDiff(
          iframe,
          noiseCraftOrigin,
          nodeIds.bass,
          0,
          grids.bass
        );
        postMonoSeqGridDiff(
          iframe,
          noiseCraftOrigin,
          nodeIds.baritone,
          0,
          grids.baritone
        );
        postMonoSeqGridDiff(
          iframe,
          noiseCraftOrigin,
          nodeIds.tenor,
          0,
          grids.tenor
        );
      }
    };

    socket.on("audioGlobalV2", handleAudioGlobalV2);
    return () => {
      socket.off("audioGlobalV2", handleAudioGlobalV2);
    };
  }, [socket, noiseCraftOrigin]);

  // iframe에서 오는 메시지 처리 (Start Audio 클릭 감지)
  useEffect(() => {
    if (!hideIframeOnStart) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "noiseCraft:audioState") {
        if (event.data.status === "playing") {
          setIframeVisible(false);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [hideIframeOnStart]);

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
      {showPerf && (
        <PerfOverlay mode="global" population={state.ui.population} />
      )}
      <GlobalSpace state={state} players={players} viewMode={viewMode} />
      {/* NoiseCraft Embedded (글로벌 퍼스펙티브용 오디오) */}
      {/* hideIframe이 true면 완전히 숨김, hideIframeOnStart가 true이고 iframeVisible이 false면 UI만 숨김 (오디오는 계속 작동) */}
      {hideIframe ? null : (
        <>
          {isGlobalDebugView ? (
            <div className={`pointer-events-auto absolute inset-4 rounded-xl bg-black/70 p-2 text-xs text-white ${!iframeVisible ? "opacity-0 pointer-events-none" : ""}`}>
              <div className="mb-1 text-white/70">NoiseCraft · Global Debug</div>
              <iframe
                ref={audioIframeRef}
                src={noiseCraftSrc}
                allow="autoplay"
                title="NoiseCraft Global Debug"
                className="h-[calc(100%-20px)] w-full"
                style={{
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                }}
              />
            </div>
          ) : (
            <div className={`pointer-events-auto absolute bottom-4 left-4 rounded-xl bg-black/70 p-2 text-xs text-white ${!iframeVisible ? "opacity-0 pointer-events-none" : ""}`}>
              <div className="mb-1 text-white/70">NoiseCraft · Global</div>
              <iframe
                ref={audioIframeRef}
                src={noiseCraftSrc}
                width={260}
                height={64}
                allow="autoplay"
                title="NoiseCraft Global Perspective"
                className="h-[64px] w-[260px]"
                style={{
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                }}
              />
            </div>
          )}
        </>
      )}
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
            // dpr를 올려 글로벌 뷰 픽셀을 더 선명하게
            dpr={[1, 2]}
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
            <CollisionSprings3D
              state={state}
              lookup={playerWorldLookup}
              planeWidth={planeWidth}
              planeHeight={planeHeight}
            />
            <CollisionMarks3D
              state={state}
              planeWidth={planeWidth}
              planeHeight={planeHeight}
              lookup={playerWorldLookup}
            />
            <PostProcessing />
            {planeData.map(({ player, depth, worldX, worldY }) => {
              // 월드 경계(위/아래/좌/우)로 갈수록 공이 페이드아웃 (복제 렌더링 없음)
              const wrapFadeW = planeWidth * 0.12;
              const wrapFadeH = planeHeight * 0.06;
              const halfW = planeWidth / 2;
              const halfH = planeHeight / 2;

              const distLeft = worldX + halfW;
              const distRight = halfW - worldX;
              const distBottom = worldY + halfH;
              const distTop = halfH - worldY;

              const fx =
                wrapFadeW > 0
                  ? clamp01(Math.min(distLeft, distRight) / wrapFadeW)
                  : 1;
              const fy =
                wrapFadeH > 0
                  ? clamp01(Math.min(distBottom, distTop) / wrapFadeH)
                  : 1;
              const opacityScale = Math.min(fx, fy);

              return (
                <PlayerPlane
                  key={player.id}
                  player={player}
                  depth={depth}
                  planeWidth={planeWidth}
                  planeHeight={planeHeight}
                  isFocused={player.isSelf ?? false}
                  worldX={worldX}
                  worldY={worldY}
                  opacityScale={opacityScale}
                />
              );
            })}
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
  opacityScale?: number;
}

const CollisionSprings3D = ({
  state,
  lookup,
  planeWidth,
  planeHeight,
}: {
  state: GameState;
  lookup: Map<string, { worldX: number; worldY: number; depth: number }>;
  planeWidth: number;
  planeHeight: number;
}) => {
  const springs = useMemo(() => {
    return state.collisionLines
      .map<SpringSegment | null>((line) => {
        const a = lookup.get(line.players[0]);
        const b = lookup.get(line.players[1]);
        if (!a || !b) return null;
        // 연결선은 항상 "월드 박스 내부" 표현으로만 그린다.
        // (토러스의 가장 가까운 경로로 선을 이동/보정하지 않음)

        // 월드 경계 근처에서는 연결선도 같이 페이드아웃 (래핑 점프를 덜 거슬리게)
        const wrapFadeW = planeWidth * 0.12;
        const wrapFadeH = planeHeight * 0.12;
        const halfW = planeWidth / 2;
        const halfH = planeHeight / 2;
        const edgeFadeAt = (x: number, y: number) => {
          if (planeWidth <= 0 || planeHeight <= 0) return 1;
          const distLeft = x + halfW;
          const distRight = halfW - x;
          const distBottom = y + halfH;
          const distTop = halfH - y;
          const fx =
            wrapFadeW > 0
              ? clamp01(Math.min(distLeft, distRight) / wrapFadeW)
              : 1;
          const fy =
            wrapFadeH > 0
              ? clamp01(Math.min(distBottom, distTop) / wrapFadeH)
              : 1;
          return Math.min(fx, fy);
        };
        const opacityScale = Math.min(
          edgeFadeAt(a.worldX, a.worldY),
          edgeFadeAt(b.worldX, b.worldY)
        );
        return {
          id: line.id,
          startedAt: line.startedAt,
          lastEvent: line.lastEvent,
          from: new THREE.Vector3(a.worldX, a.worldY, a.depth + 0.05),
          to: new THREE.Vector3(b.worldX, b.worldY, b.depth + 0.05),
          opacityScale,
        };
      })
      .filter((segment): segment is SpringSegment => Boolean(segment));
  }, [lookup, state.collisionLines, planeHeight, planeWidth]);

  if (!springs.length) return null;

  return (
    <>
      {springs.map((spring) => (
        <CollisionSpring3D key={spring.id} {...spring} />
      ))}
    </>
  );
};

// 충돌 마크를 위한 빛나는 효과와 파티클 시스템
const CollisionMarks3D = ({
  state,
  planeWidth,
  planeHeight,
  lookup,
}: {
  state: GameState;
  planeWidth: number;
  planeHeight: number;
  lookup: Map<string, { worldX: number; worldY: number; depth: number }>;
}) => {
  const marks = useMemo(() => {
    // 시간 기반 페이드는 "렌더 시점"에 계산할 수밖에 없어서 예외 처리
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const CORE_DURATION = 300000; // 5분 (코어 점)
    const PARTICLE_DURATION = 50000; // 50초 (파티클/스파클)
    return state.collisionMarks
      .map((mark) => {
        const coreAge = (now - mark.timestamp) / CORE_DURATION;
        if (coreAge >= 1) return null;
        const particleAge = Math.min(
          1,
          (now - mark.timestamp) / PARTICLE_DURATION
        );
        const worldX = toWorldX(mark.position.x, state.gameSize.width);
        const worldY = toWorldY(mark.position.y, state.gameSize.height);
        const players = mark.players
          ? mark.players
              .map((id) => state.players[id])
              .filter((p) => p !== undefined)
          : [];
        // 충돌한 두 플레이어의 가운데 depth (없으면 0)
        let depth = 0;
        if (mark.players && mark.players.length) {
          const depths = mark.players
            .map((id) => lookup.get(id))
            .filter(
              (
                entry
              ): entry is { worldX: number; worldY: number; depth: number } =>
                Boolean(entry)
            )
            .map((entry) => entry.depth);
          if (depths.length > 0) {
            depth = depths.reduce((sum, d) => sum + d, 0) / depths.length;
          }
        }
        return {
          ...mark,
          worldX,
          worldY,
          depth,
          coreAge,
          particleAge,
          players,
        };
      })
      .filter((mark): mark is NonNullable<typeof mark> => mark !== null);
  }, [state.collisionMarks, state.gameSize, state.players, lookup]);

  if (!marks.length) return null;

  return (
    <>
      {marks.map((mark) => (
        <CollisionGlowEffect key={mark.id} mark={mark} />
      ))}
      {marks.map((mark) => (
        <CollisionParticleBurst key={`particles-${mark.id}`} mark={mark} />
      ))}
      {marks.map((mark) => (
        <CollisionObjectParticles
          key={`object-particles-${mark.id}`}
          mark={mark}
          state={state}
          lookup={lookup}
        />
      ))}
    </>
  );
};

// 충돌 위치의 빛나는 효과 (우주에서 빛나는 별처럼)
const CollisionGlowEffect = ({
  mark,
}: {
  mark: {
    id: string;
    worldX: number;
    worldY: number;
    depth: number;
    coreAge: number;
    particleAge: number;
    radius: number;
    players: PlayerSnapshot[];
  };
}) => {
  const lightRef = useRef<THREE.PointLight>(null);
  const glowOuterRef = useRef<THREE.Mesh>(null);
  const sparkleRef = useRef<THREE.Points>(null);

  // 흰색 별빛 (약간의 따뜻함이 가미된 순수한 흰색)
  const starColor = useMemo(() => new THREE.Color(1.0, 0.98, 0.95), []); // 약간 따뜻한 흰색
  const pureWhite = useMemo(() => new THREE.Color(1, 1, 1), []);

  useFrame(() => {
    if (!lightRef.current || !glowOuterRef.current) return;
    const now = performance.now();

    // 부드러운 펄스 효과 (별이 깜빡이는 것처럼 - 더 자연스럽게)
    const pulse1 = 0.88 + 0.12 * Math.sin(now * 0.0018);
    const pulse2 = 0.92 + 0.08 * Math.cos(now * 0.0012);
    const pulse3 = 0.9 + 0.1 * Math.sin(now * 0.0025);
    const combinedPulse = (pulse1 + pulse2 + pulse3) / 3;

    // 코어 점은 10분 동안 유지
    const life = 1 - mark.coreAge;
    // 매우 부드러운 감쇠
    const fadeOut = Math.pow(life, 0.3);

    // 빛의 강도 (별처럼 강렬하지만 부드럽게)
    const intensity = 30 * combinedPulse * fadeOut;
    lightRef.current.intensity = intensity;
    lightRef.current.color = pureWhite;
    lightRef.current.distance = 100 + mark.radius * PLANE_SCALE * 6;

    //   // 외부 글로우 구체 (별의 빛 확산 - 가운데는 비우고, 바깥만 살짝 밝게)
    //   const glowOuterScale = 1 + 0.2 * Math.sin(now * 0.002);
    //   if (glowOuterRef.current.scale.x !== glowOuterScale) {
    //     glowOuterRef.current.scale.setScalar(glowOuterScale);
    //   }
    //   const glowOuterMaterial = glowOuterRef.current.material as THREE.MeshBasicMaterial;
    //   if (glowOuterMaterial) {
    //     glowOuterMaterial.opacity = 0.005 * fadeOut * combinedPulse;
    //     glowOuterMaterial.color = pureWhite;
    //   }
  });

  // 초기 위치
  const position: [number, number, number] = [
    mark.worldX,
    mark.worldY,
    mark.depth,
  ];

  // 반짝이는 파티클 (별 주변의 작은 반짝임 - 흰색)
  const sparkleGeometry = useMemo(() => {
    const count = 40;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seedBase = hashStringToSeed(`sparkle:${mark.id}:${mark.radius}`);

    for (let i = 0; i < count; i += 1) {
      const radius =
        mark.radius *
        PLANE_SCALE *
        (1.8 + seededRandom(seedBase + i * 5.11) * 1.2);
      const theta = seededRandom(seedBase + i * 9.23 + 17.2) * Math.PI * 2;
      const phi = seededRandom(seedBase + i * 13.37 + 91.1) * Math.PI;

      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
      positions[i * 3 + 2] = Math.cos(phi) * radius;

      // 흰색 계열 (약간의 밝기 변화)
      const brightness = 0.9 + seededRandom(seedBase + i * 2.07 + 777.7) * 0.1;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness * 0.98;
      colors[i * 3 + 2] = brightness * 0.95;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  }, [mark.id, mark.radius]);

  useFrame(() => {
    if (sparkleRef.current && mark.particleAge < 0.99) {
      // 스파클은 50초 안에서만 보이도록 (particleAge 기준)
      const life = 1 - mark.particleAge;
      const material = sparkleRef.current.material as THREE.PointsMaterial;
      if (material) {
        material.opacity = 0.6 * life;
      }
    }
  });

  return (
    <group position={position}>
      {/* 동적 PointLight - 별의 빛 */}
      <pointLight
        ref={lightRef}
        intensity={30}
        distance={100}
        decay={1.2}
        color={pureWhite}
      />

      {/* 외부 글로우 구체 - 별의 빛 확산 (가운데 구 없이, 바깥만 은은하게)
      <mesh ref={glowOuterRef}>
        <sphereGeometry args={[mark.radius * PLANE_SCALE * 1.4, 32, 32]} />
        <meshBasicMaterial
          color={pureWhite}
          transparent
          opacity={0.16}
          toneMapped={false}
        />
      </mesh> */}

      {/* 반짝이는 파티클 (별 주변의 작은 반짝임) */}
      {mark.particleAge < 0.99 && (
        <points ref={sparkleRef} geometry={sparkleGeometry}>
          <pointsMaterial
            vertexColors
            size={mark.radius * PLANE_SCALE * 0.05}
            sizeAttenuation
            transparent
            opacity={0.7}
          />
        </points>
      )}
    </group>
  );
};

// 충돌 시 파티클이 흩뿌려지는 효과 (운석 충돌 느낌)
const CollisionParticleBurst = ({
  mark,
}: {
  mark: {
    id: string;
    worldX: number;
    worldY: number;
    depth: number;
    coreAge: number;
    particleAge: number;
    radius: number;
    players: PlayerSnapshot[];
  };
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const startTimeRef = useRef<number>(0);

  const { geometry, velocities } = useMemo(() => {
    const particleCount = 40; // 더 많은 파티클
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities: Array<{ x: number; y: number; z: number }> = [];
    const seedBase = hashStringToSeed(`burst:${mark.id}:${mark.radius}`);

    // 플레이어 색상 가져오기
    const playerColors =
      mark.players.length > 0
        ? mark.players.map((p) => new THREE.Color(p.cell.color || "#ffffff"))
        : [new THREE.Color("#ffffff")];

    for (let i = 0; i < particleCount; i += 1) {
      // 구면에서 랜덤하게 방출 (운석 파편처럼)
      const theta = seededRandom(seedBase + i * 3.11) * Math.PI * 2;
      const phi = Math.acos(2 * seededRandom(seedBase + i * 7.19 + 19.9) - 1);
      // 초기 속도가 더 빠르게 (운석 충돌 느낌)
      const speed = 1.2 + seededRandom(seedBase + i * 11.7 + 71.3) * 1.5;

      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.sin(phi) * Math.sin(theta);
      const dirZ = Math.cos(phi);

      // 초기 위치는 충돌 지점 (원점)
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;

      velocities.push({
        x: dirX * speed,
        y: dirY * speed,
        z: dirZ * speed,
      });

      // 플레이어 색상 중 랜덤 선택
      const pick =
        Math.floor(
          seededRandom(seedBase + i * 17.3 + 313.3) * playerColors.length
        ) || 0;
      const color = playerColors[pick] ?? playerColors[0];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return { geometry, velocities };
  }, [mark.id, mark.players, mark.radius]);

  useEffect(() => {
    velocitiesRef.current = velocities;
    startTimeRef.current = performance.now();
  }, [velocities]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !velocitiesRef.current) return;

    const elapsed = (performance.now() - startTimeRef.current) * 0.001; // 초
    // 파티클은 최대 50초까지만 유지 (particleAge와 동일 스케일)
    const maxLife = 50;
    const life = Math.max(0, 1 - elapsed / maxLife);

    if (life <= 0) return;

    const geometry = pointsRef.current.geometry;
    const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
    if (!positionAttr) return;

    // 중력 효과 (아래로 떨어짐) - 매우 약하게
    const gravity = -0.05;
    // 저항 (공기 저항) - 매우 천천히 정지
    const drag = 0.998;

    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < velocitiesRef.current.length; i += 1) {
      const vel = velocitiesRef.current[i];
      if (!vel) continue;

      // 속도 업데이트 (중력 + 저항) - 매우 천천히
      vel.x *= drag;
      vel.y *= drag;
      vel.z = (vel.z + gravity * delta) * drag;

      // 위치 업데이트
      positions[i * 3] += vel.x * delta * 0.3;
      positions[i * 3 + 1] += vel.y * delta * 0.3;
      positions[i * 3 + 2] += vel.z * delta * 0.3;
    }

    positionAttr.needsUpdate = true;

    // 나이에 따라 매우 천천히 투명해짐
    const material = pointsRef.current.material as THREE.PointsMaterial;
    if (material) {
      // 5분에 걸쳐 천천히 사라짐
      material.opacity = Math.pow(life, 0.5) * 0.8;
    }
  });

  // 파티클은 50초까지만 렌더링 (particleAge 기준)
  if (mark.particleAge > 0.99) return null;

  return (
    <points
      ref={pointsRef}
      position={[mark.worldX, mark.worldY, mark.depth]}
      geometry={geometry}
    >
      <pointsMaterial
        vertexColors
        size={mark.radius * PLANE_SCALE * 0.06}
        sizeAttenuation
        transparent
        opacity={0.8}
      />
    </points>
  );
};

// 충돌한 object들의 파티클이 주변에 흩뿌려지는 효과 (운석 충돌 느낌)
const CollisionObjectParticles = ({
  mark,
  state,
  lookup,
}: {
  mark: {
    id: string;
    worldX: number;
    worldY: number;
    depth: number;
    coreAge: number;
    particleAge: number;
    radius: number;
    players: PlayerSnapshot[];
  };
  state: GameState;
  lookup: Map<string, { worldX: number; worldY: number; depth: number }>;
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const startTimeRef = useRef<number>(0);

  const { geometry, velocities } = useMemo(() => {
    if (!mark.players || mark.players.length === 0) {
      return { geometry: null, velocities: [] };
    }

    // 충돌한 object들의 파티클을 수집
    const allParticles: Array<{
      x: number;
      y: number;
      z: number;
      color: THREE.Color;
    }> = [];

    mark.players.forEach((player) => {
      const playerWorld = lookup.get(player.id);
      if (!playerWorld) return;

      // 각 object에서 파티클 추출 (운석 파편처럼)
      const particleCount = 12; // object당 파티클 수
      const playerColor = new THREE.Color("#ffffff");

      for (let i = 0; i < particleCount; i += 1) {
        const seedBase = hashStringToSeed(`obj:${mark.id}:${player.id}:${i}`);
        // object 중심에서 약간 떨어진 위치
        const offsetRadius =
          player.cell.radius *
          PLANE_SCALE *
          (0.3 + seededRandom(seedBase + 1.1) * 0.4);
        const theta = seededRandom(seedBase + 2.2) * Math.PI * 2;
        const phi = seededRandom(seedBase + 3.3) * Math.PI;

        const offsetX = Math.sin(phi) * Math.cos(theta) * offsetRadius;
        const offsetY = Math.sin(phi) * Math.sin(theta) * offsetRadius;
        const offsetZ = Math.cos(phi) * offsetRadius;

        allParticles.push({
          x: playerWorld.worldX - mark.worldX + offsetX,
          y: playerWorld.worldY - mark.worldY + offsetY,
          // 마크 depth(충돌 중앙) 기준 상대 위치
          z: playerWorld.depth - mark.depth + offsetZ,
          color: playerColor.clone(),
        });
      }
    });

    if (allParticles.length === 0) {
      return { geometry: null, velocities: [] };
    }

    const particleCount = allParticles.length;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities: Array<{ x: number; y: number; z: number }> = [];

    allParticles.forEach((particle, i) => {
      positions[i * 3] = particle.x;
      positions[i * 3 + 1] = particle.y;
      positions[i * 3 + 2] = particle.z;

      colors[i * 3] = particle.color.r;
      colors[i * 3 + 1] = particle.color.g;
      colors[i * 3 + 2] = particle.color.b;

      // 충돌 지점에서 멀어지는 방향으로 초기 속도
      const dist = Math.hypot(particle.x, particle.y, particle.z);
      if (dist > 0.001) {
        const speed =
          0.3 + seededRandom(hashStringToSeed(`spd:${mark.id}:${i}`)) * 0.4; // 천천히 퍼짐
        velocities.push({
          x: (particle.x / dist) * speed,
          y: (particle.y / dist) * speed,
          z: (particle.z / dist) * speed * 0.5, // z축은 더 천천히
        });
      } else {
        velocities.push({ x: 0, y: 0, z: 0 });
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return { geometry, velocities };
  }, [
    mark.id,
    mark.players,
    mark.radius,
    mark.worldX,
    mark.worldY,
    mark.depth,
    lookup,
    state.players,
  ]);

  useEffect(() => {
    velocitiesRef.current = velocities;
    startTimeRef.current = performance.now();
  }, [velocities]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !geometry || !velocitiesRef.current) return;

    const elapsed = (performance.now() - startTimeRef.current) * 0.001; // 초
    // 오브젝트 파편도 최대 50초까지만 유지
    const maxLife = 50;
    const life = Math.max(0, 1 - elapsed / maxLife);

    if (life <= 0) return;

    const positionAttr = pointsRef.current.geometry.attributes
      .position as THREE.BufferAttribute;
    if (!positionAttr) return;

    // 중력 효과 (아래로 떨어짐) - 매우 약하게
    const gravity = -0.02;
    // 저항 (공기 저항) - 매우 천천히 정지
    const drag = 0.999;

    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < velocitiesRef.current.length; i += 1) {
      const vel = velocitiesRef.current[i];
      if (!vel) continue;

      // 속도 업데이트 (중력 + 저항) - 매우 천천히
      vel.x *= drag;
      vel.y *= drag;
      vel.z = (vel.z + gravity * delta) * drag;

      // 위치 업데이트
      positions[i * 3] += vel.x * delta * 0.2;
      positions[i * 3 + 1] += vel.y * delta * 0.2;
      positions[i * 3 + 2] += vel.z * delta * 0.2;
    }

    positionAttr.needsUpdate = true;

    // 나이에 따라 매우 천천히 투명해짐
    const material = pointsRef.current.material as THREE.PointsMaterial;
    if (material) {
      // 5분에 걸쳐 천천히 사라짐
      material.opacity = Math.pow(life, 0.4) * 0.7;
    }
  });

  // 오브젝트 파편도 50초까지만 렌더링
  if (!geometry || mark.particleAge > 0.99) return null;

  return (
    <points
      ref={pointsRef}
      position={[mark.worldX, mark.worldY, mark.depth]}
      geometry={geometry}
    >
      <pointsMaterial
        vertexColors
        size={mark.radius * PLANE_SCALE * 0.05}
        sizeAttenuation
        transparent
        opacity={0.7}
      />
    </points>
  );
};

const CollisionSpring3D = ({
  from,
  to,
  startedAt,
  lastEvent,
  opacityScale = 1,
}: SpringSegment) => {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const lineMatRef = useRef<THREE.LineBasicMaterial>(null);
  const fromMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const toMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const tmpNdc = useMemo(() => new THREE.Vector3(), []);
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

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const a = fromRef.current;
    const b = toRef.current;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const planarDist = Math.hypot(dx, dy);

    // 화면 가장자리 페이드 (두 끝 중 더 약한 값 사용)
    tmpA.set(a.x, a.y, a.z);
    tmpB.set(b.x, b.y, b.z);
    tmpNdc.copy(tmpA).project(camera);
    const fadeA = computeEdgeFadeNdc(tmpNdc.x, tmpNdc.y);
    tmpNdc.copy(tmpB).project(camera);
    const fadeB = computeEdgeFadeNdc(tmpNdc.x, tmpNdc.y);
    const edgeFade = Math.min(fadeA, fadeB) * opacityScale;

    // 거리 기반 페이드: 멀수록 더 연하게
    // (월드 좌표 단위 기준; 필요하면 튜닝)
    const DIST_FADE_START = 18;
    const DIST_FADE_END = 120;
    const distT = smoothstep(DIST_FADE_START, DIST_FADE_END, planarDist);
    const distFade = 1 - 0.75 * distT; // 가까우면 1, 멀면 0.25

    const fade = edgeFade * distFade;
    if (lineMatRef.current) {
      lineMatRef.current.opacity = SPRING_LINE_OPACITY * fade;
    }
    if (fromMatRef.current) {
      fromMatRef.current.opacity = 0.6 * fade;
    }
    if (toMatRef.current) {
      toMatRef.current.opacity = 0.6 * fade;
    }
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
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <line>
        <bufferGeometry ref={geometryRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={lineMatRef}
          color="#d2d8e0"
          transparent
          opacity={SPRING_LINE_OPACITY}
          toneMapped={false}
        />
      </line>
      <mesh position={[from.x, from.y, from.z]}>
        <sphereGeometry args={[SPRING_GLOW_RADIUS, 12, 12]} />
        <meshBasicMaterial
          ref={fromMatRef}
          color="#e2e8e0"
          toneMapped={false}
          transparent
          opacity={0.6}
        />
      </mesh>
      <mesh position={[to.x, to.y, to.z]}>
        <sphereGeometry args={[SPRING_GLOW_RADIUS, 12, 12]} />
        <meshBasicMaterial
          ref={toMatRef}
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
