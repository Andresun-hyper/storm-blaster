// ===== Game Types & Interfaces =====

export type GameMode = 'level' | 'endless';
export type GameScreen = 'menu' | 'levelSelect' | 'playing' | 'paused' | 'gameOver' | 'levelComplete' | 'endlessGameOver';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Entity {
  id: number;
  type: 'player' | 'enemy' | 'bullet' | 'enemyBullet' | 'star' | 'coin' | 'powerup' | 'shield' | 'magnet' | 'rage' | 'bomb' | 'missile';
  pos: Vec2;
  vel: Vec2;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  active: boolean;
  damage: number;
}

export interface Player extends Entity {
  type: 'player';
  level: number;
  exp: number;
  expToLevel: number;
  invincible: boolean;
  invincibleTimer: number;
  shootCooldown: number;
  shootTimer: number;
  lives: number;
  maxLives: number;
  speed: number;
  weaponLevel: number;
  shield: number;
  magnetTimer: number;
  rageTimer: number;
  missileCount: number;
  missileTimer: number;
  baseDamage: number;
}

export interface Enemy extends Entity {
  type: 'enemy';
  enemyType: 'drone' | 'scout' | 'heavy' | 'suicide' | 'boss';
  shootCooldown: number;
  shootTimer: number;
  scoreValue: number;
  movePattern: 'straight' | 'sine' | 'zigzag' | 'charge' | 'boss';
  amplitude?: number;
  frequency?: number;
  phase?: number;
  dropChance: number;
  hitFlashTimer: number;
}

export interface Bullet extends Entity {
  type: 'bullet' | 'enemyBullet';
}

export type CollectibleType = 'exp' | 'coin' | 'weapon' | 'life' | 'shield' | 'magnet' | 'rage' | 'bomb' | 'missile';

export interface Collectible extends Entity {
  type: 'star' | 'coin' | 'powerup' | 'shield' | 'magnet' | 'rage' | 'bomb' | 'missile';
  collectibleType: CollectibleType;
  value: number;
}

export interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface FloatingText {
  pos: Vec2;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  fontSize: number;
}

export interface ScreenShake {
  intensity: number;
  duration: number;
  timer: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  description: string;
  targetProgress: number;
  spawnRate: number;
  enemySpeedMultiplier: number;
  maxEnemies: number;
  enemyTypes: string[];
  bossLevel: boolean;
  starRequirements: [number, number, number];
}

export interface GameState {
  screen: GameScreen;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  collectibles: Collectible[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  score: number;
  combo: number;
  comboTimer: number;
  level: number;
  levelProgress: number;
  screenShake: ScreenShake;
  bgOffset: number;
  isPaused: boolean;
  totalKills: number;
  gameTime: number;
  gameMode: GameMode;
  endlessWave: number;
  endlessNextWaveTime: number;
  damageFlashTimer: number;
}

export interface GameImages {
  player: HTMLImageElement;
  enemyDrone: HTMLImageElement;
  enemyScout: HTMLImageElement;
  enemyHeavy: HTMLImageElement;
  enemySuicide: HTMLImageElement;
  bossMothership: HTMLImageElement;
}

export interface InputState {
  touchX: number;
  touchY: number;
  isTouching: boolean;
  touchStartX: number;
  touchStartY: number;
}
