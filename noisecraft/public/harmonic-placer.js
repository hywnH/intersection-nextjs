/**
 * Global Harmonic Placer
 * Implements harmonic progression algorithm for placing particles in 24 sequencer positions (3 voices * 8 steps)
 * Based on instability mapping and entropy-based complexity control
 */

/**
 * Instability Map based on sensory dissonance data
 * Score range: 0 (most stable/consonant) ~ 10 (most unstable/dissonant)
 */
export const INSTABILITY_MAP = {
  0: 0,    // C (Tonic/Unison) - 가장 안정
  1: 9,    // C#/Db (Minor 2nd) - 매우 높은 dissonance
  2: 3,    // D (Major 2nd) - 중간 dissonance
  3: 2,    // D#/Eb (Minor 3rd) - 낮은 dissonance (consonant)
  4: 1.5,  // E (Major 3rd) - 낮은 dissonance (consonant)
  5: 2.5,  // F (Perfect 4th) - 낮은 dissonance (consonant)
  6: 8,    // F#/Gb (Tritone) - 매우 높은 dissonance
  7: 0.5,  // G (Perfect 5th) - 가장 낮은 dissonance (most consonant)
  8: 4,    // G#/Ab (Minor 6th) - 중간 dissonance
  9: 2,    // A (Major 6th) - 낮은 dissonance (consonant)
  10: 4.5, // A#/Bb (Minor 7th) - 중간-높은 dissonance
  11: 7,   // B (Major 7th/Leading tone) - 높은 dissonance
};

/**
 * Calculate average instability of assigned notes
 */
function calculateAverageInstability(assignedNotes) {
  if (!assignedNotes || assignedNotes.length === 0) return 0;
  
  const totalInstability = assignedNotes.reduce((sum, note) => {
    return sum + (INSTABILITY_MAP[note] || 0);
  }, 0);
  
  return totalInstability / assignedNotes.length;
}

/**
 * Global Harmonic Placer Class
 * Implements hybrid approach: constraint filtering + harmonic distance optimization + voice leading
 */
export class GlobalHarmonicPlacer {
  constructor(key = 'C', mode = 'major') {
    this.key = key;
    this.mode = mode;
    this.assignedPositions = []; // [{ note: 0-11, position: 0-35, voice: 0-2, step: 0-11 }]
  }

  /**
   * Calculate actual pitch considering voice octave offset
   * bass = note (0-11)
   * baritone = note + 12 (one octave up)
   * tenor = note + 24 (two octaves up)
   * @param {Number} note - 12-tone note index (0-11)
   * @param {Number} voice - Voice index (0=bass, 1=baritone, 2=tenor)
   * @returns {Number} Actual pitch (0-35)
   */
  getActualPitch(note, voice) {
    return note + (voice * 12);
  }

  /**
   * Calculate interval between two notes considering their voice octaves
   * @param {Number} note1 - First note (0-11)
   * @param {Number} voice1 - First voice (0-2)
   * @param {Number} note2 - Second note (0-11)
   * @param {Number} voice2 - Second voice (0-2)
   * @returns {Number} Interval class (0-11, normalized to chromatic scale)
   */
  calculateIntervalWithVoice(note1, voice1, note2, voice2) {
    const pitch1 = this.getActualPitch(note1, voice1);
    const pitch2 = this.getActualPitch(note2, voice2);
    const interval = Math.abs(pitch1 - pitch2);
    return interval % 12; // Normalize to chromatic interval class
  }

  /**
   * Main function: assign a new user to a position
   * @param {Number} userNote - 12-tone note index (0-11)
   * @param {Number} totalUsers - Total number of users (for entropy-based complexity)
   * @returns {Number} Position index (0-23 for 8-step sequencer)
   */
  assignNewUser(userNote, totalUsers, verbose = false) {
    const availablePositions = this.getAvailablePositions();
    
    if (availablePositions.length === 0) {
      console.warn('[HarmonicPlacer] No available positions');
      return -1;
    }

    // STRICTER: For very early stage (<= 9 users), only allow most stable notes
    const isVeryEarlyStage = totalUsers <= 9;
    if (isVeryEarlyStage) {
      const instability = INSTABILITY_MAP[userNote] || 0;
      // Only allow: C(0), Eb(3), E(4), G(7) - most stable notes
      const allowedNotes = [0, 3, 4, 7];
      if (!allowedNotes.includes(userNote)) {
        if (verbose) {
          console.warn(`[HarmonicPlacer] Rejecting note ${userNote} (instability: ${instability}) in very early stage (${totalUsers} users) - only C, Eb, E, G allowed`);
        }
        return -1; // Reject all other notes in very early stage
      }
    }

    // Phase 1: Constraint filtering
    const validPositions = availablePositions.filter(pos => {
      return this.satisfiesConstraints(userNote, pos, totalUsers);
    });

    if (validPositions.length === 0) {
      // If constraints too strict, check if note itself is too unstable
      const instability = INSTABILITY_MAP[userNote] || 0;
      const isEarlyStage = totalUsers <= 18;
      
      // In early stage, if note is too unstable (>= 6), reject it completely
      if (isEarlyStage && instability >= 6) {
        if (verbose) {
          console.warn(`[HarmonicPlacer] Rejecting unstable note ${userNote} (instability: ${instability}) in early stage (${totalUsers} users)`);
        }
        return -1; // Reject unstable note in early stage
      }
      
      // Otherwise, use random fallback (shouldn't happen if note assignment is correct)
      if (verbose) {
        console.warn(`[HarmonicPlacer] No valid positions after constraint filtering (note: ${userNote}, instability: ${instability}, available: ${availablePositions.length}), using random fallback`);
      }
      const selected = availablePositions[Math.floor(Math.random() * availablePositions.length)];
      if (verbose) {
        const voice = Math.floor(selected / 12);
        const step = selected % 12;
        const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
        console.log(`[HarmonicPlacer] Selected random position: ${selected} (${voiceName} step ${step})`);
      }
      return selected;
    }

    // Phase 2: Harmonic distance optimization
    const targetDistance = this.calculateTargetDistance(totalUsers);
    const scored = validPositions.map(pos => {
      const score = this.evaluateHarmonicScore(userNote, pos, targetDistance, totalUsers);
      return { position: pos, score };
    });

    // Filter out zero-score positions
    const validScored = scored.filter(c => c.score > 0);
    if (validScored.length === 0) {
      // Fallback to random if all scores are 0
      if (verbose) {
        console.warn(`[HarmonicPlacer] All scores are 0 (note: ${userNote}), using random from ${validPositions.length} valid positions`);
      }
      const selected = validPositions[Math.floor(Math.random() * validPositions.length)];
      if (verbose) {
        const SEQUENCER_STEPS = 8;
        const voice = Math.floor(selected / SEQUENCER_STEPS);
        const step = selected % SEQUENCER_STEPS;
        const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
        console.log(`[HarmonicPlacer] Selected random position: ${selected} (${voiceName} step ${step})`);
      }
      return selected;
    }

    // Phase 3: Weighted random selection (maintains randomness while preferring better positions)
    const selected = this.weightedRandomSelect(validScored);
    if (verbose) {
      const SEQUENCER_STEPS = 8;
      const voice = Math.floor(selected / SEQUENCER_STEPS);
      const step = selected % SEQUENCER_STEPS;
      const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
      const selectedScore = validScored.find(c => c.position === selected)?.score || 0;
      console.log(`[HarmonicPlacer] ✓ Assigned note ${userNote} to ${voiceName} step ${step} (position: ${selected}, score: ${selectedScore.toFixed(3)}, targetDistance: ${targetDistance.toFixed(2)})`);
    }
    return selected;
  }

  /**
   * Check if position satisfies constraints
   * @param {Number} noteIndex - 12-tone note index (0-11)
   * @param {Number} position - Position index (0-35)
   * @param {Number} totalUsers - Total number of users
   * @returns {Boolean} True if constraints are satisfied
   */
  satisfiesConstraints(noteIndex, position, totalUsers) {
    const instability = INSTABILITY_MAP[noteIndex] || 0;
    const SEQUENCER_STEPS = 8; // Reduced from 12 to 8 steps per voice
    const step = position % SEQUENCER_STEPS; // Step in 8-step cycle (0-7)
    const distanceToCycleEnd = SEQUENCER_STEPS - step;

    // Early stage: users <= 18 (must prefer stable chords: Maj/Min/Maj7/Min7)
    // Increased from 9 to 18 to delay unstable tones
    const isEarlyStage = totalUsers <= 18;
    
    // Constraint 1: For early stage (<=18), STRICTLY block unstable/dissonant notes
    // This ensures only stable chord tones (Maj/Min/Maj7/Min7) are used
    if (isEarlyStage) {
      // Block highly unstable notes: Minor 2nd (1), Tritone (6), Major 7th (11)
      // Instability: C#=9, F#=8, B=7 are too tense
      // STRICTER: Block all notes with instability >= 6 (F#, B, C#)
      if (instability >= 6) {
        return false; // Block very unstable notes (C#, F#, B) in early stage
      }
      
      // Also block moderately unstable notes (instability > 2.0) unless they're needed for stable chords
      // Stricter threshold: Major 2nd (D=2, instability=3) and Minor 6th (G#=8, instability=4) are less preferred
      // But allow them if they help form stable chords
      if (instability > 2.0) {
        // Check if this note could form a stable interval with existing notes
        // If all existing notes form stable intervals with this, allow it
        if (this.assignedPositions.length > 0) {
          // Stability priority: 5th (7) > Major 3rd (4) > Minor 3rd (3) > 4th (5) and 6th (8,9)
          // Priority order: Perfect 5th (7) is most stable, then Major 3rd (4), then Minor 3rd (3), then 4th (5) and 6ths (8,9)
          // DELAY Minor 3rd (3) - only allow after more particles (>= 6 users)
          const mostStableIntervals = [7]; // Perfect 5th - highest priority
          const veryStableIntervals = [4]; // Major 3rd - second priority (Minor 3rd delayed)
          const delayedStableIntervals = [3]; // Minor 3rd - only after >= 6 users
          const stableIntervals = [5, 8, 9]; // Perfect 4th, Minor 6th, Major 6th - third priority
          const acceptableIntervals = [0, 10]; // Unison, Minor 7th - acceptable
          const allStableIntervals = [...mostStableIntervals, ...veryStableIntervals, ...stableIntervals, ...acceptableIntervals];
          
          let hasStableRelationship = false;
          let bestIntervalPriority = 999; // Lower is better
          
          // Get voice from position (will be calculated in satisfiesConstraints)
          const SEQUENCER_STEPS = 8;
          const voiceIndex = Math.floor(position / SEQUENCER_STEPS);
          
          for (const existingPos of this.assignedPositions) {
            const existingVoice = existingPos.voice || Math.floor(existingPos.position / SEQUENCER_STEPS);
            // Calculate interval considering voice octaves
            const interval = this.calculateIntervalWithVoice(
              noteIndex, voiceIndex,
              existingPos.note, existingVoice
            );
            
            // Check interval priority (lower number = higher priority)
            // DELAY Minor 3rd (3) - only allow after >= 6 users
            let priority = 999;
            if (mostStableIntervals.includes(interval)) {
              priority = 1; // Perfect 5th - highest priority
            } else if (veryStableIntervals.includes(interval)) {
              priority = 2; // Major 3rd - second priority
            } else if (delayedStableIntervals.includes(interval)) {
              // Minor 3rd - only allow after >= 6 users
              if (totalUsers >= 6) {
                priority = 2.5; // Minor 3rd - slightly lower than Major 3rd
              } else {
                priority = 999; // Block Minor 3rd in early stage
              }
            } else if (stableIntervals.includes(interval)) {
              priority = 3; // 4th and 6ths - third priority
            } else if (acceptableIntervals.includes(interval)) {
              priority = 4; // Unison, Minor 7th - acceptable
            }
            
            if (priority < bestIntervalPriority) {
              bestIntervalPriority = priority;
              hasStableRelationship = true;
            }
          }
          
          // Only allow if it forms a stable relationship with at least one existing note
          if (!hasStableRelationship) {
            return false; // Block unstable notes that don't form stable intervals
          }
        } else {
          // First particle: STRICTLY only allow most stable notes
          // Priority: Perfect 5th (G=7) > Major 3rd (E=4) > Unison (C=0)
          // DELAY Minor 3rd (Eb=3) - only allow after more particles are added
          // For first particle, ONLY allow: C(0), E(4), G(7)
          // Block: Eb(3), F(5), Ab(8), A(9) - these can cause instability in early stage
          const mostStableNotes = [7]; // G (Perfect 5th) - highest priority
          const veryStableNotes = [4]; // E (Major 3rd) - second priority (Minor 3rd delayed)
          const stableNotes = [0]; // C (Unison/Tonic) - third priority
          const allAllowedNotes = [...mostStableNotes, ...veryStableNotes, ...stableNotes];
          
          if (!allAllowedNotes.includes(noteIndex)) {
            return false; // STRICTLY block all other notes for first particle (including Eb)
          }
        }
      }
      
      return true; // Passed early stage constraints
    }
    
    // Mid stage (19-30 users): Allow some complexity but still restrict very unstable notes
    const isMidStage = totalUsers > 18 && totalUsers <= 30;
    if (isMidStage) {
      // Block very unstable notes (instability >= 8) unless resolvable
      if (instability >= 8) {
        if (distanceToCycleEnd < 3) {
          const hasResolution = this.checkResolutionAvailable(step, 0);
          if (!hasResolution) {
            return false; // Cannot resolve very unstable note
          }
        }
      }
    }
    
    // Later stage (>30 users): Allow more complexity
    // Constraint: Unstable notes (instability > 7) must be resolvable before cycle ends
    if (instability > 7 && distanceToCycleEnd < 2) {
      const hasResolution = this.checkResolutionAvailable(step, 0);
      if (!hasResolution) {
        return false; // Cannot resolve unstable note
      }
    }
    
    // Later stages: apply constraint based on user count (more conservative)
    const maxAllowedInstability = Math.log(totalUsers + 1) * 1.5; // Reduced from 2.0 to 1.5
    if (instability > maxAllowedInstability && totalUsers < 30) {
      return false;
    }

    return true;
  }

  /**
   * Check if resolution note is available in next few steps
   * @param {Number} currentStep - Current step in cycle (0-11)
   * @param {Number} resolutionNote - Note that resolves (usually 0 for C)
   * @returns {Boolean} True if resolution is possible
   */
  checkResolutionAvailable(currentStep, resolutionNote) {
    // Check if resolution note exists in assigned positions within next 3 steps
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      const hasResolution = this.assignedPositions.some(p => 
        p.step === checkStep && p.note === resolutionNote
      );
      if (hasResolution) return true;
    }

    // If no resolution in assigned positions, check if there's room for one
    // (Future optimization: predict if resolution can be placed)
    // For now, allow it if there are unassigned positions in next 3 steps
    const availableInNext3 = [];
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      // Check if any position with this step is available
      const usedSteps = new Set(this.assignedPositions.map(p => p.step));
      if (!usedSteps.has(checkStep)) {
        return true; // Space available for resolution
      }
    }

    // Strict mode: require existing resolution
    return false;
  }

  /**
   * Calculate target harmonic distance based on user count
   * More users = higher distance = more complex progression
   * @param {Number} userCount - Total number of users
   * @returns {Number} Target distance (0-8)
   */
  calculateTargetDistance(userCount) {
    // User 1: distance 0 (tonic)
    // More users: higher distance (progression goes further from tonic)
    const maxDistance = 8;
    return Math.min(maxDistance, Math.log(userCount + 1) * 2);
  }

  /**
   * Evaluate harmonic score for a position
   * @param {Number} userNote - Note to place (0-11)
   * @param {Number} position - Position index (0-35)
   * @param {Number} targetDistance - Target harmonic distance
   * @param {Number} totalUsers - Total number of users
   * @returns {Number} Score (0-1, higher is better)
   */
  evaluateHarmonicScore(userNote, position, targetDistance, totalUsers) {
    const SEQUENCER_STEPS = 8;
    const voiceIndex = Math.floor(position / SEQUENCER_STEPS);
    const step = position % SEQUENCER_STEPS;
    
    // Create temporary assignment to evaluate
    const tempPositions = [...this.assignedPositions, {
      note: userNote,
      position,
      voice: voiceIndex, // 0=bass, 1=baritone, 2=tenor
      step: step
    }];

    // Calculate progression distance
    const newDistance = this.calculateProgressionDistance(tempPositions);
    
    // Distance score: how close to target distance?
    const distanceDiff = Math.abs(newDistance - targetDistance);
    const distanceScore = 1 / (1 + distanceDiff); // Closer to target = higher score

    // Position score: prefer middle positions in cycle (step 3-4 for 8-step sequencer)
    const positionScore = 1 - Math.abs(step - 3.5) / 3.5; // 0 at step 0 or 7, 1 at step 3.5

    // Instability balance: don't accumulate too much instability
    // More conservative calculation to delay unstable tones
    const allNotes = tempPositions.map(p => p.note);
    const avgInstability = calculateAverageInstability(allNotes);
    const maxInstability = Math.log(totalUsers + 1) * 1.5; // Reduced from 2.0 to 1.5 for more conservative approach
    const instabilityScore = Math.max(0, 1 - (avgInstability / maxInstability));

    // Voice distribution: prefer balanced distribution across voices
    const voiceCounts = [0, 0, 0];
    tempPositions.forEach(p => {
      voiceCounts[p.voice]++;
    });
    const voiceVariance = this.calculateVariance(voiceCounts);
    const voiceScore = 1 / (1 + voiceVariance); // Lower variance = better balance

    // NEW: Stable interval preference - prefer notes that form stable intervals with existing notes
    // For users <= 18: prefer Major, Minor, Major7, Minor7 chords (avoid tense/dissonant chords)
    // Now considers voice octaves: baritone = bass + 12, tenor = baritone + 12
    let stableIntervalScore = 0.5; // Default neutral score
    const isEarlyStage = totalUsers <= 18; // Early stage: prefer stable chords (increased from 9 to 18)
    
    if (this.assignedPositions.length > 0) {
      // Get existing notes with their voices (considering octave offsets)
      const existingPitches = this.assignedPositions.map(p => {
        const existingVoice = p.voice !== undefined ? p.voice : Math.floor(p.position / 8);
        return this.getActualPitch(p.note, existingVoice);
      });
      const initialPitch = existingPitches[0] || 0; // First assigned pitch (relative reference)
      
      // Calculate actual pitch for current note with its voice
      const currentPitch = this.getActualPitch(userNote, voiceIndex);
      const allPitches = [...existingPitches, currentPitch].sort((a, b) => a - b);
      const rootPitch = allPitches[0]; // Lowest pitch is root
      
      // For early stage (<=18 users): Check if adding this note creates a Major/Minor/Maj7/Min7 chord
      if (isEarlyStage) {
        // Calculate intervals from root, normalized to chromatic scale (0-11)
        const intervals = allPitches.map(pitch => (pitch - rootPitch) % 12);
        
        // Chord intervals (from music.js)
        const chordTypes = {
          maj: [0, 4, 7],           // Major
          min: [0, 3, 7],           // Minor
          maj7: [0, 4, 7, 11],      // Major 7th
          min7: [0, 3, 7, 10],      // Minor 7th
          dom7: [0, 4, 7, 10]       // Dominant 7th (also acceptable)
        };
        
        // Check if current intervals match a stable chord type
        let matchesChord = false;
        let chordMatchScore = 0;
        
        for (const [chordName, chordIntervals] of Object.entries(chordTypes)) {
          // Check if intervals match (allowing for subsets and supersets)
          const matches = chordIntervals.every(ci => intervals.includes(ci));
          const hasExtra = intervals.some(i => !chordIntervals.includes(i) && i !== 0); // Extra notes beyond chord
          
          if (matches && !hasExtra) {
            matchesChord = true;
            // Prefer Maj7, Min7, Maj, Min in that order (Maj7 and Min7 are most consonant)
            if (chordName === 'maj7' || chordName === 'min7') {
              chordMatchScore = 1.0;
            } else if (chordName === 'maj' || chordName === 'min') {
              chordMatchScore = 0.9;
            } else if (chordName === 'dom7') {
              chordMatchScore = 0.8; // Dominant 7th is acceptable but less preferred
            }
            break;
          }
        }
        
        if (matchesChord) {
          stableIntervalScore = chordMatchScore;
        } else {
          // Not a perfect chord match, but check if it's close
          // Calculate interval from initial note considering voice octaves (relative stability)
          const initialNote = this.assignedPositions[0].note;
          const initialVoice = this.assignedPositions[0].voice !== undefined ? 
                              this.assignedPositions[0].voice : 
                              Math.floor(this.assignedPositions[0].position / 8);
          const interval = this.calculateIntervalWithVoice(
            userNote, voiceIndex,
            initialNote, initialVoice
          );
          
          // Stability priority: 5th (7) > 3rd (3,4) > 4th (5) and 6th (8,9)
          // Unstable intervals (dissonant): Minor 2nd (1), Tritone (6), Major 7th (11) - avoid in early stage
          const mostStableIntervals = [7]; // Perfect 5th - highest priority
          const veryStableIntervals = [3, 4]; // Minor 3rd, Major 3rd - second priority
          const stableIntervals = [5, 8, 9]; // Perfect 4th, Minor 6th, Major 6th - third priority
          const unstableIntervals = [1, 6, 11]; // m2, Tritone, M7 - very tense
          
          if (mostStableIntervals.includes(interval)) {
            stableIntervalScore = 0.9; // Perfect 5th - highest score
          } else if (veryStableIntervals.includes(interval)) {
            stableIntervalScore = 0.8; // 3rds - second highest score
          } else if (stableIntervals.includes(interval)) {
            stableIntervalScore = 0.7; // 4th and 6ths - third priority
          } else if (unstableIntervals.includes(interval)) {
            stableIntervalScore = 0.0; // Zero score - should be blocked by constraints, but double-check
          } else {
            // Neutral intervals (0, 2, 10): Unison, Major 2nd, Minor 7th
            // Unison (0) is very stable, Minor 7th (10) is acceptable for 7th chords
            if (interval === 0) {
              stableIntervalScore = 0.85; // Unison is very stable (almost as good as 3rds)
            } else if (interval === 10) {
              stableIntervalScore = 0.6; // Minor 7th is okay for 7th chords
            } else {
              stableIntervalScore = 0.4; // Major 2nd and other neutral intervals less preferred
            }
          }
        }
        
        // Also check relationships with all existing notes for chord formation (considering voice octaves)
        let multiNoteScore = 0;
        let stableCount = 0;
        this.assignedPositions.forEach(existingPos => {
          const existingVoice = existingPos.voice !== undefined ? 
                               existingPos.voice : 
                               Math.floor(existingPos.position / 8);
          const relInterval = this.calculateIntervalWithVoice(
            userNote, voiceIndex,
            existingPos.note, existingVoice
          );
          // Stability priority: 5th (7) > 3rd (3,4) > 4th (5) and 6th (8,9)
          // Count stable relationships with priority weighting
          const mostStableIntervals = [7]; // Perfect 5th
          const veryStableIntervals = [3, 4]; // 3rds
          const stableIntervals = [5, 8, 9]; // 4th and 6ths
          const acceptableIntervals = [0, 10]; // Unison, Minor 7th
          
          if (mostStableIntervals.includes(relInterval)) {
            stableCount += 3; // Perfect 5th - highest weight
          } else if (veryStableIntervals.includes(relInterval)) {
            stableCount += 2; // 3rds - second weight
          } else if (stableIntervals.includes(relInterval)) {
            stableCount += 1.5; // 4th and 6ths - third weight
          } else if (acceptableIntervals.includes(relInterval)) {
            stableCount += 1; // Unison, Minor 7th - acceptable
          }
        });
        if (this.assignedPositions.length > 0) {
          // Normalize by max possible score (if all were Perfect 5ths)
          const maxPossibleScore = this.assignedPositions.length * 3;
          multiNoteScore = stableCount / maxPossibleScore;
        }
        
        // Combine chord matching with multi-note relationships (chord matching is more important)
        stableIntervalScore = (stableIntervalScore * 0.7) + (multiNoteScore * 0.3);
      } else {
        // Later stage (>9 users): Use original interval-based scoring (allows more complexity)
        const interval = (userNote - initialNote + 12) % 12;
        const stableIntervals = [0, 3, 4, 5, 7, 9];
        const unstableIntervals = [1, 6, 11];
        
        if (stableIntervals.includes(interval)) {
          stableIntervalScore = 0.8;
        } else if (unstableIntervals.includes(interval)) {
          stableIntervalScore = 0.4; // Less penalty in later stages
        } else {
          stableIntervalScore = 0.5;
        }
        
        // Multi-note relationships
        let multiNoteScore = 0;
        let stableCount = 0;
        existingNotes.forEach(existingNote => {
          const relInterval = (userNote - existingNote + 12) % 12;
          if (stableIntervals.includes(relInterval)) {
            stableCount++;
          }
        });
        if (existingNotes.length > 0) {
          multiNoteScore = stableCount / existingNotes.length;
        }
        stableIntervalScore = (stableIntervalScore * 0.6) + (multiNoteScore * 0.4);
      }
    } else {
      // First user: prefer stable notes (any note is fine, but preference for common chord tones)
      const stableNotes = [0, 3, 4, 7, 9, 10]; // C, Eb, E, G, A, Bb (chord tones)
      if (stableNotes.includes(userNote)) {
        stableIntervalScore = 0.8;
      } else {
        stableIntervalScore = 0.5;
      }
    }

    // Combined score (weighted) - increased weight for stable intervals in early stages
    // Higher weight for early stage (<=18) to enforce stable chord preferences
    const stableWeight = isEarlyStage ? 0.5 : 0.15; // Even more weight for early users (<=18) - prioritize stability
    const otherWeight = 1 - stableWeight;
    
    return distanceScore * (0.3 * otherWeight) + 
           positionScore * (0.2 * otherWeight) + 
           instabilityScore * (0.2 * otherWeight) + 
           voiceScore * (0.2 * otherWeight) +
           stableIntervalScore * stableWeight;
  }

  /**
   * Calculate progression distance (simplified version)
   * For now, uses average instability as a proxy for harmonic distance
   * Future: integrate Tonal.js for more sophisticated calculation
   * @param {Array} positions - Array of position objects
   * @returns {Number} Distance (0-10)
   */
  calculateProgressionDistance(positions) {
    if (!positions || positions.length === 0) return 0;
    
    const notes = positions.map(p => p.note);
    const avgInstability = calculateAverageInstability(notes);
    
    // Convert average instability to distance-like metric
    // Higher instability = further from tonic
    return avgInstability;
  }

  /**
   * Calculate variance of array
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  /**
   * Weighted random selection
   * @param {Array} candidates - Array of { position, score }
   * @returns {Number} Selected position
   */
  weightedRandomSelect(candidates) {
    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    if (totalScore === 0) {
      // Fallback to uniform random
      return candidates[Math.floor(Math.random() * candidates.length)].position;
    }

    let random = Math.random() * totalScore;
    
    for (const candidate of candidates) {
      random -= candidate.score;
      if (random <= 0) {
        return candidate.position;
      }
    }

    // Fallback
    return candidates[0].position;
  }

  /**
   * Get available positions (0-23: 3 voices * 8 steps)
   * @returns {Array} Array of available position indices
   */
  getAvailablePositions() {
    const SEQUENCER_STEPS = 8;
    const TOTAL_POSITIONS = 3 * SEQUENCER_STEPS; // 24 positions (3 voices * 8 steps)
    const used = new Set(this.assignedPositions.map(p => p.position));
    return Array.from({ length: TOTAL_POSITIONS }, (_, i) => i)
      .filter(p => !used.has(p));
  }

  /**
   * Add assigned position (after placement)
   * @param {Number} note - Note index (0-11)
   * @param {Number} position - Position index (0-35)
   */
  addAssignment(note, position) {
    this.assignedPositions.push({
      note,
      position,
      voice: Math.floor(position / 12),
      step: position % 12
    });
  }

  /**
   * Remove assignment (when particle is removed)
   * @param {Number} note - Note index
   * @param {Number} position - Position index
   */
  removeAssignment(note, position) {
    this.assignedPositions = this.assignedPositions.filter(p => 
      !(p.note === note && p.position === position)
    );
  }

  /**
   * Update assignments from existing assignments map
   * @param {Object} assignments - Map of { particleId: { voice, column } }
   * @param {Boolean} clearFirst - If true, clear existing assignments first (default: false)
   */
  updateAssignmentsFromMap(assignments, particles, clearFirst = false) {
    if (clearFirst) {
      this.assignedPositions = [];
    }
    
    // Remove assignments for particles that are no longer in the assignments map
    const currentParticleIds = new Set(Object.keys(assignments).map(id => parseInt(id)));
    this.assignedPositions = this.assignedPositions.filter(assignment => {
      // Keep assignments that match current particles
      const SEQUENCER_STEPS = 8;
      const particle = particles.find(p => {
        const note = p.getActiveNoteIndex();
        const voiceIndex = Math.floor(assignment.position / SEQUENCER_STEPS);
        const step = assignment.position % SEQUENCER_STEPS;
        const voice = voiceIndex === 0 ? 'bass' : voiceIndex === 1 ? 'baritone' : 'tenor';
        return note === assignment.note && 
               assignments[p.id]?.voice === voice &&
               assignments[p.id]?.column === step;
      });
      return particle && currentParticleIds.has(particle.id);
    });
    
    // Add or update assignments from map
    Object.entries(assignments).forEach(([particleIdStr, assignment]) => {
      const particleId = parseInt(particleIdStr);
      const particle = particles.find(p => p.id === particleId);
      if (!particle) return;

      const note = particle.getActiveNoteIndex();
      if (note < 0 || note >= 12) return;

      const SEQUENCER_STEPS = 8;
      const voiceIndex = assignment.voice === 'bass' ? 0 :
                        assignment.voice === 'baritone' ? 1 : 2;
      const position = voiceIndex * SEQUENCER_STEPS + assignment.column;

      // Check if assignment already exists
      const existingIndex = this.assignedPositions.findIndex(a => 
        a.note === note && a.position === position
      );
      
      if (existingIndex === -1) {
        // Add new assignment
        this.addAssignment(note, position);
      }
    });
  }

  /**
   * Get current assignments as map (for compatibility with existing code)
   * @returns {Object} Map of { particleId: { voice, column } }
   */
  getAssignmentsMap(particles) {
    const map = {};
    this.assignedPositions.forEach(assignment => {
      // Find particle with matching note at this position
      const particle = particles.find(p => {
        const note = p.getActiveNoteIndex();
        return note === assignment.note && 
               this.isParticleAtPosition(p.id, assignment.position, particles);
      });
      
      if (particle) {
        const voice = assignment.voice === 0 ? 'bass' :
                     assignment.voice === 1 ? 'baritone' : 'tenor';
        map[particle.id] = {
          voice,
          column: assignment.step
        };
      }
    });
    return map;
  }

  /**
   * Helper: check if particle is at position (for mapping)
   */
  isParticleAtPosition(particleId, position, particles) {
    // This is a simplified check - in practice, we'd track particle ID
    // For now, we'll rely on note matching
    return true;
  }

  /**
   * Clear all assignments
   */
  clear() {
    this.assignedPositions = [];
  }
}

