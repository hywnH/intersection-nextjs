export type Mode = "personal" | "global";

export interface Vec2 {
  x: number;
  y: number;
}

export interface CellState {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  color: string;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  cell: CellState;
  target?: Vec2;
  lastUpdate: number;
  isSelf?: boolean;
}

export interface CollisionMark {
  id: string;
  position: Vec2;
  radius: number;
  timestamp: number;
}

export interface CameraState {
  position: Vec2;
  zoom: number;
}

export interface UiState {
  displayName: string;
  statusMessage: string | null;
  connected: boolean;
  reconnecting: boolean;
  population: number;
}

export interface InputState {
  pointer: Vec2;
  pointerActive: boolean;
  lastHeartbeat: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface CellTrail {
  points: TrailPoint[];
}

export interface GlobalOverlay {
  focusPlayerId: string | null;
  lastKnownPositions: Record<string, Vec2>;
}

export interface GameState {
  mode: Mode;
  socketId: string | null;
  gameSize: { width: number; height: number };
  players: Record<string, PlayerSnapshot>;
  playerOrder: string[];
  selfId: string | null;
  camera: CameraState;
  ui: UiState;
  input: InputState;
  collisionMarks: CollisionMark[];
  cellTrails: Record<string, CellTrail>;
  globalOverlay: GlobalOverlay;
  target: Vec2;
  playing: boolean;
}

export type GameAction =
  | { type: "SET_MODE"; mode: Mode }
  | { type: "SET_PLAYERS"; players: Record<string, PlayerSnapshot>; order: string[] }
  | { type: "UPDATE_PLAYER"; player: PlayerSnapshot }
  | { type: "REMOVE_PLAYER"; playerId: string }
  | { type: "SET_SELF"; selfId: string | null }
  | { type: "SET_SOCKET_ID"; socketId: string | null }
  | { type: "SET_UI"; ui: Partial<UiState> }
  | { type: "SET_CAMERA"; camera: Partial<CameraState> }
  | { type: "SET_INPUT"; input: Partial<InputState> }
  | { type: "SET_TARGET"; target: Vec2 }
  | { type: "SET_GAME_SIZE"; gameSize: { width: number; height: number } }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "PUSH_COLLISION_MARK"; mark: CollisionMark }
  | { type: "SET_GLOBAL_OVERLAY"; overlay: Partial<GlobalOverlay> }
  | { type: "RESET" };
