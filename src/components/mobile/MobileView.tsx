"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { renderScene } from "@/lib/game/renderer";
import CanvasSurface from "@/components/shared/CanvasSurface";
import { usePersonalRuntime } from "@/lib/runtime/PersonalRuntimeProvider";
import type { GameState, PlayerSnapshot } from "@/types/game";
import PerfOverlay from "@/components/shared/PerfOverlay";

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
  const runtime = usePersonalRuntime();
  const { state, dispatch } = runtime;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const pointerDownRef = useRef(false);

  // Hydration-safe: query params are only available client-side.
  // Render "off" first, then enable after mount.
  const [showPerf, setShowPerf] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setShowPerf(sp.get("perf") === "1");
  }, []);

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  // Deep-link support:
  // - `/` has StartScreen that performs the iOS-required user gesture to start audio.
  // - `/mobile` can be opened directly, so we offer an in-page "Start audio" gate.
  const [gateDismissed, setGateDismissed] = useState(false);
  const [entering, setEntering] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmedName = useMemo(() => name.trim(), [name]);

  useEffect(() => {
    // If audio is already playing (e.g. navigated from `/`), don't show gate.
    if (runtime.audioStatus === "playing") {
      setGateDismissed(true);
    }
  }, [runtime.audioStatus]);

  const handleEnableAudio = async () => {
    setError(null);
    setEntering(true);
    try {
      const ok = await runtime.enableAudioAndTilt({ displayName: trimmedName });
      if (!ok) {
        setError(
          "Failed to enable audio. If you're on iOS, allow Motion & Orientation access, then try again."
        );
        return;
      }
      setGateDismissed(true);
    } finally {
      setEntering(false);
    }
  };

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

        // Lightweight runtime perf stats (read by PerfOverlay)
        const g = globalThis as unknown as {
          __intersectionPerf?: Record<string, unknown>;
        };
        if (!g.__intersectionPerf) g.__intersectionPerf = {};
        const perf = g.__intersectionPerf;
        perf.snapshotBufferLen = baseState.snapshotBuffer.length;
        const oldest = baseState.snapshotBuffer[0]?.timestamp;
        perf.snapshotBufferAgeMs =
          typeof oldest === "number" ? Math.max(0, Date.now() - oldest) : 0;

        const t0 = performance.now();
        renderScene({
          ctx,
          state: renderState,
          width: logicalWidth,
          height: logicalHeight,
        });
        const renderMs = performance.now() - t0;
        perf.renderSceneLastMs = renderMs;
        perf.renderSceneMaxMs = Math.max(
          Number(perf.renderSceneMaxMs ?? 0) || 0,
          renderMs
        );
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
      {showPerf && (
        <PerfOverlay mode="personal" population={state.ui.population} />
      )}
      {!gateDismissed && (
        <div className="pointer-events-auto absolute inset-0 z-[9998] flex items-center justify-center bg-black/80 px-6 py-10 text-white">
          <div className="w-full max-w-sm">
            <div className="mb-6 space-y-2">
              <div className="text-lg font-medium">Intersection</div>
              <div className="text-sm text-white/70">
                Tap once to start audio (required by mobile browsers).
              </div>
            </div>

            <div className="mb-4">
              <label
                className="mb-2 block text-xs text-white/60"
                htmlFor="mobileDisplayName"
              >
                your name (optional)
              </label>
              <input
                id="mobileDisplayName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Voyager-123"
                className="w-full rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
            </div>

            <div className="mb-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
              <div className="flex items-center justify-between">
                <span>socket</span>
                <span>{runtime.ready.socketReady ? "ready" : "loading"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>noisecraft</span>
                <span>
                  {runtime.ready.noiseCraftReady ? "ready" : "loading"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>audio</span>
                <span>{runtime.audioStatus}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleEnableAudio}
                disabled={!runtime.ready.ready || entering}
                className="flex-1 rounded-md border border-white/30 bg-transparent px-4 py-2 text-sm transition disabled:opacity-40"
              >
                {entering ? "Enabling…" : "Start audio"}
              </button>
              <button
                onClick={() => setGateDismissed(true)}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80"
              >
                Skip
              </button>
            </div>

            {error && <div className="mt-3 text-xs text-red-300">{error}</div>}
          </div>
        </div>
      )}
      <CanvasSurface ref={canvasRef} />
    </div>
  );
};

export default MobileView;
