import type { BotAction, BotMetadata, CompressedObservation, FighterObservation, PickupObservation } from './observation';
import { createAction, distanceSquared, getNearestByDistance, getPickupPriority, hasLivingOpponent } from './shared';
import type { BotController, BotFactoryOptions } from './BotController';

export const COLLECTOR_BOT_METADATA: BotMetadata = {
  kind: 'collector',
  name: 'CollectorBot',
  displayName: 'Collector',
  description: 'Chases pickups first, stays alive through simple threat avoidance, and scales into the late game.',
  role: 'collector',
  offense: 0.55,
  defense: 0.65,
  collect: 0.95,
};

function pickBestPickup(observation: CompressedObservation): PickupObservation | undefined {
  const pickups = observation.pickups;
  if (pickups.length === 0) {
    return undefined;
  }

  return pickups.reduce<PickupObservation | undefined>((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const candidateScore = getPickupPriority(candidate) / Math.max(1, distanceSquared(observation.self, candidate));
    const bestScore = getPickupPriority(best) / Math.max(1, distanceSquared(observation.self, best));
    return candidateScore > bestScore ? candidate : best;
  }, undefined);
}

function pickFallbackTarget(observation: CompressedObservation): FighterObservation | undefined {
  const opponents = observation.fighters.filter((fighter) => hasLivingOpponent(observation.self, fighter));
  if (opponents.length === 0) {
    return undefined;
  }

  return opponents.reduce<FighterObservation | undefined>((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const candidateScore = candidate.hp / Math.max(1, candidate.maxHp) + distanceSquared(observation.self, candidate) / 50000;
    const bestScore = best.hp / Math.max(1, best.maxHp) + distanceSquared(observation.self, best) / 50000;
    return candidateScore < bestScore ? candidate : best;
  }, undefined);
}

export class CollectorBot implements BotController {
  readonly kind = 'collector';
  readonly metadata = COLLECTOR_BOT_METADATA;
  readonly id: string;

  constructor(options: BotFactoryOptions = {}) {
    this.id = options.id ?? 'collector-bot';
  }

  reset(): void {
    // Deterministic bot: no internal state to clear.
  }

  decide(observation: CompressedObservation): BotAction {
    const { self, arena, threats } = observation;
    const pickup = pickBestPickup(observation);
    const enemy = pickFallbackTarget(observation);
    const nearestThreat = threats.length > 0 ? getNearestByDistance(self, threats) : undefined;
    const dangerDistance = nearestThreat ? distanceSquared(self, nearestThreat) : Number.POSITIVE_INFINITY;
    const inDanger = dangerDistance < 200 * 200;

    let targetX = self.x;
    let targetY = self.y;

    if (inDanger && nearestThreat) {
      targetX = self.x + (self.x - nearestThreat.x) * 0.85;
      targetY = self.y + (self.y - nearestThreat.y) * 0.85;
    } else if (pickup) {
      targetX = pickup.x;
      targetY = pickup.y;
    } else if (enemy) {
      targetX = enemy.x;
      targetY = enemy.y;
    }

    return createAction(arena, { x: targetX, y: targetY }, {
      dodgeWeight: inDanger ? 0.95 : 0.45,
      collectWeight: pickup ? 1 : 0.7,
      targetCollectibleId: pickup?.id,
      targetEnemyId: pickup ? undefined : enemy?.id,
      attackWeight: pickup ? 0.25 : 0.45,
      retreatWeight: inDanger ? 0.9 : 0.25,
    });
  }
}

export function createCollectorBot(options?: BotFactoryOptions): BotController {
  return new CollectorBot(options);
}
