/**
 * Sequencer Pattern Generator Module
 * Manages unique sequencer patterns for each particle/user
 * Supports both individual and global audio scenarios
 */

export class SequencerPatternGenerator {
  constructor(options = {}) {
    this.numNotes = options.numNotes || 12; // 12-tone chromatic
    this.useMusicTheory = options.useMusicTheory !== false;
    this.patternRegistry = new Map(); // particleId -> pattern
    this.patternHistory = []; // Track pattern assignments for debugging
  }

  /**
   * Generate a unique pattern for a new particle/user
   * Ensures no duplicate patterns are assigned
   * @param {Number} particleId - Unique particle ID
   * @param {String} scaleName - Optional scale name for music theory
   * @param {Array} excludePatterns - Patterns to avoid (already assigned)
   * @returns {Array} Pattern array like [1,0,0,...,0]
   */
  generateUniquePattern(particleId, scaleName = null, excludePatterns = []) {
    // Check if pattern already exists for this particle
    if (this.patternRegistry.has(particleId)) {
      console.log(`[PatternGen] Pattern already exists for particle ${particleId}, returning existing`);
      return this.patternRegistry.get(particleId);
    }

    let pattern;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      // Use music theory if available
      if (this.useMusicTheory && typeof window !== 'undefined' && window.generateHarmoniousPattern) {
        try {
          pattern = window.generateHarmoniousPattern(
            scaleName || 'C Pentatonic Major',
            null,
            this.numNotes
          );
        } catch (e) {
          console.warn('[PatternGen] Music theory failed, using random:', e);
          pattern = this.generateRandomPattern();
        }
      } else {
        pattern = this.generateRandomPattern();
      }

      // Check if this pattern is already assigned
      const isDuplicate = this.isPatternDuplicate(pattern, excludePatterns);
      
      if (!isDuplicate) {
        break;
      }

      attempts++;
      if (attempts >= maxAttempts) {
        console.warn(`[PatternGen] Max attempts reached for particle ${particleId}, using generated pattern anyway`);
        break;
      }
    } while (true);

    // Register and return pattern
    this.patternRegistry.set(particleId, pattern);
    this.patternHistory.push({
      particleId,
      pattern,
      timestamp: Date.now(),
      noteIndex: pattern.findIndex(v => v === 1)
    });

    console.log(`[PatternGen] Assigned pattern to particle ${particleId}: note ${pattern.findIndex(v => v === 1)}`);
    return pattern;
  }

  /**
   * Generate a random pattern with exactly one active note
   */
  generateRandomPattern() {
    const pattern = new Array(this.numNotes).fill(0);
    const activeNoteIndex = Math.floor(Math.random() * this.numNotes);
    pattern[activeNoteIndex] = 1;
    return pattern;
  }

  /**
   * Check if a pattern is duplicate
   */
  isPatternDuplicate(pattern, excludePatterns = []) {
    // Check against registry
    for (const [id, existingPattern] of this.patternRegistry.entries()) {
      if (this.patternsEqual(pattern, existingPattern)) {
        return true;
      }
    }

    // Check against exclude list
    for (const excludedPattern of excludePatterns) {
      if (this.patternsEqual(pattern, excludedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compare two patterns for equality
   */
  patternsEqual(p1, p2) {
    if (!Array.isArray(p1) || !Array.isArray(p2)) return false;
    if (p1.length !== p2.length) return false;
    return p1.every((val, idx) => val === p2[idx]);
  }

  /**
   * Get pattern for a particle
   */
  getPattern(particleId) {
    return this.patternRegistry.get(particleId) || null;
  }

  /**
   * Update pattern for a particle (e.g., when user changes scale)
   */
  updatePattern(particleId, newPattern) {
    if (!Array.isArray(newPattern) || newPattern.length !== this.numNotes) {
      throw new Error(`Invalid pattern: expected array of length ${this.numNotes}`);
    }
    
    this.patternRegistry.set(particleId, newPattern);
    this.patternHistory.push({
      particleId,
      pattern: newPattern,
      timestamp: Date.now(),
      noteIndex: newPattern.findIndex(v => v === 1),
      action: 'updated'
    });
  }

  /**
   * Remove pattern for a particle (when user leaves)
   */
  removePattern(particleId) {
    const removed = this.patternRegistry.delete(particleId);
    if (removed) {
      this.patternHistory.push({
        particleId,
        timestamp: Date.now(),
        action: 'removed'
      });
      console.log(`[PatternGen] Removed pattern for particle ${particleId}`);
    }
    return removed;
  }

  /**
   * Get all assigned patterns (for debugging)
   */
  getAllPatterns() {
    return Array.from(this.patternRegistry.entries()).map(([id, pattern]) => ({
      particleId: id,
      pattern,
      noteIndex: pattern.findIndex(v => v === 1)
    }));
  }

  /**
   * Clear all patterns (reset)
   */
  clear() {
    this.patternRegistry.clear();
    this.patternHistory = [];
  }

  /**
   * Export pattern registry for persistence
   */
  exportRegistry() {
    return {
      patterns: Array.from(this.patternRegistry.entries()).map(([id, pattern]) => ({
        particleId: id,
        pattern
      })),
      history: this.patternHistory,
      metadata: {
        numNotes: this.numNotes,
        useMusicTheory: this.useMusicTheory,
        exportTime: Date.now()
      }
    };
  }

  /**
   * Import pattern registry from saved data
   */
  importRegistry(data) {
    if (!data || !data.patterns) {
      throw new Error('Invalid registry data');
    }

    this.clear();
    
    data.patterns.forEach(({ particleId, pattern }) => {
      if (Array.isArray(pattern) && pattern.length === this.numNotes) {
        this.patternRegistry.set(particleId, pattern);
      }
    });

    if (data.history) {
      this.patternHistory = data.history;
    }

    console.log(`[PatternGen] Imported ${this.patternRegistry.size} patterns`);
  }
}

/**
 * Factory function to create pattern generator with default settings
 */
export function createPatternGenerator(options = {}) {
  return new SequencerPatternGenerator(options);
}

