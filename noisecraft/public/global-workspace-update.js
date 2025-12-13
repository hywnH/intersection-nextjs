/**
 * Global Workspace Update Loop
 * Main update and animation loop logic
 */

import { PARAM_UPDATE_INTERVAL, PULSAR_DURATION } from './global-workspace-config.js';
import { calculateEntropy, calculateRMSVelocity, calculateClusterCount, calculateInInnerPulsars, countInInnerConnections } from './global-workspace-calculations.js';
import { updateSequencerPatterns } from './global-workspace-sequencer.js';

// Update intervals
const SIGNAL_UPDATE_INTERVAL = 1000 / 60; // 60fps for UI updates

/**
 * Create update function for animation loop
 * @param {Object} components - Initialized components
 * @returns {Function} update(dt) function
 */
export function createUpdateFunction(components) {
  const {
    particleSystem,
    streamMapper,
    iframe,
    progressionGenerator,
    particleSequencerMapper,
    harmonicPlacer,
    patternManager,
    sequencerLogic,
    createParticlePatternPipeline
  } = components;
  
  let lastSignalUpdate = 0;
  let lastParamUpdate = 0;
  
  return function update(dt) {
    try {
      if (!particleSystem) {
        console.error("Particle system not initialized!");
        return;
      }
      
      // Update particle system (handles all physics)
      particleSystem.update(dt);
      
      // Get fresh particles reference
      const particles = particleSystem.getParticles();
      
      if (!particles || particles.length === 0) {
        console.error("⚠️ No particles found in system!");
        return;
      }
      
      const now = Date.now();
      
      // Throttle signal generation and UI updates (60fps max)
      if (now - lastSignalUpdate >= SIGNAL_UPDATE_INTERVAL) {
        lastSignalUpdate = now;
        
        // Calculate global metrics
        const entropy = calculateEntropy(particles);
        const rmsVelocity = calculateRMSVelocity(particles);
        const clusterCount = calculateClusterCount(particles);
        const pulsars = calculateInInnerPulsars(particles, dt, undefined, PULSAR_DURATION);
        
        // Count In Inner connections
        const signalGenerator = particleSystem.signalGenerator;
        const innerRadius = signalGenerator ? signalGenerator.innerRadius : 80;
        const inInnerNumber = countInInnerConnections(particles, innerRadius);
        
        // Update UI
        updateUI({
          entropy,
          rmsVelocity,
          clusterCount,
          inInnerNumber,
          pulsars,
          particleCount: particles.length
        });
      }
      
      // Throttle parameter updates (30fps max)
      if (now - lastParamUpdate >= PARAM_UPDATE_INTERVAL) {
        lastParamUpdate = now;
        
        // Calculate global signals
        const entropy = calculateEntropy(particles);
        const rmsVelocity = calculateRMSVelocity(particles);
        const particleCount = particles.length;
        const clusterCount = calculateClusterCount(particles);
        const pulsars = calculateInInnerPulsars(particles, dt, undefined, PULSAR_DURATION);
        
        const globalSignals = {
          entropy,
          rmsVelocity,
          particleCount,
          clusterCount,
          inInnerPulsar: pulsars.inInnerPulsar,
          outInnerPulsar: pulsars.outInnerPulsar
        };
        
        // Generate and send parameters
        if (streamMapper) {
          const params = streamMapper.generateParams(globalSignals);
          sendToNoiseCraft(params);
        }
        
        // Update sequencer patterns
        updateSequencerPatterns({
          particles,
          progressionGenerator,
          particleSequencerMapper,
          iframe,
          harmonicPlacer,
          patternManager,
          sequencerLogic,
          createParticlePatternPipeline
        });
      }
    } catch (updateError) {
      console.error("Update loop error:", updateError);
      console.error("Stack:", updateError.stack);
    }
  };
}

/**
 * Update UI elements with calculated values
 * @param {Object} metrics - Metrics to display
 */
function updateUI(metrics) {
  const {
    entropy,
    rmsVelocity,
    clusterCount,
    inInnerNumber,
    pulsars,
    particleCount
  } = metrics;
  
  const entropyEl = document.getElementById("system-entropy");
  const rmsEl = document.getElementById("system-rms-velocity");
  const clusterEl = document.getElementById("cluster-count");
  const globalParticleCountEl = document.getElementById("global-particle-count");
  const inInnerEl = document.getElementById("in-inner-number");
  const pulsarInEl = document.getElementById("in-inner-pulsar");
  const pulsarOutEl = document.getElementById("out-inner-pulsar");
  
  if (entropyEl) entropyEl.textContent = entropy.toFixed(2);
  if (rmsEl) rmsEl.textContent = rmsVelocity.toFixed(2);
  if (clusterEl) clusterEl.textContent = clusterCount.toString();
  if (globalParticleCountEl) globalParticleCountEl.textContent = particleCount.toString();
  if (inInnerEl) inInnerEl.textContent = inInnerNumber.toString();
  if (pulsarInEl) pulsarInEl.textContent = pulsars.inInnerPulsar.toString();
  if (pulsarOutEl) pulsarOutEl.textContent = pulsars.outInnerPulsar.toString();
}

/**
 * Send parameters to NoiseCraft
 * @param {Object} params - Parameters to send
 */
function sendToNoiseCraft(params) {
  const iframe = document.getElementById("noisecraft-iframe");
  if (iframe && iframe.contentWindow && params) {
    iframe.contentWindow.postMessage({
      type: 'noiseCraft:setParams',
      params: params
    }, '*');
  }
}

/**
 * Create animation loop
 * @param {Function} updateFn - Update function
 * @returns {Object} { start(), stop() }
 */
export function createAnimationLoop(updateFn) {
  let animationId = null;
  let lastTime = Date.now();
  let isRunning = false;
  
  function animate() {
    if (!isRunning) return;
    
    const now = Date.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    
    updateFn(dt);
    animationId = requestAnimationFrame(animate);
  }
  
  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      lastTime = Date.now();
      animate();
    },
    stop() {
      isRunning = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    }
  };
}

