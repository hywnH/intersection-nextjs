"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGameContext } from "@/context/GameContext";
import type { GameAction, GameState, Mode } from "@/types/game";
import { createInitialState, gameReducer } from "./state";
import { createSocketClient, type GameSocket } from "../socket/createClient";
import { registerSocketEvents } from "@/lib/socket/events";

type PlayerEntry = GameState["players"][string];

export interface GameClient {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  players: PlayerEntry[];
  socket: GameSocket | null;
}

export const useGameClient = (modeOverride?: Mode): GameClient => {
  const { mode: contextMode, displayName, serverUrl } = useGameContext();
  const mode = modeOverride ?? contextMode;
  const [state, dispatch] = useReducer(gameReducer, mode, createInitialState);
  const socketRef = useRef<GameSocket | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const stateRef = useRef(state);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const targetRef = useRef(state.target);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    targetRef.current = state.target;
  }, [state.target]);

  useEffect(() => {
    dispatch({ type: "SET_MODE", mode });
  }, [mode]);

  useEffect(() => {
    dispatch({
      type: "SET_UI",
      ui: { displayName },
    });
  }, [displayName]);

  useEffect(() => {
    let active = true;

    const connect = async () => {
      const socket = await createSocketClient({
        mode,
        serverUrl,
      });

      if (!active) {
        socket.disconnect();
        return;
      }

      socketRef.current = socket;
      setSocket(socket);
      eventCleanupRef.current = registerSocketEvents({
        socket,
        mode,
        dispatch,
        displayName,
        getState: () => stateRef.current,
      });
    };

    connect();

    return () => {
      active = false;
      eventCleanupRef.current?.();
      eventCleanupRef.current = null;
      socketRef.current?.disconnect();
      setSocket(null);
      socketRef.current = null;
      dispatch({ type: "RESET" });
    };
  }, [mode, displayName, serverUrl]);

  useEffect(() => {
    if (!socket || mode !== "personal") return;
    if (typeof window === "undefined") return;
    const interval = window.setInterval(() => {
      socket.emit("0", targetRef.current);
    }, 500);
    return () => window.clearInterval(interval);
  }, [socket, mode]);

  const players = useMemo(() => {
    return state.playerOrder
      .map((id) => state.players[id])
      .filter(Boolean) as PlayerEntry[];
  }, [state.playerOrder, state.players]);

  return {
    state,
    dispatch,
    players,
    socket,
  };
};
