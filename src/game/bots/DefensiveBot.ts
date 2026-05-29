import type { BotAction, BotMetadata, CompressedObservation, FighterObservation } from './observation';
import { createAction, distanceSquared, escapeFromThreats, getNearestByDistance, hasLivingOpponent } from './shared';
import type { BotController, BotFactoryOptions } from './BotController';

export const DEFENSIVE_BOT_METADATA: BotMetadata = {
  kind: 'defensive',
  name: 'DefensiveBot',
  displayName: 'Defensive',
  description: 'Keeps distance, prefers evasive movement, and only commits when the arena looks safe.',
  role: 'defensive',
  offense: 0.4,
  defense: 0.95,
  collect: 0.3,
};

function pickSafeOpponent(observation: CompressedObservation): FighterObservation | undefined {
  const opponents = observation.fighters.filter((fighter) => hasLivingOpponent(observation.self, fighter));
  if (opponents.length === 0) {
    return undefined;
  }

  const safestTarget = opponents.reduce<FighterObservation | undefined>((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const candidateDistance = distanceSquared(observation.self, candidate);
    const bestDistance = distanceSquared(observation.self, best);
    return candidateDistance > bestDistance ? candidate : best;
  }, undefined);

  return safestTarget;
}

export class DefensiveBot implements BotController {
  readonly kind = 'defensive';
  readonly metadata = DEFENSIVE_BOT_METADATA;
  readonly id: string;

  constructor(options: BotFactoryOptions = {}) {
    this.id = options.id ?? 'defensive-bot';
  }

  reset(): void {
    // Deterministic bot: no internal state to clear.
  }

  decide(observation: CompressedObservation): BotAction {
    const { self, arena, threats } = observation;
    const nearestThreat = threats.length > 0 ? getNearestByDistance(self, threats) : undefined;
    const escapePoint = escapeFromThreats(self, arena, threats);
    const enemy = pickSafeOpponent(observation);
    const dangerDistance = nearestThreat ? distanceSquared(self, nearestThreat) : Number.POSITIVE_INFINITY;
    const underPressure = dangerDistance < 220 * 220;

    let targetX = escapePoint.x;
    let targetY = escapePoint.y;

    if (!underPressure && enemy) {
      const keepDistanceX = self.x + (self.x - enemy.x) * 0.35;
      const keepDistanceY = self.y + (self.y - enemy.y) * 0.25;
      targetX = keepDistanceX;
      targetY = keepDistanceY;
    }

    const shouldFire = !underPressure && enemy !== undefined;
    return createAction(arena, { x: targetX, y: targetY }, {
      dodgeWeight: underPressure ? 1 : 0.8,
      collectWeight: 0.15,
      targetEnemyId: shouldFire ? enemy?.id : undefined,
      attackWeight: shouldFire ? 0.4 : 0.1,
      retreatWeight: underPressure ? 1 : 0.55,
    });
  }
}

export function createDefensiveBot(options?: BotFactoryOptions): BotController {
  return new DefensiveBot(options);
}
