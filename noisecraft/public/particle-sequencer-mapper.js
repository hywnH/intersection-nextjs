/**
 * Particle Sequencer Mapper
 * Maps particle information to sequencer patterns using (a, b, c) coordinate system
 * 
 * Structure: 13 patterns x 3 voices x 12 steps
 * - a (0-12): Note index (13 patterns, one per semitone including octave)
 * - b (0-2): Voice selection (bass, baritone, tenor) - random
 * - c (0-11): Step position - determined by instability analysis of particles at same c
 * 
 * Logic:
 * - Particles at same c value: analyze their notes (a values) and place at position with lowest instability
 * - Early particles: placed at c=0,4,8 (stable positions)
 * - Later particles: placed at c=2,6,10, etc. (progression)
 */

import { INSTABILITY_MAP } from './harmonic-placer.js';

/**
 * Calculate average instability for a set of notes
 */
function calculateAverageInstability(notes) {
  if (!notes || notes.length === 0) return 0;
  const totalInstability = notes.reduce((sum, note) => {
    return sum + (INSTABILITY_MAP[note] || 0);
  }, 0);
  return totalInstability / notes.length;
}

/**
 * Particle Sequencer Mapper Class
 * Maps particles to sequencer patterns using (a, b, c) coordinate system
 */
export class ParticleSequencerMapper {
  constructor() {
    // Track particle assignments: particleId -> { a: note, b: voice, c: step }
    this.particleAssignments = new Map();
    
    // Track c-value groups: c -> [particleIds]
    this.cValueGroups = new Map();
    
    // Track pattern structure: 13 patterns x 3 voices x 8 steps
    // patterns[a][b][c] = 1 if active, 0 otherwise
    const SEQUENCER_STEPS = 8; // Reduced from 12 to 8 steps
    this.patterns = Array(13).fill(null).map(() => 
      Array(3).fill(null).map(() => 
        Array(SEQUENCER_STEPS).fill(0)
      )
    );
  }

  /**
   * Assign a particle to sequencer pattern
   * @param {Object} particle - Particle object with id, tone, etc.
   * @param {Number} totalParticles - Total number of particles (for progression logic)
   * @returns {Object} Assignment { a, b, c } or null if failed
   */
  assignParticle(particle, totalParticles) {
    // Check if particle is already assigned - prevent duplicates
    if (this.particleAssignments.has(particle.id)) {
      const existing = this.particleAssignments.get(particle.id);
      console.log(`[ParticleMapper] Particle ${particle.id} already assigned: a=${existing.a}, b=${existing.b}, c=${existing.c} (skipping duplicate assignment)`);
      return existing;
    }
    
    // a: Note index (0-12, 13 patterns)
    const noteIndex = particle.tone !== undefined ? (particle.tone % 12) : 
                      particle.getActiveNoteIndex ? particle.getActiveNoteIndex() : 0;
    const a = Math.min(noteIndex, 12); // Ensure 0-12 range
    
    // b: Deterministic voice selection based on particle ID and note for harmonic balance
    // Distribute voices to create better chord voicings
    // Lower notes (0-3) prefer bass, middle (4-7) prefer baritone, higher (8-11) prefer tenor
    let b;
    if (a <= 3) {
      // Lower notes: prefer bass (0), but allow some distribution
      b = (particle.id % 2 === 0) ? 0 : 1; // 50% bass, 50% baritone
    } else if (a <= 7) {
      // Middle notes: prefer baritone (1), with some tenor
      b = (particle.id % 3 === 0) ? 1 : 2; // 33% baritone, 67% tenor
    } else {
      // Higher notes: prefer tenor (2), with some baritone
      b = (particle.id % 3 === 0) ? 1 : 2; // 33% baritone, 67% tenor
    }
    
    // For first particle, always use bass for stability
    if (totalParticles === 1) {
      b = 0; // bass
    }
    
    // c: Step position - determined by harmonic progression and instability analysis
    // Early particles: c = 0, 2, 4, 6 (stable positions for 8-step sequencer) - ensures immediate sound
    // Later particles: analyze instability for each c value to find optimal placement
    const SEQUENCER_STEPS = 8; // Reduced from 12 to 8 steps
    let c;
    if (totalParticles <= 3) {
      // Early stage: use stable positions (0, 2, 4, 6) for immediate sound
      const stablePositions = [0, 2, 4, 6];
      c = stablePositions[(totalParticles - 1) % stablePositions.length];
    } else if (totalParticles <= 6) {
      // Mid stage: use secondary stable positions (1, 3, 5, 7)
      const secondaryPositions = [1, 3, 5, 7];
      c = secondaryPositions[(totalParticles - 4) % secondaryPositions.length];
    } else {
      // Later stage: analyze instability for each c value
      c = this.findOptimalCValue(a, totalParticles);
    }
    
    // Store assignment
    const assignment = { a, b, c };
    this.particleAssignments.set(particle.id, assignment);
    
    // Update c-value groups
    if (!this.cValueGroups.has(c)) {
      this.cValueGroups.set(c, []);
    }
    this.cValueGroups.get(c).push(particle.id);
    
    // Update pattern
    this.patterns[a][b][c] = 1;
    
    return assignment;
  }

  /**
   * Find optimal c value based on instability analysis and chord formation
   * Groups particles by c value and finds position that creates best harmony
   * @param {Number} a - Note index (0-12)
   * @param {Number} totalParticles - Total number of particles
   * @returns {Number} Optimal c value (0-11)
   */
  findOptimalCValue(a, totalParticles) {
    // Common chord intervals (relative to root)
    const chordIntervals = {
      major: [0, 4, 7],        // C, E, G
      minor: [0, 3, 7],        // C, Eb, G
      major7: [0, 4, 7, 11],   // C, E, G, B
      minor7: [0, 3, 7, 10],   // C, Eb, G, Bb
      sus4: [0, 5, 7],         // C, F, G
      sus2: [0, 2, 7],         // C, D, G
      dim: [0, 3, 6],          // C, Eb, Gb
      aug: [0, 4, 8]           // C, E, G#
    };
    
    // Get all particles at each c value
    const SEQUENCER_STEPS = 8; // Reduced from 12 to 8 steps
    const cValueAnalyses = [];
    
    for (let c = 0; c < SEQUENCER_STEPS; c++) {
      const particlesAtC = this.cValueGroups.get(c) || [];
      const notesAtC = particlesAtC.map(pid => {
        const assignment = this.particleAssignments.get(pid);
        return assignment ? assignment.a : null;
      }).filter(note => note !== null);
      
      // Add current note to analysis
      const allNotes = [...notesAtC, a];
      const avgInstability = calculateAverageInstability(allNotes);
      
      // Check if notes form a recognizable chord
      let chordScore = 0;
      const noteSet = new Set(allNotes.map(n => n % 12)); // Normalize to 0-11
      
      // Check each chord type
      for (const [chordName, intervals] of Object.entries(chordIntervals)) {
        // Try each note as root
        for (let root = 0; root < 12; root++) {
          const chordNotes = intervals.map(interval => (root + interval) % 12);
          const matches = chordNotes.filter(note => noteSet.has(note)).length;
          const totalChordNotes = chordNotes.length;
          
          // Score based on how many chord tones are present
          if (matches === totalChordNotes) {
            // Perfect chord match
            chordScore = Math.max(chordScore, 1.0);
          } else if (matches >= 2 && totalChordNotes >= 3) {
            // Partial chord (at least 2 of 3+ notes)
            chordScore = Math.max(chordScore, 0.7 * (matches / totalChordNotes));
          } else if (matches === 1 && noteSet.size === 1) {
            // Single note (will form chord as more notes are added)
            chordScore = Math.max(chordScore, 0.3);
          }
        }
      }
      
      // Voice leading score: prefer positions that create smooth voice leading
      let voiceLeadingScore = 0.5; // Default neutral
      if (notesAtC.length > 0) {
        // Calculate average interval distance from existing notes
        const intervals = notesAtC.map(note => {
          const interval = Math.abs((a - note + 12) % 12);
          return interval;
        });
        
        // Prefer consonant intervals (3rds, 5ths, 6ths)
        const consonantIntervals = [0, 3, 4, 5, 7, 8, 9];
        const consonantCount = intervals.filter(i => consonantIntervals.includes(i)).length;
        voiceLeadingScore = 0.3 + (consonantCount / intervals.length) * 0.7;
      }
      
      // Combine scores: chord formation (40%), voice leading (30%), instability (30%)
      const combinedScore = (chordScore * 0.4) + (voiceLeadingScore * 0.3) + ((1 - avgInstability / 10) * 0.3);
      
      cValueAnalyses.push({
        c,
        avgInstability,
        particleCount: particlesAtC.length,
        chordScore,
        voiceLeadingScore,
        combinedScore
      });
    }
    
    // Sort by combined score (higher is better), then by particle count (prefer less crowded)
    cValueAnalyses.sort((x, y) => {
      if (Math.abs(x.combinedScore - y.combinedScore) < 0.05) {
        return x.particleCount - y.particleCount; // Prefer less crowded if scores are close
      }
      return y.combinedScore - x.combinedScore; // Prefer higher combined score
    });
    
    // Return best c value
    return cValueAnalyses[0].c;
  }

  /**
   * Update pattern for a particle
   * @param {Object} particle - Particle object
   * @param {Object} assignment - Assignment { a, b, c }
   */
  updatePattern(particle, assignment) {
    const { a, b, c } = assignment;
    if (a >= 0 && a < 13 && b >= 0 && b < 3 && c >= 0 && c < 12) {
      this.patterns[a][b][c] = 1;
    }
  }

  /**
   * Convert (a, b, c) patterns to NoiseCraft sequencer format
   * Returns format: { bass: [12 steps x 12 rows], baritone: [...], tenor: [...] }
   * Only includes notes for actually assigned particles (prevents duplicates)
   * @returns {Object} Sequencer patterns for each voice
   */
  toNoiseCraftFormat() {
    const SEQUENCER_STEPS = 8; // Reduced from 12 to 8 steps
    const bassPattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    const baritonePattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    const tenorPattern = Array(SEQUENCER_STEPS).fill(null).map(() => new Array(12).fill(0));
    
    // Track which cells are being set to detect duplicates
    const cellTracker = new Map(); // key: "b-c-row", value: particleId
    
    // Only iterate through actually assigned particles (prevents phantom notes)
    this.particleAssignments.forEach((assignment, particleId) => {
      const { a, b, c } = assignment;
      
      // Validate assignment
      const SEQUENCER_STEPS = 8;
      if (a < 0 || a > 12 || b < 0 || b > 2 || c < 0 || c >= SEQUENCER_STEPS) {
        console.warn(`[ParticleMapper] Invalid assignment for particle ${particleId}:`, assignment);
        return;
      }
      
      // Map to voice pattern
      const voicePattern = b === 0 ? bassPattern : 
                          b === 1 ? baritonePattern : tenorPattern;
      
      // Place note a at step c, row a (note index)
      const noteRow = a % 12; // Map 0-12 to 0-11 (12-tone chromatic)
      if (voicePattern[c] && noteRow >= 0 && noteRow < 12) {
        // Check for duplicate cell assignment
        const cellKey = `${b}-${c}-${noteRow}`;
        if (cellTracker.has(cellKey)) {
          const existingParticleId = cellTracker.get(cellKey);
          console.warn(`[ParticleMapper] ⚠️ Duplicate cell assignment detected! Cell ${cellKey} (voice=${b}, step=${c}, row=${noteRow}) already set by particle ${existingParticleId}, now trying to set by particle ${particleId}`);
        } else {
          cellTracker.set(cellKey, particleId);
        }
        voicePattern[c][noteRow] = 1;
      }
    });
    
    // Log summary
    if (cellTracker.size !== this.particleAssignments.size) {
      console.warn(`[ParticleMapper] ⚠️ Cell count (${cellTracker.size}) doesn't match assignment count (${this.particleAssignments.size})`);
    }
    
    return {
      bass: bassPattern,
      baritone: baritonePattern,
      tenor: tenorPattern
    };
  }

  /**
   * Clear all patterns
   */
  clear() {
    this.particleAssignments.clear();
    this.cValueGroups.clear();
    const SEQUENCER_STEPS = 8;
    this.patterns = Array(13).fill(null).map(() => 
      Array(3).fill(null).map(() => 
        Array(SEQUENCER_STEPS).fill(0)
      )
    );
  }

  /**
   * Get count of assigned particles (for debugging)
   */
  getAssignmentCount() {
    return this.particleAssignments.size;
  }

  /**
   * Get summary of assignments (for debugging)
   */
  getAssignmentSummary() {
    const summary = {
      total: this.particleAssignments.size,
      byVoice: { bass: 0, baritone: 0, tenor: 0 },
      byStep: Array(8).fill(0) // Reduced from 12 to 8 steps
    };
    
    this.particleAssignments.forEach((assignment) => {
      const { b, c } = assignment;
      if (b === 0) summary.byVoice.bass++;
      else if (b === 1) summary.byVoice.baritone++;
      else if (b === 2) summary.byVoice.tenor++;
      if (c >= 0 && c < 12) summary.byStep[c]++;
    });
    
    return summary;
  }

  /**
   * Remove particle assignment
   * @param {Number} particleId - Particle ID
   */
  removeParticle(particleId) {
    const assignment = this.particleAssignments.get(particleId);
    if (assignment) {
      const { a, b, c } = assignment;
      this.patterns[a][b][c] = 0;
      
      // Remove from c-value groups
      const cGroup = this.cValueGroups.get(c);
      if (cGroup) {
        const index = cGroup.indexOf(particleId);
        if (index > -1) {
          cGroup.splice(index, 1);
        }
        if (cGroup.length === 0) {
          this.cValueGroups.delete(c);
        }
      }
      
      this.particleAssignments.delete(particleId);
    }
  }

  /**
   * Get assignment for a particle
   * @param {Number} particleId - Particle ID
   * @returns {Object} Assignment { a, b, c } or null
   */
  getAssignment(particleId) {
    return this.particleAssignments.get(particleId) || null;
  }
}

