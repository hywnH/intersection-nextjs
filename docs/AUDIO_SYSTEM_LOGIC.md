# Audio System Logic - Individual & Global

## 개요

이 문서는 다중 유저 인터랙티브 오디오 시스템의 핵심 로직을 정의합니다. Individual Audio와 Global Audio 두 가지 파이프라인이 있습니다.

---

## 공통 구조

### 1. 유저별 고유 Oscillator

**구조**:
- 각 유저는 **하나의 `.ncft` 파일**을 공유합니다
- 각 유저는 **하나의 파티클**을 제어합니다
- 파티클 정보와 `.ncft` 파일 내 파라미터 간의 **매핑**을 공유합니다
- 이 매핑은 모든 유저가 공통으로 사용하는 **"틀"**입니다

**실제 출력**:
- `.ncft` 파일을 거쳐 나오는 **스테레오 오디오**가 각 유저의 고유한 oscillator입니다

---

## Individual Audio Logic

### 2. 고유 음 할당 (Sequencer Pattern)

**구조**:
- `.ncft` 파일 내에 `bass`, `baritone`, `tenor` 세 개의 `MonoSeq` 노드가 있습니다
- 각 `MonoSeq`는 **12개의 음**(한 옥타브, C~B)과 **4개의 column**(step)을 가집니다
- 각 유저는 **1번째 음부터 12번째 음 사이에서 하나**를 고유하게 가집니다

**Column 배치** (랜덤 위치):
- 각 유저의 고유 음은 `bass`, `baritone`, `tenor`의 **1st ~ 4th column (step 0-3) 사이의 랜덤한 위치**에 배치됩니다
- 각 particle이 처음 할당될 때 column 위치가 랜덤하게 선택되고, 이후 고정됩니다
- 예시: 유저의 고유 음이 **솔(G, 7번째 음)**인 경우:
  - 전체 패턴: `[0,0,0,0,0,0,0,1,0,0,0,0]` (12-tone)
  - Row 매핑: 7 → row 2 (map12ToneTo4Row: floor(7/3) = 2)
  - Column 배치 (랜덤): `bass`는 step 1, `baritone`은 step 3, `tenor`는 step 0 등
  - 실제 패턴: `bass[step=1, row=2] = 1`, `baritone[step=3, row=X] = 1` 등

**Rhythmic Complexity**:
- `bass`, `baritone`, `tenor`의 패턴이나 기둥 수는 **유동적**입니다
- Rhythmic complexity는 다음에 따라 증가합니다:
  - Cluster 내 파티클들의 **속도 variance**
  - 내 파티클에 영향을 주는(**In Inner**) 파티클 수
- **중요**: 입자는 항상 자신의 고유 음에 해당하는 칸만 시퀀서에서 사용할 수 있습니다

### 3. In Outer / In Inner 배경음 (Post-Processing)

**조건**:
- 어떤 파티클이 나에 대해 **In Outer**이거나 **In Inner**라면

**처리**:
- **변경사항**: 그 파티클의 조종자가 듣고 있을 소리 output을 spatialize 하는 대신
- **노이즈 기반 필터링된 사운드**를 생성합니다:
  - **노이즈 소스**: 화이트 노이즈 또는 다른 노이즈 타입
  - **주파수 필터**: 해당 입자의 음(note)에 해당하는 주파수역대에 대한 밴드패스/피크 필터 적용
  - 예시: 입자의 고유 음이 솔(G, 약 392Hz)인 경우, 해당 주파수역대(예: 350-450Hz)를 통과시키는 필터 적용
- 적용되는 효과:
  - **Panning**: 좌우 위치에 따른 공간 배치
  - **Spatialization**: 3D 공간 오디오 효과 (노이즈 + 필터된 사운드)
  - **Localization**: 공간적 위치 인식 (거리, 방향)
  - **Pre-delay**: 거리 기반 딜레이
  - **Reverb**: 공간감을 위한 리버브
- 이 효과들은 **`.ncft` 맵과는 무관하게** 후처리로 적용됩니다
- 목적: "나"에게 인터랙션에 대한 **오디오 큐**를 제공 (실제 오디오 출력이 아닌 필터된 노이즈로 위치/음 정보 전달)

**제한**:
- 배경음으로 사용하는 **maximum particle 수**: 나를 제외하고 **최대 2개**

### 4. In Inner 시퀀서 패턴 합치기

**조건**:
- 어떤 파티클이 **In Inner**라면 (상호작용 가능한 범위 내로 들어온 경우)

**처리**:
- 배경음을 넘어서, 그 파티클의 **고유 패턴을 받아서 sequencer 패턴을 만드는 소스로 함께 사용하기 시작**합니다
- **입자의 고유 패턴 형식**: `(0,0,0,...,0,1,0,0,0)` - 12-tone 배열에서 해당 음만 1, 나머지는 0
  - 예: 솔(G)의 경우 `(0,0,0,0,0,0,0,1,0,0,0,0)` (7번째 인덱스가 1)
- 이 패턴은 내 sequencer 패턴 생성의 **소스(source)로 합쳐집니다**
- **제한**: 나를 제외한, 가장 가까운 **최대 2개**까지

**결과**:
- In Inner일 때 내가 최대로 가지는 음의 종류: **3개** (나 자신 + In Inner 2개)
- 이 3개 음이 **화성**을 이루게 됩니다

**동적 업데이트**:
- 다른 유저가 기존보다 더 가까이 오면, 기존을 튕기고 새로운 패턴을 들여옵니다
- 다른 유저의 **rhythmic pattern은 받아오지 않고**, 오직 **고유한 식별 음 정보**만 받아옵니다
  - 예: `(0,0,0,0,0,0,0,1,0,0,0,0)` (솔)
- 받아온 음의 위치는 내 column과 같이 **random assign**됩니다
- 즉, **rhythmic assignment는 서로 직접적으로 공유하는 정보일 필요 없습니다**
- 같은 파라미터를 받아서 **개별적으로 진행**되는 사항입니다

**In Outer로 떨어질 때**:
- 시퀀서는 다시 내 **고유음만**을 사용합니다
- 해당 파티클의 고유 패턴을 더 이상 sequencer 소스로 사용하지 않습니다

### 5. In Outer 거리 기반 Fade Out

**조건**:
- In Outer에서 **더 멀리 떨어질 때**

**처리**:
- 배경 볼륨을 **아주 작게**, **강한 리버브**로 지정합니다
- Outer에서 나가면서 그 레벨로 **fade out**되도록 합니다

### 6. Individual Audio 제한사항

- Individual Audio는 **(4, 4, 4)** 형태로, 최대 **3가지 음만 combine**합니다
- `bass`, `baritone`, `tenor` 각각 4개 column

---

## Global Audio Logic

### 7. Global Window 분리

**구조**:
- Global window는 **아예 따로 열고 관람**하는 것입니다
- Individual workspace (`indiv-workspace.html`)와 분리된 **독립적인 워크스페이스**입니다
- 파일: `global-workspace.html`
- 에디터는 별도로 adjust 합니다

### 8. Global용 `.ncft` 파일

**파일명**: `glb_audio_map.ncft`

**구조**:
- Individual과는 **다른 매핑**을 해야하므로 아예 파일을 하나 더 만듭니다
- Individual이 시퀀서 정보만 다르고 같은 구조의 NoiseCraft 맵을 쓴다면
- Global은 **그냥 다른 파일**을 사용합니다

### 9. Global Workspace UI 및 기능

**UI 구조**:
- **파티클 추가/제거 기능**: +1/-1 버튼으로 동적 관리
- **개인 컨트롤 제거**: 개별 파티클 제어 불필요 (관람 모드)
- **Global 스트림 표시**: 시스템 전역 메트릭만 표시

### 10. Global Stream 계산

**스트림 종류** (Individual과 완전히 다름):

1. **엔트로피 (Entropy)**
   - 파티클 시스템의 속도 다양성 측정
   - Shannon entropy 기반 계산
   - 범위: 0 ~ log2(12) ≈ 3.58

2. **평균제곱근속력 (RMS Velocity)**
   - 모든 파티클의 속도의 평균제곱근 (Root Mean Square)
   - 계산: `sqrt(sum(vx² + vy²) / N)` where N = 파티클 수
   - 시스템 전체의 운동 에너지 지표

3. **파티클 개수 (Particle Count)**
   - 현재 활성 파티클 수
   - 동적 추가/제거 반영

4. **클러스터 개수 (Cluster Count)**
   - In Inner 반경 내에서 연결된 파티클 그룹의 수
   - DFS (Depth-First Search) 알고리즘으로 계산
   - 범위: 0 ~ 파티클 수

5. **Is Inner 생성 Pulsar**
   - Is Inner 관계가 **새로 생성**될 때마다 일정 시간 동안 1, 그 외 0
   - 펄스 지속 시간: 설정 가능 (기본값 예: 0.5초)
   - 이벤트 기반 트리거

6. **Is Inner 소멸 Pulsar**
   - Is Inner 관계가 **사라질** 때마다 일정 시간 동안 1, 그 외 0
   - 펄스 지속 시간: 설정 가능 (기본값 예: 0.5초)
   - 이벤트 기반 트리거

**계산 알고리즘**:
- 각 프레임마다 파티클 상태 업데이트
- 이전 프레임과 비교하여 In Inner 상태 변화 감지
- Pulsar는 타이머 기반으로 감쇠 (exponential decay)

### 11. Global Sequencer Pattern

**구조**:
- Global에서도 각 유저의 **(0,0,...,0) 고유 정보를 쓰는 것은 같습니다**
- 하지만 `bass`, `baritone`, `tenor`는 각각 **16개의 column**을 가집니다 (최근 변경)
- 한 유저는 그 **36개의 column 중 하나의 위치만** 차지할 수 있습니다
- 위치 지정: **Harmonic Progression 알고리즘** 기반 (랜덤 + 음악적 논리)

**예시**:
- 유저 A (도, C): `bass` column 3에 배치
- 유저 B (솔, G): `baritone` column 7에 배치
- 유저 C (미, E): `tenor` column 1에 배치
- 유저 D (라, A): `bass` column 11에 배치
- ...

### 12. Harmonic Progression 알고리즘 (향후 구현)

**목표**:
- Final result는 **harmonic progression**이 들려야 합니다
- 유저가 적으면: 금방 **tonic**으로 돌아오는 단순한 패턴
- 유저가 늘수록, 엔트로피가 클수록: progression이 **멀리** 되었으면 좋겠습니다
- **Global 스트림** (엔트로피, RMS 속도, 클러스터 수)을 harmonic progression에 반영

**구현 방식**:
- **Tonal.js**를 사용하여 최초 접속자가 배당받은 음에 대한 **instability**를 계산합니다
- 새로운 유저가 들어올 때마다:
  - 예: '도'에 대해서는 '시'가 '솔'보다 더 불안정합니다
  - 따라서, 사이클이 끝나기 전 마지막 '시'는 무조건 '솔' 전에 위치해야 합니다
- 약간은 랜덤하게 **48개의 포지션 중 하나**에 지정되었으면 합니다
- **Per-user note (0,0,...,0) assignment**: 각 파티클의 고유 패턴을 sequencer pattern maker 알고리즘과 연결

### 10. Harmonic Progression 알고리즘

**목표**:
- Final result는 **harmonic progression**이 들려야 합니다
- 유저가 적으면: 금방 **tonic**으로 돌아오는 단순한 패턴
- 유저가 늘수록, 엔트로피가 클수록: progression이 **멀리** 되었으면 좋겠습니다

**구현 방식**:
- **Tonal.js**를 사용하여 최초 접속자가 배당받은 음에 대한 **instability**를 계산합니다
- 새로운 유저가 들어올 때마다:
  - 예: '도'에 대해서는 '시'가 '솔'보다 더 불안정합니다
  - 따라서, 사이클이 끝나기 전 마지막 '시'는 무조건 '솔' 전에 위치해야 합니다
- 약간은 랜덤하게 **36개의 포지션 중 하나**에 지정되었으면 합니다

**알고리즘 요구사항**:
- Harmonic function 기반 instability 계산
- Voice leading 최적화
- Cycle completion 전 resolution 보장
- 랜덤성과 음악적 논리의 균형

### 10-1. Harmonic Progression 알고리즘 추천

#### 알고리즘 1: Instability 기반 Constrained Random Placement

**개념**:
- 각 음에 **instability score**를 부여합니다
- Tonal.js를 사용하여 harmonic function 기반 tension을 계산합니다
- 새로운 유저가 들어올 때, **현재 progression의 instability를 계산**하고
- 새로운 음을 추가할 때 **최종 instability를 조절**합니다

**구현**:
```javascript
// 각 음의 instability score (C major 기준)
const instabilityMap = {
  0: 0,    // Unison - 매우 높은 dissonance (그래프 시작점)
    1: 9,    // Minor 2nd - 매우 높은 dissonance
    2: 3,    // Major 2nd - 중간 dissonance
    3: 2,    // Minor 3rd - consonant
    4: 1.5,  // Major 3rd - consonant
    5: 2.5,  // Perfect 4th - consonant
    6: 8,    // Tritone - 매우 높은 dissonance
    7: 0.5,  // Perfect 5th - 가장 consonant (deepest dip)
    8: 4,    // Minor 6th - 중간 dissonance
    9: 2,    // Major 6th - consonant
    10: 4.5, // Minor 7th - 중간-높은 dissonance
    11: 7,   // Major 7th - 높은 dissonance
};

// 현재 progression의 총 instability
function calculateProgressionInstability(assignedNotes, totalUsers) {
  let totalInstability = 0;
  assignedNotes.forEach(noteIndex => {
    totalInstability += instabilityMap[noteIndex] || 0;
  });
  
  // 유저 수가 많을수록 더 높은 instability 허용
  const entropyFactor = Math.log(totalUsers + 1);
  return totalInstability / (entotalUsers * entropyFactor);
}

// 새로운 음 배치 가능 위치 평가
function evaluatePositionScore(noteIndex, position, currentProgression) {
  const instability = instabilityMap[noteIndex];
  const positionInCycle = position % 12; // 12-step cycle 내 위치
  
  // Cycle 끝나기 전 불안정한 음은 해결되어야 함
  const distanceToCycleEnd = 12 - positionInCycle;
  if (instability > 5 && distanceToCycleEnd < 3) {
    return -100; // 강하게 패널티
  }
  
  // 중간 위치는 더 유연
  const positionScore = Math.abs(positionInCycle - 6) / 6; // 0~1
  
  return positionScore * (instability + 1);
}
```

#### 알고리즘 2: Voice Leading 기반 Topological Sort

**개념**:
- 각 음을 **노드**로, 해결 관계를 **엣지**로 표현
- **위상 정렬(Topological Sort)** 알고리즘 사용
- "불안정한 음은 안정적인 음보다 먼저 나와야 해결될 수 있다"는 제약

**구현**:
```javascript
// 해결 관계 그래프 (C major)
const resolutionGraph = {
  11: [0],  // B (leading tone) -> C (tonic)
  7: [0, 2, 4], // G (dominant) -> C, D, E
  5: [0, 7], // F (subdominant) -> C, G
  2: [7],   // D -> G
  // ... 기타 해결 관계
};

// 위상 정렬로 valid 순서 생성
function generateValidProgression(existingNotes, newNote, availablePositions) {
  // 1. 해결 관계를 만족하는 위치만 필터링
  const validPositions = availablePositions.filter(pos => {
    const futureNotes = getNotesAfterPosition(pos);
    // newNote가 해결되어야 하는 음들이 futureNotes에 있는지 확인
    const resolutions = resolutionGraph[newNote] || [];
    return resolutions.some(r => futureNotes.includes(r));
  });
  
  // 2. 랜덤하게 하나 선택
  return validPositions[Math.floor(Math.random() * validPositions.length)];
}
```

#### 알고리즘 3: Harmonic Distance + Entropy 기반 (추천)

**개념**:
- **Tonal.js의 tension calculator** 사용
- 현재 progression의 **harmonic distance from tonic** 계산
- 유저 수가 적을 때: 낮은 distance (tonic 근처)
- 유저 수가 많을 때: 높은 distance (progression이 멀리)

**구현**:
```javascript
import { ChordTensionCalculator } from './chord-tension.js';

const tensionCalculator = new ChordTensionCalculator('C', 'major');

// 현재 progression의 harmonic distance
function calculateProgressionDistance(assignedNotes) {
  // 현재 할당된 음들로 chord 구성
  const currentChord = notesToChord(assignedNotes);
  const tension = tensionCalculator.calculateTension(currentChord);
  
  // Tension이 높을수록 tonic에서 멀리
  return tension;
}

// 새로운 유저 배치 결정
function assignNewUserPosition(userNote, totalUsers, existingPositions) {
  const targetDistance = calculateTargetDistance(totalUsers);
  const currentDistance = calculateProgressionDistance(existingNotes);
  
  // 가능한 모든 위치 시뮬레이션
  const candidates = availablePositions.map(pos => {
    const newProgression = [...existingPositions, { note: userNote, pos }];
    const newDistance = calculateProgressionDistance(newProgression);
    
    // 목표 distance에 가까운 위치 선호
    const distanceScore = 1 / (1 + Math.abs(newDistance - targetDistance));
    
    // Instability 제약 확인
    const instabilityScore = checkInstabilityConstraints(newProgression);
    
    return {
      position: pos,
      score: distanceScore * instabilityScore
    };
  });
  
  // Weighted random selection
  return weightedRandomSelect(candidates);
}

// 유저 수에 따른 목표 distance
function calculateTargetDistance(userCount) {
  // 유저 1명: 0 (tonic)
  // 유저 많을수록: 더 높은 distance
  const maxDistance = 8; // 최대 가능 distance
  return Math.min(maxDistance, Math.log(userCount + 1) * 2);
}
```

#### 최종 추천 알고리즘: Hybrid Approach

**결합 방식**:
1. **Phase 1**: Instability 제약 검사 (알고리즘 1)
   - 불안정한 음이 cycle 끝나기 전에 해결될 수 있는지 확인
   
2. **Phase 2**: Harmonic Distance 최적화 (알고리즘 3)
   - 유저 수에 따라 목표 distance 계산
   - 가능한 위치들 중 목표에 가까운 것 선호
   
3. **Phase 3**: Voice Leading 스무딩 (알고리즘 2)
   - 최종 선택 후, 이웃 음들과의 voice leading 확인
   - 필요시 미세 조정

**장점**:
- ✅ 음악적 논리 보장 (instability 제약)
- ✅ 유저 수에 따른 엔트로피 조절
- ✅ 랜덤성 유지 (weighted random)
- ✅ Tonal.js 활용 (기존 tension calculator 재사용)

---

## 구현 상태 (Implementation Status)

### ✅ 완료된 항목 (7/10)

1. **✅ 유저별 고유 Oscillator** - `test-workspace.html`
   - 각 유저가 `.ncft` 파일과 매핑 공유
   
2. **✅ 고유 음 할당 (Sequencer Pattern)** - `sequencer-logic.js`
   - `generateIndividualPattern()` 구현
   - 고유 음을 4-column sequencer에 배치
   - ⚠️ Rhythmic complexity는 아직 cluster variance 기반 동적 조절 미구현
   
3. **✅ In Outer/In Inner 배경음 (Post-processing)** - `test-workspace.html` ✅ **완료**
   - 최대 2개 파티클 선택 및 처리
   - In Outer/In Inner 구분에 따른 volume 및 reverb 적용
   - Distance-based fade-out
   
4. **✅ In Inner 시퀀서 패턴 합치기** - `sequencer-logic.js`
   - In Inner 파티클의 고유 음을 baritone/tenor에 배치 (최대 2개)
   - 동적 업데이트 구현
   
5. **✅ In Outer 거리 기반 Fade Out** - `test-workspace.html`
   - Distance-based volume 및 reverb fade
   
6. **✅ Individual Audio 제한사항** - `sequencer-logic.js`
   - (4, 4, 4) 형태, 최대 3개 음

### ⚠️ 부분 구현 (1/10)

3. **✅ In Outer/In Inner 배경음 (Post-processing)** - `test-workspace.html` ✅ **완료**
   - `audioLocalization` helper 실제 사용
   - 최대 2개 파티클 선택 및 처리 (가장 가까운 순서)
   - In Outer/In Inner 구분에 따른 volume 및 reverb 적용
   - In Outer: 높은 reverb (1.0-1.4), 낮은 볼륨 (30% of base)
   - In Inner: 낮은 reverb (최대 0.4), 정상 볼륨
   - Distance-based fade-out 구현
   - ⚠️ Panning은 계산되지만 아직 NoiseCraft 노드에 매핑되지 않음

7. **⚠️ Global Window 분리** - `global-workspace.html`
   - 파일은 존재하나 별도 서버/워크스페이스 미구현

### ❌ 미구현 (2/10)

9. **❌ Global Sequencer Pattern**
   - 12-column MonoSeq 설정 미구현
   - 36개 위치 배치 로직 없음

10. **❌ Harmonic Progression 알고리즘**
   - 알고리즘 문서화만 완료 (`/docs/HARMONIC_PROGRESSION_ALGORITHM.md`)
   - `GlobalHarmonicPlacer` 클래스 미구현

### 추가 정보

**상세 구현 상태**: `/docs/IMPLEMENTATION_STATUS.md` 참조

---

## Sensory Dissonance 기반 Instability 계산

### 참조 이미지 데이터

제공된 이미지들에 기반한 **정확한 dissonance 값**:

| Interval (Semitones) | Note Name | SD 그래프 값 | Instability Score |
|----------------------|-----------|--------------|-------------------|
| 0 | Unison (C) | ~1.0 (시작점) | 0 (Tonic - harmonic function) |
| 1 | Minor 2nd (C#) | ~1.0 | 9 |
| 2 | Major 2nd (D) | ~0.4-0.5 | 3 |
| 3 | Minor 3rd (D#) | ~0.3 | 2 |
| 4 | Major 3rd (E) | ~0.3 | 1.5 |
| 5 | Perfect 4th (F) | ~0.3 | 2.5 |
| 6 | Tritone (F#) | Peak (최고점) | 8 |
| 7 | Perfect 5th (G) | **Deepest dip (~0.1-0.2)** | 0.5 |
| 8 | Minor 6th (G#) | ~0.3-0.5 | 4 |
| 9 | Major 6th (A) | ~0.3 | 2 |
| 10 | Minor 7th (A#) | ~0.4-0.5 | 4.5 |
| 11 | Major 7th (B) | ~0.7 | 7 |

**데이터 출처**:
- SD vs Semitones 그래프: 각 semitone 간격의 실제 측정값
- Sensory dissonance 그래프: William A. Sethares 모델링 기반
- HARMONY 그래프: Half steps에 따른 dissonance 시각화

**참고**:
- Instability는 **sensory dissonance + harmonic function**을 결합한 값입니다
- Perfect 5th는 sensory dissonance는 가장 낮지만 Dominant function으로 약간의 tension을 가집니다
- Leading tone (B)은 높은 dissonance와 강한 해결 필요성으로 높은 instability를 가집니다

이 값들은 `/docs/HARMONIC_PROGRESSION_ALGORITHM.md`에 반영되었습니다.

---

## 구현 파일 구조

### Individual Audio
- **Workspace**: `test-workspace.html` (또는 `individual-workspace.html`)
- **NoiseCraft File**: `indiv_audio_map.ncft`
- **MonoSeq 구조**: `bass`, `baritone`, `tenor` 각각 4 columns, 12 rows

### Global Audio
- **Workspace**: `global-workspace.html` (새로 생성 필요)
- **NoiseCraft File**: `glb_audio_map.ncft`
- **MonoSeq 구조**: `bass`, `baritone`, `tenor` 각각 12 columns, 12 rows

---

## 핵심 개념 정리

### 1. 공유 자원
- ✅ `.ncft` 파일 (모든 유저 동일)
- ✅ 파티클-파라미터 매핑 (모든 유저 동일)
- ✅ Post-processing 설정 (모든 유저 동일)

### 2. 유저별 고유 자원
- ✅ 고유 음 (12-tone 중 하나)
- ✅ Column 배치 위치 (랜덤)
- ✅ Rhythmic pattern (속도 variance, In Inner 수에 따라)

### 3. 동적 변경 사항
- ✅ In Inner 파티클의 고유 음 정보 (최대 2개)
- ✅ 배경음 레벨 (거리에 따라)
- ✅ Rhythmic complexity (cluster 상태에 따라)

### 4. Global 전용
- ✅ Harmonic progression 알고리즘
- ✅ 48-column sequencer 구조
- ✅ Tonal.js 기반 instability 계산

---

## 구현 상태 (Implementation Status)

### Individual Audio

| 항목 | 상태 | 구현 위치 | 비고 |
|------|------|-----------|------|
| **1. 유저별 고유 Oscillator** | ✅ 완료 | `test-workspace.html` | 각 유저가 `.ncft` 파일과 매핑 공유 |
| **2. 고유 음 할당 (Sequencer Pattern)** | ✅ 완료 | `sequencer-logic.js` | `generateIndividualPattern()` - 고유 음을 4-column sequencer에 배치 |
| **3. In Outer/In Inner 배경음 (Post-processing)** | ⚠️ 부분 구현 | `test-workspace.html` | `audioLocalization` helper 있음, 실제 배경 오디오 스트림 post-processing 미구현 |
| **4. In Inner 시퀀서 패턴 합치기** | ✅ 완료 | `sequencer-logic.js` | `generateIndividualPattern()` - In Inner 파티클의 고유 음을 baritone/tenor에 배치 (최대 2개) |
| **5. In Outer 거리 기반 Fade Out** | ✅ 완료 | `test-workspace.html` | Distance-based volume 및 reverb fade (nodes 183, 163) |
| **6. Individual Audio 제한사항** | ✅ 완료 | `sequencer-logic.js` | (4, 4, 4) 최대 3개 음 combine |

### Global Audio

| 항목 | 상태 | 구현 위치 | 비고 |
|------|------|-----------|------|
| **7. Global Window 분리** | ⚠️ 부분 구현 | `global-workspace.html` | 파일은 있으나 별도 서버/워크스페이스 미구현 |
| **8. Global용 `.ncft` 파일** | ✅ 파일 생성됨 | `glb_audio_map.ncft` | 파일은 존재하나 설정/통합 미구현 |
| **9. Global Sequencer Pattern** | ❌ 미구현 | - | 16 columns per voice, 48개 위치 배치 로직 없음 |
| **10. Harmonic Progression 알고리즘** | ❌ 미구현 | - | 알고리즘 문서화만 완료, 실제 구현 없음 |

### 공통/기타

| 항목 | 상태 | 구현 위치 | 비고 |
|------|------|-----------|------|
| **파티클 시스템** | ✅ 완료 | `particle-system.js` | 중력 계산, In Inner/Outer 판단 |
| **신호 생성** | ✅ 완료 | `particle-system.js` | `generateSignals()` - distance, closingSpeed, isInner, isOuter |
| **스트림 매핑** | ✅ 완료 | `test-workspace.html` | `StreamNodeMapper` - localStorage 및 export/import 지원 |
| **패턴 할당 모듈** | ✅ 완료 | `pattern-assignment.js` | Tonal.js 통합 준비 완료 |
| **매핑 저장소** | ✅ 완료 | `mapping-storage.js` | localStorage, JSON export/import, `.ncft` 메타데이터 지원 |

---

## 다음 단계

### 우선순위 1: Individual Audio 완성
1. ⏳ **In Outer 배경음 Post-processing 구현**
   - 다른 유저의 음 정보에 해당하는 sine wave 에
   - Panning, spatialization, pre-delay, reverb 적용
   - 최대 2개 파티클만 배경음으로 사용

2. ⏳ **실제 배경 오디오 스트림 통합**
   - 현재는 helper 함수만 있음
   - 실제 오디오 파이프라인 구현 필요

### 우선순위 2: Global Audio 구현
3. ⏳ **Global Workspace 생성**
   - 별도 서버/워크스페이스 설정
   - `global-workspace.html` 완성

4. ⏳ **Global `.ncft` 파일 설정**
   - `glb_audio_map.ncft` 12-column MonoSeq 설정
   - Global workspace와 통합

5. ⏳ **Harmonic Progression 알고리즘 구현**
   - `GlobalHarmonicPlacer` 클래스 구현
   - Tonal.js 기반 instability 계산
   - Sensory dissonance 데이터 반영 (이미지 참조)

---

## Sensory Dissonance 기반 Instability 계산

### 참조 이미지 데이터

제공된 이미지들에 기반한 **정확한 dissonance 값**:

| Interval (Semitones) | Note Name | Dissonance Level | Instability Score |
|----------------------|-----------|------------------|-------------------|
| 0 | Unison (C) | 매우 낮음 (~0) | 0 (Tonic - harmonic function 기준) |
| 1 | Minor 2nd (C#) | 매우 높음 (~1.0) | 9 |
| 2 | Major 2nd (D) | 중간 (~0.4-0.5) | 3 |
| 3 | Minor 3rd (D#) | 낮음 (~0.3) | 2 |
| 4 | Major 3rd (E) | 낮음 (~0.3) | 1.5 |
| 5 | Perfect 4th (F) | 낮음 (~0.3) | 2.5 |
| 6 | Tritone (F#) | 매우 높음 (peak) | 8 |
| 7 | Perfect 5th (G) | **가장 낮음** (deepest dip) | 0.5 |
| 8 | Minor 6th (G#) | 중간 | 4 |
| 9 | Major 6th (A) | 낮음 (~0.3) | 2 |
| 10 | Minor 7th (A#) | 중간-높음 | 4.5 |
| 11 | Major 7th (B) | 높음 (~0.7) | 7 |
| 12 | Octave (C) | 매우 낮음 | 0 (Tonic - harmonic function 기준) |

**참고**:
- Instability는 **sensory dissonance + harmonic function**을 결합한 값입니다
- Perfect 5th는 sensory dissonance는 낮지만 harmonic function에서 Dominant이므로 약간의 tension을 가집니다
- Leading tone (B)은 높은 dissonance와 강한 해결 필요성으로 높은 instability를 가집니다

이 값들은 `/docs/HARMONIC_PROGRESSION_ALGORITHM.md`에 반영되었습니다.

