import type {
  ArenaObservation,
  BotAction,
  BotId,
  CollectibleKind,
  FighterObservation,
  PickupObservation,
  ThreatObservation,
} from './observation';

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function clampPoint(point: Point, arena: ArenaObservation): Point {
  return {
    x: clamp(point.x, 0, arena.width),
    y: clamp(point.y, 0, arena.height),
  };
}

export function createAction(
  arena: ArenaObservation,
  target: Point,
  overrides: Partial<Omit<BotAction, 'targetX' | 'targetY' | 'fireMode'>> = {}
): BotAction {
  const safeTarget = clampPoint(target, arena);
  return {
    targetX: safeTarget.x,
    targetY: safeTarget.y,
    fireMode: 'auto',
    dodgeWeight: 0.5,
    collectWeight: 0.5,
    ...overrides,
  };
}

export function getNearestByDistance<T extends Point & { id: BotId }>(
  origin: Point,
  items: readonly T[]
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = distanceSquared(origin, item);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

export function getThreatCenter(threats: readonly ThreatObservation[]): Point | undefined {
  if (threats.length === 0) {
    return undefined;
  }

  let sumX = 0;
  let sumY = 0;
  for (const threat of threats) {
    sumX += threat.x;
    sumY += threat.y;
  }

  return {
    x: sumX / threats.length,
    y: sumY / threats.length,
  };
}

export function getPickupPriority(pickup: PickupObservation): number {
  const basePriorityByKind: Record<CollectibleKind, number> = {
    exp: 1.1,
    coin: 1,
    weapon: 1.4,
    life: 1.8,
    shield: 1.6,
    magnet: 1.5,
    rage: 1.5,
    bomb: 1.3,
    missile: 1.2,
  };

  return (pickup.priority ?? 1) * basePriorityByKind[pickup.kind] * Math.max(1, pickup.value ?? 1);
}

export function hasLivingOpponent(self: FighterObservation, fighter: FighterObservation): boolean {
  return fighter.id !== self.id && fighter.alive !== false && fighter.hp > 0;
}

export function escapeFromThreats(
  self: FighterObservation,
  arena: ArenaObservation,
  threats: readonly ThreatObservation[]
): Point {
  if (threats.length === 0) {
    return {
      x: arena.width * 0.5,
      y: arena.height * 0.8,
    };
  }

  let escapeX = 0;
  let escapeY = 0;
  for (const threat of threats) {
    const dx = self.x - threat.x;
    const dy = self.y - threat.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const weight = ((threat.severity ?? 1) + (threat.radius ?? 0) / 80 + 1) / distance;
    escapeX += (dx / distance) * weight;
    escapeY += (dy / distance) * weight;
  }

  const fallbackX = self.x - escapeX * 180;
  const fallbackY = self.y - escapeY * 180;
  return clampPoint(
    {
      x: Number.isFinite(fallbackX) ? fallbackX : arena.width * 0.5,
      y: Number.isFinite(fallbackY) ? fallbackY : arena.height * 0.8,
    },
    arena
  );
}
