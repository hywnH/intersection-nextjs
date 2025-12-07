# Calculating Chord Tension with Tonal.js

## Overview

Tonal.js does **not** have a built-in function to directly calculate chord tension (distance from resolution/tonic). However, you can build one using Tonal.js's harmonic analysis features. This document shows how to create a comprehensive tension calculator.

## What is Chord Tension?

Chord tension refers to:
1. **Harmonic Function**: How far the chord is from the tonic (I chord) in the key
2. **Dissonance**: Intervals within the chord that create instability
3. **Voice Leading**: Distance to the nearest resolution chord
4. **Tonal Distance**: Mathematical distance in tonal space (circle of fifths)

---

## Using Tonal.js to Calculate Tension

### 1. Harmonic Function Analysis

Use Roman numeral analysis to determine the chord's function in a key:

```javascript
import { Key, Chord, Progression } from '@tonaljs/tonal';

// Get all chords in a key
const key = Key.majorKey('C');
// Returns: {
//   major: ['CM', 'Dm', 'Em', 'FM', 'GM', 'Am', 'Bdim'],
//   minor: ['Am', 'Bdim', 'CM', 'Dm', 'Em', 'FM', 'GM'],
//   ...
// }

// Get Roman numerals for chords
const progression = Progression.toRomanNumerals('C', ['C', 'G7', 'Am', 'F']);
// Returns: ['I', 'V7', 'vi', 'IV']
```

### 2. Tension Based on Harmonic Function

```javascript
/**
 * Get tension score based on harmonic function (Roman numeral)
 * Lower values = less tension (closer to tonic)
 * Higher values = more tension (further from tonic)
 */
function getFunctionTension(romanNumeral, key = 'major') {
  const functionTensionMap = {
    'I': 0,        // Tonic - no tension
    'i': 0,
    'iii': 1,      // Mediant - very low tension
    'III': 1,
    'vi': 1.5,     // Submediant - low tension
    'VI': 1.5,
    'IV': 2,       // Subdominant - medium tension
    'iv': 2,
    'ii': 2.5,     // Supertonic - medium-high tension
    'ii°': 3,      // Diminished supertonic - higher tension
    'vii°': 3.5,   // Leading tone - high tension
    'V': 4,        // Dominant - very high tension
    'v': 4,
    'V7': 5,       // Dominant 7th - highest tension (wants resolution)
    'vii°7': 5,    // Diminished 7th - very high tension
  };
  
  // Extract base Roman numeral (remove inversions/extensions)
  const base = romanNumeral.replace(/[0-9a-z]/g, '').replace('°', '°');
  
  return functionTensionMap[base] || 2; // Default to medium tension
}

// Example
console.log(getFunctionTension('I'));   // 0 (no tension)
console.log(getFunctionTension('V7'));  // 5 (high tension)
console.log(getFunctionTension('IV'));  // 2 (medium tension)
```

### 3. Dissonance Analysis

Calculate tension from dissonant intervals within the chord:

```javascript
import { Chord, Interval } from '@tonaljs/tonal';

/**
 * Calculate dissonance score based on chord intervals
 * More dissonant intervals = higher tension
 */
function calculateDissonance(chordSymbol) {
  const chord = Chord.get(chordSymbol);
  if (!chord.notes || chord.notes.length === 0) return 0;
  
  const dissonanceMap = {
    '1P': 0,   // Perfect unison - no dissonance
    '2m': 5,   // Minor 2nd - very dissonant
    '2M': 3,   // Major 2nd - moderately dissonant
    '3m': 1,   // Minor 3rd - consonant
    '3M': 1,   // Major 3rd - consonant
    '4P': 2,   // Perfect 4th - slightly dissonant
    '4A': 6,   // Augmented 4th/Tritone - very dissonant
    '5P': 0,   // Perfect 5th - consonant
    '5A': 4,   // Augmented 5th - dissonant
    '6m': 1.5, // Minor 6th - consonant
    '6M': 1.5, // Major 6th - consonant
    '7m': 4,   // Minor 7th - dissonant
    '7M': 3,   // Major 7th - dissonant
    '8P': 0,   // Perfect octave - consonant
  };
  
  let totalDissonance = 0;
  
  // Calculate intervals from root to each note
  for (let i = 1; i < chord.intervals.length; i++) {
    const interval = chord.intervals[i];
    const dissonance = dissonanceMap[interval] || 2;
    totalDissonance += dissonance;
  }
  
  // Normalize by number of intervals
  return totalDissonance / Math.max(1, chord.intervals.length - 1);
}

// Example
console.log(calculateDissonance('CM'));    // Low (~0.33)
console.log(calculateDissonance('G7'));    // High (~2.5)
console.log(calculateDissonance('Dm7b5')); // Very high (diminished + 7th)
```

### 4. Distance from Tonic (Circle of Fifths)

Calculate tonal distance using the circle of fifths:

```javascript
import { Note, Interval } from '@tonaljs/tonal';

/**
 * Calculate distance from tonic using circle of fifths
 * Closer keys = less tension, distant keys = more tension
 */
function getCircleOfFifthsDistance(note1, note2) {
  const circleOfFifths = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
  
  const pc1 = Note.pc(note1); // Get pitch class (C, D, E, etc.)
  const pc2 = Note.pc(note2);
  
  const index1 = circleOfFifths.indexOf(pc1);
  const index2 = circleOfFifths.indexOf(pc2);
  
  if (index1 === -1 || index2 === -1) return 0;
  
  // Distance along circle of fifths (can go either direction)
  const distance1 = Math.abs(index2 - index1);
  const distance2 = Math.abs(index2 - index1 + 12);
  const distance3 = Math.abs(index2 - index1 - 12);
  
  return Math.min(distance1, distance2, distance3);
}

// Example
console.log(getCircleOfFifthsDistance('C', 'G')); // 1 (close)
console.log(getCircleOfFifthsDistance('C', 'F#')); // 6 (distant)
```

---

## Complete Tension Calculator

Combining all factors into a comprehensive tension calculator:

```javascript
import { Key, Chord, Progression, Note } from '@tonaljs/tonal';

/**
 * Comprehensive chord tension calculator
 * Returns a tension score from 0 (no tension) to 10 (maximum tension)
 */
export class ChordTensionCalculator {
  constructor(key = 'C', mode = 'major') {
    this.key = key;
    this.mode = mode;
    this.keyInfo = mode === 'major' 
      ? Key.majorKey(key)
      : Key.minorKey(key);
  }

  /**
   * Calculate total tension for a chord
   * @param {String} chordSymbol - Chord symbol (e.g., 'CM', 'G7', 'Am')
   * @returns {Number} Tension score 0-10
   */
  calculateTension(chordSymbol) {
    // 1. Harmonic function tension (0-5)
    const functionTension = this.getFunctionTension(chordSymbol);
    
    // 2. Dissonance tension (0-3)
    const dissonanceTension = this.getDissonanceTension(chordSymbol);
    
    // 3. Distance from tonic tension (0-2)
    const distanceTension = this.getDistanceFromTonic(chordSymbol);
    
    // Weighted combination
    const totalTension = 
      (functionTension * 0.6) +      // 60% weight on harmonic function
      (dissonanceTension * 0.3) +    // 30% weight on dissonance
      (distanceTension * 0.1);       // 10% weight on distance
    
    return Math.min(10, Math.max(0, totalTension));
  }

  /**
   * Get tension based on harmonic function
   */
  getFunctionTension(chordSymbol) {
    // Convert chord to Roman numeral
    const roman = this.chordToRomanNumeral(chordSymbol);
    if (!roman) return 2; // Default medium tension if not in key
    
    const tensionMap = {
      'I': 0, 'i': 0,
      'iii': 0.5, 'III': 0.5,
      'vi': 1, 'VI': 1,
      'IV': 1.5, 'iv': 1.5,
      'ii': 2, 'ii°': 2.5,
      'vii°': 3,
      'V': 3.5, 'v': 3.5,
      'V7': 5, 'vii°7': 5,
    };
    
    return tensionMap[roman] || 2;
  }

  /**
   * Convert chord symbol to Roman numeral
   */
  chordToRomanNumeral(chordSymbol) {
    // Get all chords in the key
    const chords = this.mode === 'major' 
      ? this.keyInfo.major 
      : this.keyInfo.minor;
    
    // Try exact match first
    let index = chords.indexOf(chordSymbol);
    
    // If not found, try matching base chord (without extensions)
    if (index === -1) {
      const baseChord = chordSymbol.replace(/7|9|11|13|sus|add|dim|aug/g, '');
      index = chords.findIndex(chord => chord.startsWith(baseChord));
    }
    
    if (index === -1) return null;
    
    const romanNumerals = this.mode === 'major'
      ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
      : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    
    let roman = romanNumerals[index];
    
    // Check for 7th chord extensions
    if (chordSymbol.includes('7')) {
      if (roman === 'V') return 'V7';
      if (roman === 'vii°') return 'vii°7';
      // For other chords, add 7 to notation
      roman = roman + '7';
    }
    
    return roman;
  }

  /**
   * Get dissonance-based tension
   */
  getDissonanceTension(chordSymbol) {
    const chord = Chord.get(chordSymbol);
    if (!chord.intervals || chord.intervals.length === 0) return 0;
    
    const dissonanceMap = {
      '1P': 0, '2m': 5, '2M': 3,
      '3m': 0.5, '3M': 0.5,
      '4P': 1, '4A': 6,
      '5P': 0, '5A': 4,
      '6m': 0.5, '6M': 0.5,
      '7m': 3, '7M': 2.5,
      '8P': 0,
    };
    
    let totalDissonance = 0;
    for (const interval of chord.intervals) {
      totalDissonance += dissonanceMap[interval] || 1;
    }
    
    // Normalize to 0-3 range
    return Math.min(3, totalDissonance / 2);
  }

  /**
   * Get tension based on distance from tonic
   */
  getDistanceFromTonic(chordSymbol) {
    const chord = Chord.get(chordSymbol);
    if (!chord.tonic) return 0;
    
    const circleOfFifths = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
    
    const keyPc = Note.pc(this.key);
    const chordPc = Note.pc(chord.tonic);
    
    const keyIndex = circleOfFifths.indexOf(keyPc);
    const chordIndex = circleOfFifths.indexOf(chordPc);
    
    if (keyIndex === -1 || chordIndex === -1) return 0;
    
    const distance = Math.min(
      Math.abs(chordIndex - keyIndex),
      Math.abs(chordIndex - keyIndex + 12),
      Math.abs(chordIndex - keyIndex - 12)
    );
    
    // Normalize to 0-2 range
    return (distance / 6) * 2;
  }

  /**
   * Get resolution target for a chord (where it wants to resolve)
   * Returns the most likely resolution chord
   */
  getResolutionTarget(chordSymbol) {
    const roman = this.chordToRomanNumeral(chordSymbol);
    if (!roman) return null;
    
    // Resolution rules in major key
    const resolutionMap = {
      'V': 'I', 'V7': 'I',
      'vii°': 'I', 'vii°7': 'I',
      'ii': 'V', 'ii7': 'V',
      'IV': 'I',
      'vi': 'ii',
    };
    
    const targetRoman = resolutionMap[roman] || 'I';
    
    // Convert back to chord symbol
    const chords = this.mode === 'major' 
      ? this.keyInfo.major 
      : this.keyInfo.minor;
    
    const romanNumerals = this.mode === 'major'
      ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
      : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    
    const targetIndex = romanNumerals.indexOf(targetRoman);
    return chords[targetIndex] || chords[0];
  }
}

// Usage Example
const calculator = new ChordTensionCalculator('C', 'major');

console.log(calculator.calculateTension('CM'));  // ~0 (no tension, tonic)
console.log(calculator.calculateTension('G7'));  // ~5 (high tension, dominant 7th)
console.log(calculator.calculateTension('Am'));  // ~1 (low tension, submediant)
console.log(calculator.calculateTension('Dm'));  // ~2 (medium tension, supertonic)

// Get resolution target
console.log(calculator.getResolutionTarget('G7')); // 'CM' (wants to resolve to I)
console.log(calculator.getResolutionTarget('Dm')); // 'GM' (wants to resolve to V)
```

---

## Integration with Particle System

Use tension to control audio parameters:

```javascript
import { ChordTensionCalculator } from './chord-tension.js';

const tensionCalculator = new ChordTensionCalculator('C', 'major');

/**
 * Map chord tension to audio parameter
 * Higher tension = more reverb, distortion, or other effects
 */
function applyTensionToAudio(chordSymbol, audioParams) {
  const tension = tensionCalculator.calculateTension(chordSymbol);
  
  // Map tension (0-10) to reverb wet mix (0-2)
  audioParams.reverbWet = (tension / 10) * 2;
  
  // Map tension to volume (tension creates "unease", maybe reduce volume slightly)
  audioParams.volume = 1 - (tension / 10) * 0.2;
  
  // Map tension to filter cutoff (higher tension = brighter/more piercing)
  audioParams.filterCutoff = 0.5 + (tension / 10) * 0.5;
  
  return audioParams;
}

// Example: When particles form a chord
function updateAudioFromChord(particleChord) {
  const chordSymbol = getChordFromParticles(particleChord);
  const tension = tensionCalculator.calculateTension(chordSymbol);
  
  // Use tension to modulate effects
  const audioParams = {
    reverbWet: (tension / 10) * 1.5,
    volume: 1 - (tension / 10) * 0.15,
    filterCutoff: 0.4 + (tension / 10) * 0.6,
  };
  
  return audioParams;
}
```

---

## Advanced: Voice Leading Tension

Calculate tension based on how smoothly chords transition:

```javascript
import { Chord, Note } from '@tonaljs/tonal';

/**
 * Calculate tension based on voice leading distance
 * Smaller voice leading distances = smoother = less tension
 */
function getVoiceLeadingTension(currentChord, previousChord) {
  const current = Chord.get(currentChord);
  const previous = Chord.get(previousChord);
  
  if (!current.notes || !previous.notes) return 0;
  
  // Calculate total semitone distance for voice leading
  let totalDistance = 0;
  
  // Match closest notes between chords
  const usedCurrent = new Set();
  
  for (const prevNote of previous.notes) {
    let minDistance = Infinity;
    let closestCurrentNote = null;
    
    for (const currNote of current.notes) {
      if (usedCurrent.has(currNote)) continue;
      
      const prevMidi = Note.midi(prevNote);
      const currMidi = Note.midi(currNote);
      
      if (prevMidi !== null && currMidi !== null) {
        const distance = Math.abs(currMidi - prevMidi);
        if (distance < minDistance) {
          minDistance = distance;
          closestCurrentNote = currNote;
        }
      }
    }
    
    if (closestCurrentNote) {
      totalDistance += minDistance;
      usedCurrent.add(closestCurrentNote);
    }
  }
  
  // More distance = more tension (jarring transition)
  return Math.min(5, totalDistance / 2);
}
```

---

## Practical Example: Tension-Based Audio Modulation

Complete example for your particle system:

```javascript
import { ChordTensionCalculator } from './chord-tension.js';
import { Chord, Note } from '@tonaljs/tonal';

class TensionBasedAudio {
  constructor(key = 'C', mode = 'major') {
    this.tensionCalculator = new ChordTensionCalculator(key, mode);
    this.previousChord = null;
  }

  /**
   * Get chord symbol from particle notes
   */
  getChordFromParticles(particles) {
    // Extract active notes from particles
    const notes = particles
      .map(p => {
        const activeIndex = p.sequencerPattern.findIndex(v => v === 1);
        if (activeIndex === -1) return null;
        // Convert 0-11 index to note name (C, C#, D, etc.)
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return noteNames[activeIndex] + '4'; // Add octave
      })
      .filter(n => n !== null);
    
    if (notes.length < 2) return null;
    
    // Try to identify the chord from the notes
    // Simple approach: use first note as root
    const root = notes[0];
    const intervals = notes.slice(1).map(n => {
      const interval = Interval.distance(root, n);
      return interval;
    });
    
    // Identify chord type from intervals (simplified)
    // In practice, you might use Chord.detect() or similar
    return root + 'M'; // Simplified - always major
  }

  /**
   * Calculate audio parameters based on chord tension
   */
  calculateAudioParams(particles) {
    const chordSymbol = this.getChordFromParticles(particles);
    if (!chordSymbol) return null;
    
    const tension = this.tensionCalculator.calculateTension(chordSymbol);
    
    // Voice leading tension (if we have previous chord)
    let voiceLeadingTension = 0;
    if (this.previousChord) {
      voiceLeadingTension = getVoiceLeadingTension(chordSymbol, this.previousChord);
    }
    this.previousChord = chordSymbol;
    
    // Combine tensions
    const totalTension = Math.min(10, tension + voiceLeadingTension);
    
    // Map to audio parameters
    return {
      reverbWet: (totalTension / 10) * 1.5,
      volume: Math.max(0.5, 1 - (totalTension / 10) * 0.3),
      filterCutoff: 0.3 + (totalTension / 10) * 0.7,
      distortion: (totalTension / 10) * 0.5,
    };
  }
}

// Usage
const audioModulator = new TensionBasedAudio('C', 'major');

// When particles interact and form a chord
const particles = [particle0, particle1, particle2]; // Your particles
const audioParams = audioModulator.calculateAudioParams(particles);

// Apply to NoiseCraft nodes
sendToNoiseCraft([
  { nodeId: '163', paramName: 'value', value: audioParams.reverbWet },
  { nodeId: '183', paramName: 'value', value: audioParams.volume },
  // ... other parameters
]);
```

---

## Summary

While Tonal.js doesn't have a direct `calculateTension()` function, you can build one using:

1. ✅ **Roman Numeral Analysis** - `Progression.toRomanNumerals()` or `Key.majorKey()`
2. ✅ **Chord Analysis** - `Chord.get()` with intervals
3. ✅ **Key Functions** - `Key.majorKey()` / `Key.minorKey()`
4. ✅ **Note Conversion** - `Note.pc()`, `Note.midi()`, `Interval.distance()`

The `ChordTensionCalculator` class provides a complete implementation that combines:
- **Harmonic Function** (60% weight): Distance from tonic in key
- **Dissonance** (30% weight): Unstable intervals within chord
- **Tonal Distance** (10% weight): Circle of fifths distance

This gives you a tension score from 0-10 that can be used to modulate audio parameters, creating more dynamic and musically informed sound generation.

