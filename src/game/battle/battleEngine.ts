import type {
  BattleBotController,
  BattleBotObservation,
  BattleCollectible,
  BattleCollectibleKind,
  BattleFighterConfig,
  BattleFighterSnapshot,
  BattleFighterState,
  BattleFinishReason,
  BattleProjectile,
  BattleProjectileSnapshot,
  BattleReport,
  BattleSimulationConfig,
  BattleState,
  BattleStateListener,
  BotAction,
} from './battleTypes';
import type { CollectibleKind, CompressedObservation } from '../bots';
import { cloneBattleState, createBattleReport } from './battleReport';
import {
  createSeededRandom,
  deriveFighterSeed,
  normalizeBattleSimulationConfig,
  type NormalizedBattleSimulationConfig,
  type SeededRandom,
} from './simulationConfig';

export interface LocalBattleEngineOptions {
  fighters: BattleFighterConfig[];
  simulation?: BattleSimulationConfig;
}

export class LocalBattleEngine {
  private readonly config: NormalizedBattleSimulationConfig;
  private readonly controllers = new Map<string, BattleBotController | undefined>();
  private readonly listeners = new Set<BattleStateListener>();
  private readonly rng: SeededRandom;
  private state: BattleState;
  private report: BattleReport | null = null;
  private nextEntityId = 1;
  private collectibleSpawnTimer: number;

  constructor(options: LocalBattleEngineOptions) {
    if (options.fighters.length < 2) {
      throw new Error('LocalBattleEngine requires at least two fighters.');
    }

    this.config = normalizeBattleSimulationConfig(options.simulation);
    this.rng = createSeededRandom(this.config.seed);
    this.collectibleSpawnTimer = this.config.collectibleSpawnInterval * 0.5;
    this.state = this.createInitialState(options.fighters);
  }

  start(): BattleState {
    if (this.state.phase !== 'ready') return this.getState();

    this.state.phase = 'running';
    this.resetControllers();
    this.notify();
    return this.getState();
  }

  step(dtSeconds: number = this.config.fixedTimestep): BattleState {
    if (this.state.phase === 'ready') {
      this.start();
    }

    if (this.state.phase !== 'running') {
      return this.getState();
    }

    const dt = clamp(dtSeconds, 0, 0.1);
    this.state.tick += 1;
    this.state.time += dt;

    this.updateFighterTimers(dt);
    this.updateRespawns(dt);
    this.runControllers(dt);
    this.updateProjectiles(dt);
    this.updateCollectibles(dt);
    this.checkProjectileHits();
    this.checkCollectiblePickups();
    this.cleanupEntities();
    this.updateSurvivalStats();
    this.spawnCollectibles(dt);
    this.checkFinishConditions();
    this.notify();

    return this.getState();
  }

  runUntilFinished(maxTicks: number = this.config.maxTicks): BattleReport {
    this.start();

    let guard = maxTicks;
    while (this.state.phase === 'running' && guard > 0) {
      this.step(this.config.fixedTimestep);
      guard -= 1;
    }

    if (this.state.phase !== 'finished') {
      this.finish('manual');
    }

    return this.getReport();
  }

  finish(reason: BattleFinishReason = 'manual'): BattleReport {
    if (this.state.phase !== 'finished') {
      this.state.phase = 'finished';
      this.report = createBattleReport(this.state, reason);
      this.notify();
    }

    return this.getReport();
  }

  subscribe(listener: BattleStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): BattleState {
    return cloneBattleState(this.state);
  }

  getLiveState(): BattleState {
    return this.getState();
  }

  getReport(): BattleReport {
    if (!this.report) {
      throw new Error('BattleReport is not available until the battle is finished.');
    }

    return cloneBattleReport(this.report);
  }

  private createInitialState(fighterConfigs: BattleFighterConfig[]): BattleState {
    const fighters = fighterConfigs.map((fighter, index) => {
      this.controllers.set(fighter.id, fighter.bot);
      return this.createFighter(fighter, index, fighterConfigs.length);
    });

    return {
      battleId: this.config.battleId,
      phase: 'ready',
      tick: 0,
      time: 0,
      seed: this.config.seed,
      arena: { ...this.config.arena },
      fighters,
      projectiles: [],
      collectibles: [],
      stats: Object.fromEntries(fighters.map((fighter) => [fighter.id, createInitialStats(fighter)])),
    };
  }

  private createFighter(config: BattleFighterConfig, index: number, total: number): BattleFighterState {
    const width = Math.max(28, this.config.arena.width * 0.1);
    const height = width;
    const spacing = this.config.arena.width / (total + 1);
    const defaultPos = {
      x: spacing * (index + 1),
      y: this.config.arena.height * (0.68 + (index % 2) * 0.12),
    };
    const botName =
      config.bot?.metadata?.displayName ??
      config.bot?.metadata?.name ??
      config.bot?.name ??
      config.bot?.id ??
      'compatible-bot';
    const maxHp = config.maxHp ?? 12;
    const lives = config.lives ?? 3;

    return {
      id: config.id,
      name: config.name,
      botName,
      color: config.color ?? DEFAULT_FIGHTER_COLORS[index % DEFAULT_FIGHTER_COLORS.length],
      pos: { ...(config.pos ?? defaultPos) },
      vel: { x: 0, y: 0 },
      width,
      height,
      hp: maxHp,
      maxHp,
      lives,
      maxLives: lives,
      speed: config.speed ?? 260,
      damage: config.damage ?? 2,
      fireCooldown: config.fireCooldown ?? 0.42,
      fireTimer: 0,
      shield: 0,
      rageTimer: 0,
      invincibleTimer: 0,
      respawnTimer: 0,
      active: true,
      eliminated: false,
    };
  }

  private resetControllers() {
    this.state.fighters.forEach((fighter, index) => {
      const controller = this.controllers.get(fighter.id);
      const seed = deriveFighterSeed(this.config.seed, index);
      const context = {
        fighterId: fighter.id,
        seed,
        arena: { ...this.state.arena },
      };
      controller?.reset?.(seed, context);
    });
  }

  private updateFighterTimers(dt: number) {
    for (const fighter of this.state.fighters) {
      fighter.fireTimer = Math.max(0, fighter.fireTimer - dt);
      fighter.rageTimer = Math.max(0, fighter.rageTimer - dt);
      fighter.invincibleTimer = Math.max(0, fighter.invincibleTimer - dt);
    }
  }

  private updateRespawns(dt: number) {
    for (const fighter of this.state.fighters) {
      if (fighter.active || fighter.eliminated || fighter.respawnTimer <= 0) continue;

      fighter.respawnTimer = Math.max(0, fighter.respawnTimer - dt);
      if (fighter.respawnTimer === 0) {
        fighter.active = true;
        fighter.hp = fighter.maxHp;
        fighter.invincibleTimer = 1.2;
        fighter.pos = this.respawnPosition(fighter);
        fighter.vel = { x: 0, y: 0 };
      }
    }
  }

  private runControllers(dt: number) {
    for (const fighter of this.state.fighters) {
      if (!fighter.active || fighter.eliminated) continue;

      const observation = this.createObservation(fighter);
      const action = this.sanitizeAction(fighter, this.readControllerAction(fighter, observation));
      this.moveFighter(fighter, action, dt);

      if (action.fireMode !== 'hold') {
        this.fireProjectile(fighter, action);
      }
    }
  }

  private readControllerAction(fighter: BattleFighterState, observation: BattleBotObservation): BotAction {
    const controller = this.controllers.get(fighter.id);
    const action =
      controller?.decide?.(this.createCompressedObservation(fighter)) ??
      controller?.getAction?.(observation) ??
      controller?.update?.(observation);

    return action ?? createFallbackAction(observation);
  }

  private sanitizeAction(fighter: BattleFighterState, action: BotAction): BotAction {
    const nearestOpponent = nearestSnapshot(fighter.pos, this.createOpponentSnapshots(fighter));
    const targetX = finiteOr(action.targetX, fighter.pos.x);
    const targetY = finiteOr(action.targetY, fighter.pos.y);

    return {
      targetX: clamp(targetX, fighter.width / 2, this.state.arena.width - fighter.width / 2),
      targetY: clamp(targetY, fighter.height / 2, this.state.arena.height - fighter.height / 2),
      aimX: finiteOr(action.aimX, nearestOpponent?.pos.x ?? targetX),
      aimY: finiteOr(action.aimY, nearestOpponent?.pos.y ?? targetY),
      fireMode: action.fireMode ?? 'auto',
      dodgeWeight: clamp(action.dodgeWeight ?? 0, 0, 1),
      collectWeight: clamp(action.collectWeight ?? 0, 0, 1),
    };
  }

  private moveFighter(fighter: BattleFighterState, action: BotAction, dt: number) {
    const dx = action.targetX - fighter.pos.x;
    const dy = action.targetY - fighter.pos.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= 0.001) {
      fighter.vel = { x: 0, y: 0 };
      return;
    }

    const speed = fighter.rageTimer > 0 ? fighter.speed * 1.15 : fighter.speed;
    const move = Math.min(speed * dt, distance);
    const nx = dx / distance;
    const ny = dy / distance;

    fighter.pos.x = clamp(fighter.pos.x + nx * move, fighter.width / 2, this.state.arena.width - fighter.width / 2);
    fighter.pos.y = clamp(fighter.pos.y + ny * move, fighter.height / 2, this.state.arena.height - fighter.height / 2);
    fighter.vel = { x: nx * speed, y: ny * speed };
  }

  private fireProjectile(fighter: BattleFighterState, action: BotAction) {
    if (fighter.fireTimer > 0) return;

    const aimX = action.aimX ?? fighter.pos.x;
    const aimY = action.aimY ?? fighter.pos.y - 100;
    const dx = aimX - fighter.pos.x;
    const dy = aimY - fighter.pos.y;
    const distance = Math.hypot(dx, dy) || 1;
    const speed = this.config.projectileSpeed;
    const damage = fighter.rageTimer > 0 ? fighter.damage + 1 : fighter.damage;

    this.state.projectiles.push({
      id: this.nextId('projectile'),
      ownerId: fighter.id,
      pos: { x: fighter.pos.x, y: fighter.pos.y - fighter.height * 0.4 },
      vel: { x: (dx / distance) * speed, y: (dy / distance) * speed },
      width: 6,
      height: 14,
      damage,
      active: true,
    });

    this.state.stats[fighter.id].shotsFired += 1;
    fighter.fireTimer = action.fireMode === 'burst' ? fighter.fireCooldown * 0.6 : fighter.fireCooldown;
    if (fighter.rageTimer > 0) {
      fighter.fireTimer *= 0.6;
    }
  }

  private updateProjectiles(dt: number) {
    for (const projectile of this.state.projectiles) {
      if (!projectile.active) continue;

      projectile.pos.x += projectile.vel.x * dt;
      projectile.pos.y += projectile.vel.y * dt;

      if (
        projectile.pos.x < -30 ||
        projectile.pos.x > this.state.arena.width + 30 ||
        projectile.pos.y < -30 ||
        projectile.pos.y > this.state.arena.height + 30
      ) {
        projectile.active = false;
      }
    }
  }

  private updateCollectibles(dt: number) {
    for (const collectible of this.state.collectibles) {
      if (!collectible.active) continue;

      collectible.pos.x += collectible.vel.x * dt;
      collectible.pos.y += collectible.vel.y * dt;
      if (collectible.pos.y > this.state.arena.height + 30) {
        collectible.active = false;
      }
    }
  }

  private checkProjectileHits() {
    for (const projectile of this.state.projectiles) {
      if (!projectile.active) continue;

      for (const fighter of this.state.fighters) {
        if (!fighter.active || fighter.eliminated || fighter.id === projectile.ownerId) continue;
        if (fighter.invincibleTimer > 0) continue;
        if (!rectCollision(projectile, fighter)) continue;

        projectile.active = false;
        this.applyProjectileHit(projectile, fighter);
        break;
      }
    }
  }

  private applyProjectileHit(projectile: BattleProjectile, fighter: BattleFighterState) {
    const ownerStats = this.state.stats[projectile.ownerId];
    const targetStats = this.state.stats[fighter.id];
    ownerStats.shotsHit += 1;

    if (fighter.shield > 0) {
      fighter.shield -= 1;
      fighter.invincibleTimer = 0.25;
      return;
    }

    const damage = Math.min(projectile.damage, fighter.hp);
    fighter.hp -= damage;
    ownerStats.damageDealt += damage;
    ownerStats.score += damage * 10;
    targetStats.damageTaken += damage;

    if (fighter.hp <= 0) {
      this.knockOutFighter(projectile.ownerId, fighter);
    }
  }

  private knockOutFighter(attackerId: string, fighter: BattleFighterState) {
    const attackerStats = this.state.stats[attackerId];
    const targetStats = this.state.stats[fighter.id];

    attackerStats.kills += 1;
    attackerStats.score += 120;
    targetStats.deaths += 1;
    fighter.lives -= 1;
    fighter.active = false;
    fighter.vel = { x: 0, y: 0 };

    if (fighter.lives <= 0) {
      fighter.lives = 0;
      fighter.eliminated = true;
      fighter.respawnTimer = 0;
      return;
    }

    fighter.respawnTimer = 1.5;
  }

  private checkCollectiblePickups() {
    for (const collectible of this.state.collectibles) {
      if (!collectible.active) continue;

      for (const fighter of this.state.fighters) {
        if (!fighter.active || fighter.eliminated) continue;
        if (!rectCollision(collectible, fighter)) continue;

        collectible.active = false;
        this.applyCollectible(fighter, collectible);
        break;
      }
    }
  }

  private applyCollectible(fighter: BattleFighterState, collectible: BattleCollectible) {
    const stats = this.state.stats[fighter.id];
    stats.collectiblesCollected += 1;
    stats.score += 25;

    switch (collectible.kind) {
      case 'repair':
        fighter.hp = Math.min(fighter.maxHp, fighter.hp + collectible.value);
        break;
      case 'shield':
        fighter.shield = Math.min(3, fighter.shield + collectible.value);
        break;
      case 'rage':
        fighter.rageTimer = Math.max(fighter.rageTimer, collectible.value);
        break;
      case 'score':
        stats.score += collectible.value;
        break;
    }
  }

  private spawnCollectibles(dt: number) {
    this.collectibleSpawnTimer -= dt;
    if (this.collectibleSpawnTimer > 0) return;

    this.collectibleSpawnTimer = this.config.collectibleSpawnInterval;
    const kind = this.rng.pick(COLLECTIBLE_KINDS);
    const value = collectibleValue(kind);
    const size = kind === 'score' ? 16 : 20;

    this.state.collectibles.push({
      id: this.nextId('collectible'),
      kind,
      pos: {
        x: this.rng.nextRange(size, this.state.arena.width - size),
        y: -size,
      },
      vel: { x: 0, y: this.config.collectibleFallSpeed },
      width: size,
      height: size,
      value,
      active: true,
    });
  }

  private cleanupEntities() {
    this.state.projectiles = this.state.projectiles.filter((projectile) => projectile.active);
    this.state.collectibles = this.state.collectibles.filter((collectible) => collectible.active);
  }

  private updateSurvivalStats() {
    for (const fighter of this.state.fighters) {
      if (!fighter.eliminated) {
        this.state.stats[fighter.id].survivalTime = this.state.time;
      }
    }
  }

  private checkFinishConditions() {
    const contenders = this.state.fighters.filter((fighter) => !fighter.eliminated);
    if (contenders.length <= 1) {
      this.finish('elimination');
      return;
    }

    if (this.state.tick >= this.config.maxTicks) {
      this.finish('timeLimit');
    }
  }

  private createObservation(fighter: BattleFighterState): BattleBotObservation {
    return {
      fighterId: fighter.id,
      tick: this.state.tick,
      time: this.state.time,
      arena: { ...this.state.arena },
      self: createFighterSnapshot(fighter),
      opponents: this.createOpponentSnapshots(fighter),
      projectiles: this.state.projectiles
        .filter((projectile) => projectile.ownerId !== fighter.id)
        .map(createProjectileSnapshot),
      collectibles: this.state.collectibles.map((collectible) => ({
        id: collectible.id,
        kind: collectible.kind,
        pos: { ...collectible.pos },
        value: collectible.value,
      })),
    };
  }

  private createCompressedObservation(fighter: BattleFighterState): CompressedObservation {
    return {
      arena: {
        width: this.state.arena.width,
        height: this.state.arena.height,
        tick: this.state.tick,
        timeMs: Math.round(this.state.time * 1000),
        safeMargin: fighter.width,
        phase: this.state.phase,
      },
      self: createCompressedFighter(fighter, this.state.stats[fighter.id]),
      fighters: this.state.fighters.map((candidate) =>
        createCompressedFighter(candidate, this.state.stats[candidate.id])
      ),
      threats: this.state.projectiles
        .filter((projectile) => projectile.ownerId !== fighter.id)
        .map((projectile) => ({
          id: projectile.id,
          x: projectile.pos.x,
          y: projectile.pos.y,
          vx: projectile.vel.x,
          vy: projectile.vel.y,
          kind: 'projectile',
          severity: projectile.damage,
          radius: Math.max(projectile.width, projectile.height),
          ownerId: projectile.ownerId,
        })),
      pickups: this.state.collectibles.map((collectible) => ({
        id: collectible.id,
        x: collectible.pos.x,
        y: collectible.pos.y,
        kind: toBotCollectibleKind(collectible.kind),
        value: collectible.value,
        priority: collectiblePriority(collectible.kind),
      })),
      tick: this.state.tick,
      phase: this.state.phase,
    };
  }

  private createOpponentSnapshots(fighter: BattleFighterState): BattleFighterSnapshot[] {
    return this.state.fighters
      .filter((opponent) => opponent.id !== fighter.id)
      .map(createFighterSnapshot);
  }

  private respawnPosition(fighter: BattleFighterState) {
    const activeCount = this.state.fighters.filter((candidate) => !candidate.eliminated).length || 1;
    const index = this.state.fighters.findIndex((candidate) => candidate.id === fighter.id);
    const spacing = this.state.arena.width / (activeCount + 1);
    return {
      x: clamp(spacing * ((index % activeCount) + 1), fighter.width / 2, this.state.arena.width - fighter.width / 2),
      y: this.state.arena.height * 0.82,
    };
  }

  private notify() {
    if (this.listeners.size === 0) return;

    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private nextId(prefix: string): string {
    const id = `${prefix}-${this.nextEntityId}`;
    this.nextEntityId += 1;
    return id;
  }
}

const DEFAULT_FIGHTER_COLORS = ['#00F0FF', '#FF4D8D', '#FFCC00', '#7CFF6B', '#B28DFF'];
const COLLECTIBLE_KINDS: readonly BattleCollectibleKind[] = ['repair', 'shield', 'rage', 'score'];

function createInitialStats(fighter: BattleFighterState) {
  return {
    fighterId: fighter.id,
    name: fighter.name,
    botName: fighter.botName,
    score: 0,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    collectiblesCollected: 0,
    survivalTime: 0,
  };
}

function createFighterSnapshot(fighter: BattleFighterState): BattleFighterSnapshot {
  return {
    id: fighter.id,
    name: fighter.name,
    botName: fighter.botName,
    pos: { ...fighter.pos },
    vel: { ...fighter.vel },
    hp: fighter.hp,
    maxHp: fighter.maxHp,
    lives: fighter.lives,
    shield: fighter.shield,
    rageTimer: fighter.rageTimer,
    active: fighter.active,
    eliminated: fighter.eliminated,
  };
}

function createProjectileSnapshot(projectile: BattleProjectile): BattleProjectileSnapshot {
  return {
    id: projectile.id,
    ownerId: projectile.ownerId,
    pos: { ...projectile.pos },
    vel: { ...projectile.vel },
    damage: projectile.damage,
  };
}

function createCompressedFighter(
  fighter: BattleFighterState,
  stats: BattleState['stats'][string]
) {
  return {
    id: fighter.id,
    x: fighter.pos.x,
    y: fighter.pos.y,
    vx: fighter.vel.x,
    vy: fighter.vel.y,
    hp: fighter.hp,
    maxHp: fighter.maxHp,
    alive: fighter.active && !fighter.eliminated,
    score: stats.score,
    kills: stats.kills,
  };
}

function createFallbackAction(observation: BattleBotObservation): BotAction {
  const self = observation.self;
  const nearestOpponent = nearestSnapshot(
    self.pos,
    observation.opponents.filter((opponent) => opponent.active && !opponent.eliminated)
  );
  const nearestCollectible = nearestSnapshot(self.pos, observation.collectibles);
  const incoming = nearestSnapshot(
    self.pos,
    observation.projectiles.filter((projectile) => projectile.pos.y < self.pos.y + 80)
  );

  let targetX = nearestOpponent?.pos.x ?? self.pos.x;
  let targetY = observation.arena.height * 0.72;

  if (nearestCollectible && distance(self.pos, nearestCollectible.pos) < 170) {
    targetX = nearestCollectible.pos.x;
    targetY = nearestCollectible.pos.y;
  }

  if (incoming && distance(self.pos, incoming.pos) < 120) {
    const direction = incoming.pos.x <= self.pos.x ? 1 : -1;
    targetX = self.pos.x + direction * 95;
    targetY = self.pos.y + 35;
  }

  return {
    targetX,
    targetY,
    aimX: nearestOpponent?.pos.x,
    aimY: nearestOpponent?.pos.y,
    fireMode: nearestOpponent ? 'auto' : 'hold',
    dodgeWeight: incoming ? 1 : 0,
    collectWeight: nearestCollectible ? 0.5 : 0,
  };
}

function nearestSnapshot<T extends { pos: { x: number; y: number } }>(
  origin: { x: number; y: number },
  items: readonly T[]
): T | undefined {
  let nearest: T | undefined;
  let nearestDistance = Infinity;

  for (const item of items) {
    const itemDistance = distance(origin, item.pos);
    if (itemDistance < nearestDistance) {
      nearest = item;
      nearestDistance = itemDistance;
    }
  }

  return nearest;
}

function collectibleValue(kind: BattleCollectibleKind): number {
  switch (kind) {
    case 'repair':
      return 4;
    case 'shield':
      return 1;
    case 'rage':
      return 5;
    case 'score':
      return 40;
  }
}

function toBotCollectibleKind(kind: BattleCollectibleKind): CollectibleKind {
  switch (kind) {
    case 'repair':
      return 'life';
    case 'shield':
      return 'shield';
    case 'rage':
      return 'rage';
    case 'score':
      return 'coin';
  }
}

function collectiblePriority(kind: BattleCollectibleKind): number {
  switch (kind) {
    case 'repair':
      return 1.8;
    case 'shield':
      return 1.6;
    case 'rage':
      return 1.5;
    case 'score':
      return 1;
  }
}

function rectCollision(
  a: { pos: { x: number; y: number }; width: number; height: number },
  b: { pos: { x: number; y: number }; width: number; height: number }
): boolean {
  return (
    Math.abs(a.pos.x - b.pos.x) < ((a.width + b.width) / 2) * 0.72 &&
    Math.abs(a.pos.y - b.pos.y) < ((a.height + b.height) / 2) * 0.72
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneBattleReport(report: BattleReport): BattleReport {
  return {
    ...report,
    rankings: report.rankings.map((entry) => ({ ...entry })),
    finalState: cloneBattleState(report.finalState),
  };
}
