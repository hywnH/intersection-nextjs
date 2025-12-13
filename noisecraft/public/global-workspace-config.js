/**
 * Global Workspace Configuration
 * Centralized configuration constants and settings
 */

// Sequencer configuration
export const SEQUENCER_STEPS = 8; // Steps per voice (reduced from 12)
export const SEQUENCER_NODES = {
  global: {
    bass: 211,
    baritone: 212,
    tenor: 213
  }
};

// Stable harmony interval (minimum time before harmony can change)
export const STABLE_HARMONY_INTERVAL = 5000; // ms

// Harmonic progression threshold
export const USE_PROGRESSION_GENERATOR_THRESHOLD = 3; // Use progression generator for 3+ particles

// Available streams for global workspace
export const AVAILABLE_STREAMS = [
  "entropy",
  "rmsVelocity",
  "particleCount",
  "clusterCount",
  "inInnerPulsar",
  "outInnerPulsar",
];

// Interpolation modes
export const INTERPOLATION_MODES = ["linear", "logarithmic", "exponential"];

// Mathematical operations
export const OPERATIONS = [
  { value: "none", label: "None" },
  { value: "add", label: "Add (+)" },
  { value: "subtract", label: "Subtract (-)" },
  { value: "multiply", label: "Multiply (×)" },
  { value: "divide", label: "Divide (÷)" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "average", label: "Average" },
];

// Parameter update interval (throttle to 30fps)
export const PARAM_UPDATE_INTERVAL = 1000 / 30; // ~33ms

// Pulsar configuration
export const PULSAR_DURATION = 0.5; // seconds

// Particle system configuration
export const PARTICLE_CONFIG = {
  centerX: 575,
  centerY: 525,
  centralMass: 100,
  moonMass: 50,
  moonDistance: 100,
};

