import type { BotAction, BotKind, BotMetadata, CompressedObservation } from './observation';
import type { BotPolicy } from './policy';
import { AGGRESSIVE_BOT_METADATA, createAggressiveBot } from './AggressiveBot';
import { COLLECTOR_BOT_METADATA, createCollectorBot } from './CollectorBot';
import { DEFENSIVE_BOT_METADATA, createDefensiveBot } from './DefensiveBot';
import { LLM_STRATEGY_BOT_METADATA, createLLMStrategyBot } from './LLMStrategyBot';

export interface BotController<
  TObservation extends CompressedObservation = CompressedObservation,
  TAction extends BotAction = BotAction,
> {
  readonly kind: BotKind;
  readonly id: string;
  readonly metadata: BotMetadata;
  reset(seed?: number): void;
  decide(observation: TObservation): TAction;
}

export interface BotFactoryOptions {
  id?: string;
  policy?: Partial<BotPolicy>;
}

export type BotFactory = (options?: BotFactoryOptions) => BotController;

export const BOT_METADATA = {
  aggressive: AGGRESSIVE_BOT_METADATA,
  defensive: DEFENSIVE_BOT_METADATA,
  collector: COLLECTOR_BOT_METADATA,
  'llm-strategy': LLM_STRATEGY_BOT_METADATA,
} satisfies Record<BotKind, BotMetadata>;

export const BOT_FACTORIES = {
  aggressive: createAggressiveBot,
  defensive: createDefensiveBot,
  collector: createCollectorBot,
  'llm-strategy': createLLMStrategyBot,
} satisfies Record<BotKind, BotFactory>;

export function createBotController(kind: BotKind, options?: BotFactoryOptions): BotController {
  return BOT_FACTORIES[kind](options);
}

export function listBotMetadata(): BotMetadata[] {
  return Object.values(BOT_METADATA);
}

export function getBotMetadata(kind: BotKind): BotMetadata {
  return BOT_METADATA[kind];
}
