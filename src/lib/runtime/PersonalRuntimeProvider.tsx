"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, ReactNode } from "react";
import type { GameSocket } from "@/lib/socket/createClient";
import { useGameClient } from "@/lib/game/hooks";
import type { GameAction, GameState, Mode } from "@/types/game";
import {
  postNoiseCraftParams,
  resolveNoiseCraftEmbed,
} from "@/lib/audio/noiseCraft";
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";
import { generateDistancePanParams } from "@/lib/audio/streamMapping";
import {
  computePersonalSequencerV2,
  PERSONAL_SEQ_V2,
  PERSONAL_SEQ_V2_NODES,
} from "@/lib/audio/personalSequencerV2";
import { addResizeListener } from "@/lib/game/window";

type MotionPermission = "unknown" | "granted" | "denied" | "unsupported";
type AudioStatus =
  | "idle"
  | "ready"
  | "pending"
  | "playing"
  | "blocked"
  | "stopped";

type PersonalRuntimeReady = {
  socketReady: boolean;
  noiseCraftReady: boolean;
  ready: boolean;
};

type PersonalRuntimeValue = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  socket: GameSocket | null;
  ready: PersonalRuntimeReady;
  motionPermission: MotionPermission;
  audioStatus: AudioStatus;
  tiltEnabled: boolean;
  enableAudioAndTilt: (opts: { displayName: string }) => Promise<boolean>;
};

const PersonalRuntimeContext = createContext<PersonalRuntimeValue | null>(null);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const buildInterpolatedState = (state: GameState): GameState => {
  const INTERPOLATION_LAG_MS = Number(
    process.env.NEXT_PUBLIC_INTERP_LAG_MS ?? 80
  );
  const DISABLE_INTERPOLATION =
    process.env.NEXT_PUBLIC_DISABLE_INTERPOLATION === "true" ||
    process.env.NEXT_PUBLIC_DISABLE_INTERP === "true";

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
  const interpolatedPlayers: GameState["players"] = {};

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

const requestMotionPermission = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  const hasDeviceOrientation = "DeviceOrientationEvent" in window;
  if (!hasDeviceOrientation) return false;

  const anyWin = window as unknown as {
    DeviceOrientationEvent?: {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    DeviceMotionEvent?: {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
  };

  const req =
    anyWin.DeviceOrientationEvent?.requestPermission ||
    anyWin.DeviceMotionEvent?.requestPermission;
  if (!req) return true;

  try {
    const res = await req();
    return res === "granted";
  } catch {
    return false;
  }
};

export const PersonalRuntimeProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const initialMode: Mode =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/global")
      ? "global"
      : "personal";
  const { state, dispatch, socket } = useGameClient(initialMode);

  // NoiseCraft iframe
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [noiseCraftConfig, setNoiseCraftConfig] = useState<{
    src: string;
    origin: string | null;
  }>({ src: "about:blank", origin: null });
  const noiseCraftOrigin = noiseCraftConfig.origin ?? null;

  const [noiseCraftReady, setNoiseCraftReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const audioStatusRef = useRef<AudioStatus>("idle");
  const [motionPermission, setMotionPermission] =
    useState<MotionPermission>("unknown");
  const [tiltEnabled, setTiltEnabled] = useState(false);

  const lastV2InRadiusIdsRef = useRef<string[] | null>(null);
  const meetGateTimerRef = useRef<number | null>(null);
  const closeGateTimerRef = useRef<number | null>(null);
  const lastVeryCloseRef = useRef(false);
  const lastParamUpdateRef = useRef(0);
  const paramSmoothingRef = useRef<
    Map<string, { current: number; target: number }>
  >(new Map());

  // Tilt control state
  const tiltZeroRef = useRef<{ beta: number; gamma: number } | null>(null);
  const tiltLatestRef = useRef<{ beta: number; gamma: number } | null>(null);
  const tiltSmoothedRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const latestStateRef = useRef(state);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    audioStatusRef.current = audioStatus;
  }, [audioStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasDeviceOrientation = "DeviceOrientationEvent" in window;
    if (!hasDeviceOrientation) {
      setMotionPermission("unsupported");
      return;
    }
    setMotionPermission("unknown");
  }, []);

  // Build NoiseCraft embed (only for personal runtime)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.mode !== "personal") return;
    const cfg = resolveNoiseCraftEmbed({ pathnameOverride: "/mobile" });
    setNoiseCraftConfig(cfg);
  }, [state.mode]);

  // Keep server informed of screen size (preload on `/` too)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.mode !== "personal") return;
    if (!socket) return;

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
  }, [socket, state.mode]);

  useEffect(() => {
    if (state.mode !== "personal") return;
    if (!iframeRef.current) return;
    iframeRef.current.src = noiseCraftConfig.src;
  }, [noiseCraftConfig.src, state.mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.mode !== "personal") return;
    if (!noiseCraftOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== noiseCraftOrigin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "noiseCraft:projectLoaded") {
        setNoiseCraftReady(true);
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
  }, [noiseCraftOrigin, state.mode]);

  // NoiseCraft mapping params (throttled)
  useEffect(() => {
    if (state.mode !== "personal") return;
    if (!noiseCraftOrigin) return;

    const now = Date.now();
    const PARAM_UPDATE_INTERVAL_MS = 100;
    if (now - lastParamUpdateRef.current < PARAM_UPDATE_INTERVAL_MS) {
      return;
    }
    lastParamUpdateRef.current = now;

    const renderState = buildInterpolatedState(state);
    const mappedParams = generateDistancePanParams(renderState);
    const v2 = computePersonalSequencerV2(
      renderState,
      lastV2InRadiusIdsRef.current
    );

    const SMOOTHING_FACTOR = 0.02;
    const smoothingMap = paramSmoothingRef.current;
    const smooth = (nodeId: string, paramName: string, value: number) => {
      const key = `${nodeId}:${paramName}`;
      const existing = smoothingMap.get(key) || {
        current: value,
        target: value,
      };
      existing.target = value;
      const prev = existing.current;
      const diff = existing.target - prev;
      const next = prev + diff * SMOOTHING_FACTOR;
      existing.current = next;
      smoothingMap.set(key, existing);
      const changed = Math.abs(next - prev) > 1e-4;
      return { value: next, changed };
    };

    const extended = v2 ? [...mappedParams, ...v2.params] : mappedParams;
    const combined: NoiseCraftParam[] = extended
      .map((p): NoiseCraftParam | null => {
        const nodeId = String(p.nodeId);
        const paramName = p.paramName || "value";
        const { value, changed } = smooth(nodeId, paramName, p.value);
        if (!changed) return null;
        return {
          ...p,
          nodeId,
          paramName,
          value,
        };
      })
      .filter((p): p is NoiseCraftParam => p !== null);

    if (!combined.length) return;
    postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, combined);
  }, [state, noiseCraftOrigin]);

  // MonoSeq grid updates (v2)
  useEffect(() => {
    if (state.mode !== "personal") return;
    if (!noiseCraftOrigin) return;
    if (!noiseCraftReady) return;
    if (!iframeRef.current) return;

    const win = iframeRef.current.contentWindow;
    const targetOrigin =
      process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*";

    const renderState = buildInterpolatedState(state);
    const v2 = computePersonalSequencerV2(
      renderState,
      lastV2InRadiusIdsRef.current
    );
    if (!v2) return;

    const prev = lastV2InRadiusIdsRef.current ?? [];
    const prevSet = new Set(prev);
    const nextSet = new Set(v2.inRadiusIds);
    const boundaryChanged =
      prev.length !== v2.inRadiusIds.length ||
      prev.some((id) => !nextSet.has(id)) ||
      v2.inRadiusIds.some((id) => !prevSet.has(id));
    const isFirstSend = lastV2InRadiusIdsRef.current === null;

    const sendGrid = (nodeId: string, grid: number[][]) => {
      for (
        let stepIdx = 0;
        stepIdx < PERSONAL_SEQ_V2.MONOSEQ_STEPS;
        stepIdx += 1
      ) {
        for (
          let rowIdx = 0;
          rowIdx < PERSONAL_SEQ_V2.MONOSEQ_ROWS;
          rowIdx += 1
        ) {
          win?.postMessage(
            {
              type: "noiseCraft:toggleCell",
              nodeId,
              patIdx: 0,
              stepIdx,
              rowIdx,
              value: grid[stepIdx]?.[rowIdx] ? 1 : 0,
            },
            targetOrigin
          );
        }
      }
    };

    if (boundaryChanged || isFirstSend) {
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.bass, v2.grids.bass);
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.baritone, v2.grids.baritone);
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.tenor, v2.grids.tenor);
      lastV2InRadiusIdsRef.current = v2.inRadiusIds;

      if (v2.meetGateTrigger) {
        if (meetGateTimerRef.current) {
          window.clearTimeout(meetGateTimerRef.current);
          meetGateTimerRef.current = null;
        }
        const MEET_FACT_NODE = "206";
        const BASE_FACT = 0.008132716005981842;
        const MEET_FACT = 0.06;
        postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, [
          {
            nodeId: PERSONAL_SEQ_V2_NODES.meetGate,
            paramName: "value",
            value: 1,
          },
          { nodeId: MEET_FACT_NODE, paramName: "value", value: MEET_FACT },
        ]);
        meetGateTimerRef.current = window.setTimeout(() => {
          postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, [
            {
              nodeId: PERSONAL_SEQ_V2_NODES.meetGate,
              paramName: "value",
              value: 0,
            },
            { nodeId: MEET_FACT_NODE, paramName: "value", value: BASE_FACT },
          ]);
          meetGateTimerRef.current = null;
        }, PERSONAL_SEQ_V2.SWEETENER_HOLD_MS);
      }
    }

    const VERY_CLOSE_DIST = 120;
    const closeNow =
      Number.isFinite(v2.nearestDist) && v2.nearestDist <= VERY_CLOSE_DIST;
    const closePrev = lastVeryCloseRef.current;
    if (closeNow && !closePrev) {
      if (closeGateTimerRef.current) {
        window.clearTimeout(closeGateTimerRef.current);
        closeGateTimerRef.current = null;
      }
      const CLOSE_GATE_NODE = "9060";
      postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, [
        { nodeId: CLOSE_GATE_NODE, paramName: "value", value: 1 },
      ]);
      closeGateTimerRef.current = window.setTimeout(() => {
        postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, [
          { nodeId: CLOSE_GATE_NODE, paramName: "value", value: 0 },
        ]);
        closeGateTimerRef.current = null;
      }, 160);
    }
    lastVeryCloseRef.current = closeNow;
  }, [state, noiseCraftOrigin, noiseCraftReady]);

  // Tilt loop (writes desired velocity unless user is actively touching)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.mode !== "personal") return;
    if (!tiltEnabled) return;
    if (motionPermission !== "granted") return;

    let stopped = false;
    tiltZeroRef.current = null;
    tiltLatestRef.current = null;
    tiltSmoothedRef.current = { x: 0, y: 0 };

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (stopped) return;
      const beta = typeof event.beta === "number" ? event.beta : null;
      const gamma = typeof event.gamma === "number" ? event.gamma : null;
      if (beta === null || gamma === null) return;
      tiltLatestRef.current = { beta, gamma };
      if (!tiltZeroRef.current) {
        tiltZeroRef.current = { beta, gamma };
      }
    };

    window.addEventListener("deviceorientation", onOrientation, true);

    const CLIENT_MAX_SPEED = 320;
    const MAX_TILT_DEG = 22;
    const DEADZONE_DEG = 1.6;
    const SMOOTH = 0.18;

    const clamp = (v: number, min: number, max: number) =>
      Math.min(max, Math.max(min, v));
    const applyDeadzone = (v: number, dz: number) => {
      const av = Math.abs(v);
      if (av <= dz) return 0;
      return Math.sign(v) * ((av - dz) / (1 - dz));
    };

    const tick = window.setInterval(() => {
      const latest = tiltLatestRef.current;
      const zero = tiltZeroRef.current;
      if (!latest || !zero) return;

      const rawX = (latest.gamma - zero.gamma) / MAX_TILT_DEG;
      const rawY = (latest.beta - zero.beta) / MAX_TILT_DEG;
      const nx = clamp(rawX, -1, 1);
      const ny = clamp(rawY, -1, 1);
      const dx = applyDeadzone(nx, DEADZONE_DEG / MAX_TILT_DEG);
      const dy = applyDeadzone(ny, DEADZONE_DEG / MAX_TILT_DEG);

      const targetX = dx * CLIENT_MAX_SPEED;
      const targetY = dy * CLIENT_MAX_SPEED;

      const prev = tiltSmoothedRef.current;
      const next = {
        x: prev.x + (targetX - prev.x) * SMOOTH,
        y: prev.y + (targetY - prev.y) * SMOOTH,
      };
      tiltSmoothedRef.current = next;

      const s = latestStateRef.current;
      if (s.input.pointerActive) return;

      dispatch({
        type: "SET_INPUT",
        input: {
          controlVelocity: { x: next.x, y: next.y },
          lastHeartbeat: Date.now(),
        },
      });
    }, 33);

    return () => {
      stopped = true;
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.clearInterval(tick);
    };
  }, [tiltEnabled, motionPermission, state.mode, dispatch]);

  // Auto-calibrate tilt after touch movement ends (pointerActive true -> false)
  const prevPointerActiveRef = useRef(false);
  useEffect(() => {
    const prev = prevPointerActiveRef.current;
    const next = Boolean(state.input.pointerActive);
    prevPointerActiveRef.current = next;
    if (!prev || next) return;
    if (!tiltEnabled) return;
    const latest = tiltLatestRef.current;
    if (!latest) return;
    tiltZeroRef.current = { ...latest };
  }, [state.input.pointerActive, tiltEnabled]);

  const waitForAudioState = useCallback(async () => {
    if (typeof window === "undefined") return audioStatusRef.current;
    const start = Date.now();
    const timeoutMs = 1200;
    return await new Promise<AudioStatus>((resolve) => {
      const tick = () => {
        const cur = audioStatusRef.current;
        if (cur === "playing" || cur === "blocked") {
          resolve(cur);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(cur);
          return;
        }
        window.setTimeout(tick, 50);
      };
      tick();
    });
  }, []);

  const enableAudioAndTilt = useCallback(
    async ({ displayName }: { displayName: string }) => {
      if (typeof window === "undefined") return false;
      if (state.mode !== "personal") return false;
      if (!socket) return false;
      if (!noiseCraftOrigin) return false;
      if (!iframeRef.current) return false;

      // 1) Ensure server sees chosen displayName + screen size (can be called anytime)
      const trimmed = (displayName || "").trim();
      socket.emit("gotit", {
        ...(trimmed ? { name: trimmed } : {}),
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      } as unknown);

      // 2) Start audio immediately (must be in user gesture, especially on iOS)
      setAudioStatus("pending");
      iframeRef.current.contentWindow?.postMessage(
        { type: "noiseCraft:play" },
        process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*"
      );

      // 3) Motion permission (iOS prompt must also be in user gesture)
      const hasDeviceOrientation = "DeviceOrientationEvent" in window;
      if (!hasDeviceOrientation) {
        setMotionPermission("unsupported");
        // keep audio playing even if tilt unsupported
        return false;
      }
      setMotionPermission("unknown");
      const ok = await requestMotionPermission();
      setMotionPermission(ok ? "granted" : "denied");
      if (!ok) {
        // all-or-nothing: if tilt permission denied, stop audio too
        iframeRef.current.contentWindow?.postMessage(
          { type: "noiseCraft:stop" },
          process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*"
        );
        return false;
      }

      // 4) Confirm audio is actually playing (detect iOS blocked state)
      const audioState = await waitForAudioState();
      if (audioState !== "playing") {
        iframeRef.current.contentWindow?.postMessage(
          { type: "noiseCraft:stop" },
          process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*"
        );
        return false;
      }

      setTiltEnabled(true);
      return true;
    },
    [socket, noiseCraftOrigin, state.mode, waitForAudioState]
  );

  const ready = useMemo<PersonalRuntimeReady>(() => {
    const socketReady =
      state.mode === "personal" &&
      Boolean(state.ui.connected) &&
      Boolean(state.playing) &&
      Boolean(state.selfId);
    const ncReady = state.mode !== "personal" ? false : noiseCraftReady;
    return {
      socketReady,
      noiseCraftReady: ncReady,
      ready: socketReady && ncReady,
    };
  }, [
    state.mode,
    state.ui.connected,
    state.playing,
    state.selfId,
    noiseCraftReady,
  ]);

  const value = useMemo<PersonalRuntimeValue>(
    () => ({
      state,
      dispatch,
      socket,
      ready,
      motionPermission,
      audioStatus,
      tiltEnabled,
      enableAudioAndTilt,
    }),
    [
      state,
      dispatch,
      socket,
      ready,
      motionPermission,
      audioStatus,
      tiltEnabled,
      enableAudioAndTilt,
    ]
  );

  return (
    <PersonalRuntimeContext.Provider value={value}>
      {/* Hidden NoiseCraft iframe for preloading + audio playback */}
      {state.mode === "personal" && (
        <iframe
          ref={iframeRef}
          src={noiseCraftConfig.src}
          allow="autoplay"
          title="NoiseCraft Personal (hidden)"
          className="pointer-events-none fixed left-0 top-0 h-0 w-0 opacity-0"
        />
      )}
      {children}
    </PersonalRuntimeContext.Provider>
  );
};

export const usePersonalRuntime = () => {
  const ctx = useContext(PersonalRuntimeContext);
  if (!ctx) {
    throw new Error(
      "usePersonalRuntime must be used within PersonalRuntimeProvider"
    );
  }
  return ctx;
};
