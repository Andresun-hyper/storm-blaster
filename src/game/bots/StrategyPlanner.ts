import type {
  BotPolicy,
  StrategyPlannerContext,
  StrategyPlannerRequest,
  StrategyTokenBudget,
  StrategyRefreshReason,
} from './policy';

export interface StrategyPlanner {
  readonly kind: string;
  readonly name: string;
  readonly tokenBudget: StrategyTokenBudget;
  planStrategy(request: StrategyPlannerRequest): BotPolicy;
}

export interface StrategyPlannerOptions {
  readonly kind?: string;
  readonly name?: string;
  readonly tokenBudget?: Partial<StrategyTokenBudget>;
  readonly defaultReason?: StrategyRefreshReason;
}

export function createStrategyPlannerContext(
  reason: StrategyRefreshReason,
  refreshCount: number,
  previousPolicy?: BotPolicy,
  lastRefreshTick?: number,
  lastRefreshTimeMs?: number
): StrategyPlannerContext {
  return {
    reason,
    refreshCount,
    previousPolicy,
    lastRefreshTick,
    lastRefreshTimeMs,
  };
}
