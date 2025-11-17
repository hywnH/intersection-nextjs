"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Mode } from "@/types/game";

interface GameContextValue {
  mode: Mode;
  displayName: string;
  serverUrl: string;
  setMode: (mode: Mode) => void;
  setDisplayName: (name: string) => void;
  setServerUrl: (url: string) => void;
}

const fallbackUrl = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

const defaultValue: GameContextValue = {
  mode: "personal",
  displayName: "",
  serverUrl: fallbackUrl,
  setMode: () => undefined,
  setDisplayName: () => undefined,
  setServerUrl: () => undefined,
};

const GameContext = createContext<GameContextValue>(defaultValue);

export const GameProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setMode] = useState<Mode>("personal");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState(fallbackUrl);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      displayName,
      setDisplayName,
      serverUrl,
      setServerUrl,
    }),
    [mode, displayName, serverUrl]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export const useGameContext = () => useContext(GameContext);
