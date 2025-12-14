import type { AudioGlobalV2Payload, PlayerLike } from "./types";
import { GlobalSignalsComputer } from "./signals.js";
import { GlobalMappingEvaluator } from "./mapping.js";
import { GlobalSequencer } from "./sequencer.js";
import { noteIndexFromId } from "./hash.js";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const wrapDelta = (delta: number, size: number) => {
  if (!Number.isFinite(delta) || !Number.isFinite(size) || size <= 0)
    return delta;
  return ((((delta + size / 2) % size) + size) % size) - size / 2;
};

const torusDistSq = (
  a: PlayerLike,
  b: PlayerLike,
  world: { width: number; height: number }
) => {
  const dx = wrapDelta(b.x - a.x, world.width);
  const dy = wrapDelta(b.y - a.y, world.height);
  return dx * dx + dy * dy;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class GlobalAudioV2Engine {
  private readonly world: { width: number; height: number };
  private readonly signalsComputer: GlobalSignalsComputer;
  private readonly mapping: GlobalMappingEvaluator | null;
  private readonly sequencer: GlobalSequencer;
  private lastTimeMs: number | null = null;

  // Global close-trigger (match personal: radius 120 + 160ms gate)
  private prevClosePairs: Set<string> = new Set();
  private closeGateUntilMs = 0;

  // Global noise highlight smoothing + hysteresis (prevents discrete “hiss steps”)
  private noiseAccentGain = 0;
  private noiseAccentCutoff = 0.55;
  private noiseAccentReso = 0.1;
  private noiseFastestId: string | null = null;
  private noiseFastestHoldUntilMs = 0;

  constructor(options: {
    world: { width: number; height: number };
    innerRadius?: number;
    pulsarDurationSec?: number;
    entropyMaxSpeed?: number;
  }) {
    this.world = options.world;
    this.signalsComputer = new GlobalSignalsComputer({
      innerRadius: options.innerRadius,
      pulsarDurationSec: options.pulsarDurationSec,
      entropyMaxSpeed: options.entropyMaxSpeed,
    });
    this.sequencer = new GlobalSequencer({ key: "C", mode: "major" });
    try {
      this.mapping = GlobalMappingEvaluator.loadDefaultFromAssets();
    } catch (e) {
      console.warn("[GlobalAudioV2] Failed to load mappings, continuing:", e);
      this.mapping = null;
    }
  }

  private updateCloseGate(players: PlayerLike[], nowMs: number) {
    const CLOSE_RADIUS = 60;
    const CLOSE_RADIUS_SQ = CLOSE_RADIUS * CLOSE_RADIUS;
    const HOLD_MS = 160;

    const curPairs = new Set<string>();
    let anyNew = false;

    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i]!;
        const b = players[j]!;
        if (torusDistSq(a, b, this.world) > CLOSE_RADIUS_SQ) continue;
        const k = pairKey(a.id, b.id);
        curPairs.add(k);
        if (!anyNew && !this.prevClosePairs.has(k)) {
          anyNew = true;
        }
      }
    }

    if (anyNew) {
      this.closeGateUntilMs = Math.max(this.closeGateUntilMs, nowMs + HOLD_MS);
    }
    this.prevClosePairs = curPairs;

    return nowMs < this.closeGateUntilMs ? 1 : 0;
  }

  step(players: PlayerLike[], nowMs: number): AudioGlobalV2Payload {
    const dtMs = this.lastTimeMs ? nowMs - this.lastTimeMs : null;
    this.lastTimeMs = nowMs;
    const dtSec =
      dtMs && Number.isFinite(dtMs) && dtMs > 0
        ? Math.min(0.2, dtMs / 1000)
        : 1 / 12;

    const signals = this.signalsComputer.update(players, dtSec, this.world);
    const params = this.mapping ? this.mapping.generateParams(signals) : [];
    const { grids } = this.sequencer.update(players);

    // Extra params: close chime gate + global noise highlight
    const extraParams: Array<{
      nodeId: string;
      paramName: string;
      value: number;
    }> = [];

    // 1) Close-trigger gate (used by global patch chime)
    const closeGate = this.updateCloseGate(players, nowMs);
    extraParams.push({ nodeId: "9060", paramName: "value", value: closeGate });

    // 2) Background noise bed + accent by fastest mover note
    // Tune points based on server MAX_SPEED (320).
    let fastest: PlayerLike | null = null;
    let maxSpeed = 0;
    let sumSpeed = 0;
    const speedById = new Map<string, number>();
    for (const p of players) {
      const sp = Math.hypot(p.vx, p.vy);
      sumSpeed += sp;
      speedById.set(p.id, sp);
      if (sp > maxSpeed) {
        maxSpeed = sp;
        fastest = p;
      }
    }

    // Keep a subtle always-on noise bed (requested), but very low.
    // Accent (gain+cutoff+reso) provides the musical emphasis.
    const bed = 0.01;
    // Pick a “fastest” id with hysteresis so cutoff doesn’t jump frame-to-frame.
    if (fastest) {
      const curId = this.noiseFastestId;
      const curSpeed = curId ? speedById.get(curId) ?? 0 : 0;
      const nextSpeed = speedById.get(fastest.id) ?? 0;
      const SWITCH_MARGIN = 18; // require a clear win to switch immediately
      const HOLD_MS = 650; // hold selection briefly to prevent flip-flop

      if (!curId) {
        this.noiseFastestId = fastest.id;
        this.noiseFastestHoldUntilMs = nowMs + HOLD_MS;
      } else if (nowMs >= this.noiseFastestHoldUntilMs) {
        // allow switch after hold window
        this.noiseFastestId = fastest.id;
        this.noiseFastestHoldUntilMs = nowMs + HOLD_MS;
      } else if (fastest.id !== curId && nextSpeed > curSpeed + SWITCH_MARGIN) {
        // early switch only if clearly faster
        this.noiseFastestId = fastest.id;
        this.noiseFastestHoldUntilMs = nowMs + HOLD_MS;
      }
    } else {
      this.noiseFastestId = null;
      this.noiseFastestHoldUntilMs = 0;
    }

    // Targets (then smooth to avoid discrete “stepping” at 12Hz)
    const avgSpeed = players.length ? sumSpeed / players.length : 0;
    const lead = Math.max(0, maxSpeed - avgSpeed);
    const accentGainTarget = clamp01((lead - 22) / 130);

    // Map selected id -> note -> cutoff target
    let accentCutoffTarget = 0.55;
    if (this.noiseFastestId) {
      const noteIndex = noteIndexFromId(this.noiseFastestId);
      // Narrow the range so pitch feels less exaggerated.
      accentCutoffTarget = 0.25 + 0.5 * (noteIndex / 11);
    }
    // Lower resonance range so pitch is present but not “whistly”.
    const accentResoTarget = 0.08 + 0.45 * accentGainTarget;

    // Smoothing:
    // - Gain can react fairly quickly
    // - Cutoff should glide slowly (so the emphasized band changes smoothly)
    // - Reso follows gain but still smoothed
    const tauGain = 0.35 * 2;
    const tauCutoff = 1.1 * 2;
    const tauReso = 0.55 * 2;
    const alphaGain = 1 - Math.exp(-dtSec / tauGain);
    const alphaCutoff = 1 - Math.exp(-dtSec / tauCutoff);
    const alphaReso = 1 - Math.exp(-dtSec / tauReso);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    this.noiseAccentGain = lerp(
      this.noiseAccentGain,
      accentGainTarget,
      alphaGain
    );
    this.noiseAccentReso = lerp(
      this.noiseAccentReso,
      accentResoTarget,
      alphaReso
    );

    // Slew-limit cutoff per step to avoid discrete jumps at 12Hz,
    // especially when fastest-id (note) changes.
    const cutoffNext = lerp(
      this.noiseAccentCutoff,
      accentCutoffTarget,
      alphaCutoff
    );
    const MAX_CUTOFF_STEP = 0.018; // per engine tick (~12Hz) => ~0.2/sec
    const delta = cutoffNext - this.noiseAccentCutoff;
    const limitedDelta =
      Math.abs(delta) <= MAX_CUTOFF_STEP
        ? delta
        : Math.sign(delta) * MAX_CUTOFF_STEP;
    this.noiseAccentCutoff = this.noiseAccentCutoff + limitedDelta;

    extraParams.push({ nodeId: "9200", paramName: "value", value: bed });
    extraParams.push({
      nodeId: "9201",
      paramName: "value",
      value: this.noiseAccentGain,
    });
    extraParams.push({
      nodeId: "9202",
      paramName: "value",
      value: this.noiseAccentCutoff,
    });
    extraParams.push({
      nodeId: "9205",
      paramName: "value",
      value: this.noiseAccentReso,
    });

    return {
      version: 1,
      t: nowMs,
      signals,
      params: params.concat(extraParams),
      sequencer: {
        nodeIds: this.sequencer.nodeIds,
        grids,
      },
    };
  }
}
