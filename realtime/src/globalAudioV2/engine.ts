import type { AudioGlobalV2Payload, PlayerLike } from "./types";
import { GlobalSignalsComputer } from "./signals.js";
import { GlobalMappingEvaluator } from "./mapping.js";
import { GlobalSequencer } from "./sequencer.js";

export class GlobalAudioV2Engine {
  private readonly world: { width: number; height: number };
  private readonly signalsComputer: GlobalSignalsComputer;
  private readonly mapping: GlobalMappingEvaluator | null;
  private readonly sequencer: GlobalSequencer;
  private lastTimeMs: number | null = null;

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

    return {
      version: 1,
      t: nowMs,
      signals,
      params,
      sequencer: {
        nodeIds: this.sequencer.nodeIds,
        grids,
      },
    };
  }
}
