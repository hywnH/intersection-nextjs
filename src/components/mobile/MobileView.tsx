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
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";
import { generateDistancePanParams } from "@/lib/audio/streamMapping";
import {
  computePersonalSequencerV2,
  PERSONAL_SEQ_V2,
  PERSONAL_SEQ_V2_NODES,
} from "@/lib/audio/personalSequencerV2";
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
type AudioStatus =
  | "idle"
  | "ready"
  | "pending"
  | "playing"
  | "blocked"
  | "stopped";

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
  const { state, dispatch, socket } = useGameClient("personal");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const audioIframeRef = useRef<HTMLIFrameElement>(null);
  // Hydration-safe: 서버/클라 첫 렌더는 about:blank로 맞추고,
  // 마운트 이후에만 실제 src/origin을 계산해 주입한다.
  const [noiseCraftConfig, setNoiseCraftConfig] = useState<{
    src: string;
    origin: string | null;
  }>({ src: "about:blank", origin: null });
  const noiseCraftOrigin = noiseCraftConfig.origin ?? null;
  const noiseCraftSrc = noiseCraftConfig.src ?? "about:blank";
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  // Hydration-safe: 첫 렌더는 false로 고정하고 마운트 이후에만 판별.
  const [isDebugView, setIsDebugView] = useState(false);
  const lastV2InRadiusIdsRef = useRef<string[] | null>(null);
  const meetGateTimerRef = useRef<number | null>(null);
  const closeGateTimerRef = useRef<number | null>(null);
  const lastVeryCloseRef = useRef(false);
  const lastParamUpdateRef = useRef(0);
  const paramSmoothingRef = useRef<
    Map<string, { current: number; target: number }>
  >(new Map());

  useEffect(() => {
    // src/origin 계산은 클라이언트에서만 수행
    const cfg = resolveNoiseCraftEmbed();
    setNoiseCraftConfig(cfg);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname || "";
    setIsDebugView(path.startsWith("/mobile/debug"));
  }, []);

  useEffect(() => {
    // hydration 이후 확실히 반영되도록 ref에도 주입
    if (!audioIframeRef.current) return;
    audioIframeRef.current.src = noiseCraftSrc;
  }, [noiseCraftSrc]);

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  // noiseCraft / debug 여부는 초기화 시점에 결정 (setState-in-effect 회피)

  // NoiseCraft 매핑 파라미터 전송 (모바일/디버그 공통)
  useEffect(() => {
    if (!noiseCraftOrigin) return;

    // test-workspace와 유사하게 파라미터 업데이트를 스로틀링
    const now = Date.now();
    const PARAM_UPDATE_INTERVAL_MS = 100;
    if (now - lastParamUpdateRef.current < PARAM_UPDATE_INTERVAL_MS) {
      return;
    }
    lastParamUpdateRef.current = now;

    // 개인 뷰용 거리/팬 → 3개 파라미터로 매핑
    const mappedParams = generateDistancePanParams(state);
    const v2 = computePersonalSequencerV2(state, lastV2InRadiusIdsRef.current);

    // 파라미터 스무딩(클릭/팝 노이즈 방지)
    // 더 강한 스무딩: 천천히 따라가도록 작은 값 사용
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

    if (!combined.length) {
      return;
    }

    postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, combined);
  }, [state, noiseCraftOrigin]);

  // MonoSeq 패턴 기반 화음 업데이트 (v2 패치 기준)
  useEffect(() => {
    if (!noiseCraftOrigin) return;
    if (!audioIframeRef.current) return;
    // 일반 /mobile 에서는 프로젝트 로딩 이후에만(초기 패치의 기본 화음을 덮어쓰기 위함)
    if (!isDebugView && !isProjectReady) return;

    const win = audioIframeRef.current.contentWindow;
    const targetOrigin =
      process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*";

    const v2 = computePersonalSequencerV2(state, lastV2InRadiusIdsRef.current);
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

    // v2 패치에서 기본 패턴을 비워두므로, 최초 1회는 무조건 그리드를 채워서
    // "기본 자기 음"이 항상 들리도록 한다.
    if (boundaryChanged || isFirstSend) {
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.bass, v2.grids.bass);
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.baritone, v2.grids.baritone);
      sendGrid(PERSONAL_SEQ_V2_NODES.monoSeq.tenor, v2.grids.tenor);
      lastV2InRadiusIdsRef.current = v2.inRadiusIds;

      // meetGate 스위트너(enter 순간에만 0->1->0 펄스)
      if (v2.meetGateTrigger) {
        if (meetGateTimerRef.current) {
          window.clearTimeout(meetGateTimerRef.current);
          meetGateTimerRef.current = null;
        }
        // v2 패치의 detune 네트워크는 기존 `fact`(node 206)에 의해 깊이가 결정된다.
        // "딱 만났을 때"만 아주 살짝 코러스가 느껴지도록 짧게 올렸다가 되돌린다.
        const MEET_FACT_NODE = "206";
        const BASE_FACT = 0.008132716005981842; // patch 기본값(안전한 미세 detune)
        const MEET_FACT = 0.06;
        postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, [
          {
            nodeId: PERSONAL_SEQ_V2_NODES.meetGate,
            paramName: "value",
            value: 1,
          },
          { nodeId: MEET_FACT_NODE, paramName: "value", value: MEET_FACT },
        ]);
        meetGateTimerRef.current = window.setTimeout(() => {
          postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, [
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

    // 초근접(딱 붙었을 때) 전용 “띵~ 화음” 레이어 트리거
    // - veryClose로 들어오는 순간에만 1회 펄스
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
      postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, [
        { nodeId: CLOSE_GATE_NODE, paramName: "value", value: 1 },
      ]);
      closeGateTimerRef.current = window.setTimeout(() => {
        postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, [
          { nodeId: CLOSE_GATE_NODE, paramName: "value", value: 0 },
        ]);
        closeGateTimerRef.current = null;
      }, 160);
    }
    lastVeryCloseRef.current = closeNow;
  }, [state, noiseCraftOrigin, isDebugView, isProjectReady]);

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

    const FRAME_INTERVAL_MS = 33; // ~30fps로 제한
    let lastTime = 0;

    const loop = (time: number) => {
      if (!lastTime) {
        lastTime = time;
      }
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
        // 고해상도 캔버스에서도 입력 좌표는 CSS 크기 기준으로 정규화
        x: x - rect.left - rect.width / 2,
        y: y - rect.top - rect.height / 2,
      };
      // 컨트롤러: 포인터를 화면 중심 기준으로 정규화 → 원하는 속도 계산
      const nx = Math.max(-1, Math.min(1, pointer.x / (rect.width * 0.25)));
      const ny = Math.max(-1, Math.min(1, pointer.y / (rect.height * 0.25)));
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

  const shouldShowIframe = isDebugView ? true : isProjectReady;

  // NoiseCraft 파라미터 브리지: 실제 플레이어 속도 → 주파수 매핑
  useEffect(() => {
    if (!socket) return;
    if (!isDebugView) return;

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
  }, [socket, isDebugView]);

  const handleStartAudio = () => {
    if (!audioIframeRef.current) return;
    setAudioStatus("pending");
    audioIframeRef.current.contentWindow?.postMessage(
      { type: "noiseCraft:play" },
      noiseCraftOrigin || "*"
    );
  };

  return (
    <div className="relative min-h-screen w-full bg-black">
      <CanvasSurface ref={canvasRef} />
      {/* <Hud state={state} /> */}
      {/* <StatusBanner state={state} /> */}
      {/* <Controls /> */}
      <div className="pointer-events-auto absolute bottom-4 left-4 flex h-auto w-[340px] flex-col gap-2 rounded-xl bg-black/80 p-3 text-xs text-white">
        <iframe
          ref={audioIframeRef}
          src={noiseCraftSrc}
          width={isDebugView ? 1800 : 220}
          height={isDebugView ? 500 : 56}
          allow="autoplay"
          title="NoiseCraft Personal"
          className={
            shouldShowIframe
              ? isDebugView
                ? "h-[500px] w-[1800px] opacity-100"
                : "h-[56px] w-[220px] opacity-100"
              : "h-0 w-0 opacity-0 pointer-events-none"
          }
          style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
        />
        {/* <button
          type="button"
          onClick={handleStartAudio}
          disabled={audioStatus === "pending" || audioStatus === "playing"}
          className="mt-2 w-full rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/60"
        >
          {audioStatus === "pending"
            ? "시작 중…"
            : audioStatus === "playing"
            ? "재생 중"
            : "Start Audio"}
        </button> */}
        {/* <p className="text-white/50">Tap “Start Audio” inside panel.</p> */}
      </div>
    </div>
  );
};

export default MobileView;
