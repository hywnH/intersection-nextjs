import type {
  GlobalSequencerGrids,
  GlobalSequencerNodeIds,
  MonoSeqGrid,
  PlayerLike,
} from "./types";
import { noteIndexFromId } from "./hash.js";
import { GlobalHarmonicPlacer } from "./harmonicPlacer.js";

export type Voice = "bass" | "baritone" | "tenor";
export type GlobalAssignment = { voice: Voice; column: number };

const VOICES: Voice[] = ["bass", "baritone", "tenor"];

const makeEmptyGrid = (): MonoSeqGrid =>
  Array.from({ length: 12 }, () => new Array(12).fill(0));

const randomPick = <T>(arr: T[]): T | null => {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)] ?? null;
};

export class GlobalSequencer {
  readonly nodeIds: GlobalSequencerNodeIds = {
    bass: "211",
    baritone: "212",
    tenor: "213",
  };

  private assignments: Record<string, GlobalAssignment> = {};
  private harmonicPlacer: GlobalHarmonicPlacer;

  constructor(options?: { key?: string; mode?: string }) {
    this.harmonicPlacer = new GlobalHarmonicPlacer(
      options?.key ?? "C",
      options?.mode ?? "major"
    );
  }

  /**
   * Update stable assignments and build current grids.
   */
  update(players: PlayerLike[]): { grids: GlobalSequencerGrids } {
    const ids = new Set(players.map((p) => p.id));

    // Remove missing players from assignments.
    for (const id of Object.keys(this.assignments)) {
      if (!ids.has(id)) {
        delete this.assignments[id];
      }
    }

    const noteIndexById = new Map<string, number>();
    for (const p of players) noteIndexById.set(p.id, noteIndexFromId(p.id));

    // Sync harmonic placer state from current assignments.
    this.harmonicPlacer.updateAssignmentsFromMap(
      this.assignments,
      noteIndexById
    );

    // Assign any newcomers (up to 36 total).
    const totalUsers = players.length;
    for (const p of players) {
      if (this.assignments[p.id]) continue;

      const noteIndex = noteIndexById.get(p.id) ?? 0;
      let position = this.harmonicPlacer.assignNewUser(noteIndex, totalUsers);
      if (position < 0 || position >= 36) {
        const available = this.harmonicPlacer.getAvailablePositions();
        const fallback = randomPick(available);
        position = typeof fallback === "number" ? fallback : -1;
      }
      if (position < 0 || position >= 36) {
        // All slots filled.
        continue;
      }

      const voiceIndex = Math.floor(position / 12);
      const column = position % 12;
      const voice = VOICES[voiceIndex] ?? "bass";
      this.assignments[p.id] = { voice, column };
      this.harmonicPlacer.addAssignment(noteIndex, position);
    }

    const grids = this.buildGrids(players, noteIndexById);
    return { grids };
  }

  private buildGrids(
    players: PlayerLike[],
    noteIndexById: Map<string, number>
  ) {
    const bass = makeEmptyGrid();
    const baritone = makeEmptyGrid();
    const tenor = makeEmptyGrid();

    for (const p of players) {
      const a = this.assignments[p.id];
      if (!a) continue;
      const noteIndex = noteIndexById.get(p.id);
      if (noteIndex === undefined) continue;
      if (noteIndex < 0 || noteIndex >= 12) continue;
      if (a.column < 0 || a.column >= 12) continue;

      const target =
        a.voice === "bass" ? bass : a.voice === "baritone" ? baritone : tenor;
      target[a.column]![noteIndex] = 1;
    }

    return { bass, baritone, tenor };
  }
}
