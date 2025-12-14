"use client";

import type { GameAction, GameState, Mode, NoiseSlot } from "@/types/game";
import type {
  ServerPlayer,
  ServerCollisionEvent,
  ServerCollisionLine,
  ServerAudioSelf,
  ServerAudioCluster,
  ServerAudioGlobal,
} from "@/types/server";
import { mapServerPayloadToSnapshots } from "@/lib/game/mappers";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type MinimalSocket = {
  id?: string | null;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
  off: (event: string, handler?: (...args: unknown[]) => void) => unknown;
  emit: (event: string, ...args: unknown[]) => unknown;
};

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
  socket: MinimalSocket;
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
  const perf = (() => {
    const g = globalThis as unknown as {
      __intersectionPerf?: Record<string, unknown>;
    };
    if (!g.__intersectionPerf) g.__intersectionPerf = {};
    return g.__intersectionPerf;
  })();
  const nowMs = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const handlers: Array<[string, (...args: unknown[]) => void]> = [];
  const normalizeNoiseSlots = (payload: unknown): NoiseSlot[] => {
    const base = Array.from({ length: 4 }, (_, slot) => ({
      slot,
      nodeIds: [] as string[],
    }));
    if (!Array.isArray(payload)) return base;
    return base.map((entry) => {
      const match = payload.find(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as { slot?: unknown }).slot === entry.slot
      ) as { nodeIds?: unknown } | undefined;
      const rawNodeIds = Array.isArray(match?.nodeIds)
        ? (match?.nodeIds as unknown[])
        : [];
      const nodes = rawNodeIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0
      );
      return { ...entry, nodeIds: nodes.slice(0, 8) };
    });
  };

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

  // global(spectator) 모드에서 과도한 dispatch/리렌더로 프리즈가 나지 않도록
  // serverTellPlayerMove 처리를 저주파(≈15Hz)로 배치한다.
  let pendingGlobalMove: {
    playerData: ServerPlayer;
    userData: ServerPlayer[];
    meta?: {
      collisions?: ServerCollisionLine[];
      collisionEvents?: ServerCollisionEvent[];
      fast?: boolean;
      gravity?: { x: number; y: number; dist: number } | null;
      isCollidingSelf?: boolean;
    };
  } | null = null;
  let globalMoveTimer: number | null = null;
  const GLOBAL_MOVE_THROTTLE_MS = 66; // ~15Hz

  const flushGlobalMove = () => {
    globalMoveTimer = null;
    const pending = pendingGlobalMove;
    pendingGlobalMove = null;
    if (!pending) return;

    const t0 = nowMs();
    const effectivePlayerData = undefined;
    const currentSelfId = getState().selfId ?? undefined;
    const { players, order } = mapServerPayloadToSnapshots({
      playerData: effectivePlayerData,
      userData: pending.userData,
      mode,
      selfId: currentSelfId,
      displayName,
    });

    // spectator는 fast 업데이트를 쓰지 않으므로 그대로 반영
    dispatch({ type: "SET_PLAYERS", players, order, selfId: currentSelfId });

    // global 모드에서는 state.camera를 렌더에 거의 사용하지 않으므로
    // 매 틱마다 SET_CAMERA를 쏘지 않는다(불필요한 리렌더 유발).

    if (pending.meta?.collisions) {
      dispatch({ type: "SET_COLLISION_LINES", lines: pending.meta.collisions });
    }

    if (pending.meta?.collisionEvents?.length) {
      const marks = pending.meta.collisionEvents.map((event) => ({
        id: event.id,
        position: event.position,
        radius: event.radius ?? 80,
        timestamp: event.timestamp,
        players: event.players,
      }));
      dispatch({
        type: "PUSH_COLLISION_EVENTS",
        marks,
        highlight: false,
      });
    }

    const dt = nowMs() - t0;
    perf.globalMoveLastMs = dt;
    perf.globalMoveLastAt = Date.now();
    perf.globalMoveCount = Number(perf.globalMoveCount || 0) + 1;
    perf.globalMoveMaxMs = Math.max(Number(perf.globalMoveMaxMs || 0), dt);
  };

  const scheduleGlobalMove = () => {
    if (typeof window === "undefined") return;
    if (globalMoveTimer !== null) return;
    globalMoveTimer = window.setTimeout(
      flushGlobalMove,
      GLOBAL_MOVE_THROTTLE_MS
    );
  };

  const onPlayerMove = (
    playerData: ServerPlayer = {},
    userData: ServerPlayer[] = [],
    meta?: {
      collisions?: ServerCollisionLine[];
      collisionEvents?: ServerCollisionEvent[];
      fast?: boolean;
      gravity?: { x: number; y: number; dist: number } | null;
      isCollidingSelf?: boolean;
    }
  ) => {
    if (mode === "global") {
      pendingGlobalMove = { playerData, userData, meta };
      scheduleGlobalMove();
      return;
    }

    // ---- Perf instrumentation (personal) ----
    // We track arrival gaps separately from frame stalls:
    // - If gaps spike: network / server-loop lag / GC
    // - If gaps are stable but frame dt spikes: rendering / main-thread overload
    if (mode === "personal") {
      const recvAt = Date.now();
      const lastAt = Number(perf.personalMoveLastAt ?? 0) || 0;
      const gap = lastAt ? recvAt - lastAt : 0;
      perf.personalMoveLastAt = recvAt;
      perf.personalMoveGapLastMs = gap;
      perf.personalMoveGapMaxMs = Math.max(
        Number(perf.personalMoveGapMaxMs ?? 0) || 0,
        gap
      );
      perf.personalMoveCount = Number(perf.personalMoveCount ?? 0) + 1;
      if (meta?.fast) {
        perf.personalMoveFastCount =
          Number(perf.personalMoveFastCount ?? 0) + 1;
      } else {
        perf.personalMoveFullCount =
          Number(perf.personalMoveFullCount ?? 0) + 1;
      }
      perf.personalMoveUserDataLenLast = userData.length;
      perf.personalMoveUserDataLenMax = Math.max(
        Number(perf.personalMoveUserDataLenMax ?? 0) || 0,
        userData.length
      );
      perf.personalMoveFastLast = Boolean(meta?.fast);
    }

    const mapT0 = nowMs();
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
    const mapDt = nowMs() - mapT0;
    if (mode === "personal") {
      perf.personalMoveMapLastMs = mapDt;
      perf.personalMoveMapMaxMs = Math.max(
        Number(perf.personalMoveMapMaxMs ?? 0) || 0,
        mapDt
      );
      perf.personalMovePlayersLenLast = Object.keys(players).length;
      perf.personalMoveOrderLenLast = order.length;
    }

    if (mode === "personal" && currentSelfId) {
      const serverSelf = players[currentSelfId];
      if (serverSelf) {
        const gravityDir =
          meta?.gravity && Number.isFinite(meta.gravity.dist)
            ? { x: meta.gravity.x, y: meta.gravity.y }
            : undefined;
        const gravityDist =
          meta?.gravity && Number.isFinite(meta.gravity.dist)
            ? meta.gravity.dist
            : undefined;
        players[currentSelfId] = {
          ...serverSelf,
          isPredicted: false,
          predictionOffset: { x: 0, y: 0 },
          lastServerPosition: { ...serverSelf.cell.position },
          lastServerVelocity: { ...serverSelf.cell.velocity },
          gravityDir,
          gravityDist,
          isCollidingSelf: Boolean(meta?.isCollidingSelf),
        };
      }
    }

    if (mode === "personal") {
      dispatch({
        type: "PUSH_SNAPSHOT_FRAME",
        frame: {
          timestamp: Date.now(),
          players,
          order,
          fast: Boolean(meta?.fast),
        },
      });
    }

    if (!meta?.fast) {
      dispatch({ type: "SET_PLAYERS", players, order, selfId: currentSelfId });
    }

    if (mode === "personal" && !meta?.fast) {
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
      // non-personal 모드에서는 카메라를 별도로 강제 갱신하지 않는다.
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

  const onAudioSelf = (payload?: ServerAudioSelf) => {
    if (!payload) return;
    dispatch({
      type: "SET_AUDIO",
      audio: {
        self: {
          noiseLevel: payload.noiseLevel ?? 0,
          ambientLevel: payload.ambientLevel ?? 0,
          clusterId: payload.clusterId ?? null,
          updatedAt: Date.now(),
        },
      },
    });
  };

  const toClusterState = (
    payload?: ServerAudioCluster | null,
    source: "cluster" | "global" = "cluster"
  ) => {
    if (!payload) return null;
    return {
      clusterId: payload.clusterId,
      chord: payload.chord ?? [],
      memberCount: payload.memberCount ?? 0,
      centroid: payload.centroid ?? { x: 0, y: 0 },
      gain: payload.gain ?? 0,
      updatedAt: Date.now(),
      source,
    };
  };

  const onAudioCluster = (payload?: ServerAudioCluster) => {
    dispatch({
      type: "SET_AUDIO",
      audio: {
        cluster: toClusterState(payload, "cluster"),
      },
    });
  };

  // global 모드에서 audioGlobal이 30Hz로 들어오면 React 리렌더가 과도해질 수 있으므로
  // 오디오는 저주파(≈5Hz)로만 state에 반영한다. (NoiseCraft 전송은 별도로 500ms 스로틀됨)
  let pendingAudioGlobal: ServerAudioGlobal | null = null;
  let audioGlobalTimer: number | null = null;
  const AUDIO_GLOBAL_THROTTLE_MS = 200;
  const flushAudioGlobal = () => {
    audioGlobalTimer = null;
    const payload = pendingAudioGlobal;
    pendingAudioGlobal = null;
    if (!payload) return;
    dispatch({
      type: "SET_AUDIO",
      audio: {
        global: toClusterState(payload?.cluster, "global"),
      },
    });
    perf.audioGlobalLastAt = Date.now();
    perf.audioGlobalCount = Number(perf.audioGlobalCount || 0) + 1;
  };
  const scheduleAudioGlobal = () => {
    if (typeof window === "undefined") return;
    if (audioGlobalTimer !== null) return;
    audioGlobalTimer = window.setTimeout(
      flushAudioGlobal,
      AUDIO_GLOBAL_THROTTLE_MS
    );
  };
  const onAudioGlobal = (payload?: ServerAudioGlobal) => {
    if (mode === "global") {
      pendingAudioGlobal = payload ?? null;
      scheduleAudioGlobal();
      return;
    }
    dispatch({
      type: "SET_AUDIO",
      audio: {
        global: toClusterState(payload?.cluster, "global"),
      },
    });
  };

  const onNoiseSlots = (payload: unknown) => {
    dispatch({
      type: "SET_NOISE_SLOTS",
      slots: normalizeNoiseSlots(payload),
    });
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

  const handleConnect = () => onConnect();
  const handleWelcome = (...args: unknown[]) =>
    onWelcome(
      args[0] as ServerPlayer | undefined,
      args[1] as { width?: number; height?: number } | undefined
    );
  const handlePlayerMove = (...args: unknown[]) =>
    onPlayerMove(
      args[0] as ServerPlayer | undefined,
      (args[1] as ServerPlayer[]) ?? [],
      args[2] as {
        collisions?: ServerCollisionLine[];
        collisionEvents?: ServerCollisionEvent[];
        fast?: boolean;
        gravity?: { x: number; y: number; dist: number } | null;
        isCollidingSelf?: boolean;
      }
    );
  const handleLeaderboard = (...args: unknown[]) =>
    onLeaderboard((args[0] as { players?: number }) ?? {});
  const handleKick = (...args: unknown[]) => onKick((args[0] as string) ?? "");
  const handleDisconnect = () => onDisconnect();
  const handleConnectError = (...args: unknown[]) =>
    onConnectError((args[0] as Error) ?? new Error("connect_error"));
  const handleAudioSelf = (...args: unknown[]) =>
    onAudioSelf(args[0] as ServerAudioSelf | undefined);
  const handleAudioCluster = (...args: unknown[]) =>
    onAudioCluster(args[0] as ServerAudioCluster | undefined);
  const handleAudioGlobal = (...args: unknown[]) =>
    onAudioGlobal(args[0] as ServerAudioGlobal | undefined);

  handlers.push(["connect", handleConnect]);
  handlers.push(["welcome", handleWelcome]);
  handlers.push(["serverTellPlayerMove", handlePlayerMove]);
  handlers.push(["leaderboard", handleLeaderboard]);
  handlers.push(["kick", handleKick]);
  handlers.push(["disconnect", handleDisconnect]);
  handlers.push(["connect_error", handleConnectError]);
  handlers.push(["audioSelf", handleAudioSelf]);
  handlers.push(["audioCluster", handleAudioCluster]);
  handlers.push(["audioGlobal", handleAudioGlobal]);
  handlers.push([
    "noiseSlots:init",
    (...args: unknown[]) => onNoiseSlots(args[0]),
  ]);
  handlers.push([
    "noiseSlots:update",
    (...args: unknown[]) => onNoiseSlots(args[0]),
  ]);

  handlers.forEach(([event, handler]) => {
    socket.on(event, handler);
  });

  return () => {
    if (typeof window !== "undefined") {
      if (globalMoveTimer !== null) window.clearTimeout(globalMoveTimer);
      if (audioGlobalTimer !== null) window.clearTimeout(audioGlobalTimer);
    }
    globalMoveTimer = null;
    pendingGlobalMove = null;
    audioGlobalTimer = null;
    pendingAudioGlobal = null;
    handlers.forEach(([event, handler]) => {
      socket.off(event, handler);
    });
  };
};
