import type {
  BattleFinishReason,
  BattleFighterState,
  BattleRankingEntry,
  BattleReport,
  BattleState,
} from './battleTypes';

export function createBattleReport(state: BattleState, finishReason: BattleFinishReason): BattleReport {
  const rankings = createBattleRankings(state);
  const winner = rankings[0];

  return {
    battleId: state.battleId,
    seed: state.seed,
    finishReason,
    duration: state.time,
    ticks: state.tick,
    winnerId: winner?.fighterId,
    winnerName: winner?.name,
    rankings,
    finalState: cloneBattleState(state),
  };
}

export function createBattleRankings(state: BattleState): BattleRankingEntry[] {
  const fightersById = new Map(state.fighters.map((fighter) => [fighter.id, fighter]));

  return Object.values(state.stats)
    .map((stats) => {
      const fighter = fightersById.get(stats.fighterId);
      return createRankingEntry(stats.fighterId, stats, fighter);
    })
    .sort(compareRankingEntries)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

export function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    arena: { ...state.arena },
    fighters: state.fighters.map((fighter) => ({
      ...fighter,
      pos: { ...fighter.pos },
      vel: { ...fighter.vel },
    })),
    projectiles: state.projectiles.map((projectile) => ({
      ...projectile,
      pos: { ...projectile.pos },
      vel: { ...projectile.vel },
    })),
    collectibles: state.collectibles.map((collectible) => ({
      ...collectible,
      pos: { ...collectible.pos },
      vel: { ...collectible.vel },
    })),
    stats: Object.fromEntries(
      Object.entries(state.stats).map(([fighterId, stats]) => [fighterId, { ...stats }])
    ),
  };
}

function createRankingEntry(
  fighterId: string,
  stats: BattleState['stats'][string],
  fighter: BattleFighterState | undefined
): BattleRankingEntry {
  const shotsFired = stats.shotsFired;
  const accuracy = shotsFired > 0 ? stats.shotsHit / shotsFired : 0;

  return {
    rank: 0,
    fighterId,
    name: stats.name,
    botName: stats.botName,
    score: stats.score,
    kills: stats.kills,
    deaths: stats.deaths,
    damageDealt: stats.damageDealt,
    damageTaken: stats.damageTaken,
    shotsFired,
    shotsHit: stats.shotsHit,
    accuracy,
    collectiblesCollected: stats.collectiblesCollected,
    survivalTime: stats.survivalTime,
    remainingLives: fighter?.lives ?? 0,
    remainingHp: fighter?.hp ?? 0,
  };
}

function compareRankingEntries(a: BattleRankingEntry, b: BattleRankingEntry): number {
  return (
    b.score - a.score ||
    b.kills - a.kills ||
    b.remainingLives - a.remainingLives ||
    b.remainingHp - a.remainingHp ||
    b.damageDealt - a.damageDealt ||
    a.damageTaken - b.damageTaken ||
    a.deaths - b.deaths ||
    a.fighterId.localeCompare(b.fighterId)
  );
}
