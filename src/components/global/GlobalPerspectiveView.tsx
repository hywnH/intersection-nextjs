"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import {
  Html,
  OrbitControls,
  PerspectiveCamera,
  Edges,
  Grid,
} from "@react-three/drei";
import { useGameClient } from "@/lib/game/hooks";
import type { PlayerSnapshot } from "@/types/game";

const PLANE_SCALE = 0.03;
const DEPTH_SCALE = 0.002;
const CAMERA_HEIGHT_FACTOR = 0.25;
const CAMERA_DISTANCE_FACTOR = 0.5;

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
          color={isFocused ? "#172554" : "#020617"}
          transparent
          opacity={isFocused ? 0.4 : 0.25}
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
        <meshStandardMaterial
          color={player.cell.color || "#38bdf8"}
          emissive={player.isSelf ? player.cell.color || "#38bdf8" : "#000000"}
          emissiveIntensity={player.isSelf ? 0.6 : 0.1}
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

const GlobalPerspectiveView = () => {
  const { state, players } = useGameClient("global");

  const planeWidth = state.gameSize.width * PLANE_SCALE;
  const planeHeight = state.gameSize.height * PLANE_SCALE;

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
      <div className="absolute inset-0">
        {players.length === 0 ? (
          <EmptyState message="연결 대기 중..." />
        ) : (
          <Suspense fallback={<EmptyState message="3D 뷰 로딩 중..." />}>
            <Canvas
              className="h-full w-full"
              camera={{
                position: [
                  0,
                  Math.max(6, planeHeight * CAMERA_HEIGHT_FACTOR),
                  Math.max(12, planeWidth * CAMERA_DISTANCE_FACTOR),
                ],
                fov: 55,
              }}
              shadows
            >
              <color attach="background" args={["#020617"]} />
              <fog attach="fog" args={["#020617", 20, 200]} />
              <ambientLight intensity={0.35} />
              <directionalLight
                position={[10, 12, 8]}
                castShadow
                intensity={1.2}
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <PerspectiveCamera
                makeDefault
                position={[
                  0,
                  Math.max(6, planeHeight * CAMERA_HEIGHT_FACTOR),
                  Math.max(12, planeWidth * CAMERA_DISTANCE_FACTOR),
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
