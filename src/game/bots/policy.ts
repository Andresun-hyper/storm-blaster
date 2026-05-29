import type { BotId, CompressedObservation, CollectibleKind } from './observation';
import { distanceSquared } from './shared';

export type StrategyRefreshReason =
  | 'match-start'
  | 'phase-change'
  | 'periodic'
  | 'policy-expired'
  | 'manual';

export type StrategyTargetPriority =
  | 'nearest'
  | 'lowest-hp'
  | 'threatening'
  | 'opportunity';

export type StrategyFormation = 'center-lane' | 'edge-kite' | 'wide-arc' | 'orbit';
export type StrategyDodgeStyle = 'tight' | 'wide' | 'zigzag';

export interface StrategyTokenBudget {
  readonly maxPromptChars: number;
  readonly maxPromptTokens: number;
  readonly maxOpponents: number;
  readonly maxThreats: number;
  readonly maxPickups: number;
}

export interface BotPolicy {
  readonly schemaVersion: 1;
  readonly persona: string;
  readonly risk: number;
  readonly aggression: number;
  readonly collectBias: number;
  readonly dodgeBias: number;
  readonly retreatBias: number;
  readonly engagementRange: number;
  readonly targetPriority: StrategyTargetPriority;
  readonly dodgeStyle: StrategyDodgeStyle;
  readonly formation: StrategyFormation;
  readonly powerupPriority: readonly CollectibleKind[];
  readonly fireMode: 'auto' | 'hold';
  readonly refreshIntervalMs: number;
  readonly maxRefreshesPerMatch: number;
  readonly cacheTtlMs: number;
}

export interface StrategyEntityDigest {
  readonly id: BotId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp?: number;
  readonly maxHp?: number;
  readonly score?: number;
  readonly kills?: number;
  readonly priority?: number;
}

export interface StrategyObservationDigest {
  readonly arena: {
    readonly width: number;
    readonly height: number;
    readonly tick?: number;
    readonly timeMs?: number;
    readonly phase?: string;
    readonly safeMargin?: number;
  };
  readonly self: StrategyEntityDigest & {
    readonly alive?: boolean;
  };
  readonly opponents: readonly StrategyEntityDigest[];
  readonly threats: readonly StrategyEntityDigest[];
  readonly pickups: readonly (StrategyEntityDigest & {
    readonly kind: CollectibleKind;
  })[];
  readonly summary: string;
  readonly estimatedTokens: number;
}

export interface StrategyPlannerContext {
  readonly reason: StrategyRefreshReason;
  readonly refreshCount: number;
  readonly lastRefreshTick?: number;
  readonly lastRefreshTimeMs?: number;
  readonly previousPolicy?: BotPolicy;
}

export interface StrategyPlannerRequest {
  readonly observation: CompressedObservation;
  readonly digest: StrategyObservationDigest;
  readonly prompt: string;
  readonly budget: StrategyTokenBudget;
  readonly context: StrategyPlannerContext;
}

export const DEFAULT_STRATEGY_BUDGET: StrategyTokenBudget = {
  maxPromptChars: 1400,
  maxPromptTokens: 350,
  maxOpponents: 4,
  maxThreats: 6,
  maxPickups: 6,
};

export const DEFAULT_BOT_POLICY: BotPolicy = {
  schemaVersion: 1,
  persona: 'balanced-strategist',
  risk: 0.55,
  aggression: 0.6,
  collectBias: 0.45,
  dodgeBias: 0.5,
  retreatBias: 0.35,
  engagementRange: 220,
  targetPriority: 'opportunity',
  dodgeStyle: 'wide',
  formation: 'center-lane',
  powerupPriority: ['shield', 'rage', 'missile', 'life', 'weapon', 'coin', 'exp', 'bomb', 'magnet'],
  fireMode: 'auto',
  refreshIntervalMs: 12000,
  maxRefreshesPerMatch: 10,
  cacheTtlMs: 15000,
};

export function createDefaultBotPolicy(overrides: Partial<BotPolicy> = {}): BotPolicy {
  return normalizeBotPolicy({ ...DEFAULT_BOT_POLICY, ...overrides });
}

export function normalizeBotPolicy(input: Partial<BotPolicy>): BotPolicy {
  const powerupPriority = uniqueCollectiblePriority(
    input.powerupPriority ?? DEFAULT_BOT_POLICY.powerupPriority
  );

  return {
    schemaVersion: 1,
    persona: input.persona?.trim() || DEFAULT_BOT_POLICY.persona,
    risk: clamp01(input.risk ?? DEFAULT_BOT_POLICY.risk),
    aggression: clamp01(input.aggression ?? DEFAULT_BOT_POLICY.aggression),
    collectBias: clamp01(input.collectBias ?? DEFAULT_BOT_POLICY.collectBias),
    dodgeBias: clamp01(input.dodgeBias ?? DEFAULT_BOT_POLICY.dodgeBias),
    retreatBias: clamp01(input.retreatBias ?? DEFAULT_BOT_POLICY.retreatBias),
    engagementRange: clampNumber(input.engagementRange ?? DEFAULT_BOT_POLICY.engagementRange, 40, 1000),
    targetPriority: input.targetPriority ?? DEFAULT_BOT_POLICY.targetPriority,
    dodgeStyle: input.dodgeStyle ?? DEFAULT_BOT_POLICY.dodgeStyle,
    formation: input.formation ?? DEFAULT_BOT_POLICY.formation,
    powerupPriority,
    fireMode: input.fireMode ?? DEFAULT_BOT_POLICY.fireMode,
    refreshIntervalMs: clampNumber(input.refreshIntervalMs ?? DEFAULT_BOT_POLICY.refreshIntervalMs, 1000, 60000),
    maxRefreshesPerMatch: Math.max(1, Math.floor(input.maxRefreshesPerMatch ?? DEFAULT_BOT_POLICY.maxRefreshesPerMatch)),
    cacheTtlMs: clampNumber(input.cacheTtlMs ?? DEFAULT_BOT_POLICY.cacheTtlMs, 1000, 120000),
  };
}

export function createStrategyObservationDigest(
  observation: CompressedObservation,
  budget: StrategyTokenBudget = DEFAULT_STRATEGY_BUDGET
): StrategyObservationDigest {
  const self = observation.self;
  const aliveOpponents = observation.fighters.filter((fighter) => fighter.id !== self.id && fighter.alive !== false);
  const opponents = sortByDistance(self, aliveOpponents)
    .slice(0, budget.maxOpponents)
    .map((fighter) => ({
      id: fighter.id,
      x: fighter.x,
      y: fighter.y,
      vx: fighter.vx,
      vy: fighter.vy,
      hp: fighter.hp,
      maxHp: fighter.maxHp,
      score: fighter.score,
      kills: fighter.kills,
      priority: 1 - safeRatio(fighter.hp, fighter.maxHp),
    }));

  const threats = sortByDistance(self, observation.threats)
    .slice(0, budget.maxThreats)
    .map((threat) => ({
      id: threat.id,
      x: threat.x,
      y: threat.y,
      vx: threat.vx ?? 0,
      vy: threat.vy ?? 0,
      priority: threat.severity ?? 1,
    }));

  const pickups = sortByPriority(observation.pickups)
    .slice(0, budget.maxPickups)
    .map((pickup) => ({
      id: pickup.id,
      x: pickup.x,
      y: pickup.y,
      vx: 0,
      vy: 0,
      kind: pickup.kind,
      priority: pickup.priority ?? 1,
    }));

  const summary = buildStrategySummary(observation, opponents.length, threats.length, pickups.length);
  const estimatedTokens = estimateTokens(summary);

  return {
    arena: {
      width: observation.arena.width,
      height: observation.arena.height,
      tick: observation.tick ?? observation.arena.tick,
      timeMs: observation.arena.timeMs,
      phase: observation.phase ?? observation.arena.phase,
      safeMargin: observation.arena.safeMargin,
    },
    self: {
      id: self.id,
      x: self.x,
      y: self.y,
      vx: self.vx,
      vy: self.vy,
      hp: self.hp,
      maxHp: self.maxHp,
      score: self.score,
      kills: self.kills,
      alive: self.alive,
    },
    opponents,
    threats,
    pickups,
    summary,
    estimatedTokens,
  };
}

export function createStrategyPrompt(
  digest: StrategyObservationDigest,
  context: StrategyPlannerContext,
  budget: StrategyTokenBudget = DEFAULT_STRATEGY_BUDGET
): string {
  const payload = {
    reason: context.reason,
    refreshCount: context.refreshCount,
    lastRefreshTick: context.lastRefreshTick ?? null,
    lastRefreshTimeMs: context.lastRefreshTimeMs ?? null,
    previousPolicy: context.previousPolicy
      ? {
          persona: context.previousPolicy.persona,
          risk: context.previousPolicy.risk,
          aggression: context.previousPolicy.aggression,
          collectBias: context.previousPolicy.collectBias,
          dodgeBias: context.previousPolicy.dodgeBias,
          retreatBias: context.previousPolicy.retreatBias,
          engagementRange: context.previousPolicy.engagementRange,
          targetPriority: context.previousPolicy.targetPriority,
          dodgeStyle: context.previousPolicy.dodgeStyle,
          formation: context.previousPolicy.formation,
          powerupPriority: context.previousPolicy.powerupPriority.slice(0, 4),
          fireMode: context.previousPolicy.fireMode,
        }
      : undefined,
    digest,
  };

  const text = JSON.stringify(payload);
  if (text.length <= budget.maxPromptChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget.maxPromptChars - 3))}...`;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function summarizeStrategyBudget(digest: StrategyObservationDigest, budget: StrategyTokenBudget): string {
  const lines = [
    `arena=${digest.arena.width}x${digest.arena.height} tick=${digest.arena.tick ?? 0} phase=${digest.arena.phase ?? 'unknown'}`,
    `self hp=${round(digest.self.hp ?? 0)} score=${round(digest.self.score ?? 0)} kills=${round(digest.self.kills ?? 0)} alive=${digest.self.alive !== false}`,
    `opponents=${digest.opponents.length}/${budget.maxOpponents} threats=${digest.threats.length}/${budget.maxThreats} pickups=${digest.pickups.length}/${budget.maxPickups}`,
  ];
  return lines.join(' | ');
}

function buildStrategySummary(
  observation: CompressedObservation,
  opponentCount: number,
  threatCount: number,
  pickupCount: number
): string {
  const self = observation.self;
  const hpRatio = safeRatio(self.hp, self.maxHp);
  return [
    `phase=${observation.phase ?? observation.arena.phase ?? 'unknown'}`,
    `tick=${observation.tick ?? observation.arena.tick ?? 0}`,
    `hp=${round(self.hp)}/${round(self.maxHp)}(${Math.round(hpRatio * 100)}%)`,
    `score=${round(self.score ?? 0)}`,
    `kills=${round(self.kills ?? 0)}`,
    `opponents=${opponentCount}`,
    `threats=${threatCount}`,
    `pickups=${pickupCount}`,
  ].join(' ');
}

function sortByDistance<T extends { id: BotId; x: number; y: number }>(origin: { x: number; y: number }, items: readonly T[]): T[] {
  return [...items].sort((a, b) => distanceSquared(origin, a) - distanceSquared(origin, b));
}

function sortByPriority<T extends { priority?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function uniqueCollectiblePriority(items: readonly CollectibleKind[]): readonly CollectibleKind[] {
  const seen = new Set<CollectibleKind>();
  const result: CollectibleKind[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeRatio(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

function round(value: number): number {
  return Math.round(value);
}

export function parseImportUrl(urlStr: string): Partial<BotPolicy> {
  const getParam = (name: string): string | null => {
    const regex = new RegExp(`[?&]${name}=([^&#]*)`, 'i');
    const match = regex.exec(urlStr);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const target = getParam('target') || 'nearest';
  const _avoid = getParam('avoid') || 'none';
  const _betray = getParam('betray') || 'never';
  const skill = getParam('skill') || 'balanced';
  const survive = getParam('survive') || 'def50';
  const _promise = getParam('promise') || 'opportunistic';

  void _avoid;
  void _betray;
  void _promise;

  let aggression = 0.60;
  let collectBias = 0.45;
  let risk = 0.55;
  const persona = `AI-${skill}-${survive}`;

  if (skill === 'aggressive') {
    aggression = 0.85;
    collectBias = 0.50;
    risk = 0.75;
  } else if (skill === 'conservative') {
    aggression = 0.35;
    collectBias = 0.35;
    risk = 0.35;
  }

  let retreatBias = 0.35;
  let dodgeBias = 0.50;

  if (survive === 'trade') {
    retreatBias = 0.15;
    dodgeBias = 0.30;
    risk = Math.max(risk, 0.80);
    aggression = Math.min(1.0, aggression + 0.10);
  } else if (survive === 'survival_first') {
    retreatBias = 0.85;
    dodgeBias = 0.85;
    risk = Math.min(risk, 0.30);
    aggression = Math.max(0.20, aggression - 0.20);
  } else if (survive === 'def50') {
    retreatBias = 0.55;
    dodgeBias = 0.60;
  }

  let targetPriority: StrategyTargetPriority = 'opportunity';
  if (target === 'lowest_hp') {
    targetPriority = 'lowest-hp';
  } else if (target === 'highest_threat') {
    targetPriority = 'threatening';
  } else if (target === 'nearest') {
    targetPriority = 'nearest';
  }

  const dodgeStyle: StrategyDodgeStyle = survive === 'survival_first' ? 'wide' : skill === 'aggressive' ? 'tight' : 'zigzag';
  const formation: StrategyFormation = skill === 'aggressive' ? 'center-lane' : survive === 'survival_first' ? 'edge-kite' : 'orbit';

  return {
    persona,
    risk,
    aggression,
    collectBias,
    dodgeBias,
    retreatBias,
    targetPriority,
    dodgeStyle,
    formation,
    engagementRange: skill === 'aggressive' ? 300 : survive === 'survival_first' ? 180 : 240,
    powerupPriority: survive === 'survival_first' 
      ? ['shield', 'life', 'bomb', 'magnet', 'weapon', 'coin'] 
      : ['rage', 'weapon', 'missile', 'shield', 'life', 'bomb'],
  };
}
