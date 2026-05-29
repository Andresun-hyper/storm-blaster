import type { BotPolicy, StrategyPlannerRequest } from './policy';
import {
  DEFAULT_BOT_POLICY,
  DEFAULT_STRATEGY_BUDGET,
  createDefaultBotPolicy,
  estimateTokens,
} from './policy';
import type { StrategyPlanner } from './StrategyPlanner';

export interface MockStrategyPlannerOptions {
  readonly name?: string;
  readonly kind?: string;
  readonly basePolicy?: Partial<BotPolicy>;
}

export class MockStrategyPlanner implements StrategyPlanner {
  readonly kind: string;
  readonly name: string;
  readonly tokenBudget = DEFAULT_STRATEGY_BUDGET;
  private readonly basePolicy: BotPolicy;

  constructor(options: MockStrategyPlannerOptions = {}) {
    this.kind = options.kind ?? 'mock-strategy-planner';
    this.name = options.name ?? 'MockStrategyPlanner';
    this.basePolicy = createDefaultBotPolicy({ ...DEFAULT_BOT_POLICY, ...options.basePolicy });
  }

  planStrategy(request: StrategyPlannerRequest): BotPolicy {
    const observation = request.observation;
    const digest = request.digest;
    const self = observation.self;
    const hpRatio = self.maxHp > 0 ? self.hp / self.maxHp : 0;
    const pickupPressure = digest.pickups.length + digest.opponents.length;
    const dangerPressure = digest.threats.length;
    const phase = observation.arena.phase ?? 'unknown';

    const lowHp = hpRatio < 0.35;
    const heavyDanger = dangerPressure >= 3 || (dangerPressure >= 1 && hpRatio < 0.6);
    const collectorMode = !heavyDanger && pickupPressure >= 4 && hpRatio > 0.45;
    const aggressiveMode = !lowHp && !collectorMode && (phase === 'running' || request.context.reason !== 'match-start');

    const derivedPolicy = collectorMode
      ? {
          persona: 'resource-hunter',
          risk: 0.42,
          aggression: 0.42,
          collectBias: 0.92,
          dodgeBias: 0.45,
          retreatBias: 0.28,
          engagementRange: 180,
          targetPriority: 'opportunity' as const,
          dodgeStyle: 'wide' as const,
          formation: 'edge-kite' as const,
          fireMode: 'auto' as const,
        }
      : aggressiveMode
        ? {
            persona: 'pressure-forward',
            risk: 0.78,
            aggression: 0.92,
            collectBias: 0.24,
            dodgeBias: 0.34,
            retreatBias: 0.12,
            engagementRange: 260,
            targetPriority: 'nearest' as const,
            dodgeStyle: 'zigzag' as const,
            formation: 'wide-arc' as const,
            fireMode: 'auto' as const,
          }
        : {
            persona: 'survival-first',
            risk: 0.3,
            aggression: 0.28,
            collectBias: 0.58,
            dodgeBias: 0.9,
            retreatBias: 0.72,
            engagementRange: 160,
            targetPriority: 'threatening' as const,
            dodgeStyle: 'tight' as const,
            formation: 'orbit' as const,
            fireMode: 'hold' as const,
          };

    const nextPolicy = createDefaultBotPolicy({
      ...this.basePolicy,
      ...derivedPolicy,
      maxRefreshesPerMatch: Math.max(3, this.basePolicy.maxRefreshesPerMatch),
      refreshIntervalMs: Math.min(this.basePolicy.refreshIntervalMs, 10000),
      cacheTtlMs: Math.min(this.basePolicy.cacheTtlMs, 20000),
    });

    if (request.prompt.length > this.tokenBudget.maxPromptChars) {
      return {
        ...nextPolicy,
        persona: `${nextPolicy.persona}-trimmed`,
      };
    }

    const tokenEstimate = estimateTokens(request.prompt);
    if (tokenEstimate > this.tokenBudget.maxPromptTokens) {
      return {
        ...nextPolicy,
        aggression: Math.max(0.2, nextPolicy.aggression - 0.1),
        collectBias: Math.max(0.2, nextPolicy.collectBias - 0.05),
      };
    }

    return nextPolicy;
  }
}

export function createMockStrategyPlanner(options?: MockStrategyPlannerOptions): StrategyPlanner {
  return new MockStrategyPlanner(options);
}
