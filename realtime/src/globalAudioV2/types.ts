export type NoiseCraftParam = {
  nodeId: string;
  paramName?: string;
  value: number;
};

export type GlobalSignals = {
  entropy: number;
  rmsVelocity: number;
  particleCount: number;
  clusterCount: number;
  inInnerPulsar: 0 | 1;
  outInnerPulsar: 0 | 1;
};

export type MonoSeqGrid = number[][]; // [step][row] = 0|1, steps=12 rows=12

export type GlobalSequencerGrids = {
  bass: MonoSeqGrid;
  baritone: MonoSeqGrid;
  tenor: MonoSeqGrid;
};

export type GlobalSequencerNodeIds = {
  bass: string;
  baritone: string;
  tenor: string;
};

export type AudioGlobalV2Payload = {
  version: 1;
  t: number; // server timestamp ms
  signals: GlobalSignals;
  params: NoiseCraftParam[];
  sequencer: {
    nodeIds: GlobalSequencerNodeIds;
    grids: GlobalSequencerGrids;
  };
};

export type PlayerLike = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
};
