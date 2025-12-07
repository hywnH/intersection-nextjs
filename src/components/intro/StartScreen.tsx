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
    <div className="flex flex-col gap-12 text-white">
      <div className="space-y-4">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-white/40">
          Intersection
        </p>
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
          Intersection
        </h1>
        <p className="max-w-2xl text-lg text-white/70">
          Intersection is a collaborative music experience. Join a global
          audience or create your own personal space.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-white/60" htmlFor="displayName">
          Your Name (optional)
        </label>
        <input
          id="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Explorer-123"
          className="w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-base text-white outline-none focus:border-white"
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          className="rounded-full bg-white px-8 py-4 text-center text-black transition hover:bg-white/90"
          onClick={() => handleEnter("personal")}
        >
          Personal Space
        </button>
        <button
          className="rounded-full border border-white/30 px-8 py-4 text-center transition hover:border-white hover:bg-white/10"
          onClick={() => handleEnter("global")}
        >
          Global Space
        </button>
      </div>
    </div>
  );
};

export default StartScreen;
