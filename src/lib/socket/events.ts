"use client";

import type { Socket } from "socket.io-client";
import type { GameAction, GameState, Mode } from "@/types/game";
import type {
  ServerPlayer,
  ServerCollisionEvent,
  ServerCollisionLine,
} from "@/types/server";
import { mapServerPayloadToSnapshots } from "@/lib/game/mappers";

const generateDisplayName = (mode: Mode, preferred?: string) => {
  if (preferred && preferred.trim().length > 0) {
    return preferred.trim();
  }
  if (mode === "personal") {
    return `Explorer-${Math.floor(Math.random() * 900 + 100)}`;
  }
  return "Spectator";
};

interface RegisterSocketOptions {
  socket: Socket;
  mode: Mode;
  dispatch: React.Dispatch<GameAction>;
  displayName: string;
  getState: () => GameState;
}

export const registerSocketEvents = ({
  socket,
  mode,
  dispatch,
  displayName,
  getState,
}: RegisterSocketOptions) => {
  const handlers: Array<[string, (...args: unknown[]) => void]> = [];

  const onConnect = () => {
    dispatch({
      type: "SET_SOCKET_ID",
      socketId: socket.id ?? null,
    });
    dispatch({
      type: "SET_UI",
      ui: { connected: true, statusMessage: "서버에 연결되었습니다." },
    });
    if (mode === "personal") {
      socket.emit("respawn");
    }
  };

  const onWelcome = (
    playerSettings: ServerPlayer = {},
    gameSizes: { width?: number; height?: number } = {}
  ) => {
    const width = Number(gameSizes.width) || getState().gameSize.width;
    const height = Number(gameSizes.height) || getState().gameSize.height;

    dispatch({
      type: "SET_GAME_SIZE",
      gameSize: { width, height },
    });

    const selfId =
      mode === "personal"
        ? playerSettings.id || socket.id || getState().selfId
        : null;

    if (mode === "personal") {
      dispatch({
        type: "SET_SELF",
        selfId,
      });
    }

    dispatch({ type: "SET_PLAYING", playing: true });
    dispatch({
      type: "SET_UI",
      ui: { statusMessage: "월드 동기화 중..." },
    });

    const handshake: Record<string, unknown> = {
      name: generateDisplayName(mode, displayName),
    };

    if (mode === "personal" && typeof window !== "undefined") {
      handshake.screenWidth = window.innerWidth;
      handshake.screenHeight = window.innerHeight;
      handshake.target = getState().target;
    }

    socket.emit("gotit", handshake);

    if (mode === "personal" && typeof window !== "undefined") {
      socket.emit("windowResized", {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      });
    }
  };

  const onPlayerMove = (
    playerData: ServerPlayer = {},
    userData: ServerPlayer[] = [],
    meta?: {
      collisions?: ServerCollisionLine[];
      collisionEvents?: ServerCollisionEvent[];
    }
  ) => {
    const effectivePlayerData = mode === "personal" ? playerData : undefined;
    const currentSelfId =
      getState().selfId ?? playerData.id ?? socket.id ?? undefined;
    const { players, order } = mapServerPayloadToSnapshots({
      playerData: effectivePlayerData,
      userData,
      mode,
      selfId: currentSelfId,
      displayName,
    });
    dispatch({ type: "SET_PLAYERS", players, order, selfId: currentSelfId });

    if (mode === "personal") {
      const focus =
        (currentSelfId && players[currentSelfId]?.cell.position) ??
        playerData?.target ??
        players[order[0]]?.cell.position;
      if (focus) {
        dispatch({
          type: "SET_CAMERA",
          camera: { position: focus },
        });
      }
    } else {
      const focus = {
        x: getState().gameSize.width / 2,
        y: getState().gameSize.height / 2,
      };
      dispatch({
        type: "SET_CAMERA",
        camera: { position: focus },
      });
    }

    if (meta?.collisions) {
      dispatch({ type: "SET_COLLISION_LINES", lines: meta.collisions });
    }

    if (meta?.collisionEvents?.length) {
      const marks = meta.collisionEvents.map((event) => ({
        id: event.id,
        position: event.position,
        radius: event.radius ?? 80,
        timestamp: event.timestamp,
        players: event.players,
      }));
      const selfId = getState().selfId;
      const highlight =
        Boolean(selfId) &&
        meta.collisionEvents.some((event) =>
          event.players.includes(selfId as string)
        );
      dispatch({
        type: "PUSH_COLLISION_EVENTS",
        marks,
        highlight,
      });
    }
  };

  const onLeaderboard = (payload: { players?: number } = {}) => {
    if (typeof payload.players === "number") {
      dispatch({
        type: "SET_UI",
        ui: { population: payload.players },
      });
    }
  };

  const onKick = (reason = "") => {
    dispatch({
      type: "SET_UI",
      ui: {
        statusMessage: reason
          ? `접속이 종료되었습니다: ${reason}`
          : "접속이 종료되었습니다.",
        connected: false,
      },
    });
    dispatch({ type: "SET_PLAYING", playing: false });
  };

  const onDisconnect = () => {
    dispatch({
      type: "SET_SOCKET_ID",
      socketId: null,
    });
    dispatch({
      type: "SET_UI",
      ui: {
        connected: false,
        statusMessage: "연결이 끊어졌습니다. 재시도 중...",
      },
    });
    dispatch({ type: "SET_PLAYING", playing: false });
  };

  const onConnectError = (error: Error) => {
    dispatch({
      type: "SET_UI",
      ui: {
        connected: false,
        statusMessage: `연결 실패: ${error.message}`,
      },
    });
  };

  handlers.push(["connect", onConnect]);
  handlers.push(["welcome", onWelcome]);
  handlers.push(["serverTellPlayerMove", onPlayerMove]);
  handlers.push(["leaderboard", onLeaderboard]);
  handlers.push(["kick", onKick]);
  handlers.push(["disconnect", onDisconnect]);
  handlers.push(["connect_error", onConnectError]);

  handlers.forEach(([event, handler]) => {
    socket.on(event, handler);
  });

  return () => {
    handlers.forEach(([event, handler]) => {
      socket.off(event, handler);
    });
  };
};
