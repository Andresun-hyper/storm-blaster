import type { Vec2 } from '../types';
import type { BotId, CompressedObservation } from '../bots';

export type BattleId = string;
export type BattlePhase = 'ready' | 'running' | 'finished';
export type BattleFinishReason = 'elimination' | 'timeLimit' | 'manual';
export type BattleFireMode = 'auto' | 'hold' | 'burst';
export type BattleCollectibleKind = 'repair' | 'shield' | 'rage' | 'score';

export interface BattleArena {
  width: number;
  height: number;
}

export interface BattleSimulationConfig {
  battleId?: BattleId;
  arena?: Partial<BattleArena>;
  seed?: number;
  fixedTimestep?: number;
  maxTicks?: number;
  collectibleSpawnInterval?: number;
  projectileSpeed?: number;
  collectibleFallSpeed?: number;
}

export interface BattleBotResetContext {
  fighterId: BattleId;
  seed: number;
  arena: BattleArena;
}

export interface BotAction {
  targetX: number;
  targetY: number;
  aimX?: number;
  aimY?: number;
  fireMode?: BattleFireMode;
  dodgeWeight?: number;
  collectWeight?: number;
  targetEnemyId?: BotId;
  targetCollectibleId?: BotId;
  attackWeight?: number;
  retreatWeight?: number;
}

export interface BattleBotObservation {
  fighterId: BattleId;
  tick: number;
  time: number;
  arena: BattleArena;
  self: BattleFighterSnapshot;
  opponents: BattleFighterSnapshot[];
  projectiles: BattleProjectileSnapshot[];
  collectibles: BattleCollectibleSnapshot[];
}

export interface BattleBotController {
  readonly kind?: string;
  readonly id?: BattleId;
  readonly metadata?: {
    name?: string;
    displayName?: string;
  };
  name?: string;
  reset?: (seed?: number, context?: BattleBotResetContext) => void;
  getAction?: (observation: BattleBotObservation) => BotAction;
  decide?: (observation: CompressedObservation) => BotAction;
  update?: (observation: BattleBotObservation) => BotAction;
}

export interface BattleFighterConfig {
  id: BattleId;
  name: string;
  bot?: BattleBotController;
  modules?: readonly string[];
  color?: string;
  pos?: Vec2;
  maxHp?: number;
  lives?: number;
  speed?: number;
  damage?: number;
  fireCooldown?: number;
}

export interface BattleFighterState {
  id: BattleId;
  name: string;
  botName: string;
  color: string;
  pos: Vec2;
  vel: Vec2;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  lives: number;
  maxLives: number;
  speed: number;
  damage: number;
  fireCooldown: number;
  fireTimer: number;
  shield: number;
  rageTimer: number;
  invincibleTimer: number;
  respawnTimer: number;
  active: boolean;
  eliminated: boolean;
  modules?: readonly string[];
  ghostActive?: boolean;
  empActive?: boolean;
}

export interface BattleProjectile {
  id: BattleId;
  ownerId: BattleId;
  pos: Vec2;
  vel: Vec2;
  width: number;
  height: number;
  damage: number;
  active: boolean;
}

export interface BattleCollectible {
  id: BattleId;
  kind: BattleCollectibleKind;
  pos: Vec2;
  vel: Vec2;
  width: number;
  height: number;
  value: number;
  active: boolean;
}

export interface BattleFighterStats {
  fighterId: BattleId;
  name: string;
  botName: string;
  score: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  collectiblesCollected: number;
  survivalTime: number;
}

export interface BattleState {
  battleId: BattleId;
  phase: BattlePhase;
  tick: number;
  time: number;
  seed: number;
  arena: BattleArena;
  fighters: BattleFighterState[];
  projectiles: BattleProjectile[];
  collectibles: BattleCollectible[];
  stats: Record<BattleId, BattleFighterStats>;
}

export interface BattleFighterSnapshot {
  id: BattleId;
  name: string;
  botName: string;
  color: string;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  lives: number;
  shield: number;
  rageTimer: number;
  active: boolean;
  eliminated: boolean;
  modules?: readonly string[];
  ghostActive?: boolean;
  empActive?: boolean;
}

export interface BattleProjectileSnapshot {
  id: BattleId;
  ownerId: BattleId;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  width?: number;
  height?: number;
}

export interface BattleCollectibleSnapshot {
  id: BattleId;
  kind: BattleCollectibleKind;
  pos: Vec2;
  value: number;
}

export interface BattleRankingEntry {
  rank: number;
  fighterId: BattleId;
  name: string;
  botName: string;
  score: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  accuracy: number;
  collectiblesCollected: number;
  survivalTime: number;
  remainingLives: number;
  remainingHp: number;
}

export interface BattleReport {
  battleId: BattleId;
  seed: number;
  finishReason: BattleFinishReason;
  duration: number;
  ticks: number;
  winnerId?: BattleId;
  winnerName?: string;
  rankings: BattleRankingEntry[];
  finalState: BattleState;
}

export type BattleStateListener = (state: BattleState) => void;
