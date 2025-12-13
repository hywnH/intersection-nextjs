/**
 * Global Workspace Initialization
 * Handles all initialization logic for the global workspace
 */

import { SEQUENCER_STEPS, PARTICLE_CONFIG } from './global-workspace-config.js';
import { VirtualParticle, SignalGenerator, ParticleSystem } from './global-particle-system.js';
import { createPatternAssignmentManager } from './pattern-assignment.js';
import { GlobalHarmonicPlacer } from './harmonic-placer.js';
import { ParticleSequencerMapper } from './particle-sequencer-mapper.js';
import { HarmonicProgressionGenerator } from './harmonic-progression.js';
import { SCALES } from './music-theory.js';

/**
 * Initialize all components for global workspace
 * @returns {Object} Initialized components
 */
export async function initializeGlobalWorkspace() {
  console.log("[Init] ===== INITIALIZING GLOBAL WORKSPACE =====");
  
  // Initialize particle system
  console.log("[Particle Init] Step 1: Creating particle system...");
  const particleSystem = new ParticleSystem({
    width: 1150,
    height: 1050,
    innerRadius: 200,
    outerRadius: 150,
    G: 500,
    minDistance: 3,
  });
  console.log("[Particle Init] ✓ ParticleSystem created");

  // Initialize pattern manager
  console.log("[Particle Init] Step 2: Creating pattern manager...");
  let patternManager;
  try {
    patternManager = createPatternAssignmentManager({
      mode: 'individual',
      key: 'C',
      scale: 'major'
    });
    console.log("[Particle Init] ✓ Pattern manager created");
  } catch (e) {
    console.error("[Particle Init] ✗ Failed to create pattern manager:", e);
  }

  // Initialize harmonic components
  const harmonicPlacer = new GlobalHarmonicPlacer('C', 'major');
  const particleSequencerMapper = new ParticleSequencerMapper();
  particleSequencerMapper.clear();
  window.particleSequencerMapper = particleSequencerMapper;

  // Initialize HarmonicProgressionGenerator
  const progressionGenerator = new HarmonicProgressionGenerator('C', 'major');
  window.progressionGenerator = progressionGenerator;
  console.log("[Init] ✓ HarmonicProgressionGenerator initialized with Tonal.js support");

  // Select random scale
  const availableScales = Object.keys(SCALES);
  const randomScaleIndex = Math.floor(Math.random() * availableScales.length);
  const currentScale = availableScales[randomScaleIndex];
  console.log(`[Music Theory] Using scale: ${currentScale}`);

  // Create initial particle
  console.log("[Particle Init] Step 3: Adding initial particle...");
  const { centerX, centerY, centralMass } = PARTICLE_CONFIG;
  const initialNote = Math.random() < 0.7 ? 7 : 0; // G (70%) or C (30%)
  
  const particle0 = particleSystem.addParticle(0, centerX, centerY, initialNote, centralMass);
  particle0.sequencerPattern = new Array(12).fill(0);
  
  if (patternManager) {
    patternManager.assignPattern(0, particle0.sequencerPattern);
  }

  // Assign initial particle
  if (particleSequencerMapper) {
    const assignment = particleSequencerMapper.assignParticle(particle0, 1);
    if (assignment) {
      console.log(`[Particle Init] Assigned initial particle (note: ${initialNote}) using (a,b,c) mapper`);
      window._initialParticleAssignment = assignment;
    }
  }

  console.log("[Particle Init] ✓ Initial particle added successfully");

  return {
    particleSystem,
    patternManager,
    harmonicPlacer,
    particleSequencerMapper,
    progressionGenerator,
    currentScale,
    particles: particleSystem.getParticles()
  };
}

/**
 * Setup navigation prevention
 */
export function setupNavigationPrevention() {
  // Push a state to the history stack
  history.pushState(null, null, location.href);
  
  // Listen for popstate events
  window.addEventListener('popstate', function(event) {
    console.log('[Navigation] Back navigation detected, preventing reload...');
    history.pushState(null, null, location.href);
    
    const statusEl = document.getElementById('status');
    if (statusEl) {
      const originalText = statusEl.textContent;
      statusEl.textContent = 'Back navigation prevented (use browser controls instead)';
      statusEl.style.color = '#ffa';
      setTimeout(() => {
        statusEl.textContent = originalText;
        statusEl.style.color = '';
      }, 2000);
    }
  });
  
  // Prevent swipe gestures
  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  
  document.addEventListener('touchmove', function(e) {
    if (!touchStartX || !touchStartY) return;
    
    const touchEndX = e.touches[0].clientX;
    const touchEndY = e.touches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      e.preventDefault();
    }
  }, { passive: false });
  
  console.log('[Navigation] Back navigation prevention enabled');
}

