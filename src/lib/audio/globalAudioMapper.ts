/**
 * Global Audio Mapper
 * 
 * Maps global system state (clusters, users, entropy) to NoiseCraft parameters
 * Uses music theory to assign patterns based on tension and harmonic progression
 */

import type { NoiseCraftParam } from "./noiseCraft";
import type { PlayerSnapshot } from "@/types/game";
import type { AnnotatedCluster } from "@/lib/game/clusters";
import {
  GlobalVirtualSignalGenerator,
  calculateGlobalMetrics,
  createUserCountModulationConfig,
  createEntropyModulationConfig,
  createTensionModulationConfig,
  createClusterSizeModulationConfig,
} from "./globalVirtualSignals";
import { parseNoiseCraftFile, extractNodeInfo, findNodeByName } from "./nodeMapper";

/**
 * Music theory: Harmonic progression based on tension
 * Low tension -> Tonic (I), Subdominant (IV)
 * High tension -> Dominant (V), Leading tone (vii°)
 */
export interface HarmonicState {
  root: number; // 0-11 (chromatic)
  chordType: "maj" | "min" | "dim" | "aug";
  tension: number; // 0-1
}

/**
 * Calculate harmonic state from tension
 */
export function calculateHarmonicState(tension: number): HarmonicState {
  // Map tension to chord progression
  // Low tension (0-0.3): Tonic (I) - C major
  // Medium tension (0.3-0.7): Subdominant (IV) - F major
  // High tension (0.7-1.0): Dominant (V) - G major, or Leading tone (vii°) - B diminished
  
  let root: number;
  let chordType: "maj" | "min" | "dim" | "aug";
  
  if (tension < 0.3) {
    // Tonic: C major (0)
    root = 0;
    chordType = "maj";
  } else if (tension < 0.7) {
    // Subdominant: F major (5)
    root = 5;
    chordType = "maj";
  } else {
    // Dominant or Leading tone: G major (7) or B diminished (11)
    if (tension < 0.85) {
      root = 7; // G major
      chordType = "maj";
    } else {
      root = 11; // B diminished
      chordType = "dim";
    }
  }
  
  return { root, chordType, tension };
}

/**
 * Generate pattern for a sequencer based on harmonic state
 * Returns a 12-step pattern with notes from the chord
 */
export function generatePatternFromHarmonic(
  harmonicState: HarmonicState,
  voice: "bass" | "baritone" | "tenor"
): number[][] {
  const { root, chordType } = harmonicState;
  
  // Chord intervals based on type
  const chordIntervals: Record<string, number[]> = {
    maj: [0, 4, 7], // Root, Major third, Perfect fifth
    min: [0, 3, 7], // Root, Minor third, Perfect fifth
    dim: [0, 3, 6], // Root, Minor third, Diminished fifth
    aug: [0, 4, 8], // Root, Major third, Augmented fifth
  };
  
  const intervals = chordIntervals[chordType] || chordIntervals.maj;
  
  // Voice-specific octave offsets
  const octaveOffsets: Record<string, number> = {
    bass: 0,      // C2 = 24 (MIDI note 24)
    baritone: 12, // C3 = 36
    tenor: 24,    // C4 = 48
  };
  
  const baseOctave = octaveOffsets[voice] || 0;
  
  // Create 12-step pattern
  const pattern: number[][] = Array(12).fill(null).map(() => Array(12).fill(0));
  
  // Fill pattern with chord notes
  // More tension -> more complex rhythm and dissonance
  const { tension } = harmonicState;
  const noteDensity = 0.3 + tension * 0.4; // 0.3 to 0.7
  
  for (let step = 0; step < 12; step++) {
    // Decide if this step should have a note
    if (Math.random() < noteDensity) {
      // Choose a chord tone
      const intervalIndex = Math.floor(Math.random() * intervals.length);
      const interval = intervals[intervalIndex];
      const note = (root + interval) % 12;
      
      // Set the note in the pattern
      pattern[step][note] = 1;
      
      // Add some variation: occasionally add non-chord tones for high tension
      if (tension > 0.7 && Math.random() < 0.2) {
        const nonChordTone = (note + (Math.random() < 0.5 ? 1 : -1)) % 12;
        pattern[step][nonChordTone] = 1;
      }
    }
  }
  
  return pattern;
}

/**
 * Global Audio Mapper
 * Manages the mapping from global state to NoiseCraft parameters
 */
export class GlobalAudioMapper {
  private generator: GlobalVirtualSignalGenerator;
  private project: any = null;
  private nodesMap: Map<string, any> = new Map();
  private iframe: HTMLIFrameElement | null = null;
  private origin: string | null = null;

  constructor(initialMetrics: {
    userCount: number;
    clusterCount: number;
    averageClusterSize: number;
    maxClusterSize: number;
    entropy: number;
    totalParticles: number;
  }) {
    this.generator = new GlobalVirtualSignalGenerator(initialMetrics);
  }

  /**
   * Initialize with NoiseCraft project
   */
  async initialize(projectPath: string = "/noisecraft/examples/global_audio_map.ncft") {
    try {
      const fileContent = await fetch(projectPath).then((r) => r.text());
      this.project = parseNoiseCraftFile(fileContent);
      this.nodesMap = extractNodeInfo(this.project);
      
      // Find modulatable nodes
      const tensionNode = findNodeByName(this.nodesMap, "%");
      const volNode = findNodeByName(this.nodesMap, "Global Vol CHORDS");
      const factNode = findNodeByName(this.nodesMap, "fact");
      
      // Configure signals
      if (tensionNode) {
        this.generator.addSignal(
          createTensionModulationConfig(tensionNode.id, "value", 0, 1)
        );
      }
      
      if (volNode) {
        this.generator.addSignal(
          createUserCountModulationConfig(volNode.id, "value", 0, 1)
        );
      }
      
      if (factNode) {
        this.generator.addSignal(
          createEntropyModulationConfig(factNode.id, "value", 0, 0.1)
        );
      }
    } catch (error) {
      console.error("Failed to initialize global audio mapper:", error);
    }
  }

  /**
   * Set iframe reference for posting parameters
   */
  setIframe(iframe: HTMLIFrameElement | null, origin: string | null) {
    this.iframe = iframe;
    this.origin = origin;
  }

  /**
   * Update from game state
   */
  update(
    players: PlayerSnapshot[],
    clusters: AnnotatedCluster[]
  ) {
    // Calculate metrics
    const metrics = calculateGlobalMetrics(players, clusters);
    this.generator.updateMetrics(metrics);
    
    // Simulate random particles
    this.generator.simulate(1 / 60);
    
    // Generate and send parameters
    const params = this.generator.generateParams();
    if (params.length > 0 && this.iframe && this.origin) {
      this.postParams(params);
    }
    
    // Update sequencer patterns based on harmonic state
    this.updateSequencerPatterns(metrics);
  }

  /**
   * Update sequencer patterns based on harmonic progression
   */
  private updateSequencerPatterns(metrics: {
    userCount: number;
    clusterCount: number;
    averageClusterSize: number;
    maxClusterSize: number;
    entropy: number;
    totalParticles: number;
  }) {
    const tension = this.generator.calculateTension();
    const harmonicState = calculateHarmonicState(tension);
    
    // Find sequencer nodes
    const bassNode = findNodeByName(this.nodesMap, "globalBass");
    const baritoneNode = findNodeByName(this.nodesMap, "globalBaritone");
    const tenorNode = findNodeByName(this.nodesMap, "globalTenor");
    
    // Generate patterns
    if (bassNode) {
      const pattern = generatePatternFromHarmonic(harmonicState, "bass");
      this.updateSequencerPattern(bassNode.id, pattern);
    }
    
    if (baritoneNode) {
      const pattern = generatePatternFromHarmonic(harmonicState, "baritone");
      this.updateSequencerPattern(baritoneNode.id, pattern);
    }
    
    if (tenorNode) {
      const pattern = generatePatternFromHarmonic(harmonicState, "tenor");
      this.updateSequencerPattern(tenorNode.id, pattern);
    }
  }

  /**
   * Update a sequencer pattern
   */
  private updateSequencerPattern(nodeId: string, pattern: number[][]) {
    if (!this.iframe || !this.origin) return;
    
    // Post pattern update to NoiseCraft
    this.iframe.contentWindow?.postMessage(
      {
        type: "noiseCraft:setPattern",
        nodeId,
        pattern,
      },
      this.origin
    );
  }

  /**
   * Post parameters to NoiseCraft
   */
  private postParams(params: NoiseCraftParam[]) {
    if (!this.iframe || !this.origin) return;
    
    this.iframe.contentWindow?.postMessage(
      { type: "noiseCraft:setParams", params },
      this.origin
    );
  }

  /**
   * Add a random particle for testing
   */
  addRandomParticle(bounds: { width: number; height: number }) {
    const id = `global-particle-${Date.now()}-${Math.random()}`;
    return this.generator.createRandomParticle(id, bounds);
  }

  /**
   * Get all particles
   */
  getParticles() {
    return this.generator.getParticles();
  }

  /**
   * Remove a particle
   */
  removeParticle(id: string) {
    this.generator.removeParticle(id);
  }
}


