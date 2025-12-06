import type { AudioClusterState } from "@/types/game";

const NOTE_COUNT = 12;

// Hz → 0~11 (A4=440 기준 근사)
const freqToToneIndex = (freq: number): number => {
  if (!Number.isFinite(freq) || freq <= 0) return 0;
  const midi = 69 + 12 * Math.log2(freq / 440);
  const idx = Math.round(midi) % NOTE_COUNT;
  return (idx + NOTE_COUNT) % NOTE_COUNT;
};

export const normalizeToneIndex = (
  toneIndex: number | null | undefined
): number => {
  if (typeof toneIndex !== "number" || !Number.isFinite(toneIndex)) return 0;
  const idx = ((Math.round(toneIndex) % NOTE_COUNT) + NOTE_COUNT) % NOTE_COUNT;
  return idx / (NOTE_COUNT - 1); // 0~1
};

// toneIndex(0~11)를 클러스터 코드톤에 스냅
export const snapToneToChord = (
  toneIndex: number | null | undefined,
  cluster: AudioClusterState | null
): number => {
  if (
    !cluster ||
    !Array.isArray(cluster.chord) ||
    cluster.chord.length === 0 ||
    typeof toneIndex !== "number"
  ) {
    return toneIndex ?? 0;
  }

  const base = ((Math.round(toneIndex) % NOTE_COUNT) + NOTE_COUNT) % NOTE_COUNT;

  let best = base;
  let bestDist = Infinity;

  cluster.chord.forEach((note) => {
    const idx = freqToToneIndex(note.freq);
    const diff = Math.abs(((idx - base + NOTE_COUNT) % NOTE_COUNT));
    const dist = Math.min(diff, NOTE_COUNT - diff);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
  });

  return best;
};


