"use client";

import { useEffect, useMemo, useState } from "react";

type PerfSnapshot = {
  fps: number;
  frameMsP95: number;
  globalMoveLastMs?: number;
  globalMoveMaxMs?: number;
  globalMoveCount?: number;
  audioGlobalCount?: number;
};

const p95 = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((sorted.length - 1) * 0.95));
  return sorted[idx] ?? 0;
};

const p50 = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((sorted.length - 1) * 0.5));
  return sorted[idx] ?? 0;
};

type FrameSample = { t: number; dt: number };
type MoveSample = { t: number; ms: number };

export default function PerfOverlay({
  population,
  mode,
}: {
  population: number;
  mode: string;
}) {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>({
    fps: 0,
    frameMsP95: 0,
  });

  const enableAutoDump = useMemo(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("dump") === "1";
  }, []);

  // FPS 측정 (메인 스레드 프레임 드랍 감지)
  useEffect(() => {
    const frameSamples: FrameSample[] = [];
    const moveSamples: MoveSample[] = [];
    let lastDumpAt = 0;
    let lastSeenMoveAt = 0;

    let raf = 0;
    let last = performance.now();
    const windowMs: number[] = [];
    let lastReport = performance.now();

    const dump = (reason: string, extra?: Record<string, unknown>) => {
      if (!enableAutoDump) return;
      const now = Date.now();
      // 너무 자주 찍히면 콘솔이 난장판이 되니 5초 쿨다운
      if (now - lastDumpAt < 5000) return;
      lastDumpAt = now;

      const cutoff = now - 5000;
      const recentFrames = frameSamples.filter((s) => s.t >= cutoff);
      const recentMoves = moveSamples.filter((s) => s.t >= cutoff);
      const dts = recentFrames.map((s) => s.dt);
      const moveMs = recentMoves.map((s) => s.ms);

      const perf = (
        globalThis as unknown as {
          __intersectionPerf?: Record<string, unknown>;
        }
      ).__intersectionPerf;

      const summary = {
        at: new Date(now).toISOString(),
        reason,
        mode,
        population,
        frames: {
          count: dts.length,
          p50: Number(p50(dts).toFixed(2)),
          p95: Number(p95(dts).toFixed(2)),
          max: Number((Math.max(0, ...dts) || 0).toFixed(2)),
        },
        socket: {
          globalMoveLastMs: Number(perf?.globalMoveLastMs ?? 0) || 0,
          globalMoveMaxMs: Number(perf?.globalMoveMaxMs ?? 0) || 0,
          globalMoveCount: Number(perf?.globalMoveCount ?? 0) || 0,
          audioGlobalCount: Number(perf?.audioGlobalCount ?? 0) || 0,
          recentMoveSamples: recentMoves.length,
          moveMs: {
            p50: Number(p50(moveMs).toFixed(2)),
            p95: Number(p95(moveMs).toFixed(2)),
            max: Number((Math.max(0, ...moveMs) || 0).toFixed(2)),
          },
        },
        extra: extra ?? null,
      };

      const g = globalThis as unknown as {
        __intersectionPerfDumps?: unknown[];
      };
      if (!g.__intersectionPerfDumps) g.__intersectionPerfDumps = [];
      g.__intersectionPerfDumps.push(summary);

      // eslint-disable-next-line no-console
      console.groupCollapsed("[PerfDump]", summary.reason, summary.at);
      // eslint-disable-next-line no-console
      console.log(summary);
      // eslint-disable-next-line no-console
      console.log("Recent frames (t, dt ms):", recentFrames.slice(-180));
      // eslint-disable-next-line no-console
      console.log("Recent move processing (t, ms):", recentMoves.slice(-120));
      // eslint-disable-next-line no-console
      console.groupEnd();
    };

    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      windowMs.push(dt);
      frameSamples.push({ t: Date.now(), dt });
      // 2초치만 유지
      while (windowMs.length > 240) windowMs.shift();
      while (frameSamples.length > 600) frameSamples.shift(); // 대략 10초치 상한

      // 프리즈(큰 프레임 스톨) 감지
      // - 250ms 이상 dt면 체감상 "멈춤"으로 보이는 경우가 많음
      if (dt >= 250) {
        dump("frame_stall", { dtMs: Number(dt.toFixed(2)) });
      }

      if (t - lastReport >= 500) {
        const p95Ms = p95(windowMs);
        const avg =
          windowMs.reduce((s, v) => s + v, 0) / Math.max(1, windowMs.length);
        const fps = avg > 0 ? 1000 / avg : 0;

        const perf = (
          globalThis as unknown as {
            __intersectionPerf?: Record<string, unknown>;
          }
        ).__intersectionPerf;

        // serverTellPlayerMove 배치 처리 시간 샘플링 (값이 갱신된 경우만)
        const moveAt = Number(perf?.globalMoveLastAt ?? 0) || 0;
        const moveMs = Number(perf?.globalMoveLastMs ?? 0) || 0;
        if (moveAt && moveAt !== lastSeenMoveAt) {
          lastSeenMoveAt = moveAt;
          moveSamples.push({ t: moveAt, ms: moveMs });
          while (moveSamples.length > 300) moveSamples.shift();
        }

        setSnapshot({
          fps,
          frameMsP95: p95Ms,
          globalMoveLastMs: Number(perf?.globalMoveLastMs ?? 0) || 0,
          globalMoveMaxMs: Number(perf?.globalMoveMaxMs ?? 0) || 0,
          globalMoveCount: Number(perf?.globalMoveCount ?? 0) || 0,
          audioGlobalCount: Number(perf?.audioGlobalCount ?? 0) || 0,
        });

        // p95가 비정상적으로 올라가면(프레임 불안정) 한 번 덤프
        if (p95Ms >= 80) {
          dump("frame_p95_high", { p95Ms: Number(p95Ms.toFixed(2)) });
        }

        lastReport = t;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enableAutoDump, mode, population]);

  const lines = useMemo(() => {
    const arr: string[] = [];
    arr.push(`mode: ${mode}`);
    arr.push(`population: ${population}`);
    arr.push(`fps(avg): ${snapshot.fps.toFixed(1)}`);
    arr.push(`frame p95: ${snapshot.frameMsP95.toFixed(1)}ms`);
    if (mode === "global") {
      arr.push(
        `move(ms): last ${Number(snapshot.globalMoveLastMs).toFixed(
          1
        )} / max ${Number(snapshot.globalMoveMaxMs).toFixed(1)} / count ${
          snapshot.globalMoveCount
        }`
      );
      arr.push(`audioGlobal(count): ${snapshot.audioGlobalCount}`);
    }
    if (enableAutoDump) {
      arr.push("dump: on");
    }
    return arr;
  }, [enableAutoDump, mode, population, snapshot]);

  return (
    <div className="pointer-events-none fixed left-3 top-3 z-[9999] rounded-lg bg-black/70 px-3 py-2 text-[11px] leading-5 text-white">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
