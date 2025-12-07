/**
 * Global Virtual Signal Generator
 * 
 * Generates virtual signals for global audio mapping based on:
 * - Cluster information (size, count)
 * - Total user count
 * - Average particle velocity (entropy)
 * - Random particle movement
 */

import type { NoiseCraftParam } from "./noiseCraft";
import type { PlayerSnapshot } from "@/types/game";
import type { AnnotatedCluster } from "@/lib/game/clusters";
import { randomChromaticTone, type VirtualParticle } from "./virtualSignals";

/**
 * Global system metrics
 */
export interface GlobalMetrics {
  userCount: number;
  clusterCount: number;
  averageClusterSize: number;
  maxClusterSize: number;
  entropy: number; // Average velocity magnitude (0-1 normalized)
  totalParticles: number;
}

/**
 * Calculate entropy from particle velocities
 */
export function calculateEntropy(players: PlayerSnapshot[]): number {
  if (players.length === 0) return 0;
  
  let totalVelocity = 0;
  for (const player of players) {
    const vx = player.cell.velocity.x;
    const vy = player.cell.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    totalVelocity += speed;
  }
  
  const avgVelocity = totalVelocity / players.length;
  // Normalize to 0-1 (assuming max velocity of 320)
  return Math.min(avgVelocity / 320, 1);
}

/**
 * Calculate global metrics from players and clusters
 */
export function calculateGlobalMetrics(
  players: PlayerSnapshot[],
  clusters: AnnotatedCluster[]
): GlobalMetrics {
  const userCount = players.length;
  const clusterCount = clusters.length;
  const significantClusters = clusters.filter(c => c.isMulti);
  
  const avgClusterSize = significantClusters.length > 0
    ? significantClusters.reduce((sum, c) => sum + c.memberCount, 0) / significantClusters.length
    : 0;
  
  const maxClusterSize = significantClusters.length > 0
    ? Math.max(...significantClusters.map(c => c.memberCount))
    : 0;
  
  const entropy = calculateEntropy(players);
  
  return {
    userCount,
    clusterCount,
    averageClusterSize: avgClusterSize,
    maxClusterSize,
    entropy,
    totalParticles: userCount,
  };
}

/**
 * Global signal configuration
 */
export interface GlobalSignalConfig {
  nodeId: string;
  paramName?: string;
  signalType: "userCount" | "clusterCount" | "clusterSize" | "entropy" | "tension";
  minValue: number;
  maxValue: number;
  inverted?: boolean;
}

/**
 * Global Virtual Signal Generator
 * Manages random particles for global audio mapping
 */
export class GlobalVirtualSignalGenerator {
  private particles: Map<string, VirtualParticle> = new Map();
  private configs: GlobalSignalConfig[] = [];
  private metrics: GlobalMetrics;
  private lastUpdateTime: number = Date.now();

  constructor(initialMetrics: GlobalMetrics) {
    this.metrics = initialMetrics;
  }

  /**
   * Update global metrics
   */
  updateMetrics(metrics: GlobalMetrics): void {
    this.metrics = metrics;
  }

  /**
   * Add a signal configuration
   */
  addSignal(config: GlobalSignalConfig): void {
    this.configs.push(config);
  }

  /**
   * Create a random particle for global audio mapping
   */
  createRandomParticle(
    id: string,
    bounds: { width: number; height: number } = { width: 5000, height: 5000 }
  ): VirtualParticle {
    const particle: VirtualParticle = {
      id,
      position: {
        x: Math.random() * bounds.width,
        y: Math.random() * bounds.height,
      },
      velocity: {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
      },
      mass: 1,
      radius: 20,
      tone: randomChromaticTone(),
      createdAt: Date.now(),
    };
    this.particles.set(id, particle);
    return particle;
  }

  /**
   * Update particle with random movement
   */
  updateParticleRandom(id: string, dt: number = 1 / 60): void {
    const particle = this.particles.get(id);
    if (!particle) return;

    // Random walk with some momentum
    const noiseX = (Math.random() - 0.5) * 50;
    const noiseY = (Math.random() - 0.5) * 50;
    
    particle.velocity.x = particle.velocity.x * 0.9 + noiseX * 0.1;
    particle.velocity.y = particle.velocity.y * 0.9 + noiseY * 0.1;
    
    // Clamp velocity
    const maxVel = 200;
    const speed = Math.sqrt(particle.velocity.x ** 2 + particle.velocity.y ** 2);
    if (speed > maxVel) {
      particle.velocity.x = (particle.velocity.x / speed) * maxVel;
      particle.velocity.y = (particle.velocity.y / speed) * maxVel;
    }
    
    // Update position
    particle.position.x += particle.velocity.x * dt;
    particle.position.y += particle.velocity.y * dt;
    
    // Boundary reflection (optional)
    const bounds = { width: 5000, height: 5000 };
    if (particle.position.x < 0 || particle.position.x > bounds.width) {
      particle.velocity.x *= -0.8;
      particle.position.x = Math.max(0, Math.min(bounds.width, particle.position.x));
    }
    if (particle.position.y < 0 || particle.position.y > bounds.height) {
      particle.velocity.y *= -0.8;
      particle.position.y = Math.max(0, Math.min(bounds.height, particle.position.y));
    }
  }

  /**
   * Simulate all particles
   */
  simulate(dt: number = 1 / 60): void {
    for (const particle of this.particles.values()) {
      this.updateParticleRandom(particle.id, dt);
    }
  }

  /**
   * Calculate tension based on metrics
   * More users and entropy -> higher tension
   */
  calculateTension(): number {
    const { userCount, entropy, clusterCount, maxClusterSize } = this.metrics;
    
    // Normalize user count (0-1, assuming max 50 users)
    const userFactor = Math.min(userCount / 50, 1);
    
    // Cluster factor (more clusters = more complexity)
    const clusterFactor = Math.min(clusterCount / 10, 1);
    
    // Size factor (larger clusters = more tension)
    const sizeFactor = Math.min(maxClusterSize / 20, 1);
    
    // Combined tension: weighted average
    const tension = (
      userFactor * 0.3 +
      entropy * 0.4 +
      clusterFactor * 0.15 +
      sizeFactor * 0.15
    );
    
    return Math.min(tension, 1);
  }

  /**
   * Generate NoiseCraft parameters from global metrics
   */
  generateParams(): NoiseCraftParam[] {
    const params: NoiseCraftParam[] = [];
    const tension = this.calculateTension();

    for (const config of this.configs) {
      let value: number = 0;

      switch (config.signalType) {
        case "userCount":
          // Normalize user count (0-1, max 50)
          value = Math.min(this.metrics.userCount / 50, 1);
          break;

        case "clusterCount":
          // Normalize cluster count (0-1, max 10)
          value = Math.min(this.metrics.clusterCount / 10, 1);
          break;

        case "clusterSize":
          // Normalize average cluster size (0-1, max 20)
          value = Math.min(this.metrics.averageClusterSize / 20, 1);
          break;

        case "entropy":
          value = this.metrics.entropy;
          break;

        case "tension":
          value = tension;
          break;
      }

      // Map to configured range
      const mappedValue =
        config.minValue +
        (config.maxValue - config.minValue) * value;

      // Apply inversion if needed
      const finalValue = config.inverted
        ? config.maxValue + config.minValue - mappedValue
        : mappedValue;

      params.push({
        nodeId: config.nodeId,
        paramName: config.paramName || "value",
        value: finalValue,
      });
    }

    return params;
  }

  /**
   * Get all particles
   */
  getParticles(): VirtualParticle[] {
    return Array.from(this.particles.values());
  }

  /**
   * Remove a particle
   */
  removeParticle(id: string): void {
    this.particles.delete(id);
  }

  /**
   * Get current metrics
   */
  getMetrics(): GlobalMetrics {
    return { ...this.metrics };
  }
}

/**
 * Helper functions to create signal configurations
 */
export function createUserCountModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): GlobalSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "userCount",
    minValue,
    maxValue,
  };
}

export function createEntropyModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): GlobalSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "entropy",
    minValue,
    maxValue,
  };
}

export function createTensionModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): GlobalSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "tension",
    minValue,
    maxValue,
  };
}

export function createClusterSizeModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): GlobalSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "clusterSize",
    minValue,
    maxValue,
  };
}


