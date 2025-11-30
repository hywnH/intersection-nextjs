import type { GameState, Vec2 } from "@/types/game";

type ProjectionMode = "plane" | "lines";

interface RenderParams {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  width: number;
  height: number;
  projection?: ProjectionMode;
  transition?: {
    from: ProjectionMode;
    to: ProjectionMode;
    progress: number;
  } | null;
}

const project = (
  state: GameState,
  width: number,
  height: number,
  position: Vec2,
  overrides?: { cameraPosition?: Vec2; zoom?: number }
) => {
  const cameraPos = overrides?.cameraPosition ?? state.camera.position;
  const zoom = overrides?.zoom ?? state.camera.zoom;
  return {
    x: (position.x - cameraPos.x) * zoom + width / 2,
    y: (position.y - cameraPos.y) * zoom + height / 2,
  };
};

export const clearScene = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  ctx.fillStyle = "#01030a";
  ctx.fillRect(0, 0, width, height);
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const computeBlend = (
  projection: ProjectionMode,
  transition?: {
    from: ProjectionMode;
    to: ProjectionMode;
    progress: number;
  } | null
) => {
  if (!transition) {
    return projection === "lines" ? 1 : 0;
  }
  if (transition.to === "lines") {
    return clamp01(transition.progress);
  }
  return clamp01(1 - transition.progress);
};

const renderPlayers = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  ctx.save();
  const predictionVisualBlend = 0.85;

  if (blend > 0.01) {
    ctx.strokeStyle = `rgba(255,255,255,${0.15 * blend})`;
    for (let i = 0; i < state.playerOrder.length; i += 1) {
      const laneY = laneGap * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, laneY);
      ctx.lineTo(width, laneY);
      ctx.stroke();
    }
  }

  const isPersonal = state.mode === "personal";

  state.playerOrder.forEach((playerId, index) => {
    const player = state.players[playerId];
    if (!player) return;
    if (isPersonal && !player.isSelf) {
      return;
    }
    const { cell, depth } = player;
    const hasPredictionMeta =
      Boolean(
        player.isPredicted &&
          player.lastServerPosition &&
          player.predictionOffset
      ) && isPersonal;
    const renderBasePosition = hasPredictionMeta
      ? {
          x:
            player.lastServerPosition!.x +
            player.predictionOffset!.x * predictionVisualBlend,
          y:
            player.lastServerPosition!.y +
            player.predictionOffset!.y * predictionVisualBlend,
        }
      : cell.position;

    // dead-reckoning: server 업데이트 시간으로부터 경과시간 동안 속도로 예측
    const t = Math.min((Date.now() - player.lastUpdate) / 1000, 0.25);
    const predicted: Vec2 = {
      x: renderBasePosition.x + cell.velocity.x * t,
      y: renderBasePosition.y + cell.velocity.y * t,
    };
    const planePos = project(state, width, height, predicted, overrides);
    const idx = orderIndex.get(playerId) ?? index;
    const laneY = laneGap * (idx + 1);
    const lineX = (renderBasePosition.x / state.gameSize.width) * width;

    const screenPos = {
      x: planePos.x * (1 - blend) + lineX * blend,
      y: planePos.y * (1 - blend) + laneY * blend,
    };
    const radius = cell.radius * state.camera.zoom * (1 - blend) + 8 * blend;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = cell.color ?? "rgba(255,255,255,0.6)";
    ctx.fill();

    // 깊이감 보조(옵션): z에 비례한 알파나 외곽선
    if (typeof depth === "number" && blend < 0.8) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(
        0.1,
        1 - Math.abs(depth) / 1000
      )})`;
      ctx.stroke();
    }

    if (player.isSelf && state.selfHighlightUntil > Date.now()) {
      const glow = (state.selfHighlightUntil - Date.now()) / 1200;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius + 20 * glow, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * glow})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    if (isPersonal && player.isSelf) {
      ctx.font = "12px Geist, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.textAlign = "center";
      ctx.fillText(player.name || "-", screenPos.x, screenPos.y + radius + 14);
    } else if (blend > 0.3) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "12px Geist, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.fillText(player.name || "-", screenPos.x + 12, screenPos.y - 10);
    }
  });
  ctx.restore();
};
const drawSpringLine = (
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  opts: {
    phase: number;
    amplitude: number;
    segments?: number;
    damping?: number;
    waves?: number;
  }
) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    return;
  }
  const segments = opts.segments ?? 18;
  const damping = opts.damping ?? 2.4;
  const waves = opts.waves ?? 3.4;
  const nx = -dy / distance;
  const ny = dx / distance;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const sine = Math.sin(t * Math.PI * waves + opts.phase);
    const fade = Math.exp(-t * damping);
    const offset = opts.amplitude * sine * fade;
    ctx.lineTo(from.x + dx * t + nx * offset, from.y + dy * t + ny * offset);
  }
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
};
const computeSpringAmplitude = (args: {
  startedAt: number;
  lastEvent?: number;
  now: number;
}) => {
  const lastImpulse = args.lastEvent ?? args.startedAt ?? args.now;
  const sinceLast = Math.max(0, args.now - lastImpulse);
  const decay = Math.exp(-sinceLast / 1600);
  const idlePulse = 4 + 2 * Math.sin(args.now / 1000);
  return idlePulse + 24 * decay;
};
const renderCollisionConnections = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  const selfId = state.selfId;
  ctx.save();
  const phase =
    typeof performance !== "undefined"
      ? performance.now() * 0.012
      : Date.now() * 0.012;
  const wallNow = Date.now();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 8;
  state.collisionLines.forEach((pair) => {
    if (state.mode === "personal" && selfId) {
      if (!pair.players.includes(selfId)) {
        return;
      }
    }
    const a = state.players[pair.players[0]];
    const b = state.players[pair.players[1]];
    if (!a || !b) return;
    const idxA = orderIndex.get(a.id) ?? 0;
    const idxB = orderIndex.get(b.id) ?? 0;
    const laneAy = laneGap * (idxA + 1);
    const laneBy = laneGap * (idxB + 1);
    const planeA = project(state, width, height, a.cell.position, overrides);
    const planeB = project(state, width, height, b.cell.position, overrides);
    const lineAx = (a.cell.position.x / state.gameSize.width) * width;
    const lineBx = (b.cell.position.x / state.gameSize.width) * width;
    const posA = {
      x: planeA.x * (1 - blend) + lineAx * blend,
      y: planeA.y * (1 - blend) + laneAy * blend,
    };
    const posB = {
      x: planeB.x * (1 - blend) + lineBx * blend,
      y: planeB.y * (1 - blend) + laneBy * blend,
    };
    const amplitude = computeSpringAmplitude({
      startedAt: pair.startedAt,
      lastEvent: pair.lastEvent,
      now: wallNow,
    });
    drawSpringLine(ctx, posA, posB, {
      phase,
      amplitude,
      segments: 20,
      damping: 2.1,
      waves: 4,
    });

    // Render endpoints without blending to maintain visibility in personal mode
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 12;
    const dotRadius = blend > 0.7 ? 4.5 : 6;
    ctx.beginPath();
    ctx.arc(posA.x, posA.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(posB.x, posB.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

const renderCollisionMarks = ({
  ctx,
  state,
  width,
  height,
  blend,
  laneGap,
  orderIndex,
  overrides,
}: RenderParams & {
  blend: number;
  laneGap: number;
  orderIndex: Map<string, number>;
  overrides?: { cameraPosition?: Vec2; zoom?: number };
}) => {
  ctx.save();
  const now = Date.now();
  const DURATION = 6000;
  state.collisionMarks.forEach((mark) => {
    const age = (now - mark.timestamp) / DURATION;
    if (age >= 1) return;
    const planePos = project(state, width, height, mark.position, overrides);
    let laneY: number;
    if (mark.players && mark.players.length) {
      const indexes = mark.players
        .map((id) => orderIndex.get(id))
        .filter((idx) => idx !== undefined) as number[];
      if (indexes.length > 0) {
        laneY =
          laneGap *
          (indexes.reduce((sum, idx) => sum + (idx + 1), 0) / indexes.length);
      } else {
        laneY = (mark.position.y / state.gameSize.height) * height;
      }
    } else {
      laneY = (mark.position.y / state.gameSize.height) * height;
    }
    const lineX = (mark.position.x / state.gameSize.width) * width;
    const pos = {
      x: planePos.x * (1 - blend) + lineX * blend,
      y: planePos.y * (1 - blend) + laneY * blend,
    };
    const radius =
      mark.radius * (1 - blend) + Math.max(12, mark.radius * 0.2) * blend;
    const alpha = Math.max(0, 1 - age);
    const gradient = ctx.createRadialGradient(
      pos.x,
      pos.y,
      0,
      pos.x,
      pos.y,
      radius
    );
    gradient.addColorStop(0, `rgba(255,255,255,${0.5 * alpha})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

const renderSelfTrail = ({
  ctx,
  state,
  width,
  height,
  overrides,
}: RenderParams & { overrides?: { cameraPosition?: Vec2; zoom?: number } }) => {
  if (!state.selfId) return;
  const trail = state.cellTrails[state.selfId];
  if (!trail || trail.points.length < 2) return;
  const selfPlayer = state.players[state.selfId];
  const points = trail.points.map((point) => ({ x: point.x, y: point.y }));
  if (selfPlayer && points.length > 0) {
    points[points.length - 1] = {
      x: selfPlayer.cell.position.x,
      y: selfPlayer.cell.position.y,
    };
  }
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, idx) => {
    const pos = project(
      state,
      width,
      height,
      { x: point.x, y: point.y },
      overrides
    );
    if (idx === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.stroke();
  ctx.restore();
};

export const renderHud = ({ ctx, state, width }: RenderParams) => {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "16px Geist, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`모드: ${state.mode}`, 16, 16);
  ctx.fillText(`인원: ${state.ui.population}`, 16, 40);
  ctx.textAlign = "right";
  ctx.fillText(state.ui.displayName || "-", width - 16, 16);
  ctx.restore();
};

export const renderScene = (params: RenderParams) => {
  const projection = params.projection ?? "plane";
  const blend = computeBlend(projection, params.transition);
  const laneGap =
    params.state.playerOrder.length > 0
      ? params.height / Math.max(1, params.state.playerOrder.length + 1)
      : params.height;
  const overlayWidth = params.state.mode === "global" ? 240 : 0;
  const orderIndex = new Map<string, number>();
  params.state.playerOrder.forEach((id, idx) => orderIndex.set(id, idx));

  clearScene(params.ctx, params.width, params.height);
  if (params.state.playing) {
    if (params.state.mode === "personal") {
      renderSelfTrail(params);
    }
    if (params.state.mode === "global") {
      const zoom = Math.min(
        (params.width - overlayWidth) / params.state.gameSize.width,
        params.height / params.state.gameSize.height
      );
      const overrides = {
        cameraPosition: {
          x: params.state.gameSize.width / 2,
          y: params.state.gameSize.height / 2,
        },
        zoom,
      };
      renderCollisionMarks({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
      renderCollisionConnections({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
      renderPlayers({
        ...params,
        blend,
        laneGap,
        orderIndex,
        overrides,
      });
    } else {
      renderCollisionMarks({ ...params, blend, laneGap, orderIndex });
      renderCollisionConnections({ ...params, blend, laneGap, orderIndex });
      renderPlayers({ ...params, blend, laneGap, orderIndex });
    }
  }
  // renderHud(params);
};
