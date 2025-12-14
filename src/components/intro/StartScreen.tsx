"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameContext } from "@/context/GameContext";
import { usePersonalRuntime } from "@/lib/runtime/PersonalRuntimeProvider";

const StartScreen = () => {
  const router = useRouter();
  const { setMode, setDisplayName } = useGameContext();
  const runtime = usePersonalRuntime();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterRequested, setEnterRequested] = useState(false);
  const enterNameRef = useRef("");

  const trimmedName = useMemo(() => name.trim(), [name]);

  const handleEnter = () => {
    setError(null);
    setEntering(true);
    setEnterRequested(true);
    enterNameRef.current = trimmedName;
    // Make sure providers use personal mode + name while we wait.
    setMode("personal");
    setDisplayName(trimmedName);
  };

  // If user clicks before socket/noisecraft are ready, wait and then continue.
  useEffect(() => {
    if (!enterRequested) return;
    if (!runtime.ready.ready) return;
    let cancelled = false;

    const run = async () => {
      try {
        const ok = await runtime.enableAudioAndTilt({
          displayName: enterNameRef.current,
        });
        if (cancelled) return;
        if (!ok) {
          setError(
            "Failed to enable audio + tilt. If you're on iOS, allow Motion & Orientation access, then try again."
          );
          setEnterRequested(false);
          setEntering(false);
          return;
        }
        router.push("/mobile");
      } finally {
        if (!cancelled) {
          setEntering(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [enterRequested, runtime.ready.ready, runtime.enableAudioAndTilt, router]);

  return (
    <div className="flex flex-col gap-8 text-white">
      <div className="space-y-6">
        <h1 className="text-5xl font-bold leading-tight sm:text-6xl md:text-7xl vintage-serif">
          Intersection
        </h1>
      </div>

      <div className="space-y-4">
        <p className="text-sm leading-tight text-white/70 font-normal vintage-serif">
          The sphere at the center is yours.
          <br />
          <br />
          Touch and hold the space
          <br />
          to move it in that direction.
          <br />
          <br />
          Listen carefully —
          <br />
          sound will guide you toward encounters.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 mt-8">
        <div className="flex flex-col gap-2">
          <label
            className="text-sm font-normal text-white/60 vintage-serif"
            htmlFor="displayName"
          >
            your name
          </label>
          <input
            id="displayName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Voyager-123"
            className="border border-white/30 bg-[#1a1a1a] px-4 py-3 text-sm font-normal text-white text-left outline-none transition-colors focus:border-white/50 vintage-serif w-[200px]"
          />
        </div>

        <button
          className="border border-white bg-transparent px-12 py-3 text-sm font-normal text-white transition-all duration-300 hover:border-white/80 hover:text-white/90 active:scale-[0.98] vintage-serif w-[200px]"
          onClick={handleEnter}
          disabled={entering}
        >
          {entering ? "Loading…" : "Enter the space"}
        </button>
        {error && (
          <div className="w-[260px] text-center text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="mt-auto pt-8">
        <p className="text-xs font-extralight italic text-white/40 tracking-widest vintage-serif">
          &quot;Across the sea of space, the stars are other suns.&quot; - Carl
          Sagan
        </p>
      </div>
    </div>
  );
};

export default StartScreen;
