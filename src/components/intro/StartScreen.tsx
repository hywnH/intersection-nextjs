"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameContext } from "@/context/GameContext";
import type { Mode } from "@/types/game";

const StartScreen = () => {
  const router = useRouter();
  const { setMode, setDisplayName } = useGameContext();
  const [name, setName] = useState("");

  const handleEnter = (mode: Mode) => {
    setMode(mode);
    setDisplayName(name.trim());
    router.push(mode === "personal" ? "/mobile" : "/global");
  };

  return (
    <div className="flex flex-col gap-8 text-white">
      <div className="space-y-6">
        <h1 className="text-5xl font-bold leading-tight sm:text-6xl md:text-7xl vintage-serif">
          Intersection
        </h1>
      </div>

      <div className="space-y-4">
        <p className="text-sm leading-normal text-white/70 font-normal vintage-serif">
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

      <div className="flex flex-col items-center gap-4">
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
            className="rounded-lg border border-white/30 bg-white px-12 py-3 text-sm font-normal text-gray-800 outline-none transition-colors focus:border-white/50 vintage-serif w-[200px]"
          />
        </div>

        <button
          className="rounded-lg border border-white bg-transparent px-12 py-3 text-sm font-normal text-white transition-all duration-300 hover:border-white/80 hover:text-white/90 active:scale-[0.98] vintage-serif w-[200px]"
          onClick={() => handleEnter("personal")}
        >
          Enter the space
        </button>
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
