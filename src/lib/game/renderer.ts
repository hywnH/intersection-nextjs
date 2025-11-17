import type { GameState, Vec2 } from "@/types/game";

interface RenderParams {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  width: number;
  height: number;
}

const project = (
  state: GameState,
  width: number,
  height: number,
  position: Vec2
) => {
  const { position: cameraPos, zoom } = state.camera;
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

export const renderPlayers = ({ ctx, state, width, height }: RenderParams) => {
  ctx.save();
  state.playerOrder.forEach((playerId) => {
    const player = state.players[playerId];
    if (!player) return;
    const {
      cell: { position, radius, color },
    } = player;
    const screenPos = project(state, width, height, position);
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, radius * state.camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = color ?? "rgba(255,255,255,0.6)";
    ctx.fill();
  });
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
  clearScene(params.ctx, params.width, params.height);
  if (params.state.playing) {
    renderPlayers(params);
  }
  renderHud(params);
};
