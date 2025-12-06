import type { AudioClusterState } from "@/types/game";
import { snapToneToChord } from "@/lib/audio/tones";

export interface IndividualPattern {
  bassRow: number | null;
  baritoneRow: number | null;
  tenorRow: number | null;
}

export const map12ToneTo4Row = (noteIndex12: number): number => {
  if (noteIndex12 < 0 || noteIndex12 >= 12) return 0;
  return Math.floor(noteIndex12 / 3); // 0-2 -> 0, 3-5 -> 1, 6-8 -> 2, 9-11 -> 3
};

export const generateIndividualPattern = (
  selfNoteIndex: number | null,
  neighborNoteIndices: number[],
  options?: { cluster?: AudioClusterState | null; isInCluster?: boolean }
): IndividualPattern => {
  const cluster = options?.cluster ?? null;
  const hasChord = Boolean(cluster && options?.isInCluster);

  const clampTone = (tone: number | null): number | null => {
    if (tone === null || !Number.isFinite(tone)) return null;
    const idx = ((Math.round(tone) % 12) + 12) % 12;
    return idx;
  };

  const baseBassTone = clampTone(selfNoteIndex);
  const baseNeighborTones = neighborNoteIndices
    .map((n) => clampTone(n))
    .filter((n): n is number => n !== null);

  let bassTone: number | null = baseBassTone;
  let baritoneTone: number | null = null;
  let tenorTone: number | null = null;

  if (hasChord && cluster) {
    // 클러스터 코드가 있을 때만 화음으로 확장
    if (baseBassTone !== null) {
      bassTone = snapToneToChord(baseBassTone, cluster);
    }
    if (baseNeighborTones[0] !== undefined) {
      baritoneTone = snapToneToChord(baseNeighborTones[0], cluster);
    }
    if (baseNeighborTones[1] !== undefined) {
      tenorTone = snapToneToChord(baseNeighborTones[1], cluster);
    }
  } else {
    // 클러스터 없으면 단일 음만 (bass), 나머지는 침묵
    baritoneTone = null;
    tenorTone = null;
  }

  const bassRow =
    bassTone !== null && bassTone >= 0 && bassTone < 12
      ? map12ToneTo4Row(bassTone)
      : null;
  const baritoneRow =
    baritoneTone !== null && baritoneTone >= 0 && baritoneTone < 12
      ? map12ToneTo4Row(baritoneTone)
      : null;
  const tenorRow =
    tenorTone !== null && tenorTone >= 0 && tenorTone < 12
      ? map12ToneTo4Row(tenorTone)
      : null;

  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log("[personal-audio] sequencer tones", {
      hasChord,
      bassTone,
      baritoneTone,
      tenorTone,
      clusterChord: cluster?.chord?.map((n) => n.freq),
    });
  }

  return { bassRow, baritoneRow, tenorRow };
};

