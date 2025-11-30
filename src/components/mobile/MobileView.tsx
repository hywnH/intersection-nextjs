"use client";

import { useEffect, useRef, useState } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import {
  computePointerFromEvent,
  preventScrollOnTouch,
} from "@/lib/game/input";
import { addResizeListener } from "@/lib/game/window";
import CanvasSurface from "@/components/shared/CanvasSurface";
import {
  buildNoiseCraftParams,
  postNoiseCraftParams,
  resolveNoiseCraftEmbed,
} from "@/lib/audio/noiseCraft";
import type { GameState, PlayerSnapshot } from "@/types/game";
import Hud from "./Hud";
import StatusBanner from "./StatusBanner";
import Controls from "./Controls";

const INTERPOLATION_LAG_MS = Number(
  process.env.NEXT_PUBLIC_INTERP_LAG_MS ?? 80
);
const DISABLE_INTERPOLATION =
  process.env.NEXT_PUBLIC_DISABLE_INTERPOLATION === "true" ||
  process.env.NEXT_PUBLIC_DISABLE_INTERP === "true";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const MAX_CLOSING_SPEED = 100; // twice the server max speed to cover head-on approaches
type AudioStatus =
  | "idle"
  | "ready"
  | "pending"
  | "playing"
  | "blocked"
  | "stopped";

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

const computeApproachIntensity = (state: GameState) => {
  const selfId = state.selfId;
  if (!selfId) return 0;
  const selfPlayer = state.players[selfId];
  if (!selfPlayer) return 0;
  const { position: selfPos, velocity: selfVel } = selfPlayer.cell;
  let minDist = Number.POSITIVE_INFINITY;
  let nearestPlayer: PlayerSnapshot | null = null;
  for (const player of Object.values(state.players)) {
    if (player.id === selfId) continue;
    const dx = player.cell.position.x - selfPos.x;
    const dy = player.cell.position.y - selfPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) {
      minDist = dist;
      nearestPlayer = player;
    }
  }
  if (!nearestPlayer || !isFinite(minDist)) return 0;
  const safeDist = Math.max(minDist, 1e-3);
  const dirX = (nearestPlayer.cell.position.x - selfPos.x) / safeDist;
  const dirY = (nearestPlayer.cell.position.y - selfPos.y) / safeDist;
  const relVelX = selfVel.x - nearestPlayer.cell.velocity.x;
  const relVelY = selfVel.y - nearestPlayer.cell.velocity.y;
  const closingSpeed = Math.max(relVelX * dirX + relVelY * dirY, 0);
  return clamp01(closingSpeed / MAX_CLOSING_SPEED);
};

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
  ]);
  const interpolatedPlayers: Record<string, PlayerSnapshot> = {};

  playerIds.forEach((id) => {
    const from = older.players[id] ?? newer.players[id];
    const to = newer.players[id] ?? older.players[id];
    if (!from || !to) return;
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
  const { state, dispatch, socket } = useGameClient("personal");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const audioIframeRef = useRef<HTMLIFrameElement>(null);
  const [noiseCraftOrigin, setNoiseCraftOrigin] = useState<string | null>(null);
  const [noiseCraftSrc, setNoiseCraftSrc] = useState("about:blank");
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { src, origin } = resolveNoiseCraftEmbed();
    setNoiseCraftSrc(src);
    setNoiseCraftOrigin(origin);
    setIsProjectReady(false);
    setAudioStatus("idle");
  }, []);

  useEffect(() => {
    if (!noiseCraftOrigin) return;
    const approachValue = computeApproachIntensity(state);
    const params = buildNoiseCraftParams(
      state.audio,
      state.noiseSlots,
      "personal",
      approachValue
    );
    postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, params);
  }, [
    state.audio,
    state.noiseSlots,
    state.players,
    state.selfId,
    noiseCraftOrigin,
  ]);

  useEffect(() => {
    if (!noiseCraftOrigin) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== noiseCraftOrigin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "noiseCraft:projectLoaded") {
        setIsProjectReady(true);
        setAudioStatus((prev) => (prev === "playing" ? prev : "ready"));
      } else if (
        data.type === "noiseCraft:audioState" &&
        typeof data.status === "string"
      ) {
        const status = data.status as AudioStatus;
        setAudioStatus((prev) => {
          if (status === "pending") return prev;
          if (status === "ready" && prev === "playing") return prev;
          return status;
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [noiseCraftOrigin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      const baseState = latestState.current;
      const renderState =
        baseState.mode === "personal"
          ? buildInterpolatedState(baseState)
          : baseState;
      renderScene({
        ctx,
        state: renderState,
        width: canvas.width,
        height: canvas.height,
      });
      animationRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updatePointer = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = {
        x: x - rect.left - canvas.width / 2,
        y: y - rect.top - canvas.height / 2,
      };
      // 컨트롤러: 포인터를 화면 중심 기준으로 정규화 → 원하는 속도 계산
      const nx = Math.max(-1, Math.min(1, pointer.x / (canvas.width * 0.25)));
      const ny = Math.max(-1, Math.min(1, pointer.y / (canvas.height * 0.25)));
      const CLIENT_MAX_SPEED = 320; // 서버 MAX_SPEED와 동일하게 유지
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

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY);
    };

    const handlePointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      updatePointer(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      dispatch({
        type: "SET_INPUT",
        input: { pointerActive: false, controlVelocity: { x: 0, y: 0 } },
      });
    };

    const handleTouchMove = (event: TouchEvent) => {
      preventScrollOnTouch(event);
      const pointer = computePointerFromEvent(event, canvas);
      if (!pointer) return;
      dispatch({ type: "SET_TARGET", target: pointer });
      dispatch({
        type: "SET_INPUT",
        input: {
          pointer,
          pointerActive: true,
          lastHeartbeat: Date.now(),
        },
      });
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("touchmove", handleTouchMove);
    };
  }, [dispatch]);

  useEffect(() => {
    if (!socket) return;
    if (typeof window === "undefined") return;

    const emitResize = () => {
      socket.emit("windowResized", {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      });
    };

    const remove = addResizeListener(emitResize, { immediate: true });
    return () => {
      remove?.();
    };
  }, [socket]);

  // NoiseCraft 파라미터 브리지: 실제 플레이어 속도 → 주파수 매핑
  useEffect(() => {
    if (!socket) return;

    const MIN = 100; // Hz
    const MAX = 2000; // Hz
    const MAX_SPEED = 320; // 서버 최고 속도와 일치
    let raf: number | null = null;
    let lastSent = 0;

    const tick = () => {
      const now = performance.now();
      if (now - lastSent >= 33) {
        const s = latestState.current;
        const selfId = s.selfId;
        const self = selfId ? s.players[selfId] : undefined;
        const vx = self?.cell.velocity.x ?? 0;
        const vy = self?.cell.velocity.y ?? 0;
        const mag = Math.min(1, Math.hypot(vx, vy) / MAX_SPEED);
        const value = MIN + (MAX - MIN) * mag;
        socket.emit("param", {
          type: "setParam",
          nodeId: "0",
          paramName: "value",
          value,
        });
        lastSent = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [socket]);

  const handleStartAudio = () => {
    if (!audioIframeRef.current) return;
    setAudioStatus("pending");
    audioIframeRef.current.contentWindow?.postMessage(
      { type: "noiseCraft:play" },
      noiseCraftOrigin || "*"
    );
  };

  const showStartAudioPrompt = isProjectReady && audioStatus !== "playing";
  const audioStatusMessage =
    audioStatus === "blocked"
      ? "브라우저가 자동재생을 막았습니다. Start Audio를 눌러주세요."
      : audioStatus === "pending"
      ? "오디오를 활성화하는 중입니다…"
      : "프로젝트가 로드되었습니다. Start Audio를 눌러주세요.";

  return (
    <div className="relative min-h-screen w-full bg-black">
      <CanvasSurface ref={canvasRef} />
      {/* <Hud state={state} /> */}
      {/* <StatusBanner state={state} /> */}
      {/* <Controls /> */}
      <div className="pointer-events-none absolute h-0 w-0 overflow-hidden sm:pointer-events-auto sm:bottom-4 sm:left-4 sm:flex sm:h-auto sm:w-60 sm:flex-col sm:gap-2 sm:rounded-xl sm:bg-black/70 sm:p-3 sm:text-xs sm:text-white">
        {/* <p className="text-white/70">Personal Audio (NoiseCraft)</p> */}
        <iframe
          ref={audioIframeRef}
          src={noiseCraftSrc}
          width="220"
          height="120"
          allow="autoplay"
          title="NoiseCraft Personal"
          className="h-0 w-0 opacity-0 sm:h-[120px] sm:w-[220px] sm:opacity-100"
          style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
        />
        {/* <p className="text-white/50">Tap “Start Audio” inside panel.</p> */}
      </div>
      {showStartAudioPrompt && (
        <div className="pointer-events-none fixed inset-x-3 bottom-4 z-20 flex justify-center sm:inset-auto sm:bottom-6 sm:left-6 sm:right-auto sm:justify-start">
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-black/85 p-4 text-white shadow-lg backdrop-blur">
            <p className="text-sm font-medium">개인 오디오</p>
            <p className="mt-1 text-xs text-white/70">{audioStatusMessage}</p>
            <button
              type="button"
              onClick={handleStartAudio}
              disabled={audioStatus === "pending"}
              className="mt-3 w-full rounded-xl bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/60"
            >
              {audioStatus === "pending" ? "시작 중…" : "Start Audio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileView;
