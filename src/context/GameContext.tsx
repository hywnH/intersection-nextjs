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

  // 클라이언트 환경에서는 현재 접속한 호스트 기준으로 WS 주소를 재계산
  // 예: 페이지가 192.168.0.152:3000 이면 WS는 192.168.0.152:3001/socket
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hostname = window.location.hostname || "localhost";
    const protocol = window.location.protocol === "https:" ? "https" : "http";

    // envWsUrl이 절대/상대 URL이든 상관 없이 path 부분만 추출
    let path = "/socket";
    if (envWsUrl) {
      try {
        const url = new URL(envWsUrl, `${protocol}://${hostname}`);
        path = url.pathname || "/socket";
      } catch {
        // 실패하면 기본값 유지
      }
    }

    const wsUrl = `${protocol}://${hostname}:3001${path}`;
    setServerUrl(wsUrl);
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
