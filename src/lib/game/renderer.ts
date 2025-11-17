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
  transition?: { from: ProjectionMode; to: ProjectionMode; progress: number } | null
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
    // dead-reckoning: server 업데이트 시간으로부터 경과시간 동안 속도로 예측
    const t = Math.min((Date.now() - player.lastUpdate) / 1000, 0.25);
    const predicted: Vec2 = {
      x: cell.position.x + cell.velocity.x * t,
      y: cell.position.y + cell.velocity.y * t,
    };
    const planePos = project(state, width, height, predicted, overrides);
    const idx = orderIndex.get(playerId) ?? index;
    const laneY = laneGap * (idx + 1);
    const lineX = (cell.position.x / state.gameSize.width) * width;

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
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0.1, 1 - Math.abs(depth) / 1000)})`;
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
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,255,255,0.4)";
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
    ctx.beginPath();
    ctx.moveTo(posA.x, posA.y);
    ctx.lineTo(posB.x, posB.y);
    ctx.stroke();

     // Render endpoints without blending to maintain visibility in personal mode
    ctx.fillStyle = "rgba(0,255,255,0.8)";
    const dotRadius = blend > 0.7 ? 6 : 8;
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
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  trail.points.forEach((point, idx) => {
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
  renderHud(params);
};
