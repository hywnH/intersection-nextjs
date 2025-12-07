# Virtual Particles와 실제 파티클 연동 가이드

이 문서는 다른 팀원이 Virtual Particles 시스템을 실제 게임 파티클과 연동하는 방법을 안내합니다.

## 개요

프로젝트에는 두 가지 파티클 시스템이 있습니다:

1. **Virtual Particles** (`noisecraft/public/particle-system.js`)
   - 테스트/시뮬레이션용 가상 파티클
   - `test-workspace.html`에서 사용
   - 오디오 모듈레이션 테스트용

2. **Real Particles** (실제 게임 파티클)
   - `src/lib/game/state.ts`의 `GameState.players`에서 관리
   - React 컴포넌트에서 사용
   - WebSocket을 통해 서버와 동기화

## 연동 목적

Virtual Particles 시스템의 기능을 실제 게임에 적용:
- 고유한 시퀀서 패턴 부여 (`sequencer-pattern-generator.js`)
- 스트림-노드 매핑 (`mapping-preset-manager.js`)
- Individual/Global 오디오 분리 (`ncft-file-manager.js`)

## 연동 방법

### 1. 실제 파티클 → Virtual Particles 동기화

실제 게임 파티클의 데이터를 Virtual Particles로 변환하여 오디오 시스템에 사용합니다.

#### 기본 구조

```typescript
// src/lib/audio/particle-sync.ts (새로 생성)

import { VirtualSignalGenerator } from '@/lib/audio/virtualSignals';
import type { GameState } from '@/types/game';
import { createPatternGenerator } from '/public/sequencer-pattern-generator.js';

export class ParticleSync {
  private virtualGenerator: VirtualSignalGenerator;
  private patternGenerator: ReturnType<typeof createPatternGenerator>;
  private playerToParticleId: Map<string, string> = new Map();

  constructor() {
    this.virtualGenerator = new VirtualSignalGenerator(100);
    this.patternGenerator = createPatternGenerator({
      numNotes: 12,
      useMusicTheory: true
    });
  }

  /**
   * 실제 게임 파티클을 Virtual Particles로 동기화
   */
  syncFromGameState(gameState: GameState) {
    // 자신의 파티클 동기화
    if (gameState.selfId) {
      this.syncPlayer(gameState.selfId, gameState.players[gameState.selfId]);
    }

    // 다른 플레이어들 동기화
    Object.entries(gameState.players).forEach(([playerId, player]) => {
      if (playerId !== gameState.selfId) {
        this.syncPlayer(playerId, player);
      }
    });

    // 제거된 플레이어의 Virtual Particles 삭제
    this.removeDisconnectedPlayers(gameState);
  }

  /**
   * 개별 플레이어 동기화
   */
  private syncPlayer(playerId: string, player: GameState['players'][string]) {
    const virtualParticleId = `player-${playerId}`;
    
    // Virtual Particle이 없으면 생성
    if (!this.virtualGenerator.getParticles().find(p => p.id === virtualParticleId)) {
      // 고유 패턴 부여
      const pattern = this.patternGenerator.generateUniquePattern(
        playerId,
        'C Pentatonic Major',
        this.patternGenerator.getAllPatterns().map(p => p.pattern)
      );

      // Virtual Particle 생성
      this.virtualGenerator.createParticle(
        virtualParticleId,
        player.cell.position,
        player.cell.velocity,
        {
          mass: player.cell.mass,
          radius: player.cell.radius,
          tone: pattern.findIndex(v => v === 1) // 패턴에서 활성 노트 인덱스 추출
        }
      );

      // 플레이어 ID 매핑 저장
      this.playerToParticleId.set(playerId, virtualParticleId);
    } else {
      // 기존 Virtual Particle 업데이트
      this.virtualGenerator.updateParticle(virtualParticleId, {
        position: player.cell.position,
        velocity: player.cell.velocity
      });
    }
  }

  /**
   * 연결 해제된 플레이어 제거
   */
  private removeDisconnectedPlayers(gameState: GameState) {
    const currentPlayerIds = new Set(Object.keys(gameState.players));
    
    this.playerToParticleId.forEach((virtualId, playerId) => {
      if (!currentPlayerIds.has(playerId)) {
        this.virtualGenerator.removeParticle(virtualId);
        this.patternGenerator.removePattern(playerId);
        this.playerToParticleId.delete(playerId);
      }
    });
  }

  /**
   * Virtual Signal Generator 반환 (오디오 시스템에서 사용)
   */
  getVirtualGenerator() {
    return this.virtualGenerator;
  }

  /**
   * Pattern Generator 반환
   */
  getPatternGenerator() {
    return this.patternGenerator;
  }
}
```

### 2. React 컴포넌트에서 사용

#### MobileView.tsx에 통합

```typescript
// src/components/mobile/MobileView.tsx

import { ParticleSync } from '@/lib/audio/particle-sync';
import { useEffect, useRef } from 'react';

const MobileView = () => {
  const { state, dispatch, socket } = useGameClient("personal");
  const particleSyncRef = useRef<ParticleSync | null>(null);

  // ParticleSync 초기화
  useEffect(() => {
    particleSyncRef.current = new ParticleSync();
    return () => {
      particleSyncRef.current = null;
    };
  }, []);

  // 게임 상태가 변경될 때마다 동기화
  useEffect(() => {
    if (!particleSyncRef.current) return;

    // 실제 파티클 → Virtual Particles 동기화
    particleSyncRef.current.syncFromGameState(state);

    // Virtual Particles에서 오디오 파라미터 생성
    const virtualGenerator = particleSyncRef.current.getVirtualGenerator();
    const selfParticleId = state.selfId ? `player-${state.selfId}` : null;

    if (selfParticleId) {
      const params = virtualGenerator.generateParams(selfParticleId);
      
      // NoiseCraft에 파라미터 전송
      if (audioIframeRef.current && noiseCraftOrigin) {
        postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, params);
      }
    }
  }, [state.players, state.selfId]);

  // ... 나머지 코드
};
```

### 3. 시퀀서 패턴 적용

실제 파티클에도 고유한 시퀀서 패턴을 부여합니다.

```typescript
// src/lib/audio/sequencer-sync.ts (새로 생성)

import { createPatternGenerator } from '/public/sequencer-pattern-generator.js';
import { SequencerLogic } from '/public/sequencer-logic.js';
import { updateMonoSeqSequencer } from '/public/sequencer-logic.js';
import type { GameState } from '@/types/game';

export class SequencerSync {
  private patternGenerator: ReturnType<typeof createPatternGenerator>;
  private sequencerLogic: SequencerLogic;
  private playerPatterns: Map<string, number[]> = new Map(); // playerId → pattern

  constructor() {
    this.patternGenerator = createPatternGenerator();
    this.sequencerLogic = new SequencerLogic();
  }

  /**
   * 플레이어 입장 시 고유 패턴 부여
   */
  assignPatternToPlayer(playerId: string, existingPatterns: number[][] = []) {
    const pattern = this.patternGenerator.generateUniquePattern(
      playerId,
      'C Pentatonic Major',
      existingPatterns
    );
    
    this.playerPatterns.set(playerId, pattern);
    return pattern;
  }

  /**
   * 게임 상태에서 시퀀서 패턴 업데이트
   */
  updateSequencersFromGameState(
    gameState: GameState,
    iframeWindow: Window | null,
    sequencerNodeIds: { bass: string; baritone: string; tenor: string }
  ) {
    if (!gameState.selfId || !iframeWindow) return;

    const selfPlayer = gameState.players[gameState.selfId];
    if (!selfPlayer) return;

    // 자신의 패턴 가져오기 (없으면 생성)
    let selfPattern = this.playerPatterns.get(gameState.selfId);
    if (!selfPattern) {
      const existing = Array.from(this.playerPatterns.values());
      selfPattern = this.assignPatternToPlayer(gameState.selfId, existing);
    }

    // 가까운 플레이어 찾기 (inner radius 내)
    const innerPlayers = this.findInnerPlayers(gameState, selfPlayer);
    
    // Virtual Particle 객체 생성 (sequencer-logic.js가 필요로 함)
    const selfParticle = this.createVirtualParticleFromPlayer(
      gameState.selfId,
      selfPlayer,
      selfPattern
    );
    const innerParticles = innerPlayers.map(([id, player]) => {
      const pattern = this.playerPatterns.get(id) || this.assignPatternToPlayer(id);
      return this.createVirtualParticleFromPlayer(id, player, pattern);
    });

    // Individual 패턴 생성
    const sequencerPattern = this.sequencerLogic.generateIndividualPattern(
      selfParticle,
      innerParticles
    );

    // NoiseCraft 시퀀서 업데이트
    updateMonoSeqSequencer(
      iframeWindow,
      sequencerNodeIds.bass,
      0,
      sequencerPattern.bass,
      4
    );
    updateMonoSeqSequencer(
      iframeWindow,
      sequencerNodeIds.baritone,
      0,
      sequencerPattern.baritone,
      4
    );
    updateMonoSeqSequencer(
      iframeWindow,
      sequencerNodeIds.tenor,
      0,
      sequencerPattern.tenor,
      4
    );
  }

  /**
   * Inner radius 내의 플레이어 찾기
   */
  private findInnerPlayers(
    gameState: GameState,
    selfPlayer: GameState['players'][string],
    innerRadius: number = 150
  ): Array<[string, GameState['players'][string]]> {
    return Object.entries(gameState.players)
      .filter(([id, player]) => {
        if (id === gameState.selfId) return false;
        const dx = player.cell.position.x - selfPlayer.cell.position.x;
        const dy = player.cell.position.y - selfPlayer.cell.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance <= innerRadius;
      })
      .sort(([, a], [, b]) => {
        // 가까운 순서로 정렬
        const distA = Math.sqrt(
          Math.pow(a.cell.position.x - selfPlayer.cell.position.x, 2) +
          Math.pow(a.cell.position.y - selfPlayer.cell.position.y, 2)
        );
        const distB = Math.sqrt(
          Math.pow(b.cell.position.x - selfPlayer.cell.position.x, 2) +
          Math.pow(b.cell.position.y - selfPlayer.cell.position.y, 2)
        );
        return distA - distB;
      })
      .slice(0, 2); // 최대 2개 (baritone, tenor)
  }

  /**
   * 플레이어 데이터를 Virtual Particle 객체로 변환
   */
  private createVirtualParticleFromPlayer(
    playerId: string,
    player: GameState['players'][string],
    pattern: number[]
  ) {
    // VirtualParticle과 호환되는 객체 생성
    return {
      id: playerId,
      position: player.cell.position,
      velocity: player.cell.velocity,
      sequencerPattern: pattern,
      getActiveNoteIndex: () => pattern.findIndex(v => v === 1)
    };
  }
}
```

### 4. 통합 사용 예시

```typescript
// src/components/mobile/MobileView.tsx (완전한 예시)

import { ParticleSync } from '@/lib/audio/particle-sync';
import { SequencerSync } from '@/lib/audio/sequencer-sync';
import { createMappingPresetManager } from '/public/mapping-preset-manager.js';

const MobileView = () => {
  const { state } = useGameClient("personal");
  const particleSyncRef = useRef<ParticleSync | null>(null);
  const sequencerSyncRef = useRef<SequencerSync | null>(null);
  const mappingManagerRef = useRef(createMappingPresetManager({
    storageKey: 'noisecraftIndividualMappings'
  }));

  // 초기화
  useEffect(() => {
    particleSyncRef.current = new ParticleSync();
    sequencerSyncRef.current = new SequencerSync();
  }, []);

  // 게임 상태 업데이트 시
  useEffect(() => {
    if (!particleSyncRef.current || !sequencerSyncRef.current) return;

    // 1. 실제 파티클 → Virtual Particles 동기화
    particleSyncRef.current.syncFromGameState(state);

    // 2. 시퀀서 패턴 업데이트
    if (audioIframeRef.current?.contentWindow) {
      sequencerSyncRef.current.updateSequencersFromGameState(
        state,
        audioIframeRef.current.contentWindow,
        {
          bass: "211",
          baritone: "212",
          tenor: "213"
        }
      );
    }

    // 3. 스트림-노드 매핑 적용
    const virtualGenerator = particleSyncRef.current.getVirtualGenerator();
    const selfParticleId = state.selfId ? `player-${state.selfId}` : null;
    
    if (selfParticleId) {
      const mappings = mappingManagerRef.current.getMappings();
      const params = generateParamsFromMappings(
        virtualGenerator,
        selfParticleId,
        mappings
      );
      
      postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, params);
    }
  }, [state.players, state.selfId]);

  // ... 나머지 코드
};
```

## 주요 고려사항

### 1. 성능 최적화

- **Throttling**: 파라미터 업데이트를 30-60fps로 제한
- **변경 감지**: 실제로 변경된 파티클만 업데이트
- **배치 처리**: 여러 파라미터를 한 번에 전송

### 2. 패턴 영구 저장

플레이어의 고유 패턴을 서버에 저장하여 재접속 시에도 동일한 패턴 유지:

```typescript
// 서버에 패턴 저장
socket.emit('savePlayerPattern', {
  playerId: state.selfId,
  pattern: sequencerSyncRef.current?.playerPatterns.get(state.selfId)
});

// 서버에서 패턴 로드
socket.on('loadPlayerPattern', (pattern) => {
  if (pattern) {
    sequencerSyncRef.current?.playerPatterns.set(state.selfId, pattern);
  }
});
```

### 3. Individual vs Global 오디오

- **Individual**: 각 플레이어가 자신의 오디오만 듣음
- **Global**: 모든 플레이어의 오디오를 합성

`ncft-file-manager.js`를 사용하여 각각 별도 `.ncft` 파일 관리.

## 파일 구조

```
src/
├── lib/
│   └── audio/
│       ├── particle-sync.ts          # 새로 생성: 실제→Virtual 동기화
│       └── sequencer-sync.ts         # 새로 생성: 시퀀서 패턴 관리
└── components/
    └── mobile/
        └── MobileView.tsx            # 수정: 연동 코드 추가

noisecraft/public/
├── sequencer-pattern-generator.js    # 기존: 고유 패턴 생성
├── ncft-file-manager.js              # 기존: 파일 관리
└── mapping-preset-manager.js         # 기존: 매핑 관리
```

## 테스트 방법

1. **개발 환경에서 테스트**
   ```bash
   # 실제 게임 서버 실행
   npm run dev
   
   # NoiseCraft 서버 실행
   cd noisecraft && npm start
   ```

2. **Virtual Particles와 비교**
   - `test-workspace.html`에서 Virtual Particles 동작 확인
   - 실제 게임에서 동일한 동작 확인
   - 차이점이 있으면 동기화 로직 점검

3. **디버깅**
   ```typescript
   // 콘솔에서 상태 확인
   console.log('Virtual Particles:', particleSyncRef.current?.getVirtualGenerator().getParticles());
   console.log('Player Patterns:', sequencerSyncRef.current?.playerPatterns);
   ```

## 다음 단계

1. ✅ `particle-sync.ts` 생성
2. ✅ `sequencer-sync.ts` 생성
3. ✅ `MobileView.tsx`에 통합
4. ⏳ 서버 측 패턴 저장 구현
5. ⏳ Global 오디오 분리 구현
6. ⏳ 성능 최적화

## 참고 문서

- `docs/REAL_PARTICLES_ARCHITECTURE.md`: 실제 파티클 관리 구조
- `docs/FILE_ARCHITECTURE.md`: 파일별 역할 및 연결 관계
- `docs/AUDIO_SYSTEM_COMPLETE.md`: 오디오 시스템 전체 요약

