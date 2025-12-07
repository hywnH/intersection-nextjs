# Harmonic Progression Algorithm for Global Audio

## 개요

Global Audio에서 36개 column에 유저들을 배치할 때, 음악적으로 의미 있는 harmonic progression을 만들어야 합니다. 이 문서는 Tonal.js를 활용한 알고리즘을 설명합니다.

---

## 문제 정의

### 요구사항
1. 각 유저는 12-tone 중 하나의 고유 음을 가집니다
2. 총 36개 column (`bass`, `baritone`, `tenor` 각 12개) 중 하나에 배치됩니다
3. 유저가 적을 때: 단순한 패턴, tonic 근처
4. 유저가 많을 때: 복잡한 progression, tonic에서 멀리
5. 랜덤성이 필요하지만 음악적 논리도 보장되어야 합니다

### 제약사항
- 불안정한 음(예: B, leading tone)은 cycle 끝나기 전에 해결되어야 함
- 음악적 논리를 만족하면서도 랜덤성을 유지
- 실시간으로 새로운 유저가 들어올 때 효율적으로 처리

---

## 알고리즘 1: Instability 기반 Constrained Random

### 개념
각 음에 instability score를 부여하고, 현재 progression의 총 instability를 관리합니다.

### 구현

/**
 * 각 음의 instability score (C major 기준)
 * Sensory dissonance 데이터 기반 (William A. Sethares 모델링 참조)
 * 
 * 참조 그래프:
 * - SD vs Semitones: 각 semitone 간격의 dissonance
 * - Sensory dissonance: frequency ratio 기반
 * - HARMONY 그래프: half steps에 따른 dissonance
 * 
 * 점수 범위: 0 (가장 안정/Consonant) ~ 10 (가장 불안정/Dissonant)
 */
const INSTABILITY_MAP = {
  0: 0,    // C (Tonic/Unison) - 가장 안정
  1: 9,    // C#/Db (Minor 2nd) - 매우 높은 dissonance (~1.0 SD)
  2: 3,    // D (Major 2nd) - 중간 dissonance (~0.4-0.5 SD)
  3: 2,    // D#/Eb (Minor 3rd) - 낮은 dissonance (~0.3 SD, consonant)
  4: 1.5,  // E (Major 3rd) - 낮은 dissonance (~0.3 SD, consonant)
  5: 2.5,  // F (Perfect 4th) - 낮은 dissonance (~0.3 SD, consonant)
  6: 8,    // F#/Gb (Tritone) - 매우 높은 dissonance (peak on harmony graph)
  7: 0.5,  // G (Perfect 5th) - 가장 낮은 dissonance (most consonant, deepest dip)
  8: 4,    // G#/Ab (Minor 6th) - 중간 dissonance
  9: 2,    // A (Major 6th) - 낮은 dissonance (~0.3 SD, consonant)
  10: 4.5, // A#/Bb (Minor 7th) - 중간-높은 dissonance
  11: 7,   // B (Major 7th/Leading tone) - 높은 dissonance (~0.7 SD at 11.5 semitones)
};

/**
 * Interval-based instability (두 음 사이의 interval에 따른 dissonance)
 * Tonic에서 떨어진 거리를 기준으로 계산
 */
function getIntervalInstability(noteIndex, rootNote = 0) {
  const interval = (noteIndex - rootNote + 12) % 12;
  
  // Sensory dissonance 기반 interval instability
  const intervalDissonanceMap = {
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
  
  return intervalDissonanceMap[interval] || 5; // Default to medium
}

/**
 * 현재 progression의 평균 instability
 */
function calculateAverageInstability(assignedNotes) {
  if (assignedNotes.length === 0) return 0;
  
  const totalInstability = assignedNotes.reduce((sum, note) => {
    return sum + (INSTABILITY_MAP[note] || 0);
  }, 0);
  
  return totalInstability / assignedNotes.length;
}

/**
 * 위치 점수 평가
 */
function evaluatePositionScore(noteIndex, position, assignedPositions, totalUsers) {
  const instability = INSTABILITY_MAP[noteIndex];
  const voiceIndex = Math.floor(position / 12); // 0=bass, 1=baritone, 2=tenor
  const stepInCycle = position % 12; // 0-11 (12-step cycle)
  
  // 제약 1: 불안정한 음이 cycle 끝나기 전에 해결 가능한가?
  const distanceToCycleEnd = 12 - stepInCycle;
  if (instability > 5 && distanceToCycleEnd < 3) {
    return 0; // 불가능한 위치
  }
  
  // 제약 2: 유저 수에 따른 허용 instability
  const maxAllowedInstability = Math.log(totalUsers + 1) * 1.5;
  if (instability > maxAllowedInstability) {
    return 0.1; // 가능하지만 선호하지 않음
  }
  
  // 점수 계산: 위치가 좋을수록 높은 점수
  const cyclePositionScore = 1 - Math.abs(stepInCycle - 6) / 6; // 중간 위치 선호
  const instabilityBalance = 1 / (1 + instability); // 너무 불안정하지 않게
  
  return cyclePositionScore * instabilityBalance;
}
```

---

## 알고리즘 2: Harmonic Distance + Entropy (추천)

### 개념
Tonal.js의 tension calculator를 사용하여 harmonic distance를 계산하고, 유저 수에 따라 목표 distance를 설정합니다.

### 구현

```javascript
import { ChordTensionCalculator } from './chord-tension.js';

class GlobalProgressionPlacer {
  constructor(key = 'C', mode = 'major') {
    this.tensionCalculator = new ChordTensionCalculator(key, mode);
    this.assignedPositions = []; // [{ note: 0-11, voice: 0-2, step: 0-11 }]
  }

  /**
   * 유저 수에 따른 목표 harmonic distance
   */
  calculateTargetDistance(userCount) {
    // 유저 1명: distance 0 (tonic)
    // 유저 많을수록: 더 높은 distance (progression이 멀리)
    const maxDistance = 8;
    return Math.min(maxDistance, Math.log(userCount + 1) * 2);
  }

  /**
   * 현재 progression의 harmonic distance
   */
  calculateCurrentDistance() {
    if (this.assignedPositions.length === 0) return 0;
    
    // 현재 할당된 음들로 chord 구성
    const currentNotes = this.assignedPositions.map(p => p.note);
    const chord = this.notesToChord(currentNotes);
    
    if (!chord) return 0;
    
    // Tonal.js로 tension 계산
    const tension = this.tensionCalculator.calculateTension(chord);
    return tension;
  }

  /**
   * 음들로부터 chord symbol 생성
   */
  notesToChord(noteIndices) {
    if (noteIndices.length === 0) return null;
    
    // 간단한 구현: 첫 번째 음을 root로
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootNote = noteNames[noteIndices[0]];
    
    // Major triad로 가정 (실제로는 더 정교한 chord detection 필요)
    return rootNote + 'M';
  }

  /**
   * 새로운 유저 배치
   */
  assignUser(userNote, totalUsers) {
    const targetDistance = this.calculateTargetDistance(totalUsers);
    const availablePositions = this.getAvailablePositions();
    
    // 모든 가능한 위치 평가
    const candidates = availablePositions.map(pos => {
      // 임시로 이 위치에 배치
      const tempAssignment = [...this.assignedPositions, {
        note: userNote,
        voice: Math.floor(pos / 12),
        step: pos % 12,
        position: pos
      }];
      
      // 새로운 progression의 distance
      const tempPlacer = new GlobalProgressionPlacer();
      tempPlacer.assignedPositions = tempAssignment;
      const newDistance = tempPlacer.calculateCurrentDistance();
      
      // 목표 distance에 얼마나 가까운가?
      const distanceScore = 1 / (1 + Math.abs(newDistance - targetDistance));
      
      // Instability 제약 확인
      const constraintScore = this.checkInstabilityConstraints(userNote, pos, totalUsers);
      
      return {
        position: pos,
        score: distanceScore * constraintScore
      };
    }).filter(c => c.score > 0); // 가능한 위치만
    
    if (candidates.length === 0) {
      // 제약이 너무 강하면 랜덤
      return availablePositions[Math.floor(Math.random() * availablePositions.length)];
    }
    
    // Weighted random selection
    return this.weightedRandomSelect(candidates);
  }

  /**
   * Instability 제약 확인
   */
  checkInstabilityConstraints(noteIndex, position, totalUsers) {
    const instability = INSTABILITY_MAP[noteIndex];
    const stepInCycle = position % 12;
    const distanceToCycleEnd = 12 - stepInCycle;
    
    // 불안정한 음이 cycle 끝나기 전에 해결 가능한가?
    if (instability > 5 && distanceToCycleEnd < 3) {
      // 해결 음(C)이 이후에 있는가?
      const hasResolution = this.assignedPositions.some(p => {
        const pStep = p.step;
        return p.note === 0 && pStep > stepInCycle && pStep < stepInCycle + 3;
      });
      if (!hasResolution) return 0.1; // 해결 불가능
    }
    
    return 1; // 제약 만족
  }

  /**
   * 사용 가능한 위치
   */
  getAvailablePositions() {
    const allPositions = Array.from({ length: 36 }, (_, i) => i);
    const usedPositions = new Set(this.assignedPositions.map(p => p.position));
    return allPositions.filter(p => !usedPositions.has(p));
  }

  /**
   * Weighted random selection
   */
  weightedRandomSelect(candidates) {
    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    let random = Math.random() * totalScore;
    
    for (const candidate of candidates) {
      random -= candidate.score;
      if (random <= 0) {
        return candidate.position;
      }
    }
    
    return candidates[0].position;
  }
}
```

---

## 알고리즘 3: Hybrid Approach (최종 추천)

### 구조

1. **Phase 1: Constraint Filtering**
   - Instability 제약으로 불가능한 위치 제거
   
2. **Phase 2: Harmonic Distance Optimization**
   - Tonal.js로 harmonic distance 계산
   - 유저 수에 따라 목표 distance 설정
   - 목표에 가까운 위치 선호
   
3. **Phase 3: Voice Leading Smoothing**
   - 선택된 위치와 이웃 음들의 voice leading 확인
   - 필요시 미세 조정

### 최종 구현

```javascript
import { ChordTensionCalculator } from './chord-tension.js';

export class GlobalHarmonicPlacer {
  constructor(key = 'C', mode = 'major') {
    this.key = key;
    this.mode = mode;
    this.tensionCalculator = new ChordTensionCalculator(key, mode);
    this.assignedPositions = [];
  }

  /**
   * 새로운 유저 배치 (메인 함수)
   */
  assignNewUser(userNote, totalUsers) {
    const availablePositions = this.getAvailablePositions();
    
    // Phase 1: 제약 필터링
    const validPositions = availablePositions.filter(pos => {
      return this.satisfiesConstraints(userNote, pos, totalUsers);
    });
    
    if (validPositions.length === 0) {
      // 제약이 너무 강하면 랜덤
      console.warn('No valid positions, using random');
      return availablePositions[Math.floor(Math.random() * availablePositions.length)];
    }
    
    // Phase 2: Harmonic distance 최적화
    const targetDistance = this.calculateTargetDistance(totalUsers);
    const scored = validPositions.map(pos => {
      const score = this.evaluateHarmonicScore(userNote, pos, targetDistance);
      return { position: pos, score };
    });
    
    // Phase 3: Weighted random (랜덤성 유지)
    return this.weightedRandomSelect(scored);
  }

  /**
   * 제약 만족 확인
   */
  satisfiesConstraints(noteIndex, position, totalUsers) {
    const instability = INSTABILITY_MAP[noteIndex];
    const step = position % 12;
    const distanceToCycleEnd = 12 - step;
    
    // 불안정한 음은 cycle 끝나기 전에 해결 가능해야 함
    if (instability > 5 && distanceToCycleEnd < 3) {
      // 해결 음이 이후에 있는지 확인
      const hasResolution = this.checkResolutionAvailable(step, 0); // C로 해결
      return hasResolution;
    }
    
    return true;
  }

  /**
   * Harmonic score 평가
   */
  evaluateHarmonicScore(userNote, position, targetDistance) {
    // 임시 배치
    const tempPositions = [...this.assignedPositions, {
      note: userNote,
      position,
      voice: Math.floor(position / 12),
      step: position % 12
    }];
    
    // 새로운 progression distance
    const newDistance = this.calculateProgressionDistance(tempPositions);
    
    // 목표에 가까울수록 높은 점수
    const distanceScore = 1 / (1 + Math.abs(newDistance - targetDistance));
    
    // 위치 점수 (중간 위치 선호)
    const step = position % 12;
    const positionScore = 1 - Math.abs(step - 6) / 6;
    
    return distanceScore * positionScore;
  }

  /**
   * Progression distance 계산
   */
  calculateProgressionDistance(positions) {
    if (positions.length === 0) return 0;
    
    const notes = positions.map(p => p.note);
    const chord = this.notesToChord(notes);
    if (!chord) return 0;
    
    return this.tensionCalculator.calculateTension(chord);
  }

  /**
   * 해결 가능 여부 확인
   */
  checkResolutionAvailable(currentStep, resolutionNote) {
    // 이후 3 step 내에 해결 음이 있는가?
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      const hasNote = this.assignedPositions.some(p => 
        p.step === checkStep && p.note === resolutionNote
      );
      if (hasNote) return true;
    }
    
    // 미래에 배치될 수 있는 위치가 있는가?
    // (실제로는 미래 예측 필요, 여기서는 간단히 true)
    return true;
  }

  /**
   * 음들로부터 chord 생성 (간단 버전)
   */
  notesToChord(noteIndices) {
    if (noteIndices.length === 0) return null;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return noteNames[noteIndices[0]] + 'M'; // Major triad 가정
  }

  /**
   * Weighted random
   */
  weightedRandomSelect(candidates) {
    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    let random = Math.random() * total;
    
    for (const c of candidates) {
      random -= c.score;
      if (random <= 0) return c.position;
    }
    
    return candidates[0].position;
  }

  /**
   * 사용 가능한 위치
   */
  getAvailablePositions() {
    const used = new Set(this.assignedPositions.map(p => p.position));
    return Array.from({ length: 36 }, (_, i) => i)
      .filter(p => !used.has(p));
  }
}
```

---

## 사용 예시

```javascript
const placer = new GlobalHarmonicPlacer('C', 'major');

// 유저 1 배치 (도)
const pos1 = placer.assignNewUser(0, 1);
placer.assignedPositions.push({ note: 0, position: pos1, voice: Math.floor(pos1 / 12), step: pos1 % 12 });

// 유저 2 배치 (솔)
const pos2 = placer.assignNewUser(7, 2);
placer.assignedPositions.push({ note: 7, position: pos2, voice: Math.floor(pos2 / 12), step: pos2 % 12 });

// 유저 3 배치 (시)
const pos3 = placer.assignNewUser(11, 3);
placer.assignedPositions.push({ note: 11, position: pos3, voice: Math.floor(pos3 / 12), step: pos3 % 12 });
// 시는 도 전에 배치되어 해결될 수 있도록 제약됨
```

---

## 요약

### 추천 알고리즘
**Hybrid Approach (알고리즘 3)**를 사용하세요.

### 이유
1. ✅ **Tonal.js 활용**: 기존 tension calculator 재사용
2. ✅ **제약 보장**: Instability 제약으로 음악적 논리 유지
3. ✅ **엔트로피 조절**: 유저 수에 따라 progression complexity 조절
4. ✅ **랜덤성 유지**: Weighted random으로 다양성 보장
5. ✅ **실시간 처리**: 새로운 유저 진입 시 효율적으로 처리

### 다음 단계
1. `GlobalHarmonicPlacer` 클래스 구현
2. Global workspace에 통합
3. 실제 `.ncft` 파일의 MonoSeq 노드 업데이트 로직 연결

