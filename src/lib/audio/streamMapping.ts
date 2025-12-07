import type { GameState } from "@/types/game";
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";

type StreamName =
  | "attraction"
  | "velocity"
  | "distance"
  | "closingSpeed"
  | "isOuter"
  | "pan";

type InterpolationMode = "linear" | "logarithmic" | "exponential";

interface StreamConfig {
  stream: StreamName;
  interpolation: InterpolationMode;
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
}

type Operation =
  | "none"
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "min"
  | "max"
  | "average";

export interface StreamMapping {
  nodeId: string;
  paramName: string;
  operation: Operation;
  enabled: boolean;
  streams: StreamConfig[];
}

export interface InteractionSignals {
  attraction: number;
  velocity: number;
  distance: number;
  closingSpeed: number;
  isOuter: number;
  pan: number;
}

const MAX_SPEED = 320;
const MAX_RELATIVE_SPEED = MAX_SPEED * 2;
const INNER_RADIUS = 800;
const OUTER_RADIUS = 1000;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Compute interaction-based signals from the current personal game state
 * using the local player as the reference (self) and the nearest neighbor.
 */
export const computeInteractionSignals = (
  state: GameState
): InteractionSignals | null => {
  const selfId = state.selfId;
  if (!selfId) return null;
  const selfPlayer = state.players[selfId];
  if (!selfPlayer) return null;

  const { position: selfPos, velocity: selfVel } = selfPlayer.cell;
  const gravityDir = selfPlayer.gravityDir;
  const gravityDist = selfPlayer.gravityDist;

  let nearestDist = Number.POSITIVE_INFINITY;
  let nearestDx = 0;
  let nearestDy = 0;
  let nearestVelX = 0;
  let nearestVelY = 0;
  let hasNeighbor = false;

  for (const player of Object.values(state.players)) {
    if (player.id === selfId) continue;
    const dx = player.cell.position.x - selfPos.x;
    const dy = player.cell.position.y - selfPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestDx = dx;
      nearestDy = dy;
      nearestVelX = player.cell.velocity.x;
      nearestVelY = player.cell.velocity.y;
      hasNeighbor = true;
    }
  }

  if (!hasNeighbor || !Number.isFinite(nearestDist)) {
    return null;
  }

  const safeDist = Math.max(nearestDist, 1e-3);

  // 기본 방향 벡터는 서버에서 계산한 중력 벡터를 우선 사용하고,
  // 없으면 가장 가까운 플레이어 방향(nearestDx, nearestDy)을 사용
  let dirX = 0;
  let dirY = 0;
  if (gravityDir && (gravityDir.x !== 0 || gravityDir.y !== 0)) {
    const mag = Math.hypot(gravityDir.x, gravityDir.y) || 1;
    dirX = gravityDir.x / mag;
    dirY = gravityDir.y / mag;
  } else {
    dirX = nearestDx / safeDist;
    dirY = nearestDy / safeDist;
  }

  const relVelX = selfVel.x - nearestVelX;
  const relVelY = selfVel.y - nearestVelY;
  const speed = Math.hypot(selfVel.x, selfVel.y);
  const closingSpeedRaw = Math.max(relVelX * dirX + relVelY * dirY, 0);

  const speedNorm = clamp01(speed / MAX_SPEED);

  const maxAttractionDist = OUTER_RADIUS * 3;
  const clampedDist = Math.min(nearestDist, maxAttractionDist);
  const attraction = 1 - clampedDist / maxAttractionDist;

  // 상대 속도는 두 플레이어 속도의 합까지 갈 수 있으므로 640(=320*2) 기준으로 정규화
  const closingSpeed = clamp01(closingSpeedRaw / MAX_RELATIVE_SPEED);

  let isOuter = 0;
  if (nearestDist > INNER_RADIUS && nearestDist <= OUTER_RADIUS) {
    isOuter = 1;
  }

  // 좌우 팬: 화면상의 상대 X 오프셋 기준으로 -1~1
  const panDirX = nearestDx / safeDist;
  const pan = Math.max(-1, Math.min(1, panDirX));

  return {
    attraction,
    velocity: speedNorm,
    distance: nearestDist,
    closingSpeed,
    isOuter,
    pan,
  };
};

const interpolate = (
  value: number,
  mode: InterpolationMode,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number
): number => {
  if (!Number.isFinite(value)) return outputMin;
  const denom = inputMax - inputMin || 1;
  const normalized = Math.max(0, Math.min(1, (value - inputMin) / denom));
  let transformed = normalized;

  if (mode === "logarithmic") {
    transformed = Math.log(normalized * 9 + 1) / Math.log(10);
  } else if (mode === "exponential") {
    transformed = (Math.pow(10, normalized) - 1) / 9;
  }

  return outputMin + transformed * (outputMax - outputMin);
};

const computeMappingValue = (
  mapping: StreamMapping,
  signals: InteractionSignals
): number | null => {
  const values = mapping.streams.map((streamConfig) => {
    const raw = signals[streamConfig.stream];
    if (raw === undefined || raw === null) return 0;
    return interpolate(
      raw,
      streamConfig.interpolation || "linear",
      streamConfig.inputMin,
      streamConfig.inputMax,
      streamConfig.outputMin,
      streamConfig.outputMax
    );
  });

  if (!values.length) return null;
  if (values.length === 1 || mapping.operation === "none") {
    return values[0];
  }

  let result = values[0];
  const op = mapping.operation;

  for (let i = 1; i < values.length; i += 1) {
    const next = values[i];
    if (op === "add") {
      result += next;
    } else if (op === "subtract") {
      result -= next;
    } else if (op === "multiply") {
      result *= next;
    } else if (op === "divide") {
      result = next !== 0 ? result / next : result;
    } else if (op === "min") {
      result = Math.min(result, next);
    } else if (op === "max") {
      result = Math.max(result, next);
    } else if (op === "average") {
      result = (result * i + next) / (i + 1);
    }
  }

  return result;
};

export const DEFAULT_STREAM_MAPPINGS: StreamMapping[] = [
  {
    nodeId: "171",
    paramName: "value",
    operation: "multiply",
    enabled: false,
    streams: [
      {
        stream: "closingSpeed",
        interpolation: "exponential",
        inputMin: 0,
        inputMax: 0.5,
        outputMin: 0.1,
        outputMax: 0.9,
      },
    ],
  },
  {
    nodeId: "206",
    paramName: "value",
    operation: "add",
    enabled: true,
    streams: [
      {
        stream: "velocity",
        interpolation: "logarithmic",
        inputMin: 0,
        inputMax: 0.5,
        outputMin: 0.005,
        outputMax: 0.025,
      },
    ],
  },
  {
    nodeId: "163",
    paramName: "value",
    operation: "add",
    enabled: false,
    streams: [
      {
        stream: "distance",
        interpolation: "linear",
        inputMin: 0,
        inputMax: 1000,
        outputMin: 0.2,
        outputMax: 0.8,
      },
    ],
  },
  {
    nodeId: "183",
    paramName: "value",
    operation: "none",
    enabled: true,
    streams: [
      {
        stream: "attraction",
        interpolation: "linear",
        inputMin: 0,
        inputMax: 1,
        outputMin: 0,
        outputMax: 0.8,
      },
    ],
  },
  {
    nodeId: "194",
    paramName: "value",
    operation: "none",
    enabled: false,
    streams: [
      {
        stream: "isOuter",
        interpolation: "linear",
        inputMin: 0,
        inputMax: 1,
        outputMin: 0.05,
        outputMax: 0.2,
      },
    ],
  },
  {
    nodeId: "214",
    paramName: "value",
    operation: "none",
    enabled: true,
    streams: [
      {
        stream: "pan",
        interpolation: "linear",
        inputMin: -1,
        inputMax: 1,
        outputMin: 1,
        outputMax: 0,
      },
    ],
  },
];

export const generateParamsFromMappings = (
  signals: InteractionSignals,
  mappings: StreamMapping[] = DEFAULT_STREAM_MAPPINGS
): NoiseCraftParam[] => {
  const params: NoiseCraftParam[] = [];

  mappings.forEach((mapping) => {
    if (!mapping.enabled) return;
    const value = computeMappingValue(mapping, signals);
    if (value === null || value === undefined) return;
    params.push({
      nodeId: mapping.nodeId,
      paramName: mapping.paramName || "value",
      value,
    });
  });

  return params;
};
