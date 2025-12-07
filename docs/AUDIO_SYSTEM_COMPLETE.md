# 오디오 시스템 완전 가이드

이 문서는 프로젝트의 모든 오디오 관련 기능을 통합하여 설명합니다.

## 목차

1. [시스템 개요](#시스템-개요)
2. [Virtual Particles 시스템](#virtual-particles-시스템)
3. [실제 파티클 연동](#실제-파티클-연동)
4. [시퀀서 패턴 시스템](#시퀀서-패턴-시스템)
5. [스트림-노드 매핑](#스트림-노드-매핑)
6. [Individual vs Global 오디오](#individual-vs-global-오디오)
7. [음악 이론 통합](#음악-이론-통합)
8. [성능 최적화](#성능-최적화)
9. [NoiseCraft 통합](#noisecraft-통합)

---

## 시스템 개요

### 아키텍처

```
┌─────────────────────────────────────────┐
│         실제 게임 파티클                  │
│    (GameState.players)                  │
└──────────────┬──────────────────────────┘
               │ 동기화
               ▼
┌─────────────────────────────────────────┐
│      Virtual Particles                  │
│   (particle-system.js)                  │
└──────────────┬──────────────────────────┘
               │ 신호 생성
               ▼
┌─────────────────────────────────────────┐
│      Stream-Node Mapping                │
│   (mapping-preset-manager.js)            │
└──────────────┬──────────────────────────┘
               │ 파라미터 변환
               ▼
┌─────────────────────────────────────────┐
│         NoiseCraft                      │
│   (embedded.html iframe)                │
└─────────────────────────────────────────┘
```

### 주요 컴포넌트

1. **파티클 시스템**: Virtual/Real 파티클 관리
2. **시퀀서 로직**: 패턴 생성 및 업데이트
3. **패턴 생성기**: 고유 패턴 부여
4. **매핑 관리자**: 스트림-노드 매핑
5. **파일 관리자**: Individual/Global `.ncft` 파일 관리

---

## Virtual Particles 시스템

### 개요

Virtual Particles는 테스트 및 시뮬레이션을 위한 가상 파티클 시스템입니다.

**파일**: `noisecraft/public/particle-system.js`

### 주요 기능

- **파티클 생성/관리**: 위치, 속도, 질량 관리
- **중력 계산**: F = G × m₁ × m₂ / r²
- **신호 생성**: attraction, velocity, distance 등
- **상호작용 감지**: inner/outer radius 기반

### 사용 예시

```javascript
import { ParticleSystem } from '/public/particle-system.js';

const particleSystem = new ParticleSystem({
  innerRadius: 80,
  outerRadius: 150,
  G: 500,
  minDistance: 3
});

// 파티클 생성
const particle = particleSystem.addParticle(0, 500, 500, 0, 100);

// 신호 생성
const signals = particleSystem.signalGenerator.generateSignals(particle);
// { attraction, velocity, distance, closingSpeed, isInner, isOuter }
```

### 신호 타입

1. **attraction**: 중력 기반 근접도 (0-1)
2. **velocity**: 파티클 속도 (0-1)
3. **distance**: 거리 (픽셀)
4. **closingSpeed**: 접근 속도 (0-1)
5. **isInner**: Inner radius 내 여부 (0 또는 1)
6. **isOuter**: Outer radius 내 여부 (0 또는 1)

---

## 실제 파티클 연동

### 개요

실제 게임 파티클(`GameState.players`)을 Virtual Particles로 동기화하여 오디오 시스템에 사용합니다.

**참고**: `docs/VIRTUAL_TO_REAL_PARTICLES_INTEGRATION.md` 참조

### 동기화 방법

```typescript
// 실제 파티클 → Virtual Particles
const particleSync = new ParticleSync();
particleSync.syncFromGameState(gameState);

// Virtual Particles에서 오디오 파라미터 생성
const virtualGenerator = particleSync.getVirtualGenerator();
const params = virtualGenerator.generateParams(`player-${selfId}`);
```

### 주요 고려사항

- **성능**: Throttling으로 업데이트 빈도 제한
- **패턴 영구 저장**: 서버에 저장하여 재접속 시 유지
- **변경 감지**: 실제로 변경된 파티클만 업데이트

---

## 시퀀서 패턴 시스템

### 개요

각 파티클/플레이어에게 고유한 시퀀서 패턴을 부여하고, 상호작용 시 화음 생성.

**파일**: `noisecraft/public/sequencer-logic.js`, `sequencer-pattern-generator.js`

### 패턴 구조

#### 12-tone Chromatic Pattern
```javascript
// 각 파티클의 고유 패턴 (12개 요소)
[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]  // C (note 0)
[0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]  // D# (note 2)
```

#### 4-row Sequencer Pattern (Individual Audio)
```javascript
{
  bass: [1, 0, 0, 0],      // Self particle
  baritone: [0, 1, 0, 0],  // First inner particle
  tenor: [0, 0, 1, 0]      // Second inner particle
}
```

### 패턴 생성 로직

#### 1. 고유 패턴 부여
```javascript
const patternGen = createPatternGenerator();
const pattern = patternGen.generateUniquePattern(
  particleId,
  'C Pentatonic Major',
  existingPatterns
);
```

#### 2. Individual 패턴 생성
```javascript
const sequencerLogic = new SequencerLogic();
const pattern = sequencerLogic.generateIndividualPattern(
  selfParticle,
  innerParticles  // Inner radius 내의 파티클들
);
```

### 동작 방식

- **Alone**: bass만 활성 (단일 톤)
- **1 inner particle**: bass + baritone (2음 화음)
- **2+ inner particles**: bass + baritone + tenor (3음 화음)

### 12-tone → 4-row 매핑

```javascript
// 0-2 → Row 0, 3-5 → Row 1, 6-8 → Row 2, 9-11 → Row 3
map12ToneTo4Row(noteIndex12) {
  return Math.floor(noteIndex12 / 3);
}
```

---

## 스트림-노드 매핑

### 개요

Virtual Particles의 신호 스트림을 NoiseCraft 노드 파라미터로 변환.

**파일**: `noisecraft/public/test-workspace.html` (StreamNodeMapper 클래스)

### 매핑 구성

```javascript
{
  id: "mapping-123",
  nodeId: "211",           // NoiseCraft 노드 ID
  paramName: "value",      // 파라미터 이름
  operation: "none",       // 수학 연산
  enabled: true,
  streams: [{
    stream: "attraction",
    interpolation: "linear",  // linear, logarithmic, exponential
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 0.1
  }]
}
```

### 수학 연산

- **none**: 첫 번째 스트림만 사용
- **add**: 모든 스트림 합산
- **multiply**: 모든 스트림 곱셈
- **min/max**: 최소/최대값
- **average**: 평균

### 보간 모드

- **linear**: 선형 매핑
- **logarithmic**: 로그 곡선 (낮은 값에 민감)
- **exponential**: 지수 곡선 (높은 값에 민감)

### 프리셋 관리

```javascript
const mappingManager = createMappingPresetManager({
  storageKey: 'noisecraftIndividualMappings'
});

// 프리셋 저장
mappingManager.savePreset('default', 'Default mapping');

// 프리셋 불러오기
mappingManager.loadPreset('default');

// JSON 파일로 내보내기/가져오기
mappingManager.exportMappings('mappings.json');
await mappingManager.importMappings(file);
```

---

## Individual vs Global 오디오

### Individual Audio (개별 오디오)

**목적**: 각 사용자가 자신의 오디오만 듣음

**특징**:
- 자신의 파티클 + Inner radius 내 파티클들의 화음
- 공간화 (panning, distance-based gain)
- 실시간 상호작용 반영

**파일**: `indiv_audio_map.ncft`

**시퀀서 노드**:
- Bass (211): 자신의 노트
- Baritone (212): 첫 번째 inner 파티클
- Tenor (213): 두 번째 inner 파티클

### Global Audio (글로벌 오디오)

**목적**: 모든 플레이어의 오디오를 합성하여 관객에게 제공

**특징**:
- 모든 파티클의 패턴 포함
- 화음 진행 (chord progression)
- 클러스터 기반 오디오

**파일**: `global_audio_map.ncft` (Individual에서 자동 복사)

### 파일 관리

```javascript
const fileManager = createNcftFileManager({
  basePath: '/public/examples',
  individualFile: 'indiv_audio_map.ncft',
  globalFile: 'global_audio_map.ncft'
});

// Individual 초기화
await fileManager.initializeIndividual('individual-iframe');

// Global 초기화 (없으면 Individual에서 복사)
await fileManager.initializeGlobal('global-iframe');
```

---

## 음악 이론 통합

### 사용 가능한 스케일

- **Major Scales**: C, D, E, F, G, A
- **Minor Scales**: A Minor, E Minor, D Minor
- **Pentatonic Scales**: 매우 조화로움 (기본 선택)
- **Blues Scale**: 더 표현력 있는 패턴
- **Chromatic**: 완전한 유연성 (덜 조화로움)

### 패턴 생성 함수

#### 1. 조화로운 패턴 생성
```javascript
const pattern = generateHarmoniousPattern(
  'C Pentatonic Major',
  null,  // chord (optional)
  12     // numNotes
);
```

#### 2. 조화화 패턴 생성
```javascript
const pattern = generateHarmonizingPattern(
  [existingPattern1, existingPattern2],
  'C Pentatonic Major'
);
```

#### 3. 화음 패턴 생성
```javascript
const patterns = generateChordPatterns(
  'C Major',  // chord name
  3            // numPatterns
);
```

### Tonal.js 통합 (권장)

```bash
npm install @tonaljs/tonal
```

```javascript
import { Progression, Chord, Scale } from '@tonaljs/tonal';

// 화음 진행 생성
const progression = Progression.fromRomanNumerals('C major', ['I', 'V', 'vi', 'IV']);

// 화음 톤 가져오기
const chord = Chord.get('CM');
// { notes: ['C', 'E', 'G'], ... }
```

**참고**: `docs/JAVASCRIPT_MUSIC_THEORY_LIBRARIES.md` 참조

---

## 성능 최적화

### Throttling

```javascript
const SIGNAL_UPDATE_INTERVAL = 16;   // ~60fps (신호 업데이트)
const PARAM_UPDATE_INTERVAL = 33;    // ~30fps (파라미터 업데이트)
const SEQUENCER_UPDATE_THROTTLE = 100; // 10fps (시퀀서 업데이트)
```

### 최적화 기법

1. **변경 감지**: 실제로 변경된 파티클만 업데이트
2. **배치 처리**: 여러 파라미터를 한 번에 전송
3. **requestAnimationFrame**: DOM 업데이트 배치
4. **파라미터 스무딩**: 급격한 변화 방지

### 파라미터 스무딩

```javascript
// 볼륨 파라미터는 매우 느린 스무딩 (클릭 방지)
const VOLUME_SMOOTHING_FACTOR = 0.015;
const DEFAULT_SMOOTHING_FACTOR = 0.1;
```

**참고**: `docs/PERFORMANCE_AND_MUSIC_THEORY_OPTIMIZATIONS.md` 참조

---

## NoiseCraft 통합

### iframe 통신

```javascript
// 파라미터 설정
iframe.contentWindow.postMessage({
  type: "noiseCraft:setParam",
  nodeId: "211",
  paramName: "value",
  value: 0.5
}, "*");

// 시퀀서 패턴 업데이트
iframe.contentWindow.postMessage({
  type: "noiseCraft:toggleCell",
  nodeId: "211",
  patIdx: 0,
  stepIdx: 0,
  rowIdx: 2,
  value: 1
}, "*");
```

### 주요 노드 (indiv_audio_map.ncft)

- **211**: MonoSeq "bass"
- **212**: MonoSeq "baritone"
- **213**: MonoSeq "tenor"
- **206**: Knob "fact" (detune)
- **183**: Knob "Vol CHORDS"
- **17**: Knob "%" (probability)
- **70**: Knob "vol" (master volume)

### Auto-save

```javascript
iframe.contentWindow.postMessage({
  type: "noiseCraft:enableAutoSave",
  enabled: true,
  filename: "indiv_audio_map.ncft"
}, "*");
```

---

## 주요 파일 구조

```
noisecraft/public/
├── particle-system.js              # Virtual Particles
├── sequencer-logic.js              # 시퀀서 패턴 생성
├── sequencer-pattern-generator.js  # 고유 패턴 부여
├── ncft-file-manager.js            # 파일 관리
├── mapping-preset-manager.js       # 매핑 프리셋
├── music-theory.js                 # 음악 이론 함수
└── test-workspace.html             # 테스트 워크스페이스

src/lib/audio/
├── virtualSignals.ts               # Virtual 신호 생성
├── nodeMapper.ts                    # 노드 매핑
├── noiseCraft.ts                    # NoiseCraft 통신
└── example-usage.ts                 # 사용 예시

src/lib/game/
├── state.ts                         # 게임 상태 (실제 파티클)
└── hooks.ts                         # React 훅

docs/
├── AUDIO_SYSTEM_COMPLETE.md         # 이 문서
├── VIRTUAL_TO_REAL_PARTICLES_INTEGRATION.md  # 연동 가이드
└── FILE_ARCHITECTURE.md             # 파일 구조
```

---

## 빠른 시작 가이드

### 1. Virtual Particles 테스트

```bash
# NoiseCraft 서버 실행
cd noisecraft && npm start

# 브라우저에서 열기
open http://localhost:3001/public/test-workspace.html
```

### 2. 실제 파티클 연동

```typescript
// MobileView.tsx에 추가
import { ParticleSync } from '@/lib/audio/particle-sync';

const particleSync = new ParticleSync();
particleSync.syncFromGameState(gameState);
```

### 3. 매핑 설정

1. `test-workspace.html`의 "Mappings" 탭 열기
2. "+ Add Mapping" 클릭
3. 노드 선택 및 스트림 설정
4. "📥 Export"로 저장

### 4. 시퀀서 패턴 확인

- 각 파티클의 고유 패턴: `particle.sequencerPattern`
- 활성 노트 인덱스: `particle.getActiveNoteIndex()`
- Individual 패턴: `sequencerLogic.generateIndividualPattern()`

---

## 문제 해결

### 시퀀서가 업데이트되지 않음

- Inner particles 변경 감지 확인
- `updateMonoSeqSequencer()` 호출 확인
- iframe 메시지 전송 확인

### 오디오가 끊김

- 파라미터 스무딩 확인
- Throttling 간격 조정
- Gate time 증가 (0.3-0.5초)

### 패턴이 항상 같음

- 스케일 다양성 증가 (Pentatonic → Major/Minor)
- 패턴 생성 시 랜덤 시드 추가
- Tonal.js 통합 고려

---

## 참고 문서

- `docs/VIRTUAL_TO_REAL_PARTICLES_INTEGRATION.md`: 실제 파티클 연동 가이드
- `docs/FILE_ARCHITECTURE.md`: 파일별 역할 및 연결 관계
- `docs/REAL_PARTICLES_ARCHITECTURE.md`: 실제 파티클 관리 구조
- `docs/MODULE_ARCHITECTURE.md`: 모듈 아키텍처

---

이 문서는 모든 오디오 관련 기능을 통합하여 제공합니다. 특정 기능에 대한 자세한 내용은 해당 섹션을 참조하세요.

