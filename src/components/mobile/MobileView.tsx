"use client";

import { useEffect, useRef } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import {
  computePointerFromEvent,
  preventScrollOnTouch,
} from "@/lib/game/input";
import { addResizeListener } from "@/lib/game/window";
import CanvasSurface from "@/components/shared/CanvasSurface";
import Hud from "./Hud";
import StatusBanner from "./StatusBanner";
import Controls from "./Controls";

const MobileView = () => {
  const { state, dispatch, socket } = useGameClient("personal");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);

  useEffect(() => {
    latestState.current = state;
  }, [state]);

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
      renderScene({
        ctx,
        state: latestState.current,
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
      const controlVelocity = { x: nx * CLIENT_MAX_SPEED, y: ny * CLIENT_MAX_SPEED };
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

  return (
    <div className="relative min-h-screen w-full bg-black">
      <CanvasSurface ref={canvasRef} />
      <Hud state={state} />
      <StatusBanner state={state} />
      <Controls />
    </div>
  );
};

export default MobileView;
