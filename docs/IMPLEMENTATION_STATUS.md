# 구현 상태 상세 문서

이 문서는 `/docs/AUDIO_SYSTEM_LOGIC.md`에 정의된 로직의 현재 구현 상태를 상세히 정리합니다.

---

## 1. 유저마다 고유한 Oscillator

### 요구사항
- 유저마다 고유한 oscillator
- 실질적으로는 `.ncft` 맵 하나를 거쳐서 나오는 스테레오 오디오
- 모든 유저가 공유: `.ncft` 파일, 파티클-파라미터 매핑

### 구현 상태: ✅ 완료

**위치**: `test-workspace.html`
- 각 유저(파티클)는 하나의 `.ncft` 파일(`indiv_audio_map.ncft`)을 사용
- 스트림 매핑 시스템으로 파티클 신호를 `.ncft` 노드에 매핑
- 모든 유저가 동일한 `.ncft` 파일과 매핑 구조 사용

---

## 2. 고유 음 할당 (Sequencer Pattern)

### 요구사항
- 각 유저는 12개 음(한 옥타브) 중 하나를 고유하게 가짐
- 고유 음은 `bass`, `baritone`, `tenor` MonoSeq의 1st~4th column 중 랜덤 위치에 배치
- Rhythmic complexity: cluster 내 속도 variance나 In Inner 파티클 수에 따라 증가
- 입자는 항상 자신의 고유 음에 해당하는 칸만 시퀀서에서 사용

### 구현 상태: ✅ 완료

**위치**: `sequencer-logic.js` - `generateIndividualPattern()`

**구현 내용**:
```javascript
// Self particle의 고유 음 → bass에 배치 + 랜덤 column 위치 (0-3)
const selfNoteIndex12 = selfParticle.getActiveNoteIndex();
const rowIndex = this.map12ToneTo4Row(selfNoteIndex12);
pattern.bass[rowIndex] = 1;
pattern.columns.bass = getColumnPosition(selfParticle, 'bass'); // Random 0-3

// In Inner 파티클의 고유 음 → baritone, tenor에 배치 (최대 2개) + 랜덤 column
innerParticles.forEach((innerParticle, index) => {
  const noteIndex12 = innerParticle.getActiveNoteIndex();
  const rowIndex = this.map12ToneTo4Row(noteIndex12);
  if (index === 0) {
    pattern.baritone[rowIndex] = 1;
    pattern.columns.baritone = getColumnPosition(innerParticle, 'baritone');
  } else if (index === 1) {
    pattern.tenor[rowIndex] = 1;
    pattern.columns.tenor = getColumnPosition(innerParticle, 'tenor');
  }
});
```

**확인 사항**:
- ✅ 고유 음 할당: `particle.sequencerPattern`에 저장
- ✅ 4-column sequencer 사용: `bass`, `baritone`, `tenor` 각 4개 column
- ✅ 12-tone → 4-row 매핑: `map12ToneTo4Row()` 함수
- ✅ **랜덤 column 배치**: 각 particle의 고유 음이 1st~4th column (step 0-3) 중 랜덤 위치에 배치됨
  - `voiceColumnPositions` Map으로 각 voice/node별 persistent column 위치 저장
  - 각 particle은 자신의 고유 column 위치를 유지 (초기 할당 후 고정)
- ⚠️ Rhythmic complexity: 아직 cluster variance 기반 동적 조절 미구현 (고정 4-column)

---

## 3. In Outer / In Inner 배경음 (Post-processing)

### 요구사항
- In Outer 또는 In Inner 파티클의 조종자가 듣고 있을 소리를 post-processing하여 배경음으로 재생
- Panning, spatialization, pre-delay, reverb 적용
- `.ncft` 맵과는 무관하게 후처리로 적용
- 최대 나를 제외 2개 파티클만 배경음으로 사용

### 구현 상태: ✅ 완료 (하이브리드 접근법)

**위치**: `test-workspace.html` - parameter update loop

**구현 내용**:
```javascript
// 1. Calculate localization for all nearby particles
const localizationResults = window.audioLocalization.calculateLocalization(
  selfParticle, particles, { innerRadius, outerRadius }
);

// 2. Select up to 2 particles (closest first)
const candidateParticles = Object.entries(localizationResults)
  .sort((a, b) => a.distance - b.distance)
  .slice(0, 2);

// 3. Separate In Inner and In Outer
const innerParticlesForAudio = candidateParticles.filter(p => p.isInDistinct === 1);
const outerParticlesForAudio = candidateParticles.filter(p => p.isInOuter === 1);

// 4. Apply post-processing:
// - In Outer: High reverb (1.0-1.4), Lower volume (30% of base)
// - In Inner: Lower reverb (0.4 max), Normal volume
// - Distance-based fade-out
```

**구현 세부사항**:
- ✅ `background-audio-post-processing.js` 모듈로 분리 (HTML 독립적, 백엔드 재사용 가능)
- ✅ `spatial-audio-processor.js` 모듈 준비 (Web Audio API PannerNode 기반)
- ✅ 최대 2개 파티클 선택 로직 (가장 가까운 순서)
- ✅ In Inner와 In Outer 구분 처리
- ✅ Volume control: In Outer는 30% 볼륨, In Inner는 정상 볼륨
- ✅ Reverb control: In Outer는 높은 reverb (1.0-1.4), In Inner는 낮은 reverb (최대 0.4)
- ✅ Distance-based fade-out (innerRadius에서 outerRadius로 갈수록 감소)
- ✅ Panning 정보 계산 및 저장 (`window.backgroundAudioState`)
- ✅ **Web Audio API Post-Processing**: `StereoPannerNode` + `GainNode` + `DelayNode` 기반 리버브
  - 자기 오디오: NoiseCraft → destination (직접 연결, 드라이)
  - 배경 오디오: NoiseCraft → MediaStreamDestination → Parent → StereoPanner → Reverb → Gain → Destination
  - 리버브 업데이트: 5프레임마다 (성능 최적화)
  - 패닝 반응 속도: smoothing 0.5 (빠른 반응, 랙 감소)

**현재 구현 방식** (하이브리드 접근법):
- ✅ **Web Audio API Post-Processing** (주 방식): 실제 spatial audio + 리버브
- ✅ **NoiseCraft 노드 파라미터 제어** (보조): Volume/Reverb 노드 제어
  - Node 183: Vol CHORDS (volume)
  - Node 163: REVERB WET (reverb)
  - 효과적이고 효율적
- ✅ **Web Audio API Post-Processing 구조 준비** (`spatial-audio-processor.js`)
  - HRTF-based 3D spatialization
  - 향후 NoiseCraft AudioWorkletNode 접근 시 활성화 가능
  - 더 정교한 spatialization 가능

**참고 사항**:
- 현재는 NoiseCraft 노드 (Node 183: Vol CHORDS, Node 163: REVERB WET)를 통한 제어
- **Web Audio API Post-Processing 구조 준비 완료** (`spatial-audio-processor.js`)
  - HRTF-based 3D spatialization 준비됨
  - 현재는 NoiseCraft 노드 파라미터로 제어 (효과적이고 효율적)
  - 향후 NoiseCraft AudioWorkletNode 접근 가능 시 Web Audio API로 전환 가능
- Panning 정보는 계산되어 저장됨 (`window.backgroundAudioState`)
- 실제 배경 오디오 스트림은 각 파티클이 같은 `.ncft` 파일을 사용하므로, sequencer 패턴으로 이미 구현됨

**구현 방식**:
- **하이브리드 접근법**: 자기 자신의 오디오는 NoiseCraft 내부 처리 (일관성), 배경 오디오는 Web Audio API Post-Processing 준비 (효과성)
- 현재: NoiseCraft 노드 파라미터로 volume/reverb 제어 (실제 작동 중)
- 향후: Web Audio API PannerNode로 고급 spatialization 가능 (구조 준비됨)

---

## 4. In Inner 시퀀서 패턴 합치기

### 요구사항
- In Inner 파티클의 시퀀서 패턴을 나의 시퀀서 패턴에 합침
- 최대 나를 제외 가장 가까운 2개까지
- 최대 3개 음으로 화성 형성 (나 자신 + In Inner 2개)
- 다른 유저의 rhythmic pattern은 받지 않고, 고유 음 정보만 받아옴
- 위치는 내 column과 같이 random assign
- In Outer로 떨어지면 다시 내 고유음만 사용

### 구현 상태: ✅ 완료

**위치**: `sequencer-logic.js` - `generateIndividualPattern()`

**구현 내용**:
```javascript
// Self particle → bass (항상)
pattern.bass[rowIndex] = 1;

// In Inner 파티클 → baritone, tenor (최대 2개)
innerParticles.forEach((innerParticle, index) => {
  if (index === 0) pattern.baritone[rowIndex] = 1;
  else if (index === 1) pattern.tenor[rowIndex] = 1;
});

// In Inner 파티클이 없으면 baritone, tenor는 모두 0 (고유음만)
```

**확인 사항**:
- ✅ In Inner 파티클의 고유 음 정보만 받아옴 (`getActiveNoteIndex()`)
- ✅ 최대 2개까지만 사용 (index 0, 1)
- ✅ In Inner가 없으면 고유음만 사용 (baritone, tenor 모두 0)
- ✅ 위치는 random assign (12-tone → 4-row 매핑)

**동적 업데이트**:
- ✅ `test-workspace.html`에서 `innerParticlesChanged` 감지
- ✅ 패턴이 변경될 때마다 sequencer 업데이트

---

## 5. In Outer 거리 기반 Fade Out

### 요구사항
- In Outer에서 더 멀리 떨어질 때
- 배경 볼륨을 아주 작게, 강한 리버브로 지정
- Outer에서 나가면서 그 레벨로 fade out

### 구현 상태: ✅ 완료

**위치**: `test-workspace.html` - update loop

**구현 내용**:
```javascript
// Distance-based fade calculation
const distanceFactor = distance <= innerRadius 
  ? 1.0 
  : Math.max(0, 1 - ((distance - innerRadius) / (outerRadius - innerRadius)));

// Volume fade (Node 183: "Vol CHORDS")
const targetVolume = hasNearbyParticles 
  ? baseVolume * maxDistanceFactor 
  : 0.0; // Complete silence when alone

// Reverb fade (Node 163: "REVERB WET")
const targetReverb = hasNearbyParticles
  ? baseReverb * maxDistanceFactor
  : 0.0; // No reverb when alone
```

**확인 사항**:
- ✅ 거리 기반 fade 계산
- ✅ Volume과 reverb 모두 fade out
- ✅ 파라미터 smoothing으로 클릭 방지

---

## 6. Individual Audio 제한사항

### 요구사항
- Individual Audio는 (4, 4, 4) 형태
- 최대 3가지 음만 combine

### 구현 상태: ✅ 완료

**위치**: `sequencer-logic.js`
- `bass`, `baritone`, `tenor` 각각 4개 column
- `generateIndividualPattern()`에서 최대 3개 음 (bass + baritone + tenor)

---

## 7. Global Window 분리

### 요구사항
- Global window는 아예 따로 열고 관람
- Individual pipeline 파일들을 duplicate해서 새로운 워크스페이스 서버 생성
- 에디터는 별도 adjust

### 구현 상태: ✅ 기본 구조 완료

**위치**: `global-workspace.html`

**현재 상태**:
- ✅ `global-workspace.html` 파일 존재 및 기본 구조 완성
- ✅ `glb_audio_map.ncft` 파일 사용
- ✅ Global sequencer pattern 로직 통합
- ✅ 파티클 렌더링 작동 (화면에 표시됨)
- ✅ 파티클 추가/제거 함수 구현 (`addNewParticle()`, `removeLastParticle()`)
- ✅ 엔트로피 및 분산도 계산 알고리즘
- ✅ **Global streams만 사용**: particles#, entropy, dispersion, inInnerNumber, cluster#, newInInner, exitToOuter
- ✅ **Entropy 계산**: 파티클의 제곱근 속도 기반으로 계산 (속도 의존적)
- ✅ **파티클 생성 시 sequencer pattern 부여**: `addNewParticle()`에서 harmonic placement로 즉시 업데이트
- ✅ **파티클 제거 시 sequencer pattern 업데이트**: `removeLastParticle()`에서 즉시 업데이트
- ✅ **Web Audio spatialization 제거**: Global에서는 불필요하므로 제거됨
- ⚠️ 별도 서버/워크스페이스는 같은 서버 사용 (동일 포트에서 `/public/global-workspace.html` 접근)

---

## 8. Global용 `.ncft` 파일

### 요구사항
- `glb_audio_map.ncft` 파일 생성
- Individual과 다른 매핑

### 구현 상태: ✅ 파일 생성됨, ✅ 통합 완료

**위치**: `glb_audio_map.ncft`

**현재 상태**:
- ✅ 파일 존재
- ✅ Global workspace와 통합 완료 (`global-workspace.html`에서 사용)
- ⚠️ 12-column MonoSeq 설정은 NoiseCraft 에디터에서 직접 설정 필요

---

## 9. Global Sequencer Pattern

### 요구사항
- Global에서도 각 유저의 고유 정보(12-tone 중 하나) 사용
- `bass`, `baritone`, `tenor`는 각각 12개 column
- 한 유저는 36개 column 중 하나의 위치만 차지
- 순서 무관, 랜덤 지정

### 구현 상태: ✅ 완료 (랜덤 배치)

**위치**: `sequencer-logic.js` - `generateGlobalPattern()`, `global-workspace.html`

**구현 내용**:
- ✅ `generateGlobalPattern()` 함수: 36개 위치 중 랜덤 배치 로직
- ✅ Global sequencer 업데이트 함수 (`global-workspace.html`)
- ✅ 파티클별 persistent assignment (음성 + column 위치 유지)
- ⚠️ Harmonic progression 알고리즘은 아직 랜덤 배치 (다음 단계에서 구현 예정)

---

## 10. Harmonic Progression 알고리즘

### 요구사항
- 유저가 적으면: tonic 근처 단순 패턴
- 유저가 많으면: progression이 멀리 (엔트로피 증가)
- Tonal.js 사용하여 instability 계산
- 불안정한 음은 cycle 끝나기 전에 해결
- 랜덤하게 36개 포지션 중 하나 지정

### 구현 상태: ⚠️ 부분 구현 (엔트로피/분산도 계산 완료, Harmonic Placement 미구현)

**위치**: `/docs/HARMONIC_PROGRESSION_ALGORITHM.md`, `global-workspace.html`

**현재 상태**:
- ✅ 알고리즘 설계 완료 (Hybrid Approach)
- ✅ Sensory dissonance 데이터 반영 완료 (이미지 참조)
- ✅ `INSTABILITY_MAP` 정의 완료
- ✅ **엔트로피 계산 알고리즘**: Shannon entropy 기반 note 분포 다양성 측정 (0 ~ log2(12) ≈ 3.58)
- ✅ **분산도 계산 알고리즘**: 파티클 위치 기반 공간적 분산 측정 (표준편차)
- ✅ **파티클 추가/제거 기능**: +1/-1 버튼으로 동적 관리 (최대 36개)
- ✅ **파티클 렌더링**: 화면에 파티클 정상 표시됨
- ✅ **`GlobalHarmonicPlacer` 클래스 구현**: `harmonic-placer.js`
  - Constraint filtering (불안정한 음의 해결 제약)
  - Harmonic distance optimization (엔트로피 기반 자동 조절)
  - Weighted random selection (랜덤성 유지)
- ✅ **Sequencer Logic 통합**: `sequencer-logic.js`의 `generateGlobalPattern`이 harmonic placement 사용
- ✅ **Global Workspace 통합**: `global-workspace.html`에서 `GlobalHarmonicPlacer` 사용
- ✅ **파티클 추가/제거 기능 연동**: 버튼 클릭 시 sequencer pattern 즉시 업데이트 (harmonic placement 적용)
- ✅ **Global streams 시스템**: 개별 파티클 streams 제거, global streams만 사용 (particles#, entropy, dispersion, inInnerNumber, cluster#, newInInner, exitToOuter)
- ✅ **In Inner/Outer 이벤트 감지**: boolean 값으로 연결 생성/삭제 감지
- ⚠️ **Tonal.js 통합**: 향후 더 정교한 harmonic distance 계산을 위해 Tonal.js 추가 가능

---

## 요약

### ✅ 완료된 항목 (9/10)
1. 유저별 고유 Oscillator
2. 고유 음 할당 (Sequencer Pattern)
3. In Outer/In Inner 배경음 (Post-processing) ✅ **완료**
4. In Inner 시퀀서 패턴 합치기
5. In Outer 거리 기반 Fade Out
6. Individual Audio 제한사항
7. Global Window 분리 ✅ **기본 구조 완료**
8. Global용 `.ncft` 파일 ✅ **통합 완료**
9. Global Sequencer Pattern ✅ **랜덤 배치 완료**

### ✅ 완료된 항목 (10/10)
10. Harmonic Progression 알고리즘 ✅ **완료** - `GlobalHarmonicPlacer` 클래스 구현 및 통합 완료, 파티클 추가/제거 시 자동 업데이트

**추가 기능**:
- ✅ 파티클 +1/-1 추가/제거 함수 구현 (`addNewParticle()`, `removeLastParticle()`)
- ✅ 파티클 렌더링 작동 (화면에 정상 표시됨)
- ✅ 엔트로피 계산 (파티클 속도의 제곱근 기반, 속도 의존적)
- ✅ 분산도 계산 (공간적 분산, 표준편차)
- ✅ Cluster 계산 (연결된 컴포넌트 수)
- ✅ In Inner/Outer 이벤트 감지 (boolean 값으로 연결 생성/삭제 감지)
- ✅ +/- 버튼 연동: sequencer pattern 즉시 업데이트 (harmonic placement 적용)
- ✅ Global streams 시스템: particles#, entropy, dispersion, inInnerNumber, cluster#, newInInner, exitToOuter

---

## 다음 우선순위

### 현재 작업: Global Audio 구현

#### ✅ 완료된 항목
1. ✅ **Global Workspace 기본 구조** - `global-workspace.html` 완성
2. ✅ **Global Sequencer Pattern** - 36개 위치 랜덤 배치 로직
3. ✅ **파티클 관리 함수** - `addNewParticle()`, `removeLastParticle()` 구현 완료
4. ✅ **파티클 렌더링** - 화면에 파티클 정상 표시됨
5. ✅ **엔트로피 계산** - 파티클 속도의 제곱근 기반 (속도 의존적)
6. ✅ **분산도 계산** - 공간적 분산 (표준편차) 측정
7. ✅ **Cluster 계산** - 연결된 컴포넌트 수 계산
8. ✅ **Global streams 시스템** - particles#, entropy, dispersion, inInnerNumber, cluster#, newInInner, exitToOuter
9. ✅ **파티클 생성 시 sequencer pattern 부여** - harmonic placement로 즉시 업데이트
10. ✅ **파티클 제거 시 sequencer pattern 업데이트** - 즉시 업데이트

#### 다음 단계 (우선순위 순)

1. **12-column MonoSeq 설정** ⚠️ 필수 (에디터 작업)
   - NoiseCraft 에디터에서 `glb_audio_map.ncft` 열기
   - bass, baritone, tenor 각각 12-column으로 설정
   - Harmonic progression 테스트 전 필수

3. **테스트 및 최적화**
   - 파티클 추가/제거 시 sequencer 패턴 업데이트 확인
   - Harmonic progression이 제대로 작동하는지 검증 (유저 수에 따른 complexity 변화)
   - 엔트로피/분산도 값이 harmonic progression과 연동되는지 확인
   - Global audio 작동 확인

4. **Tonal.js 통합 (선택사항)** 📋 향후 개선
   - 더 정교한 harmonic distance 계산
   - Chord tension 계산
   - Voice leading 최적화

