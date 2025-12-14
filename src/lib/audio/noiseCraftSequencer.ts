export type MonoSeqGrid = number[][]; // [step][row] = 0|1 (steps=12, rows=12)

const lastSentGrids = new Map<string, Uint8Array>();

const makeGridKey = (
  nodeId: string,
  patternIndex: number,
  steps: number,
  rows: number
) => `${nodeId}|${patternIndex}|${steps}x${rows}`;

const flattenGrid = (grid: MonoSeqGrid, steps: number, rows: number) => {
  const out = new Uint8Array(steps * rows);
  for (let step = 0; step < steps; step += 1) {
    const stepArr = Array.isArray(grid[step]) ? grid[step] : null;
    for (let row = 0; row < rows; row += 1) {
      const raw = stepArr ? stepArr[row] : 0;
      out[step * rows + row] = raw === 1 ? 1 : 0;
    }
  }
  return out;
};

export const resetNoiseCraftSequencerCache = () => {
  lastSentGrids.clear();
};

export const postMonoSeqGridDiff = (
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  nodeId: string,
  patternIndex: number,
  grid: MonoSeqGrid,
  options?: { steps?: number; rows?: number }
) => {
  if (!iframe?.contentWindow) return;
  if (!nodeId) return;
  if (!Array.isArray(grid)) return;

  const steps = options?.steps ?? 12;
  const rows = options?.rows ?? 12;

  const key = makeGridKey(String(nodeId), patternIndex, steps, rows);
  const next = flattenGrid(grid, steps, rows);
  const prev = lastSentGrids.get(key);

  const targetOrigin =
    process.env.NODE_ENV === "development" ? "*" : origin || "*";

  const sendToggle = (stepIdx: number, rowIdx: number, value: number) => {
    iframe.contentWindow?.postMessage(
      {
        type: "noiseCraft:toggleCell",
        nodeId: String(nodeId),
        patIdx: patternIndex,
        stepIdx,
        rowIdx,
        value,
      },
      targetOrigin
    );
  };

  // First time (or dimension change): full sync once.
  if (!prev || prev.length !== next.length) {
    for (let step = 0; step < steps; step += 1) {
      for (let row = 0; row < rows; row += 1) {
        sendToggle(step, row, next[step * rows + row] ?? 0);
      }
    }
    lastSentGrids.set(key, next);
    return;
  }

  // Diff sync: only changed cells.
  for (let idx = 0; idx < next.length; idx += 1) {
    const v = next[idx] ?? 0;
    if (prev[idx] === v) continue;
    const step = Math.floor(idx / rows);
    const row = idx % rows;
    sendToggle(step, row, v);
  }

  lastSentGrids.set(key, next);
};
