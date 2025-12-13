# 웹 기반 음악 이론 라이브러리 조사

## 추천 라이브러리

### 1. **Tonal.js** (가장 추천) ⭐
- **GitHub**: https://github.com/tonaljs/tonal
- **특징**:
  - 순수 JavaScript, 의존성 없음
  - 코드 분석, 화성진행, 인터벌 계산
  - 코드 품질 평가 기능
  - 매우 가볍고 빠름
  - 활발한 커뮤니티

**주요 기능:**
```javascript
import { Chord, Interval, Note } from 'tonal';

// 코드 분석
Chord.notes('CMaj7'); // ['C', 'E', 'G', 'B']
Chord.intervals('CMaj7'); // ['1P', '3M', '5P', '7M']

// 코드 품질 평가
Chord.chordType('CMaj7'); // 'major seventh'

// 인터벌 계산
Interval.semitones('P5'); // 7
Interval.distance('C', 'G'); // '5P'

// 코드 진행
Chord.progression('I-V-vi-IV'); // ['C', 'G', 'Am', 'F']
```

**설치:**
```bash
npm install tonal
# 또는
<script src="https://unpkg.com/tonal@4.6.2/dist/index.js"></script>
```

### 2. **teoria.js**
- **GitHub**: https://github.com/saebekassebil/teoria
- **특징**:
  - 코드 이론 계산
  - 스케일, 코드, 인터벌
  - 다소 오래된 라이브러리 (마지막 업데이트 2017)

### 3. **music21j** (Python music21의 JavaScript 포팅)
- **특징**:
  - 매우 강력하지만 무거움
  - 웹에서는 과도할 수 있음

## Tonal.js 통합 예시

### 코드 품질 평가 및 우선순위
```javascript
import { Chord, Interval } from 'tonal';

// 코드 안정도 평가
function evaluateChordStability(chordNotes) {
  const chord = Chord.detect(chordNotes.map(n => Note.fromMidi(n + 60)));
  if (!chord || chord.length === 0) return 0;
  
  const chordType = chord[0];
  
  // 안정도 우선순위
  const stabilityMap = {
    'major': 1.0,        // 가장 안정
    'minor': 0.95,      // 매우 안정
    'major seventh': 0.9,
    'minor seventh': 0.85,
    'dominant seventh': 0.7,
    'diminished': 0.3,
    'augmented': 0.4,
  };
  
  return stabilityMap[chordType] || 0.5;
}

// 코드 간 전환 품질
function evaluateChordTransition(chord1, chord2) {
  // Voice leading 거리 계산
  // 공통 톤 확인
  // 기능적 관계 (I-V는 좋음, I-ii는 덜 좋음)
}
```

### 화성진행 생성
```javascript
import { Chord, Progression } from 'tonal';

// 화성진행 생성
const progression = Progression.fromRomanNumerals('C', ['I', 'V', 'vi', 'IV']);
// ['C', 'G', 'Am', 'F']

// 코드 품질 확인
progression.forEach(chord => {
  const notes = Chord.notes(chord);
  const quality = Chord.chordType(chord);
  // 안정도 평가
});
```

## Option C 최적화 방안

### 1. **캐싱 전략**
```javascript
class OptimizedProgressionGenerator {
  constructor() {
    this.cache = new Map(); // particleNotes -> progression
    this.lastParticleNotesHash = null;
    this.cachedProgression = null;
  }
  
  generateProgression(particleNotes, step) {
    // Hash particle notes
    const notesHash = particleNotes.sort().join(',');
    
    // Cache hit?
    if (notesHash === this.lastParticleNotesHash && this.cachedProgression) {
      return this.cachedProgression[step];
    }
    
    // Generate new progression
    const progression = this.generateNewProgression(particleNotes);
    
    // Cache it
    this.lastParticleNotesHash = notesHash;
    this.cachedProgression = progression;
    this.cache.set(notesHash, progression);
    
    return progression[step];
  }
}
```

### 2. **Throttling**
```javascript
// 매 step마다가 아니라, 사이클마다만 재계산
let lastCycle = -1;
const currentCycle = Math.floor(step / 8);

if (currentCycle !== lastCycle) {
  // 새 진행 생성
  lastCycle = currentCycle;
}
```

### 3. **점진적 업데이트**
```javascript
// 전체 재계산 대신, 변경된 step만 업데이트
function updateChangedSteps(oldPattern, newPattern) {
  const changes = [];
  for (let step = 0; step < 8; step++) {
    if (JSON.stringify(oldPattern[step]) !== JSON.stringify(newPattern[step])) {
      changes.push(step);
    }
  }
  return changes; // 변경된 step만 반환
}
```

### 4. **Lazy Evaluation**
```javascript
// 필요할 때만 계산
class LazyProgressionGenerator {
  constructor() {
    this.progressionCache = [];
  }
  
  getStep(step) {
    const cycle = Math.floor(step / 8);
    if (!this.progressionCache[cycle]) {
      this.progressionCache[cycle] = this.generateCycle(cycle);
    }
    return this.progressionCache[cycle][step % 8];
  }
}
```

## 통합 추천

### 하이브리드 접근 (최적화된 Option C)
1. **Tonal.js로 코드 분석**: 코드 품질, 안정도 평가
2. **캐싱**: 파티클 음이 변하지 않으면 재계산 안 함
3. **Throttling**: 사이클마다만 재계산
4. **점진적 업데이트**: 변경된 step만 업데이트

### 예상 성능
- **캐싱 없이**: 매 프레임마다 계산 → ~16ms (60fps 기준)
- **캐싱 + Throttling**: 사이클마다만 계산 → ~2ms
- **점진적 업데이트**: 변경된 부분만 → ~0.5ms

