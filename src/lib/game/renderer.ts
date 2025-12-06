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

// 파도처럼 출렁이는 파티클 클러스터 렌더링 (유기적으로 연결된 느낌)
const renderParticleCluster = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  time: number,
  seed: number
) => {
  // 파도처럼 보이도록 더 많은 서브 파티클과 더 큰 클러스터 (유기적 연결)
  const subParticleCount = 12 + Math.floor(seededRandom(seed * 3.7) * 16); // 12-28개 (더 많게)
  const clusterRadius = baseSize * (0.6 + seededRandom(seed * 2.1) * 0.8); // 더 큰 클러스터 (겹치게)
  
  for (let j = 0; j < subParticleCount; j++) {
    const subAngle = (j / subParticleCount) * Math.PI * 2;
    const subRadius = clusterRadius * (0.15 + seededRandom(seed * 5.1 + j) * 0.85);
    
    // 파도처럼 출렁이는 움직임 (유기적으로 연결된 느낌)
    const waveX = simpleNoise(centerX * 0.012 + time * 0.9, seed + j, time * 0.7);
    const waveY = simpleNoise(centerY * 0.012 + time * 0.9, seed + j + 100, time * 0.7);
    const moveAmount = baseSize * 0.3; // 더 큰 움직임 (파도처럼)
    
    const subX = centerX + Math.cos(subAngle) * subRadius + waveX * moveAmount;
    const subY = centerY + Math.sin(subAngle) * subRadius + waveY * moveAmount;
    
    // Z-depth 시뮬레이션 (앞뒤에 따라 크기와 밝기 변화)
    const zDepth = noise3D(centerX * 0.02, centerY * 0.02, seed + j, time * 0.3);
    const zFactor = (zDepth + 1) * 0.5; // 0~1로 정규화
    
    // 파도처럼 보이도록 더 큰 크기 (유기적으로 연결)
    const subSize = baseSize * 0.5 * (0.75 + zFactor * 0.25); // 크기 증가 (더 겹치게)
    const subAlpha = alpha * (0.85 + zFactor * 0.15); // 알파 증가
    
    // 서브 파티클 그리기
    ctx.beginPath();
    ctx.arc(subX, subY, subSize, 0, Math.PI * 2);
    // 단색 채우기 (그라데이션 제거)
    ctx.fillStyle = `rgba(255,255,255,${subAlpha})`;
    ctx.fill();
  }
};

// 파티클 기반 공 렌더링 (중력 반영 버전: 비주얼 변화 강조)
const renderParticleBall = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseRadius: number,
  time: number,
  velocity?: Vec2, // 속도 정보
  gravityDir?: Vec2, // 서버에서 계산된 중력 방향 벡터
  gravityDist?: number // 서버에서 계산된 가장 가까운 플레이어와의 거리
) => {
  // 중력 영향력 계산 (거리 기반만 사용 - 다른 플레이어가 있을 때만)
  // 거리 기반 중력 강도 (가까울수록 강함, 최대 거리 400 기준)
  const hasGravity = gravityDist !== undefined && Number.isFinite(gravityDist);
  const distGravityFactor =
    hasGravity && gravityDist! < 400
      ? Math.max(0, 1 - Math.min(gravityDist! / 400, 1))
      : 0;
  // 최종 중력 영향력 (0~1)
  const gravityInfluence = distGravityFactor;

  // 중력 방향 계산 (이미 서버에서 계산된 벡터를 사용)
  let gravityDirX = 0;
  let gravityDirY = 0;
  if (gravityDir) {
    const mag = Math.hypot(gravityDir.x, gravityDir.y);
    if (mag > 0.0001) {
      gravityDirX = gravityDir.x / mag;
      gravityDirY = gravityDir.y / mag;
    }
  }
  
  // 중력이 작을 때: 더 많은 particle, 내부 중심 움직임 (밀집)
  // 중력이 클 때: 외부로 확장되는 움직임
  // Particle 수를 훨씬 많이 늘려서 촘촘하게 (빈 공간 최소화)
  const particleCount = Math.floor(250 + gravityInfluence * 100); // 250~350개 (훨씬 촘촘하게)
  const layers = 5; // 레이어도 증가
  
  // 크기를 더 크게 (1.8배)
  const adjustedRadius = baseRadius * 1.8;
  
  // 각 레이어별로 파티클 렌더링 (뒤에서 앞으로)
  for (let layer = layers - 1; layer >= 0; layer--) {
    const layerDepth = layer / layers; // 0 (앞) ~ 1 (뒤)
    const layerTimeOffset = time + layer * 0.4;
    
    for (let i = 0; i < particleCount; i++) {
      const seed = i * 17.3 + layer * 23.7; // 고유 시드
      
      // 균등한 분포를 위한 각도 (원형이 아닌 균등 분포)
      const angle = (i / particleCount) * Math.PI * 2;
      const angleVariation = seededRandom(seed * 1.5) * 0.3; // 각도 변형
      const finalAngle = angle + angleVariation;
      
      // 중력이 없을 때: 중심으로 강하게 수축 (작은 반경, 밀집)
      // 중력이 클 때: 중력 방향으로 확장 (큰 반경, 원 밖으로)
      const baseRadiusMin = adjustedRadius * (0.1 - (1 - gravityInfluence) * 0.05); // 중력 없을 때 매우 작게
      const baseRadiusMax = adjustedRadius * (0.5 + gravityInfluence * 1.0); // 중력 클 때 더 크게 (원 밖으로)
      const radiusVariation = seededRandom(seed * 2.1);
      const baseRadius = baseRadiusMin + (baseRadiusMax - baseRadiusMin) * radiusVariation;
      
      // 기본 위치 (원형 구조 제약 없이 자유롭게)
      const baseX = centerX + Math.cos(finalAngle) * baseRadius;
      const baseY = centerY + Math.sin(finalAngle) * baseRadius;
      
      // 중력 방향 벡터 (각도 기반)
      const toGravityAngle = Math.atan2(gravityDirY, gravityDirX);
      const angleFromGravity = finalAngle - toGravityAngle;
      const cosAngleFromGravity = Math.cos(angleFromGravity);
      
      // 중력이 없을 때: 중심으로 강하게 수축 (움츠림) - 혼자 있을 때 밀집
      const contractionStrength = (1 - gravityInfluence) * 0.7; // 더 강하게 수축
      const contractionX = (centerX - baseX) * contractionStrength;
      const contractionY = (centerY - baseY) * contractionStrength;
      
      // 중력이 클 때: 중력 방향으로 강하게 팽창 (확 쏠리는 느낌)
      const expansionStrength = gravityInfluence * 2.0; // 팽창 강도 대폭 증가
      // 중력 방향과의 각도에 따라 팽창 강도 조절 (중력 방향일수록 훨씬 더 강하게)
      const gravityAlignment = Math.max(0, cosAngleFromGravity); // 0~1, 중력 방향일수록 1
      // 중력 방향일수록 훨씬 더 강하게 쏠리도록 (비선형 증가)
      const alignmentBoost = Math.pow(gravityAlignment, 0.5); // 제곱근으로 더 부드럽게
      const expansionAmount = expansionStrength * (0.3 + alignmentBoost * 0.7);
      const expansionX = gravityDirX * adjustedRadius * expansionAmount;
      const expansionY = gravityDirY * adjustedRadius * expansionAmount;
      
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
      
      // 파도 효과: 중력이 있을 때만 중력 방향으로 파도처럼 출렁임
      // 중력이 없을 때: 작은 내부 파도만 (밀집 유지)
      // 중력이 있을 때: 중력 방향으로 강한 파도
      const waveFrequency = 1.5 + gravityInfluence * 2.5; // 중력이 클수록 파도 주파수 증가
      const waveSpeed = 0.7 + gravityInfluence * 0.6;
      const baseWave = (1 - gravityInfluence) * 0.3 * simpleNoise(finalAngle * 1.5, layerTimeOffset * 0.8, time * 0.9); // 중력 없을 때 작은 파도
      
      // 중력 방향으로의 파도 (방파제에 부딪혀 튀어나오는 느낌) - 중력이 있을 때만
      const gravityWave = gravityInfluence * simpleNoise(
        finalAngle * 3.5 + time * 1.8,
        layerTimeOffset * 1.3,
        seed * 0.2
      );
      
      // 파도가 중력 방향으로 강하게 튀어나오는 효과 (중력이 있을 때만)
      // 중력이 클수록 중력 방향으로 더 강하게
      const waveDirectionBlend = gravityInfluence * 0.9; // 중력 영향이 클수록 중력 방향으로
      const waveDirectionX = Math.cos(finalAngle) * (1 - waveDirectionBlend) + gravityDirX * waveDirectionBlend;
      const waveDirectionY = Math.sin(finalAngle) * (1 - waveDirectionBlend) + gravityDirY * waveDirectionBlend;
      const waveMagnitude = adjustedRadius * (
        (1 - gravityInfluence) * 0.05 + // 중력 없을 때 작은 파도
        gravityInfluence * 0.7 // 중력이 클수록 훨씬 더 큰 파도 (원 밖으로)
      );
      
      const waveX = (baseWave + gravityWave * 1.8) * waveDirectionX * waveMagnitude;
      const waveY = (baseWave + gravityWave * 1.8) * waveDirectionY * waveMagnitude;
      
      // 내부 미세 움직임 (중력이 없을 때만 작게, 중력이 있을 때는 중력 방향으로만)
      const internalMovement = (1 - gravityInfluence) * 0.08; // 중력 없을 때만 작은 움직임
      const internalX = moveX * adjustedRadius * internalMovement;
      const internalY = moveY * adjustedRadius * internalMovement;
      
      // 중력 방향으로의 추가 쏠림 효과 (중력이 세질수록 더 강하게)
      const gravityPullStrength = Math.pow(gravityInfluence, 1.5) * 0.8; // 비선형 증가
      const gravityPullX = gravityDirX * adjustedRadius * gravityPullStrength * (0.5 + gravityAlignment * 0.5);
      const gravityPullY = gravityDirY * adjustedRadius * gravityPullStrength * (0.5 + gravityAlignment * 0.5);
      
      // 최종 위치: 수축/팽창 + 파도 + 내부 움직임 + 중력 쏠림
      const x = baseX + contractionX + expansionX + waveX + internalX + gravityPullX;
      const y = baseY + contractionY + expansionY + waveY + internalY + gravityPullY;
      
      // 중심으로부터의 거리 계산 (원 제약 없이 자유롭게)
      const distFromCenter = Math.hypot(x - centerX, y - centerY);
      // 중력이 작을 때: 작은 반경 기준, 중력이 클 때: 큰 반경 기준
      const maxDist = adjustedRadius * (0.5 + gravityInfluence * 1.0);
      const distFactor = Math.max(0, 1 - Math.min(1, distFromCenter / maxDist));
      
      // Z-depth에 따른 크기와 밝기 조절 (3D 입체감)
      const zDepth = (moveZ + 1) * 0.5; // -1~1을 0~1로
      const frontFactor = 1 - layerDepth; // 앞 레이어일수록 밝고 큼
      const sizeMultiplier = (0.6 + zDepth * 0.4) * (0.7 + frontFactor * 0.3);
      const alphaMultiplier = (0.5 + zDepth * 0.5) * (0.6 + frontFactor * 0.4);
      
      // 파티클 크기 (균등하게, 촘촘하게 보이도록)
      const particleSize = adjustedRadius * 0.16 * sizeMultiplier * (0.85 + distFactor * 0.15);
      
      // 투명도 (균등하게 밝게) - 중력이 작을 때 더 밝고 불투명하게
      const baseAlpha = 0.8 + (1 - gravityInfluence) * 0.2; // 중력 작을 때 더 밝음 (하나로 뭉친 느낌)
      // 중력이 클 때도 원 밖으로 나간 particle들이 보이도록
      const alpha = (baseAlpha + layerDepth * 0.1) * alphaMultiplier * (0.7 + distFactor * 0.3);
      
      // 작은 파티클 클러스터로 렌더링 (하나의 작은 원을 만드는 느낌)
      renderParticleCluster(ctx, x, y, particleSize, alpha, time, seed);
    }
  }
  
  // 중심부 고밀도 파티클 (균등하게 분포, 중력이 작을 때 수축, 클 때 확장)
  const centerParticleCount = Math.floor(150 + (1 - gravityInfluence) * 100); // 150~250개
  for (let i = 0; i < centerParticleCount; i++) {
    const angle = (i / centerParticleCount) * Math.PI * 2;
    const seed = i * 31.7;
    
    // 중력이 작을 때: 중심으로 수축 (작은 반경)
    // 중력이 클 때: 중력 방향으로 확장
    const baseRadiusMin = adjustedRadius * (0.1 - (1 - gravityInfluence) * 0.05);
    const baseRadiusMax = adjustedRadius * (0.4 + gravityInfluence * 0.6);
    const radiusVariation = seededRandom(seed * 7.3);
    const baseRadius = baseRadiusMin + (baseRadiusMax - baseRadiusMin) * radiusVariation;
    
    const baseX = centerX + Math.cos(angle) * baseRadius;
    const baseY = centerY + Math.sin(angle) * baseRadius;
    
    // 중력 방향 벡터
    const toGravityAngle = Math.atan2(gravityDirY, gravityDirX);
    const angleFromGravity = angle - toGravityAngle;
    const gravityAlignment = Math.max(0, Math.cos(angleFromGravity));
    
    // 중력이 없을 때: 중심으로 강하게 수축 (밀집)
    const contractionStrength = (1 - gravityInfluence) * 0.6; // 더 강하게
    const contractionX = (centerX - baseX) * contractionStrength;
    const contractionY = (centerY - baseY) * contractionStrength;
    
    // 중력이 클 때: 중력 방향으로 강하게 팽창 (확 쏠림)
    const expansionStrength = gravityInfluence * 1.5; // 강도 증가
    const alignmentBoost = Math.pow(gravityAlignment, 0.5);
    const expansionAmount = expansionStrength * (0.3 + alignmentBoost * 0.7);
    const expansionX = gravityDirX * adjustedRadius * expansionAmount;
    const expansionY = gravityDirY * adjustedRadius * expansionAmount;
    
    // 역동적인 중심부 움직임
    const moveX = noise3D(angle * 0.5, time * 0.7, seed, time * 0.9);
    const moveY = noise3D(angle * 0.5 + Math.PI, time * 0.7, seed + 100, time * 0.9);
    const moveZ = noise3D(seed * 0.1, time * 0.5, time * 0.6, time * 0.4);
    
    // 파도 효과 (중력이 있을 때만 중력 방향으로)
    const wave = gravityInfluence * simpleNoise(angle * 2.5 + time * 1.2, time * 1.0, seed * 0.3);
    const waveBlend = gravityInfluence * 0.8; // 중력이 있을 때만
    const waveX = (Math.cos(angle) * (1 - waveBlend) + gravityDirX * waveBlend) * wave * adjustedRadius * 0.4;
    const waveY = (Math.sin(angle) * (1 - waveBlend) + gravityDirY * waveBlend) * wave * adjustedRadius * 0.4;
    
    // 내부 미세 움직임 (중력이 없을 때만 작게)
    const internalMovement = (1 - gravityInfluence) * 0.06;
    const internalX = moveX * adjustedRadius * internalMovement;
    const internalY = moveY * adjustedRadius * internalMovement;
    
    // 중력 방향으로의 추가 쏠림
    const gravityPullStrength = Math.pow(gravityInfluence, 1.5) * 0.6;
    const gravityPullX = gravityDirX * adjustedRadius * gravityPullStrength * (0.5 + gravityAlignment * 0.5);
    const gravityPullY = gravityDirY * adjustedRadius * gravityPullStrength * (0.5 + gravityAlignment * 0.5);
    
    const x = baseX + contractionX + expansionX + waveX + internalX + gravityPullX;
    const y = baseY + contractionY + expansionY + waveY + internalY + gravityPullY;
    
    const distFromCenter = Math.hypot(x - centerX, y - centerY);
    const maxDist = adjustedRadius * (0.4 + gravityInfluence * 0.8);
    const distFactor = Math.max(0, 1 - Math.min(1, distFromCenter / maxDist));
    const zDepth = (moveZ + 1) * 0.5;
    
    // 파티클 크기와 밝기
    const particleSize = adjustedRadius * 0.12 * (0.8 + zDepth * 0.2) * (0.7 + distFactor * 0.3);
    const baseAlpha = 0.85 + (1 - gravityInfluence) * 0.15;
    const alpha = baseAlpha * (0.8 + zDepth * 0.2) * distFactor;
    
    // 중심부도 클러스터로 렌더링
    renderParticleCluster(ctx, x, y, particleSize, alpha, time, seed);
  }
  
  // 가장자리 파티클들 (중력 방향으로 파도처럼 튀어나옴)
  const edgeParticleCount = Math.floor(120 + gravityInfluence * 80); // 120~200개
  for (let i = 0; i < edgeParticleCount; i++) {
    const angle = (i / edgeParticleCount) * Math.PI * 2;
    const seed = i * 41.9;
    
    // 중력이 작을 때: 작은 반경, 중력이 클 때: 큰 반경 (원 밖으로)
    const baseRadiusMin = adjustedRadius * (0.7 - (1 - gravityInfluence) * 0.2);
    const baseRadiusMax = adjustedRadius * (1.0 + gravityInfluence * 1.2); // 중력 클 때 원 밖으로
    const radiusVariation = seededRandom(seed * 9.1);
    const baseRadius = baseRadiusMin + (baseRadiusMax - baseRadiusMin) * radiusVariation;
    
    const baseX = centerX + Math.cos(angle) * baseRadius;
    const baseY = centerY + Math.sin(angle) * baseRadius;
    
    // 중력 방향 벡터
    const toGravityAngle = Math.atan2(gravityDirY, gravityDirX);
    const angleFromGravity = angle - toGravityAngle;
    const gravityAlignment = Math.max(0, Math.cos(angleFromGravity));
    
    // 중력이 없을 때: 중심으로 강하게 수축 (밀집)
    const contractionStrength = (1 - gravityInfluence) * 0.5; // 더 강하게
    const contractionX = (centerX - baseX) * contractionStrength;
    const contractionY = (centerY - baseY) * contractionStrength;
    
    // 중력이 클 때: 중력 방향으로 매우 강하게 팽창 (확 쏠림)
    const expansionStrength = gravityInfluence * 2.2; // 매우 강하게
    const alignmentBoost = Math.pow(gravityAlignment, 0.5);
    const expansionAmount = expansionStrength * (0.2 + alignmentBoost * 0.8); // 중력 방향일수록 훨씬 더 강하게
    const expansionX = gravityDirX * adjustedRadius * expansionAmount;
    const expansionY = gravityDirY * adjustedRadius * expansionAmount;
    
    // 가장자리 파티클의 움직임 (중력이 없을 때는 작게)
    const moveX = noise3D(angle * 1.2, time * 1.1, seed, time * 1.0);
    const moveY = noise3D(angle * 1.2 + Math.PI, time * 1.1, seed + 200, time * 1.0);
    const moveAmount = (1 - gravityInfluence) * 0.1 + gravityInfluence * 0.3;
    
    // 파도 효과 (중력이 있을 때만 중력 방향으로 튀어나오는 느낌)
    const waveFrequency = 2.0 + gravityInfluence * 1.5;
    const gravityWave = gravityInfluence * simpleNoise(
      angle * waveFrequency + time * 1.8,
      time * 1.3,
      seed * 0.3
    );
    // 파도가 중력 방향으로 강하게 튀어나오는 효과 (중력이 있을 때만)
    const waveBlend = gravityInfluence * 0.9;
    const waveDirectionX = Math.cos(angle) * (1 - waveBlend) + gravityDirX * waveBlend;
    const waveDirectionY = Math.sin(angle) * (1 - waveBlend) + gravityDirY * waveBlend;
    const waveMagnitude = adjustedRadius * (gravityInfluence * 0.7); // 중력이 있을 때만
    
    const waveX = gravityWave * 1.8 * waveDirectionX * waveMagnitude;
    const waveY = gravityWave * 1.8 * waveDirectionY * waveMagnitude;
    
    // 중력 방향으로의 추가 쏠림 (가장자리에서도 강하게)
    const gravityPullStrength = Math.pow(gravityInfluence, 1.5) * 1.0;
    const gravityPullX = gravityDirX * adjustedRadius * gravityPullStrength * (0.4 + gravityAlignment * 0.6);
    const gravityPullY = gravityDirY * adjustedRadius * gravityPullStrength * (0.4 + gravityAlignment * 0.6);
    
    const x = baseX + contractionX + expansionX + waveX + moveX * adjustedRadius * moveAmount + gravityPullX;
    const y = baseY + contractionY + expansionY + waveY + moveY * adjustedRadius * moveAmount + gravityPullY;
    
    const distFromCenter = Math.hypot(x - centerX, y - centerY);
    // 중력이 클 때는 원 밖으로 나간 particle도 보이도록
    const maxDist = adjustedRadius * (1.0 + gravityInfluence * 1.5);
    const distFactor = Math.max(0, 1 - Math.min(1, (distFromCenter - adjustedRadius * 0.8) / (maxDist - adjustedRadius * 0.8)));
    
    // 파티클 크기
    const particleSize = adjustedRadius * 0.1 * (0.8 + distFactor * 0.2);
    // 밝기 (원 밖으로 나간 particle도 보이도록)
    const alpha = 0.7 * (0.6 + distFactor * 0.4);
    
    if (distFactor > 0.05 || gravityInfluence > 0.3) { // 중력이 클 때는 더 많이 보이도록
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
      renderParticleBall(
        ctx, 
        screenPos.x, 
        screenPos.y, 
        radius, 
        time,
        cell.velocity, // velocity 정보 전달
        player.gravityDir, // 서버에서 계산된 중력 방향
        player.gravityDist // 서버에서 계산된 거리
      );
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
  // 그림자 효과 제거
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
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
    // 점에도 그림자 사용하지 않음
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
    // 단색 원으로 렌더링 (그라데이션 제거)
    ctx.fillStyle = `rgba(255,255,255,${0.5 * alpha})`;
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
