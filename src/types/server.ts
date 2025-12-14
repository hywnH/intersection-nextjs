export interface ServerCell {
  x: number;
  y: number;
  radius?: number;
  mass?: number;
  ox?: number;
  oy?: number;
  color?: string;
  vx?: number;
  vy?: number;
  z?: number;
}

export interface ServerPlayer {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  massTotal?: number;
  hue?: number;
  color?: string;
  cells?: ServerCell[];
  target?: { x: number; y: number };
}

export interface ServerCollisionLine {
  id: string;
  players: [string, string];
  startedAt: number;
  lastEvent?: number;
}

export interface ServerCollisionEvent {
  id: string;
  players: [string, string];
  position: { x: number; y: number };
  radius?: number;
  timestamp: number;
}

export interface ServerTellPlayerMovePayload {
  playerData?: ServerPlayer;
  userData?: ServerPlayer[];
}

export interface ServerAudioChord {
  freq: number;
  gain: number;
}

export interface ServerAudioCluster {
  clusterId: string;
  chord: ServerAudioChord[];
  memberCount: number;
  centroid: { x: number; y: number };
  gain: number;
}

export interface ServerAudioSelf {
  noiseLevel: number;
  ambientLevel: number;
  clusterId: string | null;
}

export interface ServerAudioGlobal {
  cluster: ServerAudioCluster | null;
}

// ---- Global Audio V2 (global-workspace parity) ----

export interface ServerNoiseCraftParam {
  nodeId: string;
  paramName?: string;
  value: number;
}

export interface ServerGlobalSignals {
  entropy: number;
  rmsVelocity: number;
  particleCount: number;
  clusterCount: number;
  inInnerPulsar: 0 | 1;
  outInnerPulsar: 0 | 1;
}

export type ServerMonoSeqGrid = number[][]; // [step][row] = 0|1, steps=12 rows=12

export interface ServerGlobalSequencerGrids {
  bass: ServerMonoSeqGrid;
  baritone: ServerMonoSeqGrid;
  tenor: ServerMonoSeqGrid;
}

export interface ServerAudioGlobalV2 {
  version: 1;
  t: number;
  signals: ServerGlobalSignals;
  params: ServerNoiseCraftParam[];
  sequencer: {
    nodeIds: { bass: string; baritone: string; tenor: string };
    grids: ServerGlobalSequencerGrids;
  };
}
