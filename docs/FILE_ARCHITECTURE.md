# 파일 아키텍처 및 연결 관계

이 문서는 각 파일이 무엇을 담당하고 어떻게 연결되어 있는지 설명합니다.

## 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│                    test-workspace.html                      │
│              (메인 UI 및 통합 오케스트레이터)                  │
└──────────────┬──────────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌──────────────┐  ┌──────────────┐
│  Individual  │  │    Global    │
│   Audio      │  │    Audio     │
│  (iframe)    │  │   (iframe)   │
└──────────────┘  └──────────────┘
```

## 파일별 역할 및 책임

### 1. Core Modules (핵심 모듈)

#### `particle-system.js`
**역할**: 가상 파티클 시스템의 물리 엔진

**담당 기능:**
- 파티클 생성, 위치, 속도 관리
- 중력 계산 (F = G × m₁ × m₂ / r²)
- 파티클 간 상호작용 계산
- 신호 생성기 통합

**연결 관계:**
- `test-workspace.html` → 파티클 시스템 생성
- `sequencer-logic.js` → 파티클 데이터 읽기
- `signal-generator` → 상호작용 신호 생성

**주요 클래스:**
- `VirtualParticle`: 개별 파티클 (위치, 속도, 질량, sequencerPattern 속성 보유)
- `SignalGenerator`: 파티클 간 상호작용 신호 생성
- `ParticleSystem`: 전체 파티클 시스템 관리

---

#### `sequencer-logic.js`
**역할**: 시퀀서 패턴 생성 및 NoiseCraft 노드 업데이트

**담당 기능:**
- Individual 패턴 생성 (bass, baritone, tenor)
- Global 패턴 생성 (모든 파티클 포함)
- 12-tone → 4-row 매핑
- NoiseCraft MonoSeq 노드 업데이트

**연결 관계:**
- `test-workspace.html` → 패턴 생성 요청
- `particle-system.js` → 파티클의 `sequencerPattern` 읽기
- `embedded.html` (iframe) → 시퀀서 노드 업데이트 메시지 전송

**주요 함수:**
- `generateIndividualPattern()`: 개별 오디오용 패턴 생성
- `generateGlobalPattern()`: 글로벌 오디오용 패턴 생성
- `updateMonoSeqSequencer()`: NoiseCraft 노드 업데이트

---

#### `music-theory.js`
**역할**: 음악 이론 기반 패턴 생성

**담당 기능:**
- 스케일 생성 (Pentatonic, Major, Minor 등)
- 화음 톤 계산
- 조화로운 패턴 생성

**연결 관계:**
- `sequencer-pattern-generator.js` → 조화로운 패턴 생성
- `particle-system.js` → 초기 패턴 생성 시 사용

---

### 2. New Modular Components (새로운 모듈화 컴포넌트)

#### `sequencer-pattern-generator.js`
**역할**: 각 파티클/유저에게 고유한 시퀀서 패턴 부여 및 관리

**담당 기능:**
- 파티클 생성 시 고유 패턴 자동 할당
- 중복 패턴 방지
- 패턴 레지스트리 관리 (particleId → pattern)
- 패턴 내보내기/가져오기 (영구 저장)

**연결 관계:**
```
test-workspace.html
    ↓ (파티클 생성 시)
sequencer-pattern-generator.js
    ↓ (고유 패턴 생성)
particle.sequencerPattern = pattern
    ↓ (파티클에 저장)
particle-system.js (VirtualParticle)
    ↓ (패턴 읽기)
sequencer-logic.js (generateIndividualPattern)
```

**주요 메서드:**
- `generateUniquePattern()`: 고유 패턴 생성 (중복 체크)
- `getPattern()`: 파티클의 패턴 조회
- `exportRegistry()`: 패턴 레지스트리 내보내기
- `importRegistry()`: 패턴 레지스트리 가져오기

**데이터 흐름:**
1. 유저 입장 → `generateUniquePattern(userId)` 호출
2. 기존 패턴들과 중복 체크
3. 고유 패턴 생성 및 레지스트리에 저장
4. 파티클의 `sequencerPattern` 속성에 할당

---

#### `ncft-file-manager.js`
**역할**: Individual과 Global 오디오를 위한 별도 `.ncft` 파일 관리

**담당 기능:**
- Individual `.ncft` 파일 로드 및 iframe 관리
- Global `.ncft` 파일 로드 (없으면 Individual에서 복사)
- 프로젝트 파일 로드/저장
- iframe 간 메시지 전송

**연결 관계:**
```
test-workspace.html
    ↓ (초기화)
ncft-file-manager.js
    ↓ (파일 로드)
┌──────────────┬──────────────┐
│              │              │
▼              ▼              ▼
Individual    Global      embedded.html
iframe        iframe      (NoiseCraft)
```

**주요 메서드:**
- `initializeIndividual()`: Individual iframe 초기화
- `initializeGlobal()`: Global iframe 초기화 (없으면 복사)
- `postMessageToIndividual()`: Individual iframe에 메시지 전송
- `postMessageToGlobal()`: Global iframe에 메시지 전송

**파일 구조:**
- `indiv_audio_map.ncft`: Individual 오디오용 (기존 파일)
- `global_audio_map.ncft`: Global 오디오용 (자동 생성)

---

#### `mapping-preset-manager.js`
**역할**: Individual과 Global 오디오를 위한 별도의 스트림-노드 매핑 프리셋 관리

**담당 기능:**
- 매핑 저장/로드 (localStorage)
- JSON 파일로 내보내기/가져오기
- 프리셋 관리 (이름 지정, 저장, 불러오기)
- Individual/Global 각각 별도 프리셋 지원

**연결 관계:**
```
test-workspace.html
    ↓ (매핑 생성/수정)
mapping-preset-manager.js
    ↓ (저장)
localStorage / JSON 파일
    ↓ (로드)
StreamNodeMapper (test-workspace.html)
    ↓ (적용)
NoiseCraft iframe (파라미터 업데이트)
```

**주요 메서드:**
- `addMapping()`: 매핑 추가
- `savePreset()`: 프리셋으로 저장
- `loadPreset()`: 프리셋 불러오기
- `exportMappings()`: JSON 파일로 내보내기
- `importMappings()`: JSON 파일에서 가져오기

**데이터 구조:**
```javascript
{
  mappings: [
    {
      id: "mapping-123",
      nodeId: "211",
      paramName: "value",
      operation: "none",
      enabled: true,
      streams: [...]
    }
  ],
  metadata: {
    exportTime: "2024-01-01T00:00:00Z",
    presetName: "individual-default"
  }
}
```

---

### 3. Main Application (메인 애플리케이션)

#### `test-workspace.html`
**역할**: 전체 시스템의 통합 오케스트레이터 및 UI

**담당 기능:**
- 모든 모듈 초기화 및 연결
- 파티클 시스템 시각화
- 매핑 UI 제공
- 애니메이션 루프 관리
- NoiseCraft iframe 통신

**연결 관계:**
```
test-workspace.html (메인)
    │
    ├─→ particle-system.js (파티클 생성/업데이트)
    │
    ├─→ sequencer-pattern-generator.js (고유 패턴 부여)
    │
    ├─→ sequencer-logic.js (패턴 생성)
    │
    ├─→ ncft-file-manager.js (파일 관리)
    │       ├─→ Individual iframe
    │       └─→ Global iframe
    │
    ├─→ mapping-preset-manager.js (매핑 관리)
    │       ├─→ Individual mappings
    │       └─→ Global mappings
    │
    └─→ StreamNodeMapper (내부 클래스)
            └─→ 매핑 적용 → iframe 메시지 전송
```

**주요 컴포넌트:**
- `StreamNodeMapper`: 스트림-노드 매핑 관리 (내부 클래스)
- 애니메이션 루프: 파티클 업데이트 및 시퀀서 패턴 갱신
- UI: 매핑 편집, Export/Import 버튼

---

### 4. NoiseCraft Integration (NoiseCraft 통합)

#### `embedded.html`
**역할**: NoiseCraft 에디터를 iframe으로 임베드

**담당 기능:**
- `.ncft` 파일 로드 및 표시
- 노드 편집 UI
- 오디오 재생
- 부모 창과의 메시지 통신

**연결 관계:**
```
test-workspace.html
    ↓ (postMessage)
embedded.html (iframe)
    ↓ (NoiseCraft 모델 업데이트)
model.js / editor.js
    ↓ (오디오 처리)
audiograph.js / audioworklet.js
```

**메시지 타입:**
- `noiseCraft:setParam`: 노드 파라미터 설정
- `noiseCraft:toggleCell`: 시퀀서 셀 토글
- `noiseCraft:enableAutoSave`: 자동 저장 활성화
- `noiseCraft:nodeSelection`: 노드 선택 이벤트

---

## 데이터 흐름 다이어그램

### 1. 파티클 생성 및 패턴 할당

```
유저 입장
    ↓
test-workspace.html: createParticle()
    ↓
particle-system.js: addParticle()
    ↓
sequencer-pattern-generator.js: generateUniquePattern()
    ↓ (중복 체크)
particle.sequencerPattern = pattern
    ↓ (저장)
VirtualParticle (particle-system.js)
```

### 2. Individual 오디오 업데이트

```
애니메이션 루프 (test-workspace.html)
    ↓
particle-system.js: generateSignals()
    ↓ (innerParticles 계산)
sequencer-logic.js: generateIndividualPattern()
    ↓ (particle.getActiveNoteIndex() 호출)
particle.sequencerPattern 읽기
    ↓ (패턴 생성)
updateMonoSeqSequencer()
    ↓ (postMessage)
ncft-file-manager.js: postMessageToIndividual()
    ↓
Individual iframe (embedded.html)
    ↓
NoiseCraft: 시퀀서 노드 업데이트
```

### 3. Global 오디오 업데이트

```
애니메이션 루프 (test-workspace.html)
    ↓
모든 파티클 수집
    ↓
sequencer-logic.js: generateGlobalPattern()
    ↓ (모든 파티클의 패턴 사용)
updateMonoSeqSequencer()
    ↓ (postMessage)
ncft-file-manager.js: postMessageToGlobal()
    ↓
Global iframe (embedded.html)
    ↓
NoiseCraft: 시퀀서 노드 업데이트
```

### 4. 매핑 적용

```
사용자가 매핑 생성/수정
    ↓
mapping-preset-manager.js: addMapping()
    ↓ (localStorage 저장)
StreamNodeMapper: generateParams()
    ↓ (스트림 값 → 파라미터 변환)
ncft-file-manager.js: postMessageToIndividual/Global()
    ↓
NoiseCraft iframe: 파라미터 업데이트
```

---

## 파일 간 의존성 그래프

```
test-workspace.html (메인)
    │
    ├─→ particle-system.js
    │       └─→ music-theory.js (선택적)
    │
    ├─→ sequencer-logic.js
    │       └─→ particle-system.js (파티클 읽기)
    │
    ├─→ sequencer-pattern-generator.js
    │       └─→ music-theory.js (선택적)
    │
    ├─→ ncft-file-manager.js
    │       └─→ embedded.html (iframe)
    │
    ├─→ mapping-preset-manager.js
    │       └─→ localStorage
    │
    └─→ music-theory.js
```

---

## 주요 데이터 구조

### 1. Sequencer Pattern
```javascript
// 12-tone chromatic pattern
[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]  // C
[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]  // E
```

### 2. Individual Pattern (4-row sequencer)
```javascript
{
  bass: [1, 0, 0, 0],      // Self particle
  baritone: [0, 1, 0, 0],  // First inner particle
  tenor: [0, 0, 1, 0]      // Second inner particle
}
```

### 3. Mapping Configuration
```javascript
{
  id: "mapping-123",
  nodeId: "211",
  paramName: "value",
  operation: "none",
  enabled: true,
  streams: [{
    stream: "attraction",
    interpolation: "linear",
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 0.1
  }]
}
```

---

## 모듈 간 통신 방식

### 1. 직접 함수 호출
- `particle.getActiveNoteIndex()` → `sequencerPattern` 읽기
- `patternGenerator.generateUniquePattern()` → 패턴 생성

### 2. postMessage (iframe 통신)
- `fileManager.postMessageToIndividual()` → Individual iframe
- `fileManager.postMessageToGlobal()` → Global iframe

### 3. localStorage
- `mappingPresetManager.saveToStorage()` → 매핑 저장
- `patternGenerator.exportRegistry()` → 패턴 레지스트리 저장

### 4. 이벤트 리스너
- iframe `load` 이벤트 → 초기화 완료
- `window.addEventListener('message')` → iframe 메시지 수신

---

## 확장 포인트

### 1. 새로운 패턴 생성 알고리즘
- `sequencer-pattern-generator.js`의 `generateUniquePattern()` 수정

### 2. 새로운 매핑 연산 추가
- `test-workspace.html`의 `StreamNodeMapper.computeMappingValue()` 수정

### 3. 새로운 파일 형식 지원
- `ncft-file-manager.js`의 `loadProjectFile()` 확장

### 4. 서버 측 파일 저장
- `ncft-file-manager.js`의 `saveProjectFile()` 구현

---

이 아키텍처는 모듈화되어 있어 각 컴포넌트를 독립적으로 테스트하고 수정할 수 있으며, Individual과 Global 오디오를 완전히 분리하여 관리할 수 있습니다.

