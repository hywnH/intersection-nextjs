"use client";

import { useEffect, useRef, useState } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import CanvasSurface from "@/components/shared/CanvasSurface";

type ProjectionMode = "plane" | "lines";

const TRANSITION_DURATION = 600;

const GlobalView = () => {
  const { state, players, dispatch } = useGameClient("global");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const [projection, setProjection] = useState<ProjectionMode>("plane");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const transitionRef = useRef<{
    from: ProjectionMode;
    to: ProjectionMode;
    start: number;
  } | null>(null);

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
      const overlayWidth = 256;
      const zoom = Math.min(
        (canvas.width - overlayWidth) / state.gameSize.width,
        canvas.height / state.gameSize.height
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          position: {
            x: state.gameSize.width / 2,
            y: state.gameSize.height / 2,
          },
          zoom,
        },
      });
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      let transition: { from: ProjectionMode; to: ProjectionMode; progress: number } | null =
        null;
      const t = transitionRef.current;
      if (t) {
        const progress = Math.min(
          1,
          (performance.now() - t.start) / TRANSITION_DURATION
        );
        transition = { ...t, progress };
        if (progress >= 1) {
          transitionRef.current = null;
        }
      }

      renderScene({
        ctx,
        state: latestState.current,
        width: canvas.width,
        height: canvas.height,
        projection,
        transition,
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
  }, [dispatch, state.gameSize.height, state.gameSize.width, projection]);

  useEffect(() => {
    const nc = process.env.NEXT_PUBLIC_NOISECRAFT_WS_URL || "http://localhost:4000";
    const rt = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3001";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const ncBase = nc.startsWith("/") ? origin + nc : nc;
    const rtUrl = rt.startsWith("/") ? origin + rt : rt;
    const src = `${ncBase.replace(/\/$/, "")}/public/embedded.html?io=${encodeURIComponent(rtUrl)}`;
    if (iframeRef.current) {
      iframeRef.current.src = src;
    }
  }, []);

  const handleProjectionChange = (mode: ProjectionMode) => {
    if (mode === projection) return;
    transitionRef.current = {
      from: projection,
      to: mode,
      start: performance.now(),
    };
    setProjection(mode);
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-950">
      <CanvasSurface ref={canvasRef} className="bg-black" />
      {/* NoiseCraft Embedded (Socket.IO 제어) */}
      <div className="pointer-events-auto absolute bottom-4 right-4 rounded-xl bg-black/60 p-2 text-xs text-white">
        <div className="mb-2 text-white/70">NoiseCraft</div>
        <iframe
          ref={iframeRef}
          src={"about:blank"}
          width="420"
          height="120"
          style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
          allow="autoplay"
          title="NoiseCraft Embedded"
        ></iframe>
        <div className="mt-2 text-white/50">iframe 안에서 Start Audio 클릭</div>
      </div>
      <div className="pointer-events-auto absolute right-6 top-6 flex gap-2">
        <button
          type="button"
          onClick={() => handleProjectionChange("plane")}
          className={`rounded-full px-4 py-2 text-sm ${
            projection === "plane"
              ? "bg-white text-black"
              : "bg-white/10 text-white/70"
          }`}
        >
          Plane
        </button>
        <button
          type="button"
          onClick={() => handleProjectionChange("lines")}
          className={`rounded-full px-4 py-2 text-sm ${
            projection === "lines"
              ? "bg-white text-black"
              : "bg-white/10 text-white/70"
          }`}
        >
          Lines
        </button>
      </div>
      <div className="pointer-events-none absolute left-0 top-0 flex h-full w-64 flex-col gap-4 bg-black/60 p-6 text-white">
        <p className="text-xs uppercase tracking-[0.4em] text-blue-300">
          Spectator
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
                    좌표 ({player.cell.position.x.toFixed(0)},{" "}
                    {player.cell.position.y.toFixed(0)})
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalView;
