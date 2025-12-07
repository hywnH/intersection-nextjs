# 실제 파티클 관리 아키텍처

이 문서는 실제 파티클(다른 팀원이 작업한 게임 파티클)이 어디서 관리되고 어떻게 작동하는지 설명합니다.

## 개요

프로젝트에는 두 가지 종류의 파티클이 있습니다:

1. **Virtual Particles** (`noisecraft/public/particle-system.js`)
   - 테스트/시뮬레이션용 가상 파티클
   - `test-workspace.html`에서 사용
   - 오디오 모듈레이션 테스트용

2. **Real Particles** (실제 게임 파티클)
   - 실제 게임에서 사용되는 플레이어/셀
   - React/Next.js 기반
   - WebSocket을 통해 서버와 동기화

## 실제 파티클 관리 구조

### 1. 게임 상태 관리 (`src/lib/game/state.ts`)

**역할**: 게임 전체 상태를 관리하는 Reducer

**주요 데이터 구조:**
```typescript
interface GameState {
  players: Record<string, PlayerSnapshot>;  // 모든 플레이어/파티클
  playerOrder: string[];                    // 플레이어 순서
  selfId: string | null;                    // 자신의 ID
  // ... 기타 상태
}

interface PlayerSnapshot {
  id: string;
  name: string;
  cell: CellState;  // 실제 파티클 데이터
  // ...
}

interface CellState {
  position: Vec2;    // 위치
  velocity: Vec2;    // 속도
  radius: number;    // 반지름
  mass: number;      // 질량
  color: string;     // 색상
}
```

**주요 액션:**
- `SET_PLAYERS`: 모든 플레이어 설정 (서버에서 받은 스냅샷)
- `UPDATE_PLAYER`: 개별 플레이어 업데이트
- `REMOVE_PLAYER`: 플레이어 제거

**연결 관계:**
```
서버 (WebSocket)
    ↓ (플레이어 데이터)
socket/events.ts
    ↓ (액션 디스패치)
game/state.ts (gameReducer)
    ↓ (상태 업데이트)
GameState.players
```

---

### 2. 게임 클라이언트 훅 (`src/lib/game/hooks.ts`)

**역할**: React 컴포넌트에서 게임 상태에 접근하는 훅

**주요 기능:**
- `useGameClient()`: 게임 상태와 소켓에 접근
- WebSocket 연결 관리
- 상태 업데이트 디스패치

**사용 예시:**
```typescript
const { state, dispatch, players, socket } = useGameClient("personal");

// state.players: 모든 플레이어/파티클
// players: 순서대로 정렬된 플레이어 배열
// socket: WebSocket 연결
```

**연결 관계:**
```
React Component
    ↓ (useGameClient 호출)
game/hooks.ts
    ↓ (상태 관리)
game/state.ts
    ↓ (소켓 연결)
socket/createClient.ts
```

---

### 3. 소켓 이벤트 처리 (`src/lib/socket/events.ts`)

**역할**: 서버로부터 받은 WebSocket 메시지를 게임 액션으로 변환

**주요 이벤트:**
- 플레이어 스냅샷 수신 → `SET_PLAYERS` 액션
- 개별 플레이어 업데이트 → `UPDATE_PLAYER` 액션
- 플레이어 제거 → `REMOVE_PLAYER` 액션

**연결 관계:**
```
서버 (WebSocket)
    ↓ (메시지 수신)
socket/events.ts (registerSocketEvents)
    ↓ (액션 생성)
dispatch(GameAction)
    ↓ (상태 업데이트)
game/state.ts (gameReducer)
```

---

### 4. 렌더링 (`src/lib/game/renderer.ts`)

**역할**: 실제 파티클을 Canvas에 렌더링

**주요 함수:**
- `renderParticleBall()`: 파티클을 3D 입체감 있는 공으로 렌더링
- `renderParticleCluster()`: 파티클 클러스터 렌더링

**연결 관계:**
```
GameState.players
    ↓ (플레이어 데이터)
game/renderer.ts
    ↓ (Canvas 렌더링)
components/mobile/MobileView.tsx
    ↓ (화면 표시)
Canvas Element
```

---

### 5. React 컴포넌트

#### `src/components/mobile/MobileView.tsx`
**역할**: 모바일 뷰에서 실제 파티클 렌더링 및 오디오 연동

**주요 기능:**
- `useGameClient()`로 게임 상태 가져오기
- Canvas에 파티클 렌더링
- NoiseCraft 오디오와 연동

**연결 관계:**
```
MobileView.tsx
    ├─→ useGameClient() → game/hooks.ts
    ├─→ renderer.ts → 파티클 렌더링
    └─→ noiseCraft.ts → 오디오 파라미터 전송
```

#### `src/components/global/GlobalView.tsx`
**역할**: 글로벌 뷰에서 모든 파티클 표시

---

## 데이터 흐름

### 1. 플레이어 입장 → 파티클 생성

```
1. 클라이언트 연결
   ↓
2. socket/createClient.ts: WebSocket 연결
   ↓
3. 서버: 플레이어 생성 및 ID 할당
   ↓
4. socket/events.ts: SET_SELF 액션 디스패치
   ↓
5. game/state.ts: selfId 설정
   ↓
6. 서버: 모든 플레이어 스냅샷 전송
   ↓
7. socket/events.ts: SET_PLAYERS 액션 디스패치
   ↓
8. game/state.ts: players 객체 업데이트
   ↓
9. React 컴포넌트: state.players 읽기
   ↓
10. renderer.ts: 파티클 렌더링
```

### 2. 플레이어 이동 → 파티클 업데이트

```
1. 사용자 입력 (마우스/터치)
   ↓
2. MobileView.tsx: input 이벤트 처리
   ↓
3. socket.emit("0", { vx, vy }): 속도 전송
   ↓
4. 서버: 물리 계산 및 위치 업데이트
   ↓
5. 서버: 업데이트된 플레이어 데이터 브로드캐스트
   ↓
6. socket/events.ts: UPDATE_PLAYER 액션 디스패치
   ↓
7. game/state.ts: players[playerId] 업데이트
   ↓
8. React 컴포넌트: 리렌더링
   ↓
9. renderer.ts: 새로운 위치에 파티클 렌더링
```

### 3. 실제 파티클 → 오디오 연동

```
1. GameState.players (실제 파티클 데이터)
   ↓
2. MobileView.tsx: computeApproachIntensity()
   ↓
3. buildNoiseCraftParams(): 오디오 파라미터 생성
   ↓
4. postNoiseCraftParams(): NoiseCraft iframe에 전송
   ↓
5. embedded.html: 오디오 파라미터 적용
```

---

## Virtual Particles vs Real Particles

### Virtual Particles (`noisecraft/public/particle-system.js`)
- **용도**: 테스트/시뮬레이션
- **위치**: `test-workspace.html`에서만 사용
- **관리**: 클라이언트 측에서만 관리
- **데이터**: `VirtualParticle` 객체
- **용도**: 오디오 모듈레이션 테스트

### Real Particles (게임 상태)
- **용도**: 실제 게임 플레이
- **위치**: React 컴포넌트에서 사용
- **관리**: 서버와 동기화
- **데이터**: `PlayerSnapshot` (GameState.players)
- **용도**: 실제 게임 플레이어 표현

---

## 파일별 역할 요약

| 파일 | 역할 | 담당 기능 |
|------|------|-----------|
| `src/lib/game/state.ts` | 게임 상태 관리 | Reducer로 상태 업데이트, players 객체 관리 |
| `src/lib/game/hooks.ts` | React 훅 | `useGameClient()` - 게임 상태 접근 |
| `src/lib/socket/events.ts` | 소켓 이벤트 | 서버 메시지 → 게임 액션 변환 |
| `src/lib/socket/createClient.ts` | 소켓 클라이언트 | WebSocket 연결 생성 |
| `src/lib/game/renderer.ts` | 렌더링 | Canvas에 파티클 그리기 |
| `src/components/mobile/MobileView.tsx` | 모바일 뷰 | 실제 파티클 표시 및 오디오 연동 |
| `src/types/game.ts` | 타입 정의 | `PlayerSnapshot`, `CellState` 등 |

---

## 실제 파티클과 Virtual Particles 통합

현재는 두 시스템이 분리되어 있지만, 통합이 필요할 수 있습니다:

### 통합 시나리오

```typescript
// 실제 파티클 → Virtual Particles 변환
function syncRealParticlesToVirtual(
  gameState: GameState,
  virtualGenerator: VirtualSignalGenerator
) {
  // 자신의 파티클
  if (gameState.selfId) {
    const selfPlayer = gameState.players[gameState.selfId];
    virtualGenerator.updateParticle("self", {
      position: selfPlayer.cell.position,
      velocity: selfPlayer.cell.velocity
    });
  }

  // 다른 플레이어들
  Object.entries(gameState.players).forEach(([id, player]) => {
    if (id === gameState.selfId) return;
    
    virtualGenerator.updateParticle(`player-${id}`, {
      position: player.cell.position,
      velocity: player.cell.velocity
    });
  });
}
```

이렇게 하면 실제 게임 파티클의 데이터를 Virtual Particles로 동기화하여 오디오 모듈레이션에 사용할 수 있습니다.

---

## 주요 차이점

| 항목 | Virtual Particles | Real Particles |
|------|------------------|----------------|
| **저장 위치** | `particle-system.js` (메모리) | `GameState.players` (React 상태) |
| **동기화** | 클라이언트만 | 서버와 WebSocket 동기화 |
| **생명주기** | 테스트 세션 동안만 | 게임 세션 전체 |
| **물리 계산** | 클라이언트 측 중력 시뮬레이션 | 서버 측 물리 엔진 |
| **용도** | 오디오 테스트 | 실제 게임 플레이 |

---

## 다음 단계

실제 파티클과 Virtual Particles를 통합하려면:

1. `src/lib/audio/example-usage.ts`의 `updateVirtualSignalsFromGameState()` 활용
2. `MobileView.tsx`에서 실제 파티클 데이터를 Virtual Particles로 동기화
3. `sequencer-pattern-generator.js`를 실제 파티클에도 적용

이렇게 하면 실제 게임에서도 각 플레이어에게 고유한 시퀀서 패턴을 부여할 수 있습니다.

