/**
 * Harmonic Progression Generator (Optimized Real-time Adaptive)
 * Collects notes from active particles and generates natural harmonic progressions
 * Optimized with caching, throttling, and incremental updates for performance
 * 
 * Performance optimizations:
 * - Caching: Only recalculate when particle notes change
 * - Throttling: Limit updates to once per sequencer step
 * - Incremental: Only update changed steps
 * - Lazy evaluation: Calculate on demand
 * 
 * Chord quality evaluation:
 * - Evaluates entire chord set (not just first note interval)
 * - Uses chord stability priority: Perfect 5th > 3rd > 4th/6th
 * - Considers all existing notes when adding new ones
 */

import { INSTABILITY_MAP } from './harmonic-placer.js';

// Tonal.js lazy loading (loaded on demand)
let tonalModule = null;
let Chord, Note, Interval, Progression;

/**
 * Load Tonal.js module (lazy loading)
 * @returns {Promise} Resolves when Tonal.js is loaded
 */
async function loadTonal() {
  if (tonalModule) return tonalModule;
  
  try {
    // Try ES6 module import
    tonalModule = await import('tonal');
    Chord = tonalModule.Chord || tonalModule.default?.Chord;
    Note = tonalModule.Note || tonalModule.default?.Note;
    Interval = tonalModule.Interval || tonalModule.default?.Interval;
    Progression = tonalModule.Progression || tonalModule.default?.Progression;
    return tonalModule;
  } catch (e) {
    // Fallback: try global Tonal (if loaded via script tag)
    if (typeof window !== 'undefined' && window.Tonal) {
      Chord = window.Tonal.Chord;
      Note = window.Tonal.Note;
      Interval = window.Tonal.Interval;
      Progression = window.Tonal.Progression;
      tonalModule = window.Tonal;
      return tonalModule;
    }
    console.warn('[HarmonicProgression] Tonal.js not available, using fallback logic');
    return null;
  }
}

/**
 * Convert note index (0-11) to note name (C, C#, D, etc.)
 * @param {Number} noteIndex - Note index (0-11)
 * @returns {String} Note name
 */
function noteIndexToName(noteIndex) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return noteNames[noteIndex % 12];
}

/**
 * Analyze chord from same step notes in 3-octave range
 * Bass-Baritone-Tenor are connected: bass highest = baritone lowest, baritone highest = tenor lowest
 * @param {Number} bassNote - Bass note (0-11)
 * @param {Number} baritoneNote - Baritone note (0-11)
 * @param {Number} tenorNote - Tenor note (0-11)
 * @param {Number} rootNote - Root note (0-11) for relative analysis, or null for absolute
 * @returns {Object} { quality: 0-1, chordType: string, stability: number, chordName: string, pitches: Array }
 */
async function analyzeStepChord(bassNote, baritoneNote, tenorNote, rootNote = null) {
  // Convert to 3-octave range:
  // Bass: note (0-11) -> actual pitch: note
  // Baritone: note (0-11) -> actual pitch: note + 12
  // Tenor: note (0-11) -> actual pitch: note + 24
  const bassPitch = bassNote;
  const baritonePitch = baritoneNote + 12;
  const tenorPitch = tenorNote + 24;
  
  // Collect all pitches and sort
  const pitches = [bassPitch, baritonePitch, tenorPitch].filter(p => p !== null && p !== undefined).sort((a, b) => a - b);
  
  // Convert to pitch classes (0-11) for chord analysis
  const pitchClasses = pitches.map(p => p % 12);
  const uniquePitchClasses = [...new Set(pitchClasses)];
  
  // If root note is provided, analyze relative to root
  if (rootNote !== null && rootNote !== undefined) {
    // Calculate intervals relative to root
    const intervals = uniquePitchClasses.map(pc => (pc - rootNote + 12) % 12).sort((a, b) => a - b);
    return await evaluateChordQualityFromIntervals(intervals, rootNote);
  }
  
  // Absolute analysis: use lowest pitch as root
  return await evaluateChordQuality(uniquePitchClasses);
}

/**
 * Evaluate chord quality from intervals relative to root
 * @param {Array} intervals - Array of intervals from root (0-11)
 * @param {Number} rootNote - Root note (0-11)
 * @returns {Object} { quality: 0-1, chordType: string, stability: number, chordName: string }
 */
async function evaluateChordQualityFromIntervals(intervals, rootNote) {
  if (!intervals || intervals.length === 0) {
    return { quality: 0, chordType: 'none', stability: 0, chordName: null };
  }
  
  // Common chord intervals (relative to root)
  const chordTypes = {
    'maj': [0, 4, 7],           // Major: root, major 3rd, perfect 5th
    'min': [0, 3, 7],           // Minor: root, minor 3rd, perfect 5th
    'maj7': [0, 4, 7, 11],      // Major 7th
    'min7': [0, 3, 7, 10],      // Minor 7th
    'dom7': [0, 4, 7, 10],      // Dominant 7th
    'sus4': [0, 5, 7],          // Suspended 4th
    'sus2': [0, 2, 7],          // Suspended 2nd
    'dim': [0, 3, 6],           // Diminished
    'aug': [0, 4, 8]            // Augmented
  };
  
  // Check which chord type matches
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [chordType, chordIntervals] of Object.entries(chordTypes)) {
    const matches = chordIntervals.filter(ci => intervals.includes(ci)).length;
    const hasExtra = intervals.some(i => !chordIntervals.includes(i) && i !== 0);
    const matchRatio = matches / Math.max(chordIntervals.length, intervals.length);
    
    // Prefer exact matches, but allow partial matches
    if (matches === chordIntervals.length && !hasExtra) {
      // Perfect match
      if (matchRatio > bestScore) {
        bestScore = matchRatio;
        bestMatch = chordType;
      }
    } else if (matches >= 2 && matchRatio > bestScore * 0.7) {
      // Partial match (at least 2 intervals match)
      if (matchRatio > bestScore) {
        bestScore = matchRatio;
        bestMatch = chordType;
      }
    }
  }
  
  // Stability based on chord type
  const stabilityMap = {
    'maj': 1.0,
    'min': 0.95,
    'maj7': 0.9,
    'min7': 0.85,
    'dom7': 0.8,
    'sus4': 0.75,
    'sus2': 0.7,
    'dim': 0.5,
    'aug': 0.5
  };
  
  const stability = bestMatch ? stabilityMap[bestMatch] || 0.5 : 0.3;
  const quality = bestScore * stability;
  
  const rootName = noteIndexToName(rootNote);
  const chordName = bestMatch ? `${rootName}${bestMatch === 'maj' ? '' : bestMatch}` : null;
  
  return {
    quality,
    chordType: bestMatch || 'unknown',
    stability,
    chordName
  };
}

/**
 * Evaluate chord quality from a set of notes using Tonal.js
 * Considers ALL notes together, not just pairwise intervals
 * @param {Array} notes - Array of note indices (0-11)
 * @returns {Object} { quality: 0-1, chordType: string, stability: number, chordName: string }
 */
async function evaluateChordQuality(notes) {
  if (!notes || notes.length === 0) return { quality: 0, chordType: 'none', stability: 0, chordName: null };
  
  const uniqueNotes = [...new Set(notes)].sort((a, b) => a - b);
  if (uniqueNotes.length === 1) {
    return { 
      quality: 0.5, 
      chordType: 'single', 
      stability: 1 - (INSTABILITY_MAP[uniqueNotes[0]] || 0) / 10,
      chordName: noteIndexToName(uniqueNotes[0])
    };
  }
  
  // Try to load and use Tonal.js for accurate chord detection
  const tonal = await loadTonal();
  if (tonal && Chord && Note) {
    try {
      // Convert note indices to note names (using C4 octave as reference)
      const noteNames = uniqueNotes.map(n => noteIndexToName(n));
      
      // Detect chord using Tonal.js
      const detectedChords = Chord.detect(noteNames);
      
      if (detectedChords && detectedChords.length > 0) {
        const bestChord = detectedChords[0];
        const chordType = Chord.chordType(bestChord) || 'unknown';
        
        // Stability based on chord type (우리 우선순위 반영)
        const stabilityMap = {
          'major': 1.0,              // 가장 안정
          'minor': 0.95,             // 매우 안정
          'major seventh': 0.9,       // 안정
          'minor seventh': 0.85,      // 안정
          'dominant seventh': 0.7,    // 중간
          'suspended fourth': 0.8,     // 안정
          'suspended second': 0.75,   // 안정
          'diminished': 0.3,          // 불안정
          'augmented': 0.4,           // 불안정
        };
        
        // Get stability from map or calculate from intervals
        let stability = stabilityMap[chordType] || 0.5;
        
        // If we have intervals, verify stability priority (Perfect 5th > 3rd > 4th/6th)
        if (Interval) {
          const chordIntervals = Chord.intervals(bestChord) || [];
          const hasPerfect5th = chordIntervals.some(iv => Interval.semitones(iv) === 7);
          const has3rd = chordIntervals.some(iv => {
            const semitones = Interval.semitones(iv);
            return semitones === 3 || semitones === 4;
          });
          const has4thOr6th = chordIntervals.some(iv => {
            const semitones = Interval.semitones(iv);
            return semitones === 5 || semitones === 8 || semitones === 9;
          });
          
          // Adjust stability based on interval priority
          if (hasPerfect5th) stability = Math.max(stability, 1.0);
          else if (has3rd) stability = Math.max(stability, 0.9);
          else if (has4thOr6th) stability = Math.max(stability, 0.7);
        }
        
        return {
          quality: stability,
          chordType: chordType,
          stability: stability,
          chordName: bestChord
        };
      }
    } catch (e) {
      console.warn('[HarmonicProgression] Tonal.js chord detection failed, using fallback:', e);
    }
  }
  
  // Fallback: Manual chord detection (if Tonal.js not available)
  const intervals = [];
  for (let i = 0; i < uniqueNotes.length; i++) {
    for (let j = i + 1; j < uniqueNotes.length; j++) {
      const interval = (uniqueNotes[j] - uniqueNotes[i] + 12) % 12;
      intervals.push(interval);
    }
  }
  
  // Check for common chord types
  const chordPatterns = {
    'major': { intervals: [4, 7], priority: 1.0 },
    'minor': { intervals: [3, 7], priority: 0.95 },
    'major7': { intervals: [4, 7, 11], priority: 0.9 },
    'minor7': { intervals: [3, 7, 10], priority: 0.85 },
    'sus4': { intervals: [5, 7], priority: 0.8 },
    'sus2': { intervals: [2, 7], priority: 0.75 },
    'dim': { intervals: [3, 6], priority: 0.3 },
    'aug': { intervals: [4, 8], priority: 0.4 },
  };
  
  let bestMatch = { quality: 0, chordType: 'unknown', stability: 0, chordName: null };
  
  for (const [chordType, pattern] of Object.entries(chordPatterns)) {
    const requiredIntervals = pattern.intervals;
    const hasAllIntervals = requiredIntervals.every(req => intervals.includes(req));
    
    if (hasAllIntervals) {
      const stabilityScores = intervals.map(interval => {
        if (interval === 7) return 1.0; // Perfect 5th - most stable
        if (interval === 3 || interval === 4) return 0.9; // 3rds - very stable
        if (interval === 5 || interval === 8 || interval === 9) return 0.7; // 4th/6ths - stable
        return 0.3;
      });
      
      const avgStability = stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length;
      const quality = pattern.priority * avgStability;
      
      if (quality > bestMatch.quality) {
        bestMatch = { quality, chordType, stability: avgStability, chordName: null };
      }
    }
  }
  
  if (bestMatch.quality === 0) {
    const stabilityScores = intervals.map(interval => {
      if (interval === 7) return 1.0;
      if (interval === 3 || interval === 4) return 0.9;
      if (interval === 5 || interval === 8 || interval === 9) return 0.7;
      if (interval === 1 || interval === 6 || interval === 11) return 0.1;
      return 0.5;
    });
    
    const avgStability = stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length;
    bestMatch = { quality: avgStability * 0.6, chordType: 'partial', stability: avgStability, chordName: null };
  }
  
  return bestMatch;
}

/**
 * Common chord progressions in major key
 * Roman numerals: I, ii, iii, IV, V, vi, vii°
 */
const MAJOR_PROGRESSIONS = {
  // Common progressions (most natural)
  'I-V-vi-IV': [[0, 4, 7], [7, 11, 2], [9, 0, 4], [5, 9, 0]], // C-G-Am-F (most popular)
  'I-vi-IV-V': [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]], // C-Am-F-G
  'vi-IV-I-V': [[9, 0, 4], [5, 9, 0], [0, 4, 7], [7, 11, 2]], // Am-F-C-G
  'I-IV-V-I': [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]], // C-F-G-C (classic)
  'I-vi-ii-V': [[0, 4, 7], [9, 0, 4], [2, 5, 9], [7, 11, 2]], // C-Am-Dm-G
  'I-iii-vi-IV': [[0, 4, 7], [4, 7, 11], [9, 0, 4], [5, 9, 0]], // C-Em-Am-F
};

/**
 * Common chord progressions in minor key
 */
const MINOR_PROGRESSIONS = {
  'i-iv-V-i': [[0, 3, 7], [5, 8, 0], [7, 11, 2], [0, 3, 7]], // Am-Dm-G-Am
  'i-VI-V-i': [[0, 3, 7], [8, 0, 3], [7, 11, 2], [0, 3, 7]], // Am-F-G-Am
  'i-iv-i-V': [[0, 3, 7], [5, 8, 0], [0, 3, 7], [7, 11, 2]], // Am-Dm-Am-G
};

/**
 * Select best notes from available particles for harmonic progression
 * NOW EVALUATES ENTIRE CHORD SET, not just pairwise intervals
 * @param {Array} particleNotes - Array of note indices (0-11) from particles
 * @param {Array} targetChord - Target chord tones (array of note indices)
 * @param {Array} existingNotes - Already selected notes (for chord quality evaluation)
 * @param {Number} numNotes - Number of notes to select
 * @returns {Promise<Array>} Selected note indices
 */
async function selectBestNotes(particleNotes, targetChord, existingNotes = [], numNotes = 3) {
    if (!particleNotes || particleNotes.length === 0) {
      return targetChord.slice(0, numNotes); // Fallback to target chord
    }

    // Score each available note based on:
    // 1. Is it a chord tone? (highest priority)
    // 2. Stability (Perfect 5th > 3rd > 4th/6th)
    // 3. CHORD QUALITY: How well does it form a chord with existing notes?
    const scoredNotesPromises = particleNotes.map(async (note) => {
      const isChordTone = targetChord.includes(note);
      const instability = INSTABILITY_MAP[note] || 0;
      const stabilityScore = 1 - (instability / 10); // Lower instability = higher score
      
      // NEW: Evaluate chord quality with existing notes + this note
      const testChord = [...existingNotes, note];
      const chordQuality = await evaluateChordQuality(testChord);
      
      // Priority: chord tone > chord quality > stability
      let score = 0;
      if (isChordTone) {
        score = 200 + chordQuality.quality * 50 + stabilityScore * 10; // Chord tones get huge boost
      } else {
        score = chordQuality.quality * 50 + stabilityScore * 10; // Non-chord tones by quality + stability
      }
      
      return { 
        note, 
        score, 
        isChordTone, 
        stabilityScore,
        chordQuality: chordQuality.quality,
        chordType: chordQuality.chordType
      };
    });
    
    const scoredNotes = await Promise.all(scoredNotesPromises);

    // Sort by score (highest first)
    scoredNotes.sort((a, b) => b.score - a.score);

    // Select notes one by one, evaluating chord quality at each step
    const selected = [];
    const remaining = [...scoredNotes];
    
    while (selected.length < numNotes && remaining.length > 0) {
      let bestCandidate = null;
      let bestScore = -1;
      let bestIndex = -1;
      
      // Try each remaining note and see which forms best chord
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const testChord = [...selected, candidate.note];
        const quality = await evaluateChordQuality(testChord);
        
        // Score: chord quality + individual note score
        const combinedScore = quality.quality * 100 + candidate.score;
        
        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestCandidate = candidate;
          bestIndex = i;
        }
      }
      
      if (bestCandidate) {
        selected.push(bestCandidate.note);
        remaining.splice(bestIndex, 1);
      } else {
        break;
      }
    }

    // If still not enough, fill with target chord tones
    for (let i = 0; selected.length < numNotes; i++) {
      const chordTone = targetChord[i % targetChord.length];
      if (!selected.includes(chordTone)) {
        selected.push(chordTone);
      }
    }

    return selected.slice(0, numNotes);
  }

/**
 * Harmonic Progression Generator Class
 * Generates natural chord progressions based on available particle notes
 */
export class HarmonicProgressionGenerator {
  constructor(key = 'C', mode = 'major') {
    this.key = key; // Root note (0-11)
    this.mode = mode; // 'major' or 'minor'
    this.currentCycle = 0; // Current cycle (0-7 for 8-step sequencer)
    this.currentProgression = null; // Current progression name
    this.progressionChords = []; // Chords for current cycle
    this.history = []; // History of previous chords for voice leading
    
    // Optimization: Caching
    this.cache = new Map(); // particleNotesHash -> progression
    this.lastParticleNotesHash = null;
    this.cachedPattern = null;
    this.lastUpdateStep = -1;
  }

  /**
   * Generate harmonic progression for current cycle
   * NOW ANALYZES CHORD IN 3-OCTAVE RANGE relative to first note/current state
   * @param {Array} particleNotes - Available notes from particles (0-11)
   * @param {Number} currentStep - Current step in sequencer (0-7, cycles every 8)
   * @param {Number} rootNote - Root note (0-11) for relative analysis, or null for absolute
   * @returns {Promise<Object>} { bass: note, baritone: note, tenor: note, chordName: string, chordAnalysis: Object }
   */
  async generateProgression(particleNotes, currentStep = 0, rootNote = null) {
    const SEQUENCER_STEPS = 8;
    const cycleIndex = Math.floor(currentStep / SEQUENCER_STEPS);
    const stepInCycle = currentStep % SEQUENCER_STEPS;
    
    // If new cycle, select a new progression
    if (cycleIndex !== this.currentCycle) {
      this.currentCycle = cycleIndex;
      this.selectProgression(particleNotes);
    }

    // Get chord for current step (2 steps per chord in 8-step cycle)
    const stepsPerChord = 2; // 8 steps / 4 chords = 2 steps per chord
    const chordIndex = Math.floor(stepInCycle / stepsPerChord);
    const targetChord = this.progressionChords[chordIndex] || this.progressionChords[0];

    // Select best notes from available particles
    // Pass existing notes to evaluate full chord quality
    const existingNotes = this.history.length > 0 ? this.history[this.history.length - 1] : [];
    const selectedNotes = await selectBestNotes(particleNotes, targetChord, existingNotes, 3);

    // Assign to voices with voice leading consideration
    // Use first note as root for relative analysis, or use provided rootNote
    const effectiveRoot = rootNote !== null ? rootNote : (selectedNotes.length > 0 ? selectedNotes[0] : targetChord[0] || 0);
    const assignment = await this.assignToVoices(selectedNotes, targetChord, effectiveRoot);
    
    // Add chord information for debugging
    const chordNames = ['I', 'V', 'vi', 'IV', 'ii', 'iii'];
    assignment.chordName = assignment.chordAnalysis?.chordName || chordNames[chordIndex] || '?';
    assignment.chordIndex = chordIndex;

    return assignment;
  }
  
  /**
   * Generate full pattern for entire cycle (8 steps) - OPTIMIZED
   * Uses caching to avoid recalculation
   * @param {Array} particleNotes - Available notes from particles (0-11)
   * @param {Number} currentStep - Current step (for incremental updates)
   * @returns {Promise<Object>} { bass: [8 steps], baritone: [8 steps], tenor: [8 steps] }
   */
  async generateFullCyclePattern(particleNotes, currentStep = 0) {
    const SEQUENCER_STEPS = 8;
    const cycleIndex = Math.floor(currentStep / SEQUENCER_STEPS);
    
    // Create hash for caching
    const notesHash = [...particleNotes].sort().join(',');
    
    // Check cache
    if (this.lastParticleNotesHash === notesHash && 
        this.cachedPattern && 
        this.cachedPattern.cycleIndex === cycleIndex) {
      // Cache hit - return cached pattern
      return this.cachedPattern;
    }
    
    // Cache miss - generate new pattern
    const bassPattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    const baritonePattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    const tenorPattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    
    // Select progression for this cycle
    this.selectProgression(particleNotes);
    
    // Determine root note from first particle note (or first available note)
    const rootNote = particleNotes.length > 0 ? particleNotes[0] : 0;
    
    // Generate pattern for each step (await all async operations)
    for (let step = 0; step < SEQUENCER_STEPS; step++) {
      const assignment = await this.generateProgression(particleNotes, cycleIndex * SEQUENCER_STEPS + step, rootNote);
      
      // Place notes in sequencer pattern
      bassPattern[step][assignment.bass] = 1;
      baritonePattern[step][assignment.baritone] = 1;
      tenorPattern[step][assignment.tenor] = 1;
    }
    
    // Cache the result
    const pattern = {
      bass: bassPattern,
      baritone: baritonePattern,
      tenor: tenorPattern,
      progression: this.currentProgression,
      cycleIndex: cycleIndex
    };
    
    this.lastParticleNotesHash = notesHash;
    this.cachedPattern = pattern;
    this.cache.set(notesHash, pattern);
    
    return pattern;
  }
  
  /**
   * Get single step (optimized - uses cache if available)
   * @param {Array} particleNotes - Available notes from particles (0-11)
   * @param {Number} step - Current step
   * @returns {Promise<Object>} { bass: note, baritone: note, tenor: note }
   */
  async getStep(particleNotes, step) {
    // Try to use cached pattern
    const notesHash = [...particleNotes].sort().join(',');
    const cycleIndex = Math.floor(step / 8);
    const stepInCycle = step % 8;
    
    if (this.lastParticleNotesHash === notesHash && 
        this.cachedPattern && 
        this.cachedPattern.cycleIndex === cycleIndex) {
      // Extract from cached pattern
      return {
        bass: this.cachedPattern.bass[stepInCycle].findIndex(v => v === 1),
        baritone: this.cachedPattern.baritone[stepInCycle].findIndex(v => v === 1),
        tenor: this.cachedPattern.tenor[stepInCycle].findIndex(v => v === 1)
      };
    }
    
    // Generate on demand (use first particle note as root)
    const rootNote = particleNotes.length > 0 ? particleNotes[0] : 0;
    return await this.generateProgression(particleNotes, step, rootNote);
  }

  /**
   * Select appropriate progression based on available notes
   * @param {Array} particleNotes - Available notes from particles
   */
  selectProgression(particleNotes) {
    const progressions = this.mode === 'major' ? MAJOR_PROGRESSIONS : MINOR_PROGRESSIONS;
    const progressionNames = Object.keys(progressions);

    // Score each progression based on how well it matches available notes
    const scored = progressionNames.map(name => {
      const chords = progressions[name];
      let matchScore = 0;
      let totalChordTones = 0;

      chords.forEach(chord => {
        const chordTonesInParticles = chord.filter(tone => 
          particleNotes.includes(tone)
        ).length;
        matchScore += chordTonesInParticles;
        totalChordTones += chord.length;
      });

      const avgMatch = matchScore / totalChordTones;
      return { name, score: avgMatch, chords };
    });

    // Sort by match score
    scored.sort((a, b) => b.score - a.score);

    // Select progression (prefer good matches, but add some randomness)
    let selected;
    if (scored[0].score > 0.3) {
      // Good match found, use it or top 2 with 70/30 probability
      selected = Math.random() < 0.7 ? scored[0] : scored[1] || scored[0];
    } else {
      // Poor match, use random from top 3
      const top3 = scored.slice(0, 3);
      selected = top3[Math.floor(Math.random() * top3.length)] || scored[0];
    }

    this.currentProgression = selected.name;
    this.progressionChords = selected.chords;

    // Store in history for voice leading
    if (this.history.length > 0) {
      // Check voice leading smoothness
      const lastChord = this.history[this.history.length - 1];
      const voiceLeadingScore = this.calculateVoiceLeading(lastChord, selected.chords[0]);
      
      // If voice leading is poor, try to adjust
      if (voiceLeadingScore < 0.5 && scored.length > 1) {
        // Try second best
        const alternative = scored[1];
        const altVoiceLeading = this.calculateVoiceLeading(lastChord, alternative.chords[0]);
        if (altVoiceLeading > voiceLeadingScore) {
          this.currentProgression = alternative.name;
          this.progressionChords = alternative.chords;
        }
      }
    }

    // Update history
    this.history.push(selected.chords[0]);
    if (this.history.length > 4) {
      this.history.shift(); // Keep last 4 chords
    }
  }

  /**
   * Calculate voice leading smoothness between two chords
   * @param {Array} chord1 - First chord [note1, note2, note3]
   * @param {Array} chord2 - Second chord [note1, note2, note3]
   * @returns {Number} Score 0-1 (higher = smoother)
   */
  calculateVoiceLeading(chord1, chord2) {
    if (!chord1 || !chord2 || chord1.length === 0 || chord2.length === 0) {
      return 0.5;
    }

    // Sort chords by pitch
    const sorted1 = [...chord1].sort((a, b) => a - b);
    const sorted2 = [...chord2].sort((a, b) => a - b);

    // Calculate minimum total voice leading distance
    let totalDistance = 0;
    const minLength = Math.min(sorted1.length, sorted2.length);

    for (let i = 0; i < minLength; i++) {
      const distance = Math.abs((sorted2[i] - sorted1[i] + 12) % 12);
      // Prefer small intervals (0-4 semitones)
      if (distance <= 4) {
        totalDistance += distance;
      } else {
        totalDistance += 12; // Large jumps are penalized
      }
    }

    // Normalize to 0-1 (lower distance = higher score)
    const maxDistance = minLength * 12;
    return 1 - (totalDistance / maxDistance);
  }

  /**
   * Assign selected notes to voices (bass, baritone, tenor)
   * NOW ANALYZES CHORD IN 3-OCTAVE RANGE and assigns relative to first note/current state
   * @param {Array} selectedNotes - Selected note indices (0-11)
   * @param {Array} targetChord - Target chord tones
   * @param {Number} rootNote - Root note (0-11) for relative analysis, or null for absolute
   * @returns {Promise<Object>} { bass: note, baritone: note, tenor: note, chordAnalysis: Object }
   */
  async assignToVoices(selectedNotes, targetChord, rootNote = null) {
    // Sort notes by pitch
    const sorted = [...selectedNotes].sort((a, b) => a - b);

    // Assign: lowest to bass, middle to baritone, highest to tenor
    const bass = sorted[0] || targetChord[0] || 0;
    const baritone = sorted[1] || targetChord[1] || targetChord[0] || 4;
    const tenor = sorted[2] || targetChord[2] || targetChord[1] || 7;

    // Analyze chord in 3-octave range relative to root
    const chordAnalysis = await analyzeStepChord(bass, baritone, tenor, rootNote);

    return { bass, baritone, tenor, chordAnalysis };
  }

  /**
   * Reset progression (for new key/mode or restart)
   */
  reset() {
    this.currentCycle = 0;
    this.currentProgression = null;
    this.progressionChords = [];
    this.history = [];
  }
}

