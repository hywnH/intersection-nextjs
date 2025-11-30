"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Html,
  OrbitControls,
  PerspectiveCamera,
  Edges,
  Grid,
} from "@react-three/drei";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useGameClient } from "@/lib/game/hooks";
import type { PlayerSnapshot } from "@/types/game";

import { MeshLineGeometry, MeshLineMaterial } from "meshline";

const PLANE_SCALE = 0.03;
const DEPTH_SCALE = 0.002;
const CAMERA_HEIGHT_FACTOR = 0.25;
const CAMERA_DISTANCE_FACTOR = 0.5;
const SPARK_COLORS = [
  "#A2CCB6",
  "#FCEEB5",
  "#EE786E",
  "#e0feff",
  "#fda4af",
  "#93c5fd",
];

type MouseRef = React.MutableRefObject<[number, number]>;

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
          opacity={isFocused ? 0.45 : 0.3}
          metalness={0.1}
          roughness={0.8}
        />
        <Edges color={isFocused ? "#93c5fd" : "#475569"} />
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
          emissive={player.isSelf ? player.cell.color || "#38bdf8" : "#000000"}
          emissiveIntensity={player.isSelf ? 0.6 : 0.1}
          metalness={0.45}
          roughness={0.25}
          clearcoat={0.6}
          clearcoatRoughness={0.15}
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

const BackgroundParticles = ({
  count,
  mouse,
}: {
  count: number;
  mouse: MouseRef;
}) => {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const lightRef = useRef<THREE.PointLight | null>(null);
  const { size, viewport } = useThree();
  const aspect = size.width / viewport.width;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(0.22, 0), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#050814",
        emissive: "#0c1224",
        roughness: 0.8,
        metalness: 0.35,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const particles = useMemo(() => {
    return Array.from({ length: count }).map(() => ({
      t: Math.random() * 100,
      factor: 20 + Math.random() * 120,
      speed: 0.01 + Math.random() / 150,
      xFactor: -80 + Math.random() * 160,
      yFactor: -50 + Math.random() * 100,
      zFactor: -80 + Math.random() * 160,
      mx: 0,
      my: 0,
    }));
  }, [count]);

  useFrame(() => {
    if (!meshRef.current) return;
    particles.forEach((particle, index) => {
      const { factor, speed, xFactor, yFactor, zFactor } = particle;
      particle.t += speed / 2;
      const { t } = particle;
      const a = Math.cos(t) + Math.sin(t * 1) / 10;
      const b = Math.sin(t) + Math.cos(t * 2) / 10;
      const s = Math.cos(t);
      particle.mx += (mouse.current[0] - particle.mx) * 0.01;
      particle.my += (-mouse.current[1] - particle.my) * 0.01;
      dummy.position.set(
        particle.mx * 5 * a +
          xFactor +
          Math.cos((t / 10) * factor) +
          (Math.sin(t) * factor) / 10,
        particle.my * 5 * b +
          yFactor +
          Math.sin((t / 10) * factor) +
          (Math.cos(t * 2) * factor) / 10,
        particle.my * 3 * b +
          zFactor +
          Math.cos((t / 10) * factor) +
          (Math.sin(t * 3) * factor) / 10
      );
      dummy.scale.setScalar(Math.max(0.2, s));
      dummy.rotation.set(s * 5, s * 5, s * 5);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(index, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (lightRef.current) {
      lightRef.current.position.set(
        (mouse.current[0] / aspect) * 10,
        (-mouse.current[1] / aspect) * 6,
        0
      );
    }
  });

  return (
    <group renderOrder={-30}>
      <pointLight ref={lightRef} distance={80} intensity={6} color="#93c5fd" />
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
    </group>
  );
};

interface FatLineProps {
  curve: THREE.Vector3[];
  width: number;
  color: string;
  speed: number;
}

const FatLine = ({ curve, width, color, speed }: FatLineProps) => {
  const { size } = useThree();
  const geometry = useMemo(() => new MeshLineGeometry(), []);
  const material = useMemo(() => {
    const mat = new MeshLineMaterial({
      lineWidth: width,
      color,
      dashArray: 0.2,
      dashRatio: 0.9,
      resolution: new THREE.Vector2(size.width, size.height),
    });
    mat.transparent = true;
    mat.depthTest = false;
    mat.opacity = 0.85;
    return mat;
  }, [color, size.height, size.width, width]);

  useEffect(() => {
    geometry.setPoints(curve);
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [curve, geometry, material]);

  useFrame(() => {
    if (material.uniforms?.dashOffset) {
      material.uniforms.dashOffset.value -= speed;
    }
  });

  return <mesh geometry={geometry} material={material} />;
};

const SparkLines = ({
  mouse,
  count,
  colors,
  radius = 12,
}: {
  mouse: MouseRef;
  count: number;
  colors: string[];
  radius?: number;
}) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const lines = useMemo(() => {
    return new Array(count).fill(null).map((_, index) => {
      const start = new THREE.Vector3(
        Math.sin(0) * radius * Math.random(),
        Math.cos(0) * radius * Math.random(),
        0
      );
      const points = new Array(30).fill(null).map((__, i) => {
        const angle = (i / 20) * Math.PI * 2;
        return start
          .clone()
          .add(
            new THREE.Vector3(
              Math.sin(angle) * radius * Math.max(0.3, Math.random()),
              Math.cos(angle) * radius * Math.max(0.3, Math.random()),
              (Math.sin(angle * 2) * radius) / 4
            )
          );
      });
      const curve = new THREE.CatmullRomCurve3(points).getPoints(400);
      return {
        curve,
        color: colors[Math.floor(Math.random() * colors.length)] ?? "#ffffff",
        width: Math.max(0.06, (0.35 * index) / 10),
        speed: Math.max(0.001, 0.003 * Math.random()),
      };
    });
  }, [colors, count, radius]);

  const { size, viewport } = useThree();
  const aspect = size.width / viewport.width;

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      (mouse.current[1] / aspect) * 0.1,
      0.05
    );
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      (mouse.current[0] / aspect) * 0.05,
      0.05
    );
  });

  return (
    <group ref={groupRef} renderOrder={-25}>
      <group
        position={[-radius * 0.6, -radius * 0.4, -12]}
        scale={[1.2, 1.35, 1]}
      >
        {lines.map((props, index) => (
          <FatLine key={`line-${index}`} {...props} />
        ))}
      </group>
    </group>
  );
};

const PostProcessing = () => {
  const composerRef = useRef<EffectComposer | null>(null);
  const { gl, scene, camera, size } = useThree();

  useEffect(() => {
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      1.5,
      0.8,
      0
    );
    bloomPass.threshold = 0.2;
    bloomPass.strength = 1.35;
    bloomPass.radius = 0.65;

    const composer = new EffectComposer(gl);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    bloomPass.renderToScreen = true;
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

const GlobalPerspectiveView = () => {
  const { state, players } = useGameClient("global");
  const pointerRef = useRef<[number, number]>([0, 0]);

  const planeWidth = state.gameSize.width * PLANE_SCALE;
  const planeHeight = state.gameSize.height * PLANE_SCALE;

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    pointerRef.current = [x, y];
  };

  const handlePointerLeave = () => {
    pointerRef.current = [0, 0];
  };

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
      const depth = (targetDepth - average + index * 120) * DEPTH_SCALE;
      return {
        player,
        depth,
        worldX: toWorldX(player.cell.position.x, state.gameSize.width),
        worldY: toWorldY(player.cell.position.y, state.gameSize.height),
      };
    });
  }, [players, state.gameSize.height, state.gameSize.width]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div
        className="absolute inset-0"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {players.length === 0 ? (
          <EmptyState message="연결 대기 중..." />
        ) : (
          <Suspense fallback={<EmptyState message="3D 뷰 로딩 중..." />}>
            <Canvas
              className="h-full w-full"
              linear
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
              <fog attach="fog" args={["#02030f", 80, 260]} />
              <BackgroundParticles
                count={players.length > 0 ? 600 : 320}
                mouse={pointerRef}
              />
              <SparkLines
                count={24}
                mouse={pointerRef}
                colors={SPARK_COLORS}
                radius={Math.max(12, planeWidth * 0.35)}
              />
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
                makeDefault
                position={[
                  0,
                  Math.max(8, planeHeight * CAMERA_HEIGHT_FACTOR),
                  Math.max(14, planeWidth * CAMERA_DISTANCE_FACTOR),
                ]}
                fov={55}
              />
              <OrbitControls
                enableDamping
                dampingFactor={0.08}
                minPolarAngle={0.2}
                maxPolarAngle={Math.PI - 0.24}
                target={[0, 0, 0]}
              />
              <Grid
                args={[planeWidth * 2, planeHeight * 2]}
                position={[0, 0, 0]}
                cellSize={1}
                sectionSize={4}
                sectionThickness={0.6}
                cellColor="#0f172a"
                sectionColor="#1d4ed8"
                fadeDistance={60}
                fadeStrength={1}
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
      <div className="pointer-events-none absolute left-0 top-0 z-20 flex h-full w-64 flex-col gap-4 bg-black/60 p-6 text-white">
        <p className="text-xs uppercase tracking-[0.4em] text-blue-300">
          Perspective
        </p>
        <h2 className="text-2xl font-semibold">실시간 참여자</h2>
        <div className="flex-1 overflow-auto text-sm text-white/70">
          {players.length === 0 ? (
            <p className="text-white/40">연결 대기 중...</p>
          ) : (
            <ul className="space-y-2">
              {players.map((player) => (
                <li key={player.id} className="rounded-lg bg-white/5 p-2">
                  <p className="text-white">{player.name || "익명"}</p>
                  <p className="text-xs text-white/60">
                    depth {(player.depth ?? 0).toFixed(0)} | 좌표{" "}
                    {player.cell.position.x.toFixed(0)},{" "}
                    {player.cell.position.y.toFixed(0)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="text-xs text-white/60">
          인원 {state.ui.population.toLocaleString()}
        </div>
      </div>
    </div>
  );
};

export default GlobalPerspectiveView;
