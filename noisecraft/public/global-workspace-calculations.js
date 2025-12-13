/**
 * Global Workspace Calculations
 * Utility functions for calculating system metrics
 */

/**
 * Calculate system entropy (measure of disorder/randomness)
 * @param {Array} particles - Array of particles
 * @returns {Number} Entropy value (0-1)
 */
export function calculateEntropy(particles) {
  if (!particles || particles.length === 0) return 0;
  
  // Calculate velocity distribution
  const velocities = particles.map(p => {
    const vx = p.velocity?.x || 0;
    const vy = p.velocity?.y || 0;
    return Math.sqrt(vx * vx + vy * vy);
  });
  
  // Normalize velocities
  const maxVel = Math.max(...velocities, 1);
  const normalized = velocities.map(v => v / maxVel);
  
  // Calculate entropy using Shannon entropy formula
  const bins = 10;
  const histogram = new Array(bins).fill(0);
  normalized.forEach(v => {
    const bin = Math.min(Math.floor(v * bins), bins - 1);
    histogram[bin]++;
  });
  
  let entropy = 0;
  histogram.forEach(count => {
    if (count > 0) {
      const p = count / particles.length;
      entropy -= p * Math.log2(p);
    }
  });
  
  // Normalize to 0-1 range
  return entropy / Math.log2(bins);
}

/**
 * Calculate RMS (Root Mean Square) velocity
 * @param {Array} particles - Array of particles
 * @returns {Number} RMS velocity
 */
export function calculateRMSVelocity(particles) {
  if (!particles || particles.length === 0) return 0;
  
  let sumSquared = 0;
  particles.forEach(p => {
    const vx = p.velocity?.x || 0;
    const vy = p.velocity?.y || 0;
    const speed = Math.sqrt(vx * vx + vy * vy);
    sumSquared += speed * speed;
  });
  
  return Math.sqrt(sumSquared / particles.length);
}

/**
 * Calculate cluster count (particles within inner radius)
 * @param {Array} particles - Array of particles
 * @param {Number} innerRadius - Inner radius threshold
 * @returns {Number} Number of clusters
 */
export function calculateClusterCount(particles, innerRadius = 80) {
  if (!particles || particles.length === 0) return 0;
  
  const visited = new Set();
  let clusterCount = 0;
  
  particles.forEach(p => {
    if (visited.has(p.id)) return;
    
    // BFS to find all connected particles
    const cluster = [];
    const queue = [p];
    visited.add(p.id);
    
    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);
      
      particles.forEach(other => {
        if (visited.has(other.id)) return;
        
        const dx = other.position.x - current.position.x;
        const dy = other.position.y - current.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= innerRadius) {
          visited.add(other.id);
          queue.push(other);
        }
      });
    }
    
    if (cluster.length > 0) {
      clusterCount++;
    }
  });
  
  return clusterCount;
}

/**
 * Calculate in-inner pulsar state
 * @param {Array} particles - Array of particles
 * @param {Number} dt - Delta time
 * @param {Number} innerRadius - Inner radius threshold
 * @param {Number} pulsarDuration - Pulsar duration in seconds
 * @returns {Object} { inInnerPulsar: 0|1, outInnerPulsar: 0|1 }
 */
export function calculateInInnerPulsars(particles, dt, innerRadius = 80, pulsarDuration = 0.5) {
  if (!particles || particles.length === 0) {
    return { inInnerPulsar: 0, outInnerPulsar: 0 };
  }
  
  // Initialize state if not exists
  if (!window._pulsarState) {
    window._pulsarState = {
      previousInInnerState: new Map(),
      inInnerPulsarTimer: 0,
      outInnerPulsarTimer: 0
    };
  }
  
  const state = window._pulsarState;
  const currentInInnerState = new Map();
  
  // Determine current in-inner connections
  particles.forEach(p => {
    const neighbors = new Set();
    particles.forEach(other => {
      if (other.id !== p.id) {
        const dx = other.position.x - p.position.x;
        const dy = other.position.y - p.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= innerRadius) {
          neighbors.add(other.id);
        }
      }
    });
    currentInInnerState.set(p.id, neighbors);
  });
  
  // Check for state changes
  let inInnerPulsarTimer = state.inInnerPulsarTimer;
  let outInnerPulsarTimer = state.outInnerPulsarTimer;
  
  currentInInnerState.forEach((neighbors, particleId) => {
    const previousNeighbors = state.previousInInnerState.get(particleId) || new Set();
    
    // Check if state changed
    const isSame = neighbors.size === previousNeighbors.size &&
                   [...neighbors].every(n => previousNeighbors.has(n));
    
    if (!isSame) {
      // State changed - trigger pulsar
      if (neighbors.size > previousNeighbors.size) {
        // Entered inner - trigger in-inner pulsar
        inInnerPulsarTimer = pulsarDuration;
      } else if (neighbors.size < previousNeighbors.size) {
        // Exited inner - trigger out-inner pulsar
        outInnerPulsarTimer = pulsarDuration;
      }
    }
  });
  
  // Update timers
  if (inInnerPulsarTimer > 0) {
    inInnerPulsarTimer = Math.max(0, inInnerPulsarTimer - dt);
  }
  if (outInnerPulsarTimer > 0) {
    outInnerPulsarTimer = Math.max(0, outInnerPulsarTimer - dt);
  }
  
  // Update state
  state.inInnerPulsarTimer = inInnerPulsarTimer;
  state.outInnerPulsarTimer = outInnerPulsarTimer;
  state.previousInInnerState = new Map();
  currentInInnerState.forEach((neighbors, particleId) => {
    state.previousInInnerState.set(particleId, new Set(neighbors));
  });
  
  return {
    inInnerPulsar: inInnerPulsarTimer > 0 ? 1 : 0,
    outInnerPulsar: outInnerPulsarTimer > 0 ? 1 : 0
  };
}

/**
 * Count in-inner connections
 * @param {Array} particles - Array of particles
 * @param {Number} innerRadius - Inner radius threshold
 * @returns {Number} Number of in-inner connections
 */
export function countInInnerConnections(particles, innerRadius = 80) {
  if (!particles || particles.length === 0) return 0;
  
  let inInnerNumber = 0;
  particles.forEach(p => {
    particles.forEach(other => {
      if (other.id !== p.id) {
        const dx = other.position.x - p.position.x;
        const dy = other.position.y - p.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= innerRadius) {
          inInnerNumber++;
        }
      }
    });
  });
  
  return Math.floor(inInnerNumber / 2); // Each connection counted twice
}

