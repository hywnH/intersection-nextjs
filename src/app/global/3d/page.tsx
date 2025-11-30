"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import GlobalView from "@/components/global/GlobalView";

const GlobalPerspectiveView = dynamic(
  () => import("@/components/global/GlobalPerspectiveView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white/70">
        3D 뷰 로딩 중...
      </div>
    ),
  }
);

type Mode = "projection" | "perspective";

export default function Global3DPage() {
  const [mode, setMode] = useState<Mode>("perspective");

  return (
    <div className="relative min-h-screen bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-1/2 top-6 z-50 flex -translate-x-1/2 gap-2">
          <button
            type="button"
            onClick={() => setMode("projection")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "projection"
                ? "bg-white text-black shadow-lg"
                : "bg-white/10 text-white/70"
            }`}
          >
            Projection
          </button>
          <button
            type="button"
            onClick={() => setMode("perspective")}
            className={`rounded-full px-4 py-2 text-sm transition ${
              mode === "perspective"
                ? "bg-white text-black shadow-lg"
                : "bg-white/10 text-white/70"
            }`}
          >
            Perspective
          </button>
        </div>
      </div>
      <div className="h-screen w-full">
        {mode === "projection" ? (
          <GlobalView key="projection" />
        ) : (
          <GlobalPerspectiveView key="perspective" />
        )}
      </div>
    </div>
  );
}


