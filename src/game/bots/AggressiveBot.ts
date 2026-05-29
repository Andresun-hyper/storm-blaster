import type { BotAction, BotMetadata, CompressedObservation, FighterObservation } from './observation';
import { clamp, createAction, distanceSquared, getNearestByDistance, hasLivingOpponent } from './shared';
import type { BotController, BotFactoryOptions } from './BotController';

export const AGGRESSIVE_BOT_METADATA: BotMetadata = {
  kind: 'aggressive',
  name: 'AggressiveBot',
  displayName: 'Aggressive',
  description: 'Pushes the closest opponent, keeps pressure high, and accepts more risk for faster kills.',
  role: 'aggressive',
  offense: 0.95,
  defense: 0.35,
  collect: 0.2,
};

function pickAggressiveTarget(observation: CompressedObservation): FighterObservation | undefined {
  const opponents = observation.fighters.filter((fighter) => hasLivingOpponent(observation.self, fighter));
  if (opponents.length === 0) {
    return undefined;
  }

  const nearest = getNearestByDistance(observation.self, opponents);
  if (!nearest) {
    return undefined;
  }

  return nearest;
}

export class AggressiveBot implements BotController {
  readonly kind = 'aggressive';
  readonly metadata = AGGRESSIVE_BOT_METADATA;
  readonly id: string;

  constructor(options: BotFactoryOptions = {}) {
    this.id = options.id ?? 'aggressive-bot';
  }

  reset(): void {
    // Deterministic bot: no internal state to clear.
  }

  decide(observation: CompressedObservation): BotAction {
    const { self, arena, threats } = observation;
    const enemy = pickAggressiveTarget(observation);
    const nearestThreat = threats.length > 0 ? getNearestByDistance(self, threats) : undefined;

    const closeThreat = nearestThreat ? distanceSquared(self, nearestThreat) < 180 * 180 : false;
    const safeZoneY = arena.height * 0.22;
    let targetX = self.x;
    let targetY = self.y;

    if (enemy) {
      const leadX = clamp(enemy.x + enemy.vx * 0.2, 0, arena.width);
      const leadY = clamp(enemy.y + enemy.vy * 0.1, 0, arena.height);
      targetX = leadX;
      targetY = closeThreat ? Math.max(safeZoneY, leadY - 120) : leadY;
    }

    if (nearestThreat && closeThreat) {
      targetX = self.x + (self.x - nearestThreat.x) * 0.9;
      targetY = self.y + (self.y - nearestThreat.y) * 0.9;
    }

    return createAction(arena, { x: targetX, y: targetY }, {
      dodgeWeight: closeThreat ? 0.4 : 0.2,
      collectWeight: 0.1,
      targetEnemyId: enemy?.id,
      attackWeight: 1,
      retreatWeight: closeThreat ? 0.2 : 0,
    });
  }
}

export function createAggressiveBot(options?: BotFactoryOptions): BotController {
  return new AggressiveBot(options);
}
