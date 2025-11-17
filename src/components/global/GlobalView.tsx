"use client";

import { useEffect, useRef } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import CanvasSurface from "@/components/shared/CanvasSurface";

const GlobalView = () => {
  const { state, players } = useGameClient("global");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
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

  return (
    <div className="relative min-h-screen w-full bg-slate-950">
      <CanvasSurface ref={canvasRef} className="bg-black" />
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
