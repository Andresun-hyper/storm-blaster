import type { BattleArena, BattleSimulationConfig } from './battleTypes';

export interface NormalizedBattleSimulationConfig {
  battleId: string;
  arena: BattleArena;
  seed: number;
  fixedTimestep: number;
  maxTicks: number;
  collectibleSpawnInterval: number;
  projectileSpeed: number;
  collectibleFallSpeed: number;
}

export const DEFAULT_BATTLE_SIMULATION_CONFIG: NormalizedBattleSimulationConfig = {
  battleId: 'local-battle',
  arena: {
    width: 390,
    height: 844,
  },
  seed: 1337,
  fixedTimestep: 1 / 60,
  maxTicks: 60 * 120,
  collectibleSpawnInterval: 3,
  projectileSpeed: 520,
  collectibleFallSpeed: 95,
};

export function normalizeBattleSimulationConfig(
  config: BattleSimulationConfig = {}
): NormalizedBattleSimulationConfig {
  return {
    ...DEFAULT_BATTLE_SIMULATION_CONFIG,
    ...config,
    arena: {
      ...DEFAULT_BATTLE_SIMULATION_CONFIG.arena,
      ...config.arena,
    },
  };
}

export interface SeededRandom {
  next: () => number;
  nextRange: (min: number, max: number) => number;
  nextInt: (min: number, maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
}

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextRange: (min, max) => min + (max - min) * next(),
    nextInt: (min, maxExclusive) => Math.floor(min + (maxExclusive - min) * next()),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

export function deriveFighterSeed(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9E3779B9)) >>> 0;
}
