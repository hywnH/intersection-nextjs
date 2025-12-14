import type { GlobalSignals, PlayerLike } from "./types";

type World = { width: number; height: number };

const wrapDelta = (delta: number, size: number) => {
  if (!Number.isFinite(delta) || !Number.isFinite(size) || size <= 0)
    return delta;
  return ((((delta + size / 2) % size) + size) % size) - size / 2;
};

const torusDistSq = (a: PlayerLike, b: PlayerLike, world: World) => {
  const dx = wrapDelta(b.x - a.x, world.width);
  const dy = wrapDelta(b.y - a.y, world.height);
  return dx * dx + dy * dy;
};

export class GlobalSignalsComputer {
  private prevAdj: Map<string, Set<string>> = new Map();
  private inTimer = 0;
  private outTimer = 0;
  private readonly pulsarDurationSec: number;
  private readonly innerRadius: number;
  private readonly entropyMaxSpeed: number;

  constructor(options?: {
    innerRadius?: number;
    pulsarDurationSec?: number;
    entropyMaxSpeed?: number;
  }) {
    this.innerRadius = options?.innerRadius ?? 80;
    this.pulsarDurationSec = options?.pulsarDurationSec ?? 0.5;
    this.entropyMaxSpeed = options?.entropyMaxSpeed ?? 100;
  }

  update(players: PlayerLike[], dtSec: number, world: World): GlobalSignals {
    const particleCount = players.length;

    const entropy = this.computeEntropy(players);
    const rmsVelocity = this.computeRmsVelocity(players);

    const { clusterCount, adj } = this.computeInnerAdjacency(players, world);
    const pulsars = this.updatePulsars(adj, dtSec);

    return {
      entropy,
      rmsVelocity,
      particleCount,
      clusterCount,
      inInnerPulsar: pulsars.inInnerPulsar,
      outInnerPulsar: pulsars.outInnerPulsar,
    };
  }

  private computeEntropy(players: PlayerLike[]) {
    if (!players.length) return 0;
    const velocities = players.map((p) => Math.hypot(p.vx, p.vy));
    const maxSpeed = this.entropyMaxSpeed;
    const normalized = velocities.map((v) => Math.min(v / maxSpeed, 1));
    const bins = 12;
    const counts = new Array<number>(bins).fill(0);
    for (const v of normalized) {
      const bin = Math.floor(v * bins);
      counts[Math.min(bin, bins - 1)] += 1;
    }
    let entropy = 0;
    for (const c of counts) {
      if (c <= 0) continue;
      const p = c / players.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private computeRmsVelocity(players: PlayerLike[]) {
    if (!players.length) return 0;
    let sumSq = 0;
    for (const p of players) {
      sumSq += p.vx * p.vx + p.vy * p.vy;
    }
    return Math.sqrt(sumSq / players.length);
  }

  private computeInnerAdjacency(players: PlayerLike[], world: World) {
    const innerRadiusSq = this.innerRadius * this.innerRadius;
    const adj: Map<string, Set<string>> = new Map();
    for (const p of players) adj.set(p.id, new Set());

    // O(n^2) build adjacency
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i]!;
        const b = players[j]!;
        if (torusDistSq(a, b, world) <= innerRadiusSq) {
          adj.get(a.id)!.add(b.id);
          adj.get(b.id)!.add(a.id);
        }
      }
    }

    // Connected components (DFS/BFS)
    const visited = new Set<string>();
    let clusterCount = 0;
    for (const p of players) {
      if (visited.has(p.id)) continue;
      clusterCount += 1;
      const stack = [p.id];
      visited.add(p.id);
      while (stack.length) {
        const id = stack.pop()!;
        const neighbors = adj.get(id);
        if (!neighbors) continue;
        for (const n of neighbors) {
          if (visited.has(n)) continue;
          visited.add(n);
          stack.push(n);
        }
      }
    }

    return { clusterCount, adj };
  }

  private updatePulsars(adj: Map<string, Set<string>>, dtSec: number) {
    let newConnections = false;
    let brokenConnections = false;

    for (const [id, neighbors] of adj) {
      const prev = this.prevAdj.get(id) ?? new Set<string>();
      for (const n of neighbors) {
        if (!prev.has(n)) newConnections = true;
      }
      for (const n of prev) {
        if (!neighbors.has(n)) brokenConnections = true;
      }
      if (newConnections && brokenConnections) break;
    }

    if (newConnections) {
      this.inTimer = this.pulsarDurationSec;
    } else if (this.inTimer > 0) {
      this.inTimer = Math.max(0, this.inTimer - dtSec);
    }

    if (brokenConnections) {
      this.outTimer = this.pulsarDurationSec;
    } else if (this.outTimer > 0) {
      this.outTimer = Math.max(0, this.outTimer - dtSec);
    }

    // update prev adjacency snapshot
    this.prevAdj = new Map();
    for (const [id, neighbors] of adj) {
      this.prevAdj.set(id, new Set(neighbors));
    }

    return {
      inInnerPulsar: (this.inTimer > 0 ? 1 : 0) as 0 | 1,
      outInnerPulsar: (this.outTimer > 0 ? 1 : 0) as 0 | 1,
    };
  }
}
