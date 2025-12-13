# Tonal.js 통합 가이드

## 설치 방법

### Option 1: npm (권장)
```bash
npm install tonal
```

### Option 2: CDN (빠른 테스트)
```html
<script src="https://unpkg.com/tonal@4.6.2/dist/index.js"></script>
```

### Option 3: ES6 Module
```javascript
import { Chord, Interval, Note, Progression } from 'tonal';
```

## 주요 기능

### 1. 코드 분석 및 품질 평가
```javascript
import { Chord } from 'tonal';

// 코드에서 음 추출
Chord.notes('CMaj7'); // ['C', 'E', 'G', 'B']
Chord.intervals('CMaj7'); // ['1P', '3M', '5P', '7M']

// 코드 타입 확인
Chord.chordType('CMaj7'); // 'major seventh'

// 코드 안정도 평가 (우리 시스템에 맞게)
function getChordStability(chordName) {
  const type = Chord.chordType(chordName);
  const stabilityMap = {
    'major': 1.0,
    'minor': 0.95,
    'major seventh': 0.9,
    'minor seventh': 0.85,
    'dominant seventh': 0.7,
    'diminished': 0.3,
    'augmented': 0.4,
  };
  return stabilityMap[type] || 0.5;
}
```

### 2. 코드 감지 (우리가 필요한 기능!)
```javascript
import { Chord } from 'tonal';

// 음 배열에서 코드 감지
const notes = [0, 4, 7]; // C, E, G
const chordNames = Chord.detect(notes.map(n => Note.fromMidi(n + 60)));
// ['CM', 'Em', 'G'] - 가능한 코드들

// 가장 가능성 높은 코드 선택
const bestChord = chordNames[0]; // 'CM' (C Major)
```

### 3. 화성진행 생성
```javascript
import { Progression } from 'tonal';

// 로마 숫자로 진행 생성
const progression = Progression.fromRomanNumerals('C', ['I', 'V', 'vi', 'IV']);
// ['C', 'G', 'Am', 'F']

// 각 코드의 음 추출
progression.map(chord => Chord.notes(chord));
// [['C', 'E', 'G'], ['G', 'B', 'D'], ['A', 'C', 'E'], ['F', 'A', 'C']]
```

### 4. 인터벌 계산
```javascript
import { Interval } from 'tonal';

// 두 음 사이의 인터벌
Interval.distance('C', 'G'); // '5P' (Perfect 5th)
Interval.semitones('5P'); // 7

// Voice leading 거리
Interval.semitones(Interval.distance('C', 'E')); // 4
```

## 우리 시스템에 통합

### 개선된 코드 평가 함수
```javascript
import { Chord, Note } from 'tonal';

function evaluateChordQualityWithTonal(notes) {
  // Convert to note names
  const noteNames = notes.map(n => Note.fromMidi(n + 60));
  
  // Detect chord
  const detectedChords = Chord.detect(noteNames);
  
  if (detectedChords.length === 0) {
    return { quality: 0.3, chordType: 'unknown', stability: 0.3 };
  }
  
  const bestChord = detectedChords[0];
  const chordType = Chord.chordType(bestChord);
  
  // Stability based on chord type
  const stabilityMap = {
    'major': 1.0,
    'minor': 0.95,
    'major seventh': 0.9,
    'minor seventh': 0.85,
    'dominant seventh': 0.7,
    'diminished': 0.3,
    'augmented': 0.4,
  };
  
  const stability = stabilityMap[chordType] || 0.5;
  
  return {
    quality: stability,
    chordType: chordType,
    stability: stability,
    chordName: bestChord
  };
}
```

### 화성진행 자동 생성
```javascript
import { Progression } from 'tonal';

function generateProgressionFromParticles(particleNotes, key = 'C') {
  // Convert particle notes to scale degrees
  // Find best progression that matches available notes
  // Use Tonal's progression system
  
  const commonProgressions = [
    ['I', 'V', 'vi', 'IV'],
    ['I', 'vi', 'IV', 'V'],
    ['vi', 'IV', 'I', 'V'],
  ];
  
  // Score each progression
  const scored = commonProgressions.map(roman => {
    const chords = Progression.fromRomanNumerals(key, roman);
    // Check how many particle notes match chord tones
    const matchScore = calculateMatchScore(chords, particleNotes);
    return { roman, chords, score: matchScore };
  });
  
  // Return best match
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}
```

## 성능 고려사항

### Tonal.js는 가볍지만...
- 코드 감지: ~1-2ms per call
- 화성진행 생성: ~0.5ms per call
- **캐싱 필수**: 같은 입력에 대해 재계산 방지

### 최적화 전략
```javascript
// 1. 결과 캐싱
const chordCache = new Map();
function getCachedChord(notes) {
  const key = notes.sort().join(',');
  if (chordCache.has(key)) {
    return chordCache.get(key);
  }
  const result = Chord.detect(notes);
  chordCache.set(key, result);
  return result;
}

// 2. Lazy loading
// Tonal.js를 필요할 때만 import
if (typeof window !== 'undefined') {
  import('tonal').then(({ Chord }) => {
    // Use Chord here
  });
}
```

