import http from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

// 게임 설정 (intersection 서버와 호환되는 기본값)
const GAME_WIDTH = 5000;
const GAME_HEIGHT = 5000;
const MAX_HEARTBEAT_MS = 5000;
const TICK_HZ = 60; // 이동 계산
const UPDATE_HZ = 40; // 클라이언트 전송 빈도

type Vec2 = { x: number; y: number };

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  target: Vec2;
  radius: number;
  massTotal: number;
  color: string;
  screenWidth: number;
  screenHeight: number;
  lastHeartbeat: number;
}

const players = new Map<string, Player>();
const spectators = new Set<string>();

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

function spawnPoint(): Vec2 {
  const padding = 100;
  return {
    x: rand(padding, GAME_WIDTH - padding),
    y: rand(padding, GAME_HEIGHT - padding),
  };
}

function moveTowards(p: Player, dt: number) {
  const speed = 200; // px/s 기본 속도(간단화)
  const dx = p.target.x - (p.x - GAME_WIDTH / 2);
  const dy = p.target.y - (p.y - GAME_HEIGHT / 2);

  // target은 화면 중심 기준 상대 좌표이므로, 카메라를 플레이어 위치로 가정하고 보정
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = dx / len;
  const ny = dy / len;
  p.x = Math.max(0, Math.min(GAME_WIDTH, p.x + nx * speed * dt));
  p.y = Math.max(0, Math.min(GAME_HEIGHT, p.y + ny * speed * dt));
}

function toServerPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    massTotal: p.massTotal,
    color: p.color,
    cells: [
      {
        x: p.x,
        y: p.y,
        radius: p.radius,
      },
    ],
  };
}

function visiblePlayers(forId: string) {
  // 간략히: 모든 플레이어를 보낸다. 필요 시 화면 기준 가시거리 필터 추가 가능
  const list = Array.from(players.values())
    .filter((u) => u.id !== forId)
    .map(toServerPlayer);
  return list;
}

const httpServer = http.createServer((_, res) => {
  res.statusCode = 200;
  res.end("ok");
});

const io = new Server(httpServer, {
  transports: ["websocket"],
  allowEIO3: false,
  cors: {
    origin: ["http://localhost:3000"],
    credentials: false,
  },
  pingInterval: 10000,
  pingTimeout: 20000,
});

io.on("connection", (socket) => {
  const type = (socket.handshake.query?.type as string) || "player";

  if (type === "spectator") {
    spectators.add(socket.id);
    // spectator는 즉시 welcome
    socket.emit("welcome", {}, { width: GAME_WIDTH, height: GAME_HEIGHT });

    socket.on("gotit", () => {
      // no-op: spectator 등록만
    });
  } else {
    // player 핸들러
    socket.on("respawn", () => {
      const pos = spawnPoint();
      const existing = players.get(socket.id);
      const name = existing?.name || "";
      const p: Player = {
        id: socket.id,
        name,
        x: pos.x,
        y: pos.y,
        target: { x: 0, y: 0 },
        radius: 20,
        massTotal: 400,
        color: "rgba(255,255,255,0.8)",
        screenWidth: existing?.screenWidth || 0,
        screenHeight: existing?.screenHeight || 0,
        lastHeartbeat: Date.now(),
      };
      players.set(socket.id, p);
      socket.emit("welcome", toServerPlayer(p), {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
      });
    });

    socket.on(
      "gotit",
      (data: {
        name?: string;
        screenWidth?: number;
        screenHeight?: number;
        target?: Vec2;
      }) => {
        const p = players.get(socket.id);
        if (!p) return;
        p.name = (data.name || "").toString().slice(0, 24);
        p.screenWidth = Number(data.screenWidth || 0);
        p.screenHeight = Number(data.screenHeight || 0);
        if (data.target) p.target = data.target;
      }
    );

    socket.on("windowResized", (data: { screenWidth?: number; screenHeight?: number }) => {
      const p = players.get(socket.id);
      if (!p) return;
      p.screenWidth = Number(data.screenWidth || 0);
      p.screenHeight = Number(data.screenHeight || 0);
    });

    socket.on("0", (target: Vec2) => {
      const p = players.get(socket.id);
      if (!p) return;
      p.lastHeartbeat = Date.now();
      p.target = target || { x: 0, y: 0 };
    });
  }

  socket.on("disconnect", () => {
    spectators.delete(socket.id);
    players.delete(socket.id);
  });
});

// 게임 루프: 이동 계산
setInterval(() => {
  const now = Date.now();
  const dt = 1 / TICK_HZ;
  for (const p of players.values()) {
    if (now - p.lastHeartbeat > MAX_HEARTBEAT_MS) {
      // 하트비트 타임아웃: 단순히 타겟 무시
      continue;
    }
    moveTowards(p, dt);
  }
}, 1000 / TICK_HZ);

// 업데이트 브로드캐스트
setInterval(() => {
  // spectator 업데이트
  for (const id of spectators) {
    const s = io.sockets.sockets.get(id);
    if (!s) continue;
    const playerData = {
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT / 2,
      cells: [],
      massTotal: 0,
      color: "#ccc",
      id,
      name: "",
    };
    s.emit("serverTellPlayerMove", playerData, Array.from(players.values()).map(toServerPlayer));
    s.emit("leaderboard", { players: players.size });
  }

  // 각 플레이어별 업데이트
  for (const p of players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (!s) continue;
    s.emit("serverTellPlayerMove", toServerPlayer(p), visiblePlayers(p.id));
    s.emit("leaderboard", { players: players.size });
  }
}, 1000 / UPDATE_HZ);

httpServer.listen(PORT, HOST, () => {
  console.log(`Realtime on http://${HOST}:${PORT}`);
});
