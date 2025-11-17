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
