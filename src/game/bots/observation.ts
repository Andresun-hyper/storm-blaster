export type BotKind = 'aggressive' | 'defensive' | 'collector' | 'llm-strategy';

export type BotId = string | number;

export type FireMode = 'auto' | 'hold';

export type CollectibleKind = 'exp' | 'coin' | 'weapon' | 'life' | 'shield' | 'magnet' | 'rage' | 'bomb' | 'missile';

export interface ArenaObservation {
  width: number;
  height: number;
  tick?: number;
  timeMs?: number;
  safeMargin?: number;
  phase?: string;
}

export interface FighterObservation {
  id: BotId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  alive?: boolean;
  teamId?: string | number;
  score?: number;
  kills?: number;
}

export interface ThreatObservation {
  id: BotId;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  kind?: string;
  severity?: number;
  radius?: number;
  ownerId?: BotId;
  ttlMs?: number;
}

export interface PickupObservation {
  id: BotId;
  x: number;
  y: number;
  kind: CollectibleKind;
  value?: number;
  priority?: number;
}

export interface CompressedObservation {
  arena: ArenaObservation;
  self: FighterObservation;
  fighters: readonly FighterObservation[];
  threats: readonly ThreatObservation[];
  pickups: readonly PickupObservation[];
  tick?: number;
  phase?: string;
}

export interface BotAction {
  targetX: number;
  targetY: number;
  fireMode: FireMode;
  dodgeWeight: number;
  collectWeight: number;
  targetEnemyId?: BotId;
  targetCollectibleId?: BotId;
  attackWeight?: number;
  retreatWeight?: number;
}

export interface BotMetadata {
  kind: BotKind;
  name: string;
  displayName: string;
  description: string;
  role: 'aggressive' | 'defensive' | 'collector' | 'strategy';
  offense: number;
  defense: number;
  collect: number;
}
