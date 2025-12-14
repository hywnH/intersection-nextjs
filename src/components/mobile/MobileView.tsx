"use client";

import { useEffect, useRef } from "react";
import { renderScene } from "@/lib/game/renderer";
import CanvasSurface from "@/components/shared/CanvasSurface";
import { usePersonalRuntime } from "@/lib/runtime/PersonalRuntimeProvider";
import type { GameState, PlayerSnapshot } from "@/types/game";

const INTERPOLATION_LAG_MS = Number(
  process.env.NEXT_PUBLIC_INTERP_LAG_MS ?? 80
);
const DISABLE_INTERPOLATION =
  process.env.NEXT_PUBLIC_DISABLE_INTERPOLATION === "true" ||
  process.env.NEXT_PUBLIC_DISABLE_INTERP === "true";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const buildInterpolatedState = (state: GameState): GameState => {
  if (
    DISABLE_INTERPOLATION ||
    state.mode !== "personal" ||
    state.snapshotBuffer.length === 0
  ) {
    return state;
  }

  const target = Date.now() - INTERPOLATION_LAG_MS;
  const frames = state.snapshotBuffer;
  let older = frames[0];
  let newer = frames[frames.length - 1];

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    if (frame.timestamp <= target) {
      older = frame;
    }
    if (frame.timestamp >= target) {
      newer = frame;
      break;
    }
  }

  if (newer.timestamp < target) {
    older = newer;
  }

  let alpha = 0;
  if (newer !== older && newer.timestamp !== older.timestamp) {
    alpha = (target - older.timestamp) / (newer.timestamp - older.timestamp);
    alpha = Math.min(Math.max(alpha, 0), 1);
  }

  const playerIds = new Set<string>([
    ...older.order,
    ...newer.order,
    ...Object.keys(older.players),
    ...Object.keys(newer.players),
    ...Object.keys(state.players),
  ]);
  const interpolatedPlayers: Record<string, PlayerSnapshot> = {};

  playerIds.forEach((id) => {
    const from = older.players[id] ?? newer.players[id] ?? state.players[id];
    const to = newer.players[id] ?? older.players[id] ?? state.players[id];
    if (!from && !to) return;
    if (!from || !to) {
      const single = (from ?? to)!;
      interpolatedPlayers[id] = {
        ...single,
        lastUpdate: Date.now(),
      };
      return;
    }
    const cell = {
      ...from.cell,
      position: {
        x: lerp(from.cell.position.x, to.cell.position.x, alpha),
        y: lerp(from.cell.position.y, to.cell.position.y, alpha),
      },
      velocity: {
        x: lerp(from.cell.velocity.x, to.cell.velocity.x, alpha),
        y: lerp(from.cell.velocity.y, to.cell.velocity.y, alpha),
      },
    };
    interpolatedPlayers[id] = {
      ...from,
      cell,
      lastUpdate: Date.now(),
    };
  });

  const order = Array.from(playerIds).filter((id) => interpolatedPlayers[id]);

  let camera = state.camera;
  if (state.selfId && interpolatedPlayers[state.selfId]) {
    camera = {
      ...state.camera,
      position: {
        x: interpolatedPlayers[state.selfId].cell.position.x,
        y: interpolatedPlayers[state.selfId].cell.position.y,
      },
    };
  }

  return {
    ...state,
    players: interpolatedPlayers,
    playerOrder: order,
    camera,
  };
};

const MobileView = () => {
  const { state, dispatch } = usePersonalRuntime();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let logicalWidth = window.innerWidth;
    let logicalHeight = window.innerHeight;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      logicalWidth = window.innerWidth;
      logicalHeight = window.innerHeight;
      canvas.width = Math.floor(logicalWidth * dpr);
      canvas.height = Math.floor(logicalHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const FRAME_INTERVAL_MS = 33;
    let lastTime = 0;

    const loop = (time: number) => {
      if (!lastTime) lastTime = time;
      const dt = time - lastTime;
      if (dt >= FRAME_INTERVAL_MS) {
        lastTime = time;
        const baseState = latestState.current;
        const renderState =
          baseState.mode === "personal"
            ? buildInterpolatedState(baseState)
            : baseState;
        renderScene({
          ctx,
          state: renderState,
          width: logicalWidth,
          height: logicalHeight,
        });
      }
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateFromClientPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = {
        x: clientX - rect.left - rect.width / 2,
        y: clientY - rect.top - rect.height / 2,
      };

      const nx = Math.max(-1, Math.min(1, pointer.x / (rect.width * 0.25)));
      const ny = Math.max(-1, Math.min(1, pointer.y / (rect.height * 0.25)));
      const CLIENT_MAX_SPEED = 320;
      const controlVelocity = {
        x: nx * CLIENT_MAX_SPEED,
        y: ny * CLIENT_MAX_SPEED,
      };

      dispatch({
        type: "SET_INPUT",
        input: {
          pointer,
          pointerActive: true,
          lastHeartbeat: Date.now(),
          controlVelocity,
        },
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownRef.current = true;
      canvas.setPointerCapture(event.pointerId);
      updateFromClientPoint(event.clientX, event.clientY);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerDownRef.current) return;
      updateFromClientPoint(event.clientX, event.clientY);
    };

    const stop = () => {
      pointerDownRef.current = false;
      dispatch({
        type: "SET_INPUT",
        input: {
          pointerActive: false,
          controlVelocity: { x: 0, y: 0 },
        },
      });
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("pointerleave", stop);
    };
  }, [dispatch]);

  return (
    <div className="relative min-h-screen w-full bg-black">
      <CanvasSurface ref={canvasRef} />
    </div>
  );
};

export default MobileView;
