# Background Audio Post-Processing Module

## 개요

`background-audio-post-processing.js`는 HTML에 의존하지 않는 순수 JavaScript 모듈로, 배경 오디오 post-processing 로직을 처리합니다.

최종 전시에서는 오디오만 필요하므로, 백엔드/서버에서 재사용 가능하도록 설계되었습니다.

## 파일 위치

- `noisecraft/public/background-audio-post-processing.js`

## 주요 기능

1. **최대 2개 파티클 선택**: 가장 가까운 파티클 2개까지 배경음으로 사용
2. **In Inner/In Outer 구분**: 거리 기반으로 파티클을 분류
3. **Volume 및 Reverb 제어**:
   - In Inner: 정상 볼륨, 낮은 reverb (최대 0.4)
   - In Outer: 낮은 볼륨 (30% of base), 높은 reverb (1.0-1.4)
4. **Distance-based fade-out**: innerRadius에서 outerRadius로 갈수록 감소
5. **Panning 계산**: 향후 panning 노드 추가 시 사용 가능

## 사용법

### 기본 사용

```javascript
import { processBackgroundAudio } from './background-audio-post-processing.js';

const particles = particleSystem.getParticles();
const selfParticle = particles.find(p => p.id === 0);

const backgroundAudio = processBackgroundAudio(
  selfParticle,
  particles,
  {
    innerRadius: 80,
    outerRadius: 150,
    baseVolume: 0.0015
  }
);

// NoiseCraft 노드 파라미터 배열
const params = backgroundAudio.params; // [{nodeId, paramName, value}, ...]

// 로컬라이제이션 상태 (디버깅/향후 사용)
const state = backgroundAudio.state;
```

### 반환값

```javascript
{
  params: [
    {
      nodeId: "183",      // "Vol CHORDS" - 배경 오디오 볼륨
      paramName: "value",
      value: 0.0015       // 계산된 볼륨 값
    },
    {
      nodeId: "163",      // "REVERB WET" - 리버브
      paramName: "value",
      value: 1.2          // 계산된 리버브 값
    }
  ],
  state: {
    localization: {
      candidates: [...],  // 선택된 파티클 정보
      avgPan: 0.0,       // 평균 panning 값
      innerCount: 1,     // In Inner 파티클 개수
      outerCount: 1      // In Outer 파티클 개수
    }
  }
}
```

## 함수

### `processBackgroundAudio(selfParticle, allParticles, config)`

주요 post-processing 함수입니다.

**Parameters:**
- `selfParticle` (Object): 제어되는 파티클 (id: 0 typically)
- `allParticles` (Array): 모든 파티클 배열
- `config` (Object): 설정 객체
  - `innerRadius` (number): Inner 반경 (default: 80)
  - `outerRadius` (number): Outer 반경 (default: 150)
  - `baseVolume` (number): 기본 볼륨 (default: 0.0015)

**Returns:** `{params, state}` 객체

### `calculateLocalization(selfParticle, otherParticles, config)`

파티클 간 로컬라이제이션 파라미터를 계산합니다.

**Parameters:**
- `selfParticle` (Object): 제어되는 파티클
- `otherParticles` (Array): 다른 파티클 배열
- `config` (Object): `{innerRadius, outerRadius}`

**Returns:** 파티클 ID를 키로 하는 로컬라이제이션 결과 객체

### `smoothParameter(currentValue, targetValue, smoothingFactor, smoothingState)`

파라미터 값을 부드럽게 보간합니다 (클릭 방지).

## NoiseCraft 노드

### Node 183: "Vol CHORDS"
- 다른 파티클의 oscillator (bass, baritone, tenor) 볼륨
- In Inner: 정상 볼륨
- In Outer: 30% 볼륨

### Node 163: "REVERB WET"
- 배경 오디오 리버브
- In Outer: 높은 reverb (1.0-1.4)
- In Inner: 낮은 reverb (최대 0.4)

## individual-audio.js 파일

**참고**: `individual-audio.js` 파일은 현재 사용되지 않습니다. 

- **용도**: 초기 설계 단계에서 만들어진 `IndividualAudioRouter` 클래스
- **상태**: 미사용 (deprecated)
- **대체**: `background-audio-post-processing.js` 사용

만약 향후 다른 용도로 사용할 계획이 있다면:
- User-Particle 매핑 관리 (`registerUser`, `unregisterUser`)
- 개별 유저별 오디오 라우팅
- 더 복잡한 오디오 라우팅 로직

현재는 `background-audio-post-processing.js`가 모든 기능을 담당합니다.

## 백엔드 통합

이 모듈은 HTML/브라우저에 의존하지 않으므로 Node.js 백엔드에서도 사용 가능합니다:

```javascript
// Node.js 예시
const { processBackgroundAudio } = require('./background-audio-post-processing.js');

function updateAudioParams(userId, allParticles) {
  const selfParticle = allParticles.find(p => p.userId === userId);
  const result = processBackgroundAudio(selfParticle, allParticles, {
    innerRadius: 80,
    outerRadius: 150
  });
  
  // WebSocket을 통해 클라이언트에 전송
  socket.emit('audioParams', result.params);
}
```

