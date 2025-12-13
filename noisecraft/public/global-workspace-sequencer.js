/**
 * Global Workspace Sequencer Updates
 * Handles sequencer pattern generation and updates
 */

import { SEQUENCER_STEPS, SEQUENCER_NODES, STABLE_HARMONY_INTERVAL, USE_PROGRESSION_GENERATOR_THRESHOLD } from './global-workspace-config.js';
import { updateMonoSeqSequencer } from './sequencer-logic.js';

/**
 * Update sequencer patterns using HarmonicProgressionGenerator or ParticleSequencerMapper
 * @param {Object} options - Update options
 * @param {Array} options.particles - Array of particles
 * @param {Object} options.progressionGenerator - HarmonicProgressionGenerator instance
 * @param {Object} options.particleSequencerMapper - ParticleSequencerMapper instance
 * @param {Object} options.iframe - NoiseCraft iframe element
 * @param {Object} options.harmonicPlacer - GlobalHarmonicPlacer instance
 * @param {Object} options.patternManager - Pattern manager instance
 * @param {Object} options.sequencerLogic - SequencerLogic instance
 * @param {Function} options.createParticlePatternPipeline - Pipeline factory function
 * @returns {Object|null} Updated pattern or null if skipped
 */
export async function updateSequencerPatterns({
  particles,
  progressionGenerator,
  particleSequencerMapper,
  iframe,
  harmonicPlacer,
  patternManager,
  sequencerLogic,
  createParticlePatternPipeline
}) {
  if (!iframe || !iframe.contentWindow || particles.length === 0) {
    return null;
  }
  
  let globalPattern;
  const shouldUseProgression = particles.length >= USE_PROGRESSION_GENERATOR_THRESHOLD && progressionGenerator;
  
  // Use HarmonicProgressionGenerator for 3+ particles
  if (shouldUseProgression) {
    // Collect all particle notes (0-11)
    const allParticleNotes = particles.map(p => {
      const note = p.tone !== undefined ? (p.tone % 12) : (p.getActiveNoteIndex ? p.getActiveNoteIndex() : 0);
      return note >= 0 && note < 12 ? note : 0;
    }).filter(note => note >= 0 && note < 12);
    
    // Calculate current step (0-7, cycles every 8 steps)
    if (!window._progressionStepCounter) {
      window._progressionStepCounter = 0;
    }
    const currentStep = window._progressionStepCounter;
    
    try {
      const pattern = await progressionGenerator.generateFullCyclePattern(allParticleNotes, currentStep);
      
      // Update step counter for next cycle
      window._progressionStepCounter = (window._progressionStepCounter + 1) % 8;
      
      // Apply pattern with stable harmony interval check
      return await applySequencerPattern(pattern, iframe);
    } catch (err) {
      console.error("[HarmonicProgression] Error generating pattern:", err);
      // Fall through to particleSequencerMapper
    }
  }
  
  // Use ParticleSequencerMapper for 1-2 particles or as fallback
  if (particleSequencerMapper) {
    // Clear any stale assignments
    const existingParticleIds = new Set(particles.map(p => p.id));
    const staleAssignments = [];
    particleSequencerMapper.particleAssignments.forEach((assignment, particleId) => {
      if (!existingParticleIds.has(particleId)) {
        staleAssignments.push(particleId);
      }
    });
    staleAssignments.forEach(pid => particleSequencerMapper.removeParticle(pid));
    
    // Ensure all current particles are assigned
    particles.forEach(particle => {
      if (!particleSequencerMapper.particleAssignments.has(particle.id)) {
        particleSequencerMapper.assignParticle(particle, particles.length);
      }
    });
    
    // Convert to NoiseCraft format
    globalPattern = particleSequencerMapper.toNoiseCraftFormat();
    
    // Debug: Verify assignment count
    const assignmentCount = particleSequencerMapper.getAssignmentCount();
    if (assignmentCount !== particles.length) {
      console.warn(`[Global] Assignment mismatch: ${assignmentCount} assignments for ${particles.length} particles`);
    }
  } else {
    // Fallback to old method
    if (!window.globalParticleAssignments) {
      window.globalParticleAssignments = {};
    }
    
    const patternPipeline = window.patternPipeline || createParticlePatternPipeline({
      mode: 'global',
      harmonicPlacer: harmonicPlacer,
      patternManager: patternManager
    });
    
    particles.forEach(particle => {
      if (!window.globalParticleAssignments[particle.id]) {
        const assignment = patternPipeline.assignGlobalPositionToParticle(particle, particles.length);
        if (assignment) {
          window.globalParticleAssignments[particle.id] = assignment;
        }
      }
    });
    
    globalPattern = sequencerLogic.generateGlobalPattern(
      particles,
      window.globalParticleAssignments,
      harmonicPlacer,
      false
    );
    window.globalParticleAssignments = globalPattern.assignments || {};
  }
  
  return await applySequencerPattern(globalPattern, iframe);
}

/**
 * Apply sequencer pattern to NoiseCraft with stable harmony interval check
 * @param {Object} pattern - Pattern object { bass, baritone, tenor }
 * @param {Object} iframe - NoiseCraft iframe element
 * @returns {Object|null} Pattern if applied, null if skipped
 */
async function applySequencerPattern(pattern, iframe) {
  const patternKey = JSON.stringify({
    bass: pattern.bass.map(step => step.join(',')),
    baritone: pattern.baritone.map(step => step.join(',')),
    tenor: pattern.tenor.map(step => step.join(','))
  });
  
  const prevPattern = window.previousSequencerPattern;
  
  // Check if pattern changed
  if (prevPattern && prevPattern === patternKey) {
    // Check for pending pattern
    if (window._pendingHarmonyPattern) {
      const now = Date.now();
      const lastHarmonyChange = window._lastHarmonyChangeTime || 0;
      const timeSinceLastChange = now - lastHarmonyChange;
      
      if (timeSinceLastChange >= STABLE_HARMONY_INTERVAL) {
        // Apply pending pattern
        const pendingPattern = window._pendingHarmonyPattern;
        const pendingData = window._pendingHarmonyPatternData;
        
        window._lastHarmonyChangeTime = now;
        window._pendingHarmonyPattern = null;
        window._pendingHarmonyPatternData = null;
        
        requestAnimationFrame(() => {
          updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.bass, 0, pendingData.bass, SEQUENCER_STEPS);
          updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.baritone, 0, pendingData.baritone, SEQUENCER_STEPS);
          updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.tenor, 0, pendingData.tenor, SEQUENCER_STEPS);
        });
        
        window.previousSequencerPattern = pendingPattern;
        return pendingData;
      }
    }
    return null; // Pattern unchanged
  }
  
  // Pattern changed - check stable harmony interval
  const now = Date.now();
  const lastHarmonyChange = window._lastHarmonyChangeTime || 0;
  const timeSinceLastChange = now - lastHarmonyChange;
  
  if (timeSinceLastChange < STABLE_HARMONY_INTERVAL) {
    // Store pending pattern
    window._pendingHarmonyPattern = patternKey;
    window._pendingHarmonyPatternData = pattern;
    return null; // Skip this update
  }
  
  // Apply pattern
  window._lastHarmonyChangeTime = now;
  window._pendingHarmonyPattern = null;
  window._pendingHarmonyPatternData = null;
  
  // Log pattern update (throttled)
  const bassActiveCells = pattern.bass.reduce((sum, step) => 
    sum + step.reduce((stepSum, cell) => stepSum + (cell === 1 ? 1 : 0), 0), 0);
  const baritoneActiveCells = pattern.baritone.reduce((sum, step) => 
    sum + step.reduce((stepSum, cell) => stepSum + (cell === 1 ? 1 : 0), 0), 0);
  const tenorActiveCells = pattern.tenor.reduce((sum, step) => 
    sum + step.reduce((stepSum, cell) => stepSum + (cell === 1 ? 1 : 0), 0), 0);
  
  if (bassActiveCells === 0 && baritoneActiveCells === 0 && tenorActiveCells === 0) {
    console.warn(`[Global Sequencer] ⚠️ All patterns are empty!`);
  } else {
    const shouldLog = !window._lastPatternUpdateLog || Date.now() - window._lastPatternUpdateLog > 3000;
    if (shouldLog) {
      console.log(`[Global Sequencer] Pattern changed - Bass: ${bassActiveCells}, Baritone: ${baritoneActiveCells}, Tenor: ${tenorActiveCells} cells`);
      window._lastPatternUpdateLog = Date.now();
    }
  }
  
  // Apply to NoiseCraft
  requestAnimationFrame(() => {
    updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.bass, 0, pattern.bass, SEQUENCER_STEPS);
    updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.baritone, 0, pattern.baritone, SEQUENCER_STEPS);
    updateMonoSeqSequencer(iframe.contentWindow, SEQUENCER_NODES.global.tenor, 0, pattern.tenor, SEQUENCER_STEPS);
  });
  
  window.previousSequencerPattern = patternKey;
  return pattern;
}

