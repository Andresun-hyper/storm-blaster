import type { Player, Enemy, Bullet, Collectible, Particle, FloatingText, Vec2 } from './types';

let nextId = 1;

export function createId(): number {
  return nextId++;
}

export function createPlayer(canvasW: number, canvasH: number): Player {
  const size = canvasW * 0.12;
  return {
    id: createId(),
    type: 'player',
    pos: { x: canvasW / 2, y: canvasH * 0.75 },
    vel: { x: 0, y: 0 },
    width: size,
    height: size,
    hp: 3,
    maxHp: 3,
    active: true,
    damage: 1,
    level: 1,
    exp: 0,
    expToLevel: 20,
    invincible: false,
    invincibleTimer: 0,
    shootCooldown: 0.15,
    shootTimer: 0,
    lives: 3,
    maxLives: 5,
    speed: 400,
    weaponLevel: 1,
    shield: 0,
    magnetTimer: 0,
    rageTimer: 0,
    missileCount: 0,
    missileTimer: 0,
    baseDamage: 1,
  };
}

export function createEnemy(
  type: 'drone' | 'scout' | 'heavy' | 'suicide' | 'boss',
  canvasW: number,
  _canvasH: number,
  speedMultiplier: number
): Enemy {
  const configs: Record<string, Partial<Enemy>> = {
    drone: {
      width: canvasW * 0.1,
      height: canvasW * 0.1,
      hp: 2,
      maxHp: 2,
      damage: 1,
      scoreValue: 10,
      shootCooldown: 0,
      shootTimer: 0,
      movePattern: 'straight',
      vel: { x: 0, y: 80 * speedMultiplier },
      dropChance: 0.3,
    },
    scout: {
      width: canvasW * 0.09,
      height: canvasW * 0.09,
      hp: 3,
      maxHp: 3,
      damage: 1,
      scoreValue: 15,
      shootCooldown: 2.0,
      shootTimer: 1.0,
      movePattern: 'sine',
      vel: { x: 0, y: 100 * speedMultiplier },
      amplitude: canvasW * 0.2,
      frequency: 2,
      phase: Math.random() * Math.PI * 2,
      dropChance: 0.4,
    },
    heavy: {
      width: canvasW * 0.15,
      height: canvasW * 0.15,
      hp: 10,
      maxHp: 10,
      damage: 2,
      scoreValue: 50,
      shootCooldown: 1.5,
      shootTimer: 0.5,
      movePattern: 'straight',
      vel: { x: 0, y: 50 * speedMultiplier },
      dropChance: 0.8,
    },
    suicide: {
      width: canvasW * 0.08,
      height: canvasW * 0.08,
      hp: 1,
      maxHp: 1,
      damage: 2,
      scoreValue: 20,
      shootCooldown: 0,
      shootTimer: 0,
      movePattern: 'charge',
      vel: { x: 0, y: 200 * speedMultiplier },
      dropChance: 0.5,
    },
    boss: {
      width: canvasW * 0.35,
      height: canvasW * 0.35,
      hp: 200,
      maxHp: 200,
      damage: 3,
      scoreValue: 500,
      shootCooldown: 0.5,
      shootTimer: 0.5,
      movePattern: 'boss',
      vel: { x: 60 * speedMultiplier, y: 0 },
      dropChance: 1.0,
    },
  };

  const config = configs[type];
  const startX = type === 'boss' 
    ? canvasW / 2 
    : Math.random() * (canvasW - config.width!) + config.width! / 2;
  const startY = type === 'boss' ? -config.height! : -config.height!;

  return {
    id: createId(),
    type: 'enemy',
    pos: { x: startX, y: startY },
    vel: { ...config.vel! },
    width: config.width!,
    height: config.height!,
    hp: config.hp!,
    maxHp: config.maxHp!,
    active: true,
    damage: config.damage!,
    enemyType: type,
    shootCooldown: config.shootCooldown!,
    shootTimer: config.shootTimer!,
    scoreValue: config.scoreValue!,
    movePattern: config.movePattern as Enemy['movePattern'],
    amplitude: config.amplitude,
    frequency: config.frequency,
    phase: config.phase,
    dropChance: config.dropChance!,
    hitFlashTimer: 0,
  };
}

export function createPlayerBullet(player: Player): Bullet {
  // Multi-shot handled in engine
  return {
    id: createId(),
    type: 'bullet',
    pos: { x: player.pos.x, y: player.pos.y - player.height / 2 },
    vel: { x: 0, y: -800 },
    width: 4,
    height: 12,
    hp: 1,
    maxHp: 1,
    active: true,
    damage: player.weaponLevel,
  };
}

export function createEnemyBullet(enemy: Enemy, targetX: number, targetY: number): Bullet {
  const dx = targetX - enemy.pos.x;
  const dy = targetY - enemy.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = 250;

  return {
    id: createId(),
    type: 'enemyBullet',
    pos: { x: enemy.pos.x, y: enemy.pos.y + enemy.height / 2 },
    vel: { x: (dx / dist) * speed, y: (dy / dist) * speed },
    width: 6,
    height: 6,
    hp: 1,
    maxHp: 1,
    active: true,
    damage: enemy.damage,
  };
}

export function createCollectible(
  pos: Vec2,
  type: 'star' | 'coin' | 'powerup' | 'shield' | 'magnet' | 'rage' | 'bomb' | 'missile',
  canvasW: number
): Collectible {
  const configs: Record<string, { collectibleType: Collectible['collectibleType']; value: number; width: number; height: number }> = {
    star: { collectibleType: 'exp', value: 10, width: canvasW * 0.05, height: canvasW * 0.05 },
    coin: { collectibleType: 'coin', value: 1, width: canvasW * 0.04, height: canvasW * 0.04 },
    powerup: { collectibleType: 'weapon', value: 1, width: canvasW * 0.06, height: canvasW * 0.06 },
    shield: { collectibleType: 'shield', value: 1, width: canvasW * 0.055, height: canvasW * 0.055 },
    magnet: { collectibleType: 'magnet', value: 1, width: canvasW * 0.055, height: canvasW * 0.055 },
    rage: { collectibleType: 'rage', value: 1, width: canvasW * 0.055, height: canvasW * 0.055 },
    bomb: { collectibleType: 'bomb', value: 1, width: canvasW * 0.06, height: canvasW * 0.06 },
    missile: { collectibleType: 'missile', value: 3, width: canvasW * 0.055, height: canvasW * 0.055 },
  };

  const config = configs[type];

  return {
    id: createId(),
    type,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 120 },
    width: config.width,
    height: config.height,
    hp: 1,
    maxHp: 1,
    active: true,
    damage: 0,
    collectibleType: config.collectibleType,
    value: config.value,
  };
}

export function createExplosionParticles(pos: Vec2, count: number, _canvasW: number, colorOverride?: string): Particle[] {
  const particles: Particle[] = [];
  const colors = colorOverride ? [colorOverride] : ['#FFCC00', '#FF6600', '#FF0000', '#FF4444', '#FFAA00'];
  
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 100 + Math.random() * 200;
    particles.push({
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - 50 },
      life: 0.5 + Math.random() * 0.5,
      maxLife: 0.5 + Math.random() * 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 2 + Math.random() * 4,
    });
  }
  
  return particles;
}

export function createHitParticles(pos: Vec2, count: number = 3): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 100;
    particles.push({
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.2 + Math.random() * 0.2,
      maxLife: 0.4,
      color: '#FFFFFF',
      size: 1 + Math.random() * 2,
    });
  }
  return particles;
}

export function createMissile(player: Player, targetX: number, targetY: number): Bullet {
  const dx = targetX - player.pos.x;
  const dy = targetY - player.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = 400;
  return {
    id: createId(),
    type: 'bullet',
    pos: { x: player.pos.x, y: player.pos.y - player.height / 2 },
    vel: { x: (dx / dist) * speed, y: (dy / dist) * speed },
    width: 6,
    height: 14,
    hp: 1,
    maxHp: 1,
    active: true,
    damage: player.baseDamage * 3,
  };
}

export function createFloatingText(pos: Vec2, text: string, color: string = '#FFFFFF'): FloatingText {
  return {
    pos: { x: pos.x, y: pos.y },
    text,
    color,
    life: 1.0,
    maxLife: 1.0,
    fontSize: 18,
  };
}

export function resetIdCounter() {
  nextId = 1;
}
