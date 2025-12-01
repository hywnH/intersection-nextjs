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

// 개선된 노이즈 함수 (더 역동적인 움직임)
const simpleNoise = (x: number, y: number, t: number): number => {
  return (
    Math.sin(x * 0.5 + t) * 0.5 +
    Math.cos(y * 0.5 + t * 0.7) * 0.3 +
    Math.sin((x + y) * 0.3 + t * 1.2) * 0.2
  );
};

// 3D 위치를 위한 노이즈 (Z-depth 시뮬레이션)
const noise3D = (x: number, y: number, z: number, t: number): number => {
  return (
    Math.sin(x * 0.4 + t * 0.8) * 0.4 +
    Math.cos(y * 0.4 + t * 0.6) * 0.3 +
    Math.sin(z * 0.3 + t * 1.0) * 0.2 +
    Math.sin((x + y + z) * 0.2 + t * 1.5) * 0.1
  );
};

// 시드 기반 랜덤 함수 (일관된 값 생성)
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

// 작은 파티클 클러스터 렌더링 (하나의 작은 원을 만드는 느낌)
const renderParticleCluster = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  time: number,
  seed: number
) => {
  const subParticleCount = 5 + Math.floor(seededRandom(seed * 3.7) * 8); // 5-12개
  const clusterRadius = baseSize * (0.3 + seededRandom(seed * 2.1) * 0.4);
  
  for (let j = 0; j < subParticleCount; j++) {
    const subAngle = (j / subParticleCount) * Math.PI * 2;
    const subRadius = clusterRadius * (0.3 + seededRandom(seed * 5.1 + j) * 0.7);
    
    // 각 서브 파티클의 역동적인 움직임
    const moveX = noise3D(centerX * 0.01, time * 0.5, seed + j, time * 0.8);
    const moveY = noise3D(centerY * 0.01, time * 0.5, seed + j + 100, time * 0.8);
    const moveAmount = baseSize * 0.15;
    
    const subX = centerX + Math.cos(subAngle) * subRadius + moveX * moveAmount;
    const subY = centerY + Math.sin(subAngle) * subRadius + moveY * moveAmount;
    
    // Z-depth 시뮬레이션 (앞뒤에 따라 크기와 밝기 변화)
    const zDepth = noise3D(centerX * 0.02, centerY * 0.02, seed + j, time * 0.3);
    const zFactor = (zDepth + 1) * 0.5; // 0~1로 정규화
    
    const subSize = baseSize * 0.25 * (0.6 + zFactor * 0.4); // 크기 증가
    const subAlpha = alpha * (0.7 + zFactor * 0.3); // 알파 증가
    
    // 서브 파티클 그리기
    ctx.beginPath();
    ctx.arc(subX, subY, subSize, 0, Math.PI * 2);
    
    const gradient = ctx.createRadialGradient(
      subX, subY, 0,
      subX, subY, subSize * 2.5
    );
    gradient.addColorStop(0, `rgba(255,255,255,${subAlpha})`);
    gradient.addColorStop(0.5, `rgba(255,255,255,${subAlpha * 0.7})`); // 더 밝게
    gradient.addColorStop(0.8, `rgba(255,255,255,${subAlpha * 0.3})`); // 더 긴 꼬리
    gradient.addColorStop(1, `rgba(255,255,255,0)`);
    
    ctx.fillStyle = gradient;
    ctx.fill();
  }
};

// 파티클 기반 공 렌더링 (개선된 버전: 클러스터 + 3D 입체감 + 역동적 움직임)
const renderParticleBall = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseRadius: number,
  time: number
) => {
  const particleCount = 70; // 메인 파티클 개수 (증가)
  const layers = 4; // 레이어 수 (더 깊은 입체감)
  
  // 각 레이어별로 파티클 렌더링 (뒤에서 앞으로)
  for (let layer = layers - 1; layer >= 0; layer--) {
    const layerDepth = layer / layers; // 0 (앞) ~ 1 (뒤)
    const layerRadius = baseRadius * (0.5 + layerDepth * 0.5);
    const layerTimeOffset = time + layer * 0.4;
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const seed = i * 17.3 + layer * 23.7; // 고유 시드
      
      // 기본 위치 (구면 좌표)
      const sphereAngle = seededRandom(seed * 1.3) * Math.PI * 2;
      const sphereElevation = (seededRandom(seed * 2.7) - 0.5) * Math.PI * 0.6;
      const sphereRadius = baseRadius * (0.3 + seededRandom(seed * 3.1) * 0.7);
      
      // 3D 위치를 2D로 투영
      const baseX = centerX + Math.cos(angle) * layerRadius;
      const baseY = centerY + Math.sin(angle) * layerRadius;
      
      // 역동적인 움직임 (여러 주파수의 노이즈 조합)
      const moveSpeed = 0.8 + seededRandom(seed * 4.1) * 0.4;
      const moveX = noise3D(
        baseX * 0.008,
        layerTimeOffset * moveSpeed,
        seed * 0.1,
        time * 0.6
      );
      const moveY = noise3D(
        baseY * 0.008,
        layerTimeOffset * moveSpeed,
        seed * 0.1 + 50,
        time * 0.6
      );
      const moveZ = noise3D(
        seed * 0.05,
        layerTimeOffset * moveSpeed * 0.7,
        time * 0.5,
        time * 0.4
      );
      
      // 출렁임 효과
      const waveX = simpleNoise(angle * 2.5, layerTimeOffset, time * 0.8);
      const waveY = simpleNoise(angle * 2.5 + Math.PI, layerTimeOffset, time * 0.8);
      const waveAmount = baseRadius * (0.12 + seededRandom(seed * 5.3) * 0.08);
      
      const x = baseX + moveX * baseRadius * 0.2 + waveX * waveAmount;
      const y = baseY + moveY * baseRadius * 0.2 + waveY * waveAmount;
      
      // 중심으로부터의 거리 계산
      const distFromCenter = Math.hypot(x - centerX, y - centerY);
      const distFactor = 1 - Math.min(1, distFromCenter / baseRadius);
      
      // Z-depth에 따른 크기와 밝기 조절 (3D 입체감)
      const zDepth = (moveZ + 1) * 0.5; // -1~1을 0~1로
      const frontFactor = 1 - layerDepth; // 앞 레이어일수록 밝고 큼
      const sizeMultiplier = (0.6 + zDepth * 0.4) * (0.7 + frontFactor * 0.3);
      const alphaMultiplier = (0.5 + zDepth * 0.5) * (0.6 + frontFactor * 0.4);
      
      // 파티클 크기 (더 크게)
      const particleSize = baseRadius * 0.12 * sizeMultiplier * (0.9 + distFactor * 0.3);
      
      // 투명도 (더 불투명하게)
      const alpha = (0.6 + layerDepth * 0.2) * alphaMultiplier * (0.7 + distFactor * 0.3);
      
      // 작은 파티클 클러스터로 렌더링 (하나의 작은 원을 만드는 느낌)
      renderParticleCluster(ctx, x, y, particleSize, alpha, time, seed);
    }
  }
  
  // 중심부 고밀도 파티클 (더 많은 작은 클러스터)
  const centerParticleCount = 60;
  for (let i = 0; i < centerParticleCount; i++) {
    const angle = (i / centerParticleCount) * Math.PI * 2;
    const seed = i * 31.7;
    const radius = baseRadius * (0.2 + seededRandom(seed * 7.3) * 0.4);
    
    // 역동적인 중심부 움직임
    const moveX = noise3D(angle * 0.5, time * 0.7, seed, time * 0.9);
    const moveY = noise3D(angle * 0.5 + Math.PI, time * 0.7, seed + 100, time * 0.9);
    const moveZ = noise3D(seed * 0.1, time * 0.5, time * 0.6, time * 0.4);
    
    const x = centerX + Math.cos(angle) * radius + moveX * baseRadius * 0.15;
    const y = centerY + Math.sin(angle) * radius + moveY * baseRadius * 0.15;
    
    const distFromCenter = Math.hypot(x - centerX, y - centerY);
    const distFactor = 1 - Math.min(1, distFromCenter / (baseRadius * 0.5));
    const zDepth = (moveZ + 1) * 0.5;
    
    const particleSize = baseRadius * 0.1 * (0.8 + zDepth * 0.2) * (0.7 + distFactor * 0.3);
    const alpha = 0.8 * (0.7 + zDepth * 0.3) * distFactor;
    
    // 중심부도 클러스터로 렌더링
    renderParticleCluster(ctx, x, y, particleSize, alpha, time, seed);
  }
  
  // 가장자리 흩어진 작은 파티클들 (더 역동적인 느낌)
  const edgeParticleCount = 40;
  for (let i = 0; i < edgeParticleCount; i++) {
    const angle = (i / edgeParticleCount) * Math.PI * 2;
    const seed = i * 41.9;
    const radius = baseRadius * (0.85 + seededRandom(seed * 9.1) * 0.15);
    
    // 가장자리 파티클의 더 큰 움직임
    const moveX = noise3D(angle * 1.2, time * 1.1, seed, time * 1.0);
    const moveY = noise3D(angle * 1.2 + Math.PI, time * 1.1, seed + 200, time * 1.0);
    
    const x = centerX + Math.cos(angle) * radius + moveX * baseRadius * 0.25;
    const y = centerY + Math.sin(angle) * radius + moveY * baseRadius * 0.25;
    
    const distFromCenter = Math.hypot(x - centerX, y - centerY);
    const distFactor = Math.max(0, 1 - (distFromCenter - baseRadius * 0.9) / (baseRadius * 0.1));
    
    const particleSize = baseRadius * 0.08 * distFactor;
    const alpha = 0.6 * distFactor;
    
    if (distFactor > 0.1) {
      renderParticleCluster(ctx, x, y, particleSize, alpha, time, seed);
    }
  }
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
  const time = performance.now() * 0.001; // 초 단위 시간 (파티클 애니메이션용)

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
    
    // 개인 뷰에서 자기 공에 파티클 효과 적용
    if (isPersonal && player.isSelf) {
      renderParticleBall(ctx, screenPos.x, screenPos.y, radius, time);
    } else {
      // 다른 플레이어는 기존 스타일 유지
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = cell.color ?? "rgba(255,255,255,0.6)";
      ctx.fill();
    }

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
