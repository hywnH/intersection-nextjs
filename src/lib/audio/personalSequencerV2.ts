import type { GameState, PlayerSnapshot } from "@/types/game";
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";

// 간단한 해시로 12-tone 인덱스 생성 (0..11)
const hashToneIndex = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 12;
};

/**
 * Personal Sequencer V2
 *
 * 목표:
 * - 개인은 자기 음(1개)을 항상 가진다.
 * - 가장 가까운 2이웃만(거리 기준) 화성/시퀀서에 사용한다.
 * - 특정 거리(상수) 밖이면 단음(자기 음만) + 노이즈는 "그냥 노이즈"에 가깝게.
 * - 특정 거리(상수) 안으로 들어오면 이웃 음을 "불협 최소"로 스냅 + 디튠/스위트너(meetGate)로 기분 좋게.
 * - MonoSeq(4x13) 그리드는 경계 출입(enter/leave) 때만 업데이트한다.
 *
 * 기존 test-workspace 로직의 문제점(왜 V2가 필요한가):
 * - `particle-system.js`의 `innerParticles`는 정렬되지 않아서 “가장 가까운 2이웃”에 바로 쓰면 오동작한다.
 * - `sequencer-logic.js`의 개인 패턴은 매번 랜덤 아르페지오를 생성해 패턴 키가 자주 바뀌어 과도 업데이트를 유발한다.
 * - V2는 (1) 이웃을 거리순으로 고정, (2) 시퀀서 패턴은 안정적으로 유지, (3) 경계 이벤트 기반으로 갱신한다.
 */

export const PERSONAL_SEQ_V2 = {
  // 규칙 4: boundary 안/밖 판정 기준 (MonoSeq 업데이트 트리거)
  SEQUENCER_RADIUS: 420,
  // 규칙 3: 노이즈 톤화는 조금 더 멀리서도 서서히 시작 가능
  PROX_TONALIZE_START_FACTOR: 2.5,
  // meetGate 펄스 길이(ms)
  SWEETENER_HOLD_MS: 180,
  // MonoSeq 그리드 규격 (각 voice는 4-step, 3 voice 합치면 12-step으로 생각)
  MONOSEQ_STEPS: 4,
  MONOSEQ_ROWS: 13,
} as const;

// V2 patch node IDs (noisecraft/examples/indiv_audio_map_v2.ncft)
export const PERSONAL_SEQ_V2_NODES = {
  // MonoSeq voices (same as v1)
  monoSeq: {
    bass: "211",
    baritone: "212",
    tenor: "213",
  },
  // tonal noise controls
  tonal: {
    n1Gain: "9003",
    n2Gain: "9006",
    n1Reso: "9009",
    n2Reso: "9014",
  },
  meetGate: "9007",
} as const;

export type MonoSeqGrid = number[][]; // [stepIdx][rowIdx] -> 0|1

export interface PersonalSequencerV2Result {
  selfId: string;
  selfTone: number;
  nearestDist: number;
  // 최근접 2명 (거리순)
  neighbors: Array<{
    id: string;
    dist: number;
    dx: number;
    dy: number;
    rawTone: number;
    snappedTone: number;
    inSequencerRadius: boolean;
    proximity01: number; // 0 far -> 1 close (톤화/리듬/스위트너에 사용)
  }>;
  // MonoSeq 그리드 (voice별)
  grids: {
    bass: MonoSeqGrid;
    baritone: MonoSeqGrid;
    tenor: MonoSeqGrid;
  };
  // 연속 파라미터(노이즈 톤화 등)
  params: NoiseCraftParam[];
  // boundary enter 순간 (스위트너 트리거)
  meetGateTrigger: boolean;
  // 경계 안에 있는 최근접 2명 집합(enter/leave 감지용)
  inRadiusIds: string[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const wrapDelta = (delta: number, size: number) => {
  if (!Number.isFinite(delta) || !Number.isFinite(size) || size <= 0)
    return delta;
  return ((((delta + size / 2) % size) + size) % size) - size / 2;
};

const intervalClass = (a: number, b: number) => {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
};

// avoid_dissonance: 강하게 피할 간격(1,2,6) + 약하게 피할 간격(10=단7)
const FORBIDDEN_HARD = new Set([1, 2, 6]);
const FORBIDDEN_SOFT = new Set([10]);
const PREFERRED = new Set([0, 3, 4, 5]); // 7은 5로 환원됨, 8/9은 4/3으로 환원됨
// “안전한 화성”만 쓰기(피치클래스 기준, intervalClass)
// 필요하면 여기만 바꾸면 전체 화성 성향이 바뀜.
const SAFE_INTERVALS = new Set([0, 3, 4, 5, 7, 8, 9]);

const scoreInterval = (ic: number) => {
  if (FORBIDDEN_HARD.has(ic)) return 100;
  if (FORBIDDEN_SOFT.has(ic)) return 20;
  // unison(0)은 안전하지만 너무 자주 나오면 “한 음만” 들리는 문제가 생김
  if (ic === 0) return 3;
  if (PREFERRED.has(ic)) return 0;
  return 5;
};

const safePenalty = (ic: number) => (SAFE_INTERVALS.has(ic) ? 0 : 1000);

const ensureSafeTone = (tone: number, selfTone: number) => {
  const pcSelf = ((selfTone % 12) + 12) % 12;
  const pc = ((tone % 12) + 12) % 12;
  if (SAFE_INTERVALS.has(intervalClass(pc, pcSelf))) return pc;
  const fallbacks = [7, 4, 3, 5, 9, 8];
  for (const off of fallbacks) {
    const cand = (pcSelf + off) % 12;
    if (SAFE_INTERVALS.has(intervalClass(cand, pcSelf))) return cand;
  }
  return pcSelf;
};

const candidatesNearRaw = (raw: number) => {
  // raw에서 ±2 semitone 범위의 후보(피치클래스)
  const out: number[] = [];
  for (let d = -2; d <= 2; d += 1) {
    out.push((((raw + d) % 12) + 12) % 12);
  }
  // 중복 제거(모듈러로 겹칠 수 있음)
  return Array.from(new Set(out));
};

function chooseSnappedTones(selfTone: number, rawTones: number[]): number[] {
  const raws = rawTones.slice(0, 2);
  if (raws.length === 0) return [];
  const cand0 = candidatesNearRaw(raws[0]);
  if (raws.length === 1) {
    let best = raws[0];
    let bestScore = Infinity;
    for (const c of cand0) {
      const ic = intervalClass(c, selfTone);
      const s =
        scoreInterval(ic) +
        safePenalty(ic) +
        Math.min((c - raws[0] + 12) % 12, (raws[0] - c + 12) % 12) +
        (c === selfTone ? 2 : 0);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return [ensureSafeTone(best, selfTone)];
  }
  const cand1 = candidatesNearRaw(raws[1]);
  let best0 = raws[0];
  let best1 = raws[1];
  let bestScore = Infinity;
  for (const c0 of cand0) {
    for (const c1 of cand1) {
      const ic0 = intervalClass(c0, selfTone);
      const ic1 = intervalClass(c1, selfTone);
      const ic01 = intervalClass(c0, c1);
      const s0 = scoreInterval(ic0) + safePenalty(ic0);
      const s1 = scoreInterval(ic1) + safePenalty(ic1);
      const s01 = scoreInterval(ic01) + safePenalty(ic01);
      const adj0 = intervalClass(c0, raws[0]);
      const adj1 = intervalClass(c1, raws[1]);
      const dupPenalty =
        (c0 === selfTone ? 2 : 0) +
        (c1 === selfTone ? 2 : 0) +
        (c0 === c1 ? 6 : 0);
      const score = s0 + s1 + s01 + adj0 + adj1 + dupPenalty;
      if (score < bestScore) {
        bestScore = score;
        best0 = c0;
        best1 = c1;
      }
    }
  }
  return [ensureSafeTone(best0, selfTone), ensureSafeTone(best1, selfTone)];
}

const emptyGrid = (): MonoSeqGrid =>
  Array.from({ length: PERSONAL_SEQ_V2.MONOSEQ_STEPS }, () =>
    Array.from({ length: PERSONAL_SEQ_V2.MONOSEQ_ROWS }, () => 0)
  );

const setStepRow = (grid: MonoSeqGrid, step: number, row: number | null) => {
  if (row === null) return;
  if (step < 0 || step >= grid.length) return;
  if (row < 0 || row >= grid[step].length) return;
  grid[step][row] = 1;
};

/**
 * 3개의 4-step MonoSeq를 합쳐서 “12컬럼”으로 생각하고 패턴을 만든다.
 * - 각 컬럼 값은 0..toneCount (0=rest, 1..toneCount=chord-tone index)
 * - 예: bass 1301 / baritone 2312 / tenor 1320
 */
type VoiceCodes = [number, number, number, number]; // 4 digits

const stableKey = (selfId: string, inRadiusIds: string[]) => {
  // order-insensitive
  const ids = [...inRadiusIds].sort();
  return `${selfId}|${ids.join(",")}`;
};

const fnv1a32 = (str: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const patternCache = new Map<
  string,
  { codes12: number[]; toneCount: number }
>();

const pickCode = (rng: () => number, toneCount: number, restProb: number) => {
  if (rng() < restProb) return 0;
  // 1..toneCount
  return 1 + Math.floor(rng() * Math.max(1, toneCount));
};

const generateCodes12 = (key: string, toneCount: number) => {
  const rng = mulberry32(fnv1a32(key));
  const out: number[] = new Array(12).fill(0);

  // 각 영역(bass/baritone/tenor)별로 rest 확률 다르게(기본 자기 음이 항상 들리게 bass는 더 촘촘)
  const restByIdx = (idx: number) => {
    if (idx < 4) return 0.05; // bass
    if (idx < 8) return 0.12; // baritone
    return 0.18; // tenor
  };

  for (let i = 0; i < 12; i += 1) {
    out[i] = pickCode(rng, toneCount, restByIdx(i));
  }

  const ensureMinHits = (start: number, end: number, minHits: number) => {
    const seg = out.slice(start, end);
    const hits = seg.filter((v) => v !== 0).length;
    if (hits >= minHits) return;
    for (let k = hits; k < minHits; k += 1) {
      const j = start + Math.floor(rng() * (end - start));
      out[j] = 1;
    }
  };

  // 보정 1: bass(0~3)에는 최소 2개는
  ensureMinHits(0, 4, 2);

  // 보정 2: toneCount>=2면 baritone(4~7)도 최소 1개는
  if (toneCount >= 2) ensureMinHits(4, 8, 2);

  // 보정 3: toneCount>=3면 tenor(8~11)도 최소 2개 + code=3 최소 1개
  if (toneCount >= 3) {
    ensureMinHits(8, 12, 2);
    if (!out.slice(8, 12).some((v) => v === 3)) {
      const j = 8 + Math.floor(rng() * 4);
      out[j] = 3;
    }
  }

  // 보정 4: toneCount>=2면 code=2가 최소 1번은 등장
  if (toneCount >= 2 && !out.some((v) => v === 2)) {
    const j = 4 + Math.floor(rng() * 4);
    out[j] = 2;
  }

  return out;
};

const buildGridFromCodes = (chordTones: number[], codes4: VoiceCodes) => {
  const grid = emptyGrid();
  for (let step = 0; step < 4; step += 1) {
    const code = codes4[step] ?? 0;
    if (code === 0) continue;
    const tone = chordTones[code - 1];
    if (!Number.isFinite(tone)) continue;
    setStepRow(grid, step, ((tone % 12) + 12) % 12);
  }
  return grid;
};

const toProximity01 = (dist: number, start: number, end: number) => {
  // dist <= start => 1, dist >= end => 0
  if (!Number.isFinite(dist)) return 0;
  if (dist <= start) return 1;
  if (dist >= end) return 0;
  const t = (end - dist) / (end - start);
  return clamp01(t);
};

export const computePersonalSequencerV2 = (
  state: GameState,
  prevInRadiusIds: string[] | null
): PersonalSequencerV2Result | null => {
  const selfId = state.selfId;
  if (!selfId) return null;
  const selfPlayer = state.players[selfId];
  if (!selfPlayer) return null;

  const selfTone = hashToneIndex(selfId);
  const selfPos = selfPlayer.cell.position;

  const others: PlayerSnapshot[] = Object.values(state.players).filter(
    (p) => p.id !== selfId
  );

  const withDist = others
    .map((p) => {
      const dx = wrapDelta(p.cell.position.x - selfPos.x, state.gameSize.width);
      const dy = wrapDelta(
        p.cell.position.y - selfPos.y,
        state.gameSize.height
      );
      const dist = Math.hypot(dx, dy);
      return { p, dx, dy, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 2);

  const rawTones = withDist.map(({ p }) => hashToneIndex(p.id));
  const snapped = chooseSnappedTones(selfTone, rawTones);

  const R = PERSONAL_SEQ_V2.SEQUENCER_RADIUS;
  const tonalizeStart = R * PERSONAL_SEQ_V2.PROX_TONALIZE_START_FACTOR;

  const neighbors = withDist.map(({ p, dx, dy, dist }, idx) => {
    const rawTone = rawTones[idx] ?? 0;
    const snappedTone = snapped[idx] ?? rawTone;
    const inSequencerRadius = dist <= R;
    const proximity01 = toProximity01(dist, R, tonalizeStart);
    return {
      id: p.id,
      dist,
      dx,
      dy,
      rawTone,
      snappedTone,
      inSequencerRadius,
      proximity01,
    };
  });

  const inRadiusIds = neighbors
    .filter((n) => n.inSequencerRadius)
    .map((n) => n.id);

  const prevSet = new Set(prevInRadiusIds ?? []);
  const meetGateTrigger = inRadiusIds.some((id) => !prevSet.has(id));
  const nearestDist = neighbors[0]?.dist ?? Infinity;

  // chord-tone set: self + (경계 안 최근접 2명), order는 안정적으로 id 기준
  const inNeighbors = neighbors.filter((n) => n.inSequencerRadius);
  const sortedIn = [...inNeighbors].sort((a, b) => a.id.localeCompare(b.id));
  // **핵심**: 3명(=self + 이웃2) 붙어있으면 “3번째 음” 슬롯은 무조건 유지해야 한다.
  // 스냅 결과가 유니즌으로 겹쳐도 tenor가 비지 않도록, 부족한 음은 self 기반으로 안전한 화성으로 파생 생성한다.
  const desiredToneCount = Math.min(3, 1 + sortedIn.length); // self + (이웃 수, 최대 2)

  // 기본 후보: self + snapped neighbors (pitch class)
  const chordTonesRaw: number[] = [
    selfTone,
    ...sortedIn.map((n) => n.snappedTone),
  ];
  const chordTones: number[] = [];
  chordTonesRaw.forEach((t) => {
    const pc = ((t % 12) + 12) % 12;
    if (!chordTones.includes(pc)) chordTones.push(pc);
  });

  // 부족한 음은 self 기준으로 5도/3도 등 “안전한” 음을 추가해 채운다.
  const selfPc = chordTones[0] ?? ((selfTone % 12) + 12) % 12;
  const fillOffsets = [7, 4, 3, 9, 5, 8, 2, 10]; // 대체 후보(가능한 한 consonant부터)
  for (const off of fillOffsets) {
    if (chordTones.length >= desiredToneCount) break;
    const pc = (selfPc + off) % 12;
    if (!chordTones.includes(pc)) chordTones.push(pc);
  }

  const toneCount = Math.min(desiredToneCount, chordTones.length);

  const key = stableKey(selfId, inRadiusIds);
  // toneCount가 바뀌었을 때(예: 2명->3명) 기존 캐시가 남아 있으면
  // code=3이 안 나와서 “3번째 음”이 비는 것처럼 보일 수 있다.
  // 그래서 toneCount 변화 시에는 반드시 재생성한다.
  const cached = patternCache.get(key);
  const codes12 =
    cached && cached.toneCount === toneCount
      ? cached.codes12
      : (() => {
          const next = generateCodes12(key, toneCount);
          patternCache.set(key, { codes12: next, toneCount });
          return next;
        })();

  // 12컬럼을 4/4/4로 쪼개서 각 voice에 반영
  const bassCodes = codes12.slice(0, 4) as VoiceCodes;
  const baritoneCodes = codes12.slice(4, 8) as VoiceCodes;
  const tenorCodes = codes12.slice(8, 12) as VoiceCodes;

  const grids = {
    // 기본 자기 음은 항상 들리도록 bass 영역은 항상 생성
    bass: buildGridFromCodes(chordTones, bassCodes),
    // 이웃 1명 이상일 때 baritone 활성
    baritone:
      toneCount >= 2
        ? buildGridFromCodes(chordTones, baritoneCodes)
        : emptyGrid(),
    // 이웃 2명(=toneCount 3)일 때 tenor 활성
    tenor:
      toneCount >= 3 ? buildGridFromCodes(chordTones, tenorCodes) : emptyGrid(),
  };

  // 연속 파라미터: 노이즈 톤화(거리 기반)
  // - gain은 proximity^2로 더 부드럽게(가까워질수록 급격히 또렷)
  // - reso는 proximity에 비례(가까우면 공명↑)
  const p1 = neighbors[0]?.proximity01 ?? 0;
  const p2 = neighbors[1]?.proximity01 ?? 0;
  const p1Gain = p1 * p1 * 0.06;
  const p2Gain = p2 * p2 * 0.06;
  const p1Reso = p1 * 1.2;
  const p2Reso = p2 * 1.2;

  const params: NoiseCraftParam[] = [
    {
      nodeId: PERSONAL_SEQ_V2_NODES.tonal.n1Gain,
      paramName: "value",
      value: p1Gain,
    },
    {
      nodeId: PERSONAL_SEQ_V2_NODES.tonal.n2Gain,
      paramName: "value",
      value: p2Gain,
    },
    {
      nodeId: PERSONAL_SEQ_V2_NODES.tonal.n1Reso,
      paramName: "value",
      value: p1Reso,
    },
    {
      nodeId: PERSONAL_SEQ_V2_NODES.tonal.n2Reso,
      paramName: "value",
      value: p2Reso,
    },
  ];

  return {
    selfId,
    selfTone,
    nearestDist,
    neighbors,
    grids,
    params,
    meetGateTrigger,
    inRadiusIds,
  };
};
