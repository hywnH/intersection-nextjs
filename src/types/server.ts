export interface ServerCell {
  x: number;
  y: number;
  radius?: number;
  mass?: number;
  ox?: number;
  oy?: number;
  color?: string;
}

export interface ServerPlayer {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  massTotal?: number;
  hue?: number;
  color?: string;
  cells?: ServerCell[];
  target?: { x: number; y: number };
}

export interface ServerTellPlayerMovePayload {
  playerData?: ServerPlayer;
  userData?: ServerPlayer[];
}
