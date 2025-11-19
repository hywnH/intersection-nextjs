"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Mode } from "@/types/game";

interface GameContextValue {
  mode: Mode;
  displayName: string;
  serverUrl: string;
  setMode: (mode: Mode) => void;
  setDisplayName: (name: string) => void;
  setServerUrl: (url: string) => void;
}

// 서버 환경(SSR)용 기본 WS URL
const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;
const fallbackUrl =
  envWsUrl ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001/socket"
    : "/socket");

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!envWsUrl) return;

    try {
      const absoluteUrl = new URL(envWsUrl, window.location.origin);
      setServerUrl(absoluteUrl.toString());
    } catch {
      setServerUrl(envWsUrl);
    }
  }, []);

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
