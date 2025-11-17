"use client";

import { io } from "socket.io-client";
import type { Mode } from "@/types/game";

export interface GameSocket {
  id: string | null | undefined;
  emit: (event: string, ...args: unknown[]) => GameSocket;
  on: (event: string, handler: (...args: unknown[]) => void) => GameSocket;
  off: (event: string, handler?: (...args: unknown[]) => void) => GameSocket;
  disconnect: () => void;
}

const createStubSocket = (): GameSocket => {
  const stub: GameSocket = {
    id: null,
    emit: () => stub,
    on: () => stub,
    off: () => stub,
    disconnect: () => undefined,
  };
  return stub;
};

export const createSocketClient = async ({
  serverUrl,
  mode,
}: {
  serverUrl: string;
  mode: Mode;
}): Promise<GameSocket> => {
  if (typeof window === "undefined") {
    return createStubSocket();
  }

  return io(serverUrl, {
    query: {
      type: mode === "personal" ? "player" : "spectator",
    },
    transports: ["websocket"],
    withCredentials: true,
  }) as GameSocket;
};
