/**
 * Server-side port of NoiseCraft GlobalHarmonicPlacer
 * Source: noisecraft/public/global-harmonic-placer.js
 */

type AssignedPosition = {
  note: number; // 0..11
  position: number; // 0..35 (voice*12 + step)
  voice: number; // 0..2
  step: number; // 0..11
};

// Instability map (from the algorithm doc / JS implementation)
const INSTABILITY_MAP: Record<number, number> = {
  0: 0,
  1: 9,
  2: 3,
  3: 2,
  4: 1.5,
  5: 2.5,
  6: 8,
  7: 0.5,
  8: 4,
  9: 2,
  10: 4.5,
  11: 7,
};

export class GlobalHarmonicPlacer {
  key: string;
  mode: string;
  assignedPositions: AssignedPosition[];

  constructor(key = "C", mode = "major") {
    this.key = key;
    this.mode = mode;
    this.assignedPositions = [];
  }

  calculateTargetDistance(userCount: number) {
    const maxDistance = 8;
    return Math.min(maxDistance, Math.log(userCount + 1) * 2);
  }

  calculateProgressionDistance(positions: AssignedPosition[]) {
    if (positions.length === 0) return 0;
    const notes = positions.map((p) => p.note);
    const totalInstability = notes.reduce((sum, note) => {
      return sum + (INSTABILITY_MAP[note] ?? 0);
    }, 0);
    return totalInstability / notes.length;
  }

  assignNewUser(userNote: number, totalUsers: number) {
    const availablePositions = this.getAvailablePositions();
    if (availablePositions.length === 0) return -1;

    const validPositions = availablePositions.filter((pos) =>
      this.satisfiesConstraints(userNote, pos)
    );

    const candidates =
      validPositions.length > 0 ? validPositions : availablePositions;
    const targetDistance = this.calculateTargetDistance(totalUsers);

    const scored = candidates.map((pos) => ({
      position: pos,
      score: this.evaluateHarmonicScore(userNote, pos, targetDistance),
    }));

    return this.weightedRandomSelect(scored);
  }

  satisfiesConstraints(noteIndex: number, position: number) {
    const instability = INSTABILITY_MAP[noteIndex] ?? 0;
    const step = position % 12;
    const distanceToCycleEnd = 12 - step;

    if (instability > 5 && distanceToCycleEnd < 3) {
      const hasResolution = this.checkResolutionAvailable(step, 0);
      return hasResolution;
    }

    return true;
  }

  evaluateHarmonicScore(
    userNote: number,
    position: number,
    targetDistance: number
  ) {
    const tempPositions: AssignedPosition[] = [
      ...this.assignedPositions,
      {
        note: userNote,
        position,
        voice: Math.floor(position / 12),
        step: position % 12,
      },
    ];

    const newDistance = this.calculateProgressionDistance(tempPositions);
    const distanceScore = 1 / (1 + Math.abs(newDistance - targetDistance));
    const step = position % 12;
    const positionScore = 1 - Math.abs(step - 6) / 6;
    return distanceScore * positionScore;
  }

  checkResolutionAvailable(currentStep: number, resolutionNote: number) {
    for (let i = 1; i <= 3; i += 1) {
      const checkStep = (currentStep + i) % 12;
      const hasNote = this.assignedPositions.some(
        (p) => p.step === checkStep && p.note === resolutionNote
      );
      if (hasNote) return true;
    }
    return true;
  }

  weightedRandomSelect(candidates: Array<{ position: number; score: number }>) {
    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    if (total === 0) return candidates[0]?.position ?? -1;
    let random = Math.random() * total;
    for (const c of candidates) {
      random -= c.score;
      if (random <= 0) return c.position;
    }
    return candidates[0]?.position ?? -1;
  }

  getAvailablePositions() {
    const used = new Set(this.assignedPositions.map((p) => p.position));
    return Array.from({ length: 36 }, (_, i) => i).filter((p) => !used.has(p));
  }

  addAssignment(noteIndex: number, position: number) {
    this.assignedPositions.push({
      note: noteIndex,
      position,
      voice: Math.floor(position / 12),
      step: position % 12,
    });
  }

  updateAssignmentsFromMap(
    assignments: Record<
      string,
      { voice: "bass" | "baritone" | "tenor"; column: number }
    >,
    noteIndexById: Map<string, number>
  ) {
    this.assignedPositions = [];
    const voices = ["bass", "baritone", "tenor"] as const;
    for (const [id, assignment] of Object.entries(assignments)) {
      const noteIndex = noteIndexById.get(id);
      if (noteIndex === undefined) continue;
      if (noteIndex < 0 || noteIndex >= 12) continue;
      const voiceIndex = voices.indexOf(assignment.voice);
      if (voiceIndex < 0) continue;
      const col = assignment.column;
      if (!Number.isFinite(col) || col < 0 || col >= 12) continue;
      const position = voiceIndex * 12 + col;
      this.assignedPositions.push({
        note: noteIndex,
        position,
        voice: voiceIndex,
        step: col,
      });
    }
  }
}
