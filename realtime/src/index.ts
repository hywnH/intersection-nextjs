import http from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket";

// 게임 설정 (intersection 서버와 호환되는 기본값)
const GAME_WIDTH = 5000;
const GAME_HEIGHT = 5000;
const MAX_HEARTBEAT_MS = 5000;
const TICK_HZ = 120; // 이동 계산 더 촘촘히
const UPDATE_HZ = 60; // 클라이언트 전송 빈도 상향

type Vec2 = { x: number; y: number };

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number; // depth
  desiredVx: number;
  desiredVy: number;
  radius: number;
  massTotal: number;
  color: string;
  screenWidth: number;
  screenHeight: number;
  lastHeartbeat: number;
  vx: number;
  vy: number;
}

const players = new Map<string, Player>();
const spectators = new Set<string>();
const collisionLines = new Map<
  string,
  {
    id: string;
    players: [string, string];
    startedAt: number;
    lastEvent: number;
  }
>();
const collisionEvents: Array<{
  id: string;
  players: [string, string];
  position: Vec2;
  radius: number;
  timestamp: number;
}> = [];
const COLLISION_DISTANCE = 80;

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

function spawnPoint(): Vec2 {
  const padding = 100;
  return {
    x: rand(padding, GAME_WIDTH - padding),
    y: rand(padding, GAME_HEIGHT - padding),
  };
}

function moveTowards(p: Player, dt: number) {
  // 가속/감속 기반 부드러운 움직임: 클라이언트가 보낸 원하는 속도에 수렴
  const MAX_SPEED = 320; // px/s
  const SMOOTH = 0.25; // 응답성(0~1)
  
  // 유저 입력 처리
  const desiredVx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.desiredVx));
  const desiredVy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.desiredVy));
  
  // 유저가 정지 상태인지 확인 (원하는 속도가 거의 0이면 정지)
  const USER_MOVEMENT_THRESHOLD = 3; // px/s
  const isUserIdle = Math.abs(desiredVx) < USER_MOVEMENT_THRESHOLD && Math.abs(desiredVy) < USER_MOVEMENT_THRESHOLD;
  
  if (isUserIdle) {
    // 유저가 정지 상태일 때: 중력 적용
    // 가장 가까운 플레이어 찾기
    let closest: Player | null = null;
    let minDist = Infinity;
    
    for (const other of players.values()) {
      if (other.id === p.id) continue;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist) {
        minDist = dist;
        closest = other;
      }
    }
    
    if (closest) {
      // 중력 설정
      const GRAVITY_STRENGTH = 50; // px/s² (중력 가속도)
      const GRAVITY_MAX_DISTANCE = 3000; // 최대 중력 작용 거리
      const GRAVITY_MAX_SPEED = 100; // 중력으로 인한 최대 속도 (px/s)
      
      const dx = closest.x - p.x;
      const dy = closest.y - p.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist > 0 && dist < GRAVITY_MAX_DISTANCE) {
        // 거리에 반비례하는 중력 (가까울수록 강함)
        const gravityFactor = 1 - (dist / GRAVITY_MAX_DISTANCE);
        const gravityAccel = GRAVITY_STRENGTH * gravityFactor;
        
        // 방향 벡터 정규화
        const dirX = dx / dist;
        const dirY = dy / dist;
        
        // 중력 가속도를 속도에 적용
        const gravityVx = dirX * gravityAccel * dt;
        const gravityVy = dirY * gravityAccel * dt;
        
        p.vx += gravityVx;
        p.vy += gravityVy;
        
        // 중력 최대 속도 제한
        const currentSpeed = Math.hypot(p.vx, p.vy);
        if (currentSpeed > GRAVITY_MAX_SPEED) {
          const scale = GRAVITY_MAX_SPEED / currentSpeed;
          p.vx *= scale;
          p.vy *= scale;
        }
      } else {
        // 거리가 너무 멀면 속도 감소 (마찰)
        const FRICTION = 0.98;
        p.vx *= FRICTION;
        p.vy *= FRICTION;
      }
    } else {
      // 다른 플레이어가 없으면 속도 감소
      const FRICTION = 0.98;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
    }
  } else {
    // 유저가 이동 중일 때: 유저 입력 우선 (중력 무시)
    p.vx += (desiredVx - p.vx) * SMOOTH;
    p.vy += (desiredVy - p.vy) * SMOOTH;
  }
  
  // 위치 업데이트
  p.x = Math.max(0, Math.min(GAME_WIDTH, p.x + p.vx * dt));
  p.y = Math.max(0, Math.min(GAME_HEIGHT, p.y + p.vy * dt));
}

function toServerPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    massTotal: p.massTotal,
    color: p.color,
    cells: [
      {
        x: p.x,
        y: p.y,
        radius: p.radius,
        vx: p.vx,
        vy: p.vy,
        z: p.z,
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

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const EVENT_COOLDOWN_MS = 600;

function detectCollisions() {
  const arr = Array.from(players.values());
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = i + 1; j < arr.length; j += 1) {
      const pa = arr[i];
      const pb = arr[j];
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= COLLISION_DISTANCE) {
        const key = pairKey(pa.id, pb.id);
        const now = Date.now();
        const existing = collisionLines.get(key);
        if (!existing) {
          collisionLines.set(key, {
            id: key,
            players: [pa.id, pb.id],
            startedAt: now,
            lastEvent: now,
          });
          collisionEvents.push({
            id: `${key}-${now}`,
            players: [pa.id, pb.id],
            position: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
            radius: 80,
            timestamp: now,
          });
        } else if (now - existing.lastEvent > EVENT_COOLDOWN_MS) {
          existing.lastEvent = now;
          collisionEvents.push({
            id: `${key}-${now}`,
            players: existing.players,
            position: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
            radius: 80,
            timestamp: now,
          });
        }
      }
    }
  }
}

function removePlayerCollisions(id: string) {
  for (const [key, pair] of collisionLines) {
    if (pair.players[0] === id || pair.players[1] === id) {
      collisionLines.delete(key);
    }
  }
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:7773",
  "http://127.0.0.1:7773",
  "https://intersection-web.onrender.com",
  "https://intersection-audio.onrender.com",
];

const parseOrigins = (raw?: string) =>
  (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseOrigins(process.env.CORS_ORIGINS)])
);

const httpServer = http.createServer((_, res) => {
  res.statusCode = 200;
  res.end("ok");
});

const io = new Server(httpServer, {
  path: SOCKET_PATH,
  transports: ["websocket"],
  allowEIO3: false,
  cors: {
    origin: allowedOrigins,
    credentials: true,
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
        z: rand(-500, 500),
        desiredVx: 0,
        desiredVy: 0,
        radius: 20,
        massTotal: 400,
        color: "rgba(255,255,255,0.8)",
        screenWidth: existing?.screenWidth || 0,
        screenHeight: existing?.screenHeight || 0,
        lastHeartbeat: Date.now(),
        vx: 0,
        vy: 0,
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
      }) => {
        const p = players.get(socket.id);
        if (!p) return;
        p.name = (data.name || "").toString().slice(0, 24);
        p.screenWidth = Number(data.screenWidth || 0);
        p.screenHeight = Number(data.screenHeight || 0);
      }
    );

    socket.on(
      "windowResized",
      (data: { screenWidth?: number; screenHeight?: number }) => {
        const p = players.get(socket.id);
        if (!p) return;
        p.screenWidth = Number(data.screenWidth || 0);
        p.screenHeight = Number(data.screenHeight || 0);
      }
    );

    socket.on("0", (payload: { vx?: number; vy?: number }) => {
      const p = players.get(socket.id);
      if (!p) return;
      p.lastHeartbeat = Date.now();
      p.desiredVx = Number(payload?.vx || 0);
      p.desiredVy = Number(payload?.vy || 0);
    });
  }

  socket.on("disconnect", () => {
    spectators.delete(socket.id);
    players.delete(socket.id);
    removePlayerCollisions(socket.id);
  });

  // 외부 파라미터 브리지: 클라이언트가 보낸 파라미터 변경을 모두에게 브로드캐스트
  // payload 예: { type: 'setParam', nodeId: '0', paramName: 'value', value: 880 }
  socket.on("param", (payload: unknown) => {
    try {
      io.emit("param", payload);
    } catch {}
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
  detectCollisions();
  const collisionSnapshot = Array.from(collisionLines.values());
  const eventsSnapshot = collisionEvents.splice(0);

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
    s.emit(
      "serverTellPlayerMove",
      playerData,
      Array.from(players.values()).map(toServerPlayer),
      { collisions: collisionSnapshot, collisionEvents: eventsSnapshot }
    );
    s.emit("leaderboard", { players: players.size });
  }

  // 각 플레이어별 업데이트
  for (const p of players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (!s) continue;
    s.emit("serverTellPlayerMove", toServerPlayer(p), visiblePlayers(p.id), {
      collisions: collisionSnapshot,
      collisionEvents: eventsSnapshot,
    });
    s.emit("leaderboard", { players: players.size });
  }
}, 1000 / UPDATE_HZ);

httpServer.listen(PORT, HOST, () => {
  console.log(`Realtime on http://${HOST}:${PORT}`);
});
