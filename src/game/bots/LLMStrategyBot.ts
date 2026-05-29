import type {
  BotAction,
  BotMetadata,
  BotKind,
  CollectibleKind,
  CompressedObservation,
  FighterObservation,
  PickupObservation,
  ThreatObservation,
} from './observation';
import { createAction, distanceSquared, escapeFromThreats, getNearestByDistance } from './shared';
import {
  DEFAULT_STRATEGY_BUDGET,
  createDefaultBotPolicy,
  createStrategyObservationDigest,
  createStrategyPrompt,
  normalizeBotPolicy,
  type BotPolicy,
  type StrategyPlannerContext,
  type StrategyTokenBudget,
  type StrategyRefreshReason,
} from './policy';
import { createStrategyPlannerContext, type StrategyPlanner } from './StrategyPlanner';
import { MockStrategyPlanner } from './MockStrategyPlanner';
import type { BotController, BotFactoryOptions } from './BotController';

export interface LLMStrategyBotOptions extends BotFactoryOptions {
  readonly planner?: StrategyPlanner;
  readonly policy?: Partial<BotPolicy>;
  readonly refreshIntervalMs?: number;
  readonly maxRefreshesPerMatch?: number;
  readonly budget?: Partial<StrategyTokenBudget>;
}

export const LLM_STRATEGY_BOT_METADATA: BotMetadata = {
  kind: 'llm-strategy',
  name: 'LLMStrategyBot',
  displayName: 'LLM Strategy',
  description:
    'Consumes a cached high-level policy generated from compressed observations, then executes it locally without any live API dependency.',
  role: 'strategy',
  offense: 0.68,
  defense: 0.68,
  collect: 0.56,
};

export class LLMStrategyBot implements BotController {
  readonly kind: BotKind = 'llm-strategy';
  readonly metadata = LLM_STRATEGY_BOT_METADATA;
  readonly id: string;

  private readonly planner: StrategyPlanner;
  private readonly budget = { ...DEFAULT_STRATEGY_BUDGET };
  private readonly maxRefreshesPerMatch: number;
  private readonly refreshIntervalMs: number;
  private policy: BotPolicy;
  private refreshCount = 0;
  private lastRefreshTick: number | undefined;
  private lastRefreshTimeMs: number | undefined;
  private lastPhase: string | undefined;

  constructor(options: LLMStrategyBotOptions = {}) {
    this.id = options.id ?? 'llm-strategy-bot';
    this.planner = options.planner ?? new MockStrategyPlanner();
    this.policy = createDefaultBotPolicy(options.policy);
    this.refreshIntervalMs = options.refreshIntervalMs ?? this.policy.refreshIntervalMs;
    this.maxRefreshesPerMatch = options.maxRefreshesPerMatch ?? this.policy.maxRefreshesPerMatch;

    if (options.budget) {
      Object.assign(this.budget, options.budget);
    }
  }

  reset(): void {
    this.policy = createDefaultBotPolicy(this.policy);
    this.refreshCount = 0;
    this.lastRefreshTick = undefined;
    this.lastRefreshTimeMs = undefined;
    this.lastPhase = undefined;
  }

  decide(observation: CompressedObservation): BotAction {
    const reason = this.getRefreshReason(observation);
    if (reason) {
      this.refreshStrategy(observation, reason);
    }

    return this.policyToAction(observation, this.policy);
  }

  getCachedPolicy(): BotPolicy {
    return this.policy;
  }

  private getRefreshReason(observation: CompressedObservation): StrategyRefreshReason | null {
    const tick = observation.tick ?? observation.arena.tick ?? 0;
    const timeMs = observation.arena.timeMs ?? Math.round((observation.arena.tick ?? tick) * 16.67);
    const phase = observation.phase ?? observation.arena.phase;

    if (this.refreshCount === 0) {
      return 'match-start';
    }

    if (phase !== this.lastPhase) {
      return 'phase-change';
    }

    if (this.refreshCount < this.maxRefreshesPerMatch) {
      const staleByTime =
        this.lastRefreshTimeMs !== undefined && timeMs - this.lastRefreshTimeMs >= this.refreshIntervalMs;
      const staleByTick = this.lastRefreshTick !== undefined && tick - this.lastRefreshTick >= 600;
      if (staleByTime || staleByTick) {
        return 'periodic';
      }
    }

    if (
      this.lastRefreshTimeMs !== undefined &&
      timeMs - this.lastRefreshTimeMs >= this.policy.cacheTtlMs &&
      this.refreshCount < this.maxRefreshesPerMatch
    ) {
      return 'policy-expired';
    }

    return null;
  }

  private refreshStrategy(observation: CompressedObservation, reason: StrategyRefreshReason): void {
    if (this.refreshCount >= this.maxRefreshesPerMatch) {
      return;
    }

    const digest = createStrategyObservationDigest(observation, this.budget);
    const context: StrategyPlannerContext = createStrategyPlannerContext(
      reason,
      this.refreshCount,
      this.policy,
      this.lastRefreshTick,
      this.lastRefreshTimeMs
    );
    const prompt = createStrategyPrompt(digest, context, this.budget);
    const nextPolicy = this.planner.planStrategy({
      observation,
      digest,
      prompt,
      budget: this.budget,
      context,
    });

    this.policy = normalizeBotPolicy({
      ...this.policy,
      ...nextPolicy,
    });
    this.refreshCount += 1;
    this.lastRefreshTick = observation.tick ?? observation.arena.tick;
    this.lastRefreshTimeMs = observation.arena.timeMs;
    this.lastPhase = observation.phase ?? observation.arena.phase;
  }

  private policyToAction(observation: CompressedObservation, policy: BotPolicy): BotAction {
    const { self, arena } = observation;
    const threat = getNearestThreat(self, observation.threats);
    const escape = escapeFromThreats(self, arena, observation.threats);
    const enemy = chooseEnemy(self, observation.fighters, policy.targetPriority);
    const pickup = choosePickup(self, observation.pickups, policy.powerupPriority);
    const dangerDistance = threat ? distanceSquared(self, threat) : Number.POSITIVE_INFINITY;
    const dangerThreshold = Math.max(120, 220 - policy.risk * 90);
    const isInDanger = dangerDistance < dangerThreshold * dangerThreshold;

    let targetX = self.x;
    let targetY = self.y;

    if (isInDanger) {
      targetX = escape.x;
      targetY = escape.y;
    } else if (pickup && policy.collectBias >= policy.aggression) {
      targetX = pickup.x;
      targetY = pickup.y;
    } else if (enemy) {
      const laneX = getFormationX(policy.formation, arena.width, enemy, self);
      const laneY = getFormationY(policy.formation, arena.height, enemy, self);
      targetX = laneX;
      targetY = laneY;
    } else {
      const anchor = getFormationAnchor(policy.formation, arena.width, arena.height);
      targetX = anchor.x;
      targetY = anchor.y;
    }

    const attackWeight = clamp01(policy.aggression * (enemy ? 1 : 0.5));
    const collectWeight = clamp01(policy.collectBias * (pickup ? 1 : 0.45));
    const dodgeWeight = clamp01(policy.dodgeBias + (isInDanger ? 0.35 : 0));
    const retreatWeight = clamp01(policy.retreatBias + (isInDanger ? 0.35 : 0.05));

    const action = createAction(arena, { x: targetX, y: targetY }, {
      dodgeWeight,
      collectWeight,
      targetEnemyId: enemy?.id,
      targetCollectibleId: pickup?.id,
      attackWeight,
      retreatWeight,
    });

    return {
      ...action,
      fireMode: policy.fireMode,
    };
  }
}

export function createLLMStrategyBot(options?: LLMStrategyBotOptions): BotController {
  return new LLMStrategyBot(options);
}

function chooseEnemy(
  self: FighterObservation,
  fighters: readonly FighterObservation[],
  priority: BotPolicy['targetPriority']
): FighterObservation | undefined {
  const opponents = fighters.filter((fighter) => fighter.id !== self.id && fighter.alive !== false && fighter.hp > 0);
  if (opponents.length === 0) {
    return undefined;
  }

  switch (priority) {
    case 'nearest':
      return getNearestByDistance(self, opponents);
    case 'lowest-hp':
      return opponents.reduce<FighterObservation | undefined>((best, candidate) => {
        if (!best) return candidate;
        return candidate.hp / Math.max(1, candidate.maxHp) < best.hp / Math.max(1, best.maxHp) ? candidate : best;
      }, undefined);
    case 'threatening':
      return opponents.reduce<FighterObservation | undefined>((best, candidate) => {
        if (!best) return candidate;
        const candidateScore = (candidate.kills ?? 0) + safeRatio(candidate.hp, candidate.maxHp) * 0.5;
        const bestScore = (best.kills ?? 0) + safeRatio(best.hp, best.maxHp) * 0.5;
        return candidateScore > bestScore ? candidate : best;
      }, undefined);
    case 'opportunity':
    default:
      return opponents.reduce<FighterObservation | undefined>((best, candidate) => {
        if (!best) return candidate;
        const candidateScore = (candidate.score ?? 0) / Math.max(1, distanceSquared(self, candidate));
        const bestScore = (best.score ?? 0) / Math.max(1, distanceSquared(self, best));
        return candidateScore > bestScore ? candidate : best;
      }, undefined);
  }
}

function choosePickup(
  self: FighterObservation,
  pickups: readonly PickupObservation[],
  preference: readonly CollectibleKind[]
): PickupObservation | undefined {
  if (pickups.length === 0) {
    return undefined;
  }

  const prioritized = [...pickups].sort((a, b) => {
    const aPriority = preferenceIndex(preference, a.kind) * 1000 - distanceSquared(self, a);
    const bPriority = preferenceIndex(preference, b.kind) * 1000 - distanceSquared(self, b);
    return bPriority - aPriority;
  });

  return prioritized[0];
}

function preferenceIndex(preference: readonly CollectibleKind[], kind: CollectibleKind): number {
  const index = preference.indexOf(kind);
  return index >= 0 ? preference.length - index : 0;
}

function getNearestThreat(self: FighterObservation, threats: readonly ThreatObservation[]): ThreatObservation | undefined {
  if (threats.length === 0) {
    return undefined;
  }

  return getNearestByDistance(self, threats);
}

function getFormationAnchor(formation: BotPolicy['formation'], width: number, height: number) {
  switch (formation) {
    case 'edge-kite':
      return { x: width * 0.18, y: height * 0.76 };
    case 'wide-arc':
      return { x: width * 0.72, y: height * 0.68 };
    case 'orbit':
      return { x: width * 0.5, y: height * 0.62 };
    case 'center-lane':
    default:
      return { x: width * 0.5, y: height * 0.74 };
  }
}

function getFormationX(
  formation: BotPolicy['formation'],
  width: number,
  enemy: FighterObservation,
  self: FighterObservation
): number {
  switch (formation) {
    case 'edge-kite':
      return enemy.x < width * 0.5 ? width * 0.84 : width * 0.16;
    case 'wide-arc':
      return clampNumber(enemy.x + (enemy.x >= self.x ? -120 : 120), width * 0.12, width * 0.88);
    case 'orbit':
      return clampNumber(self.x + Math.sign(self.x - enemy.x || 1) * 80, width * 0.1, width * 0.9);
    case 'center-lane':
    default:
      return clampNumber(enemy.x, width * 0.2, width * 0.8);
  }
}

function getFormationY(
  formation: BotPolicy['formation'],
  height: number,
  enemy: FighterObservation,
  self: FighterObservation
): number {
  switch (formation) {
    case 'edge-kite':
      return clampNumber(Math.min(enemy.y, self.y - 80), height * 0.12, height * 0.88);
    case 'wide-arc':
      return clampNumber(enemy.y + 60, height * 0.16, height * 0.9);
    case 'orbit':
      return clampNumber(self.y + (self.y < enemy.y ? -60 : 60), height * 0.1, height * 0.9);
    case 'center-lane':
    default:
      return clampNumber(enemy.y, height * 0.14, height * 0.86);
  }
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
