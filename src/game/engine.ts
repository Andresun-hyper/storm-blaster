import type { GameState, GameImages, InputState, Enemy, Collectible, LevelConfig, GameMode } from './types';
import { createPlayer, createEnemy, createPlayerBullet, createEnemyBullet, createCollectible, createExplosionParticles, createFloatingText, createHitParticles, createMissile, resetIdCounter } from './entities';
import { getLevelConfig } from './levels';
import { audioManager } from './audio';

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private state: GameState;
  private input: InputState;
  private animFrameId: number = 0;
  private lastTime: number = 0;
  private spawnTimer: number = 0;
  private levelConfig: LevelConfig;
  private onStateChange: (state: GameState) => void;
  private gameMode: GameMode = 'level';

  constructor(
    canvas: HTMLCanvasElement,
    _images: GameImages,
    onStateChange: (state: GameState) => void
  ) {
    this.canvas = canvas;
    this.onStateChange = onStateChange;
    this.input = { touchX: canvas.width / 2, touchY: canvas.height * 0.75, isTouching: false, touchStartX: 0, touchStartY: 0 };
    this.levelConfig = getLevelConfig(1);
    this.state = this.createInitialState();
  }

  private createInitialState(): GameState {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      screen: 'playing',
      player: createPlayer(w, h),
      enemies: [],
      bullets: [],
      collectibles: [],
      particles: [],
      floatingTexts: [],
      score: 0,
      combo: 0,
      comboTimer: 0,
      level: 1,
      levelProgress: 0,
      screenShake: { intensity: 0, duration: 0, timer: 0 },
      bgOffset: 0,
      isPaused: false,
      totalKills: 0,
      gameTime: 0,
      gameMode: this.gameMode,
      endlessWave: 1,
      endlessNextWaveTime: 30,
      damageFlashTimer: 0,
    };
  }

  startLevel(level: number) {
    this.gameMode = 'level';
    resetIdCounter();
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.levelConfig = getLevelConfig(level);
    this.state = {
      screen: 'playing',
      player: createPlayer(w, h),
      enemies: [],
      bullets: [],
      collectibles: [],
      particles: [],
      floatingTexts: [],
      score: 0,
      combo: 0,
      comboTimer: 0,
      level,
      levelProgress: 0,
      screenShake: { intensity: 0, duration: 0, timer: 0 },
      bgOffset: 0,
      isPaused: false,
      totalKills: 0,
      gameTime: 0,
      gameMode: 'level',
      endlessWave: 1,
      endlessNextWaveTime: 30,
      damageFlashTimer: 0,
    };
    this.spawnTimer = 0;
    this.lastTime = performance.now();
    audioManager.playBGM();
    this.gameLoop(this.lastTime);
  }

  startEndless() {
    this.gameMode = 'endless';
    resetIdCounter();
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.levelConfig = {
      id: 0,
      name: 'Endless',
      description: 'Survive as long as you can',
      targetProgress: 99999,
      spawnRate: 2.0,
      enemySpeedMultiplier: 1.0,
      maxEnemies: 4,
      enemyTypes: ['drone'],
      bossLevel: false,
      starRequirements: [1, 2, 3],
    };
    this.state = {
      screen: 'playing',
      player: createPlayer(w, h),
      enemies: [],
      bullets: [],
      collectibles: [],
      particles: [],
      floatingTexts: [],
      score: 0,
      combo: 0,
      comboTimer: 0,
      level: 1,
      levelProgress: 0,
      screenShake: { intensity: 0, duration: 0, timer: 0 },
      bgOffset: 0,
      isPaused: false,
      totalKills: 0,
      gameTime: 0,
      gameMode: 'endless',
      endlessWave: 1,
      endlessNextWaveTime: 30,
      damageFlashTimer: 0,
    };
    this.spawnTimer = 0;
    this.lastTime = performance.now();
    audioManager.playBGM();
    this.gameLoop(this.lastTime);
  }

  private gameLoop = (timestamp: number) => {
    if (this.state.screen !== 'playing') return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    if (!this.state.isPaused) {
      this.update(dt);
    }

    this.onStateChange(this.state);
    this.animFrameId = requestAnimationFrame(this.gameLoop);
  };

  private update(dt: number) {
    this.state.gameTime += dt;
    this.state.bgOffset += dt * 50;

    // Update endless mode difficulty
    if (this.gameMode === 'endless') {
      this.updateEndlessDifficulty(dt);
    }

    // Update player buff timers
    this.updatePlayerBuffs(dt);

    // Update player
    this.updatePlayer(dt);

    // Spawn enemies
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.state.enemies.length < this.levelConfig.maxEnemies) {
      if (this.gameMode === 'endless' || this.state.levelProgress < 100 || this.levelConfig.bossLevel) {
        this.spawnEnemy();
        this.spawnTimer = this.levelConfig.spawnRate;
      }
    }

    // Update enemies
    this.updateEnemies(dt);

    // Update bullets
    this.updateBullets(dt);

    // Update collectibles (with magnet)
    this.updateCollectibles(dt);

    // Update particles
    this.updateParticles(dt);

    // Update floating texts
    this.updateFloatingTexts(dt);

    // Update screen shake
    if (this.state.screenShake.timer > 0) {
      this.state.screenShake.timer -= dt;
    }

    // Update combo timer
    if (this.state.comboTimer > 0) {
      this.state.comboTimer -= dt;
      if (this.state.comboTimer <= 0) {
        this.state.combo = 0;
      }
    }

    // Update damage flash
    if (this.state.damageFlashTimer > 0) {
      this.state.damageFlashTimer -= dt;
    }

    // Auto fire missiles
    this.updateMissiles(dt);

    // Check collisions
    this.checkCollisions();

    // Clean up inactive entities
    this.cleanupEntities();

    // Check win/lose conditions
    this.checkGameConditions();
  }

  private updateEndlessDifficulty(dt: number) {
    this.state.endlessNextWaveTime -= dt;
    if (this.state.endlessNextWaveTime <= 0) {
      this.state.endlessWave++;
      this.state.endlessNextWaveTime = 30;

      // Increase difficulty
      const wave = this.state.endlessWave;
      this.levelConfig.enemySpeedMultiplier = 1.0 + wave * 0.15;
      this.levelConfig.spawnRate = Math.max(0.3, 2.0 - wave * 0.15);
      this.levelConfig.maxEnemies = Math.min(15, 4 + Math.floor(wave / 2));

      // Unlock enemy types as waves progress
      const types: string[] = ['drone'];
      if (wave >= 2) types.push('scout');
      if (wave >= 4) types.push('heavy');
      if (wave >= 6) types.push('suicide');
      if (wave >= 10) types.push('boss');
      this.levelConfig.enemyTypes = types;

      // Boss every 5 waves starting wave 5
      this.levelConfig.bossLevel = wave >= 5 && wave % 5 === 0;

      // Floating text for wave up
      this.state.floatingTexts.push(createFloatingText(
        { x: this.canvas.width / 2, y: this.canvas.height * 0.3 },
        `WAVE ${wave}`,
        '#FF0055'
      ));
      this.state.screenShake = { intensity: 8, duration: 0.3, timer: 0.3 };
    }
  }

  private updatePlayerBuffs(dt: number) {
    const player = this.state.player;
    if (player.magnetTimer > 0) player.magnetTimer -= dt;
    if (player.rageTimer > 0) player.rageTimer -= dt;
    if (player.missileTimer > 0) player.missileTimer -= dt;
  }

  private updateMissiles(dt: number) {
    const player = this.state.player;
    if (player.missileCount <= 0) return;

    player.missileTimer -= dt;
    if (player.missileTimer <= 0) {
      player.missileTimer = 1.5;
      // Find nearest enemy
      let nearest: Enemy | null = null;
      let nearestDist = Infinity;
      for (const enemy of this.state.enemies) {
        if (!enemy.active || enemy.enemyType === 'boss') continue;
        const dx = enemy.pos.x - player.pos.x;
        const dy = enemy.pos.y - player.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = enemy;
        }
      }
      if (nearest) {
        this.state.bullets.push(createMissile(player, nearest.pos.x, nearest.pos.y));
        player.missileCount--;
      } else {
        // Fire straight up if no target
        this.state.bullets.push(createMissile(player, player.pos.x, player.pos.y - 100));
        player.missileCount--;
      }
    }
  }

  private updatePlayer(dt: number) {
    const player = this.state.player;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Movement (follow touch with lerp)
    if (this.input.isTouching) {
      const targetX = this.input.touchX;
      const targetY = this.input.touchY;
      const lerpFactor = 1 - Math.exp(-15 * dt);
      player.pos.x += (targetX - player.pos.x) * lerpFactor;
      player.pos.y += (targetY - player.pos.y) * lerpFactor;
    }

    // Clamp to screen
    const halfW = player.width / 2;
    const halfH = player.height / 2;
    player.pos.x = Math.max(halfW, Math.min(w - halfW, player.pos.x));
    player.pos.y = Math.max(halfH, Math.min(h - halfH, player.pos.y));

    // Invincibility timer
    if (player.invincible) {
      player.invincibleTimer -= dt;
      if (player.invincibleTimer <= 0) {
        player.invincible = false;
      }
    }

    // Auto shoot (rage doubles fire rate)
    const cooldown = player.rageTimer > 0 ? player.shootCooldown * 0.5 : player.shootCooldown;
    player.shootTimer -= dt;
    if (player.shootTimer <= 0) {
      this.playerShoot();
      player.shootTimer = cooldown;
    }
  }

  private playerShoot() {
    const player = this.state.player;
    const damage = player.rageTimer > 0 ? player.baseDamage + 1 : player.baseDamage;

    const makeBullet = (px: number, vx: number): ReturnType<typeof createPlayerBullet> => {
      const b = createPlayerBullet(player);
      b.pos.x = px;
      b.vel.x = vx;
      b.damage = damage;
      return b;
    };

    if (player.weaponLevel === 1) {
      this.state.bullets.push(makeBullet(player.pos.x, 0));
    } else if (player.weaponLevel === 2) {
      this.state.bullets.push(
        makeBullet(player.pos.x - player.width * 0.2, 0),
        makeBullet(player.pos.x + player.width * 0.2, 0)
      );
    } else {
      this.state.bullets.push(
        makeBullet(player.pos.x, 0),
        makeBullet(player.pos.x - player.width * 0.25, -80),
        makeBullet(player.pos.x + player.width * 0.25, 80)
      );
    }

    audioManager.playSFX('shoot');
  }

  private spawnEnemy() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const types = this.levelConfig.enemyTypes;

    // Check if boss should spawn
    if (this.levelConfig.bossLevel && this.state.levelProgress >= 80) {
      const hasBoss = this.state.enemies.some(e => e.enemyType === 'boss');
      if (!hasBoss) {
        const boss = createEnemy('boss', w, h, this.levelConfig.enemySpeedMultiplier);
        boss.pos.y = -boss.height;
        this.state.enemies.push(boss);
        return;
      }
    }

    // Don't spawn more if boss is present
    if (this.state.enemies.some(e => e.enemyType === 'boss')) {
      return;
    }

    const type = types[Math.floor(Math.random() * types.length)] as Enemy['enemyType'];
    const enemy = createEnemy(type, w, h, this.levelConfig.enemySpeedMultiplier);
    
    // For suicide enemies, aim at player
    if (type === 'suicide') {
      const dx = this.state.player.pos.x - enemy.pos.x;
      const dy = this.state.player.pos.y - enemy.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      enemy.vel.x = (dx / dist) * 50;
    }

    this.state.enemies.push(enemy);
  }

  private updateEnemies(dt: number) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const player = this.state.player;

    for (const enemy of this.state.enemies) {
      if (!enemy.active) continue;

      // Hit flash timer
      if (enemy.hitFlashTimer > 0) {
        enemy.hitFlashTimer -= dt;
      }

      // Movement patterns
      switch (enemy.movePattern) {
        case 'straight':
          enemy.pos.y += enemy.vel.y * dt;
          break;
        case 'sine':
          enemy.pos.y += enemy.vel.y * dt;
          if (enemy.phase !== undefined && enemy.frequency !== undefined && enemy.amplitude !== undefined) {
            enemy.pos.x += Math.cos(enemy.phase + enemy.pos.y * enemy.frequency * 0.01) * enemy.amplitude * 0.02;
          }
          break;
        case 'zigzag':
          enemy.pos.y += enemy.vel.y * dt;
          enemy.pos.x += Math.sin(Date.now() * 0.003 + enemy.id) * 100 * dt;
          break;
        case 'charge':
          enemy.pos.x += enemy.vel.x * dt;
          enemy.pos.y += enemy.vel.y * dt;
          break;
        case 'boss':
          enemy.pos.x += enemy.vel.x * dt;
          if (enemy.pos.x <= enemy.width / 2 || enemy.pos.x >= w - enemy.width / 2) {
            enemy.vel.x *= -1;
          }
          enemy.pos.y += enemy.vel.y * dt;
          if (enemy.pos.y < enemy.height * 0.3) {
            enemy.pos.y += 30 * dt;
          }
          break;
      }

      // Shooting
      if (enemy.shootCooldown > 0) {
        enemy.shootTimer -= dt;
        if (enemy.shootTimer <= 0) {
          this.state.bullets.push(createEnemyBullet(enemy, player.pos.x, player.pos.y));
          enemy.shootTimer = enemy.shootCooldown;
        }
      }

      // Check off-screen
      if (enemy.pos.y > h + enemy.height) {
        enemy.active = false;
      }
      if (enemy.pos.x < -enemy.width || enemy.pos.x > w + enemy.width) {
        enemy.active = false;
      }
    }
  }

  private updateBullets(dt: number) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const bullet of this.state.bullets) {
      if (!bullet.active) continue;

      bullet.pos.x += bullet.vel.x * dt;
      bullet.pos.y += bullet.vel.y * dt;

      if (bullet.pos.y < -20 || bullet.pos.y > h + 20 || bullet.pos.x < -20 || bullet.pos.x > w + 20) {
        bullet.active = false;
      }
    }
  }

  private updateCollectibles(dt: number) {
    const h = this.canvas.height;
    const player = this.state.player;

    for (const col of this.state.collectibles) {
      if (!col.active) continue;

      col.pos.y += col.vel.y * dt;

      // Magnet effect
      if (player.magnetTimer > 0) {
        const dx = player.pos.x - col.pos.x;
        const dy = player.pos.y - col.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 250 && dist > 5) {
          const speed = 400 * (1 - dist / 250);
          col.pos.x += (dx / dist) * speed * dt;
          col.pos.y += (dy / dist) * speed * dt;
        }
      }

      if (col.pos.y > h + 30) {
        col.active = false;
      }
    }
  }

  private updateParticles(dt: number) {
    for (const p of this.state.particles) {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.y += 100 * dt; // gravity
      p.life -= dt;
    }
  }

  private updateFloatingTexts(dt: number) {
    for (const ft of this.state.floatingTexts) {
      ft.pos.y -= 40 * dt;
      ft.life -= dt;
    }
  }

  private checkCollisions() {
    const player = this.state.player;

    // Player bullets vs enemies
    for (const bullet of this.state.bullets) {
      if (!bullet.active || bullet.type !== 'bullet') continue;

      for (const enemy of this.state.enemies) {
        if (!enemy.active) continue;

        if (this.rectCollision(bullet, enemy)) {
          bullet.active = false;
          enemy.hp -= bullet.damage;
          enemy.hitFlashTimer = 0.08;

          // Hit particles and floating damage text
          this.state.particles.push(...createHitParticles(bullet.pos, 3));
          if (bullet.damage > 1) {
            this.state.floatingTexts.push(createFloatingText(
              { x: bullet.pos.x, y: bullet.pos.y - 10 },
              String(bullet.damage),
              '#FFAAAA'
            ));
          }

          if (enemy.hp <= 0) {
            this.killEnemy(enemy);
          }
          break;
        }
      }
    }

    // Enemy bullets vs player
    if (!player.invincible) {
      for (const bullet of this.state.bullets) {
        if (!bullet.active || bullet.type !== 'enemyBullet') continue;

        if (this.rectCollision(bullet, player)) {
          bullet.active = false;
          this.damagePlayer(bullet.damage);
          break;
        }
      }
    }

    // Enemies vs player
    if (!player.invincible) {
      for (const enemy of this.state.enemies) {
        if (!enemy.active) continue;

        if (this.rectCollision(enemy, player)) {
          this.damagePlayer(enemy.damage);
          if (enemy.enemyType !== 'boss') {
            enemy.active = false;
            this.state.particles.push(...createExplosionParticles(enemy.pos, 8, this.canvas.width));
          }
          break;
        }
      }
    }

    // Player vs collectibles
    for (const col of this.state.collectibles) {
      if (!col.active) continue;

      if (this.rectCollision(col, player)) {
        col.active = false;
        this.collectItem(col);
      }
    }
  }

  private rectCollision(a: { pos: { x: number; y: number }; width: number; height: number }, 
                       b: { pos: { x: number; y: number }; width: number; height: number }): boolean {
    return Math.abs(a.pos.x - b.pos.x) < (a.width + b.width) / 2 * 0.7 &&
           Math.abs(a.pos.y - b.pos.y) < (a.height + b.height) / 2 * 0.7;
  }

  private killEnemy(enemy: Enemy) {
    enemy.active = false;

    // Score with combo
    this.state.combo++;
    this.state.comboTimer = 3.0;
    let multiplier = 1.0;
    if (this.state.combo >= 20) multiplier = 5.0;
    else if (this.state.combo >= 10) multiplier = 3.0;
    else if (this.state.combo >= 5) multiplier = 2.0;
    else if (this.state.combo >= 3) multiplier = 1.5;
    else if (this.state.combo >= 2) multiplier = 1.2;

    const points = Math.floor(enemy.scoreValue * multiplier);
    this.state.score += points;
    this.state.totalKills++;

    // Level progress (only in level mode)
    if (this.gameMode === 'level') {
      const progressPerKill = 100 / this.levelConfig.targetProgress;
      this.state.levelProgress = Math.min(100, this.state.levelProgress + progressPerKill);
    }

    // Floating text
    const color = multiplier > 1.0 ? '#FFCC00' : '#FFFFFF';
    this.state.floatingTexts.push(createFloatingText(enemy.pos, `+${points}`, color));
    if (this.state.combo >= 5) {
      this.state.floatingTexts.push(createFloatingText(
        { x: enemy.pos.x, y: enemy.pos.y - 25 },
        `${this.state.combo} COMBO!`,
        '#FF6600'
      ));
    }

    // Explosion
    const particleCount = enemy.enemyType === 'boss' ? 30 : enemy.enemyType === 'heavy' ? 15 : 8;
    this.state.particles.push(...createExplosionParticles(enemy.pos, particleCount, this.canvas.width));

    // Screen shake
    const shakeIntensity = enemy.enemyType === 'boss' ? 15 : enemy.enemyType === 'heavy' ? 8 : 4;
    this.state.screenShake = { intensity: shakeIntensity, duration: 0.2, timer: 0.2 };

    // Drops
    if (Math.random() < enemy.dropChance) {
      const roll = Math.random();
      if (roll < 0.45) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'star', this.canvas.width));
      } else if (roll < 0.65) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'coin', this.canvas.width));
      } else if (roll < 0.78) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'powerup', this.canvas.width));
      } else if (roll < 0.86) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'shield', this.canvas.width));
      } else if (roll < 0.92) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'magnet', this.canvas.width));
      } else if (roll < 0.95) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'rage', this.canvas.width));
      } else if (roll < 0.97) {
        this.state.collectibles.push(createCollectible(enemy.pos, 'bomb', this.canvas.width));
      } else {
        this.state.collectibles.push(createCollectible(enemy.pos, 'missile', this.canvas.width));
      }
    }

    audioManager.playSFX('explosion');
  }

  private damagePlayer(damage: number) {
    const player = this.state.player;

    // Shield absorbs damage
    if (player.shield > 0) {
      player.shield--;
      player.invincible = true;
      player.invincibleTimer = 0.5;
      this.state.damageFlashTimer = 0.15;
      this.state.screenShake = { intensity: 6, duration: 0.15, timer: 0.15 };
      this.state.floatingTexts.push(createFloatingText(player.pos, 'SHIELD!', '#00F0FF'));
      audioManager.playSFX('hit');
      // Blue shield break particles
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 100;
        this.state.particles.push({
          pos: { x: player.pos.x, y: player.pos.y },
          vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          life: 0.4,
          maxLife: 0.4,
          color: '#00F0FF',
          size: 3 + Math.random() * 3,
        });
      }
      return;
    }

    player.lives -= damage;
    player.invincible = true;
    player.invincibleTimer = 1.5;
    this.state.damageFlashTimer = 0.4;

    this.state.screenShake = { intensity: 12, duration: 0.3, timer: 0.3 };
    this.state.combo = 0;
    this.state.comboTimer = 0;

    audioManager.playSFX('hit');

    // Red flash particles
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 150;
      this.state.particles.push({
        pos: { x: player.pos.x, y: player.pos.y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color: '#FF0000',
        size: 3 + Math.random() * 4,
      });
    }

    // Floating damage text
    this.state.floatingTexts.push(createFloatingText(
      { x: player.pos.x, y: player.pos.y - 30 },
      `-${damage}`,
      '#FF0000'
    ));
  }

  private collectItem(col: Collectible) {
    const player = this.state.player;

    switch (col.collectibleType) {
      case 'exp':
        player.exp += col.value;
        this.state.floatingTexts.push(createFloatingText(col.pos, `+${col.value} XP`, '#00F0FF'));
        
        // Check level up
        if (player.exp >= player.expToLevel) {
          player.exp -= player.expToLevel;
          player.level++;
          player.expToLevel = Math.floor(player.expToLevel * 1.5);
          player.shootCooldown = Math.max(0.05, player.shootCooldown * 0.9);
          player.baseDamage = Math.floor(1 + player.level * 0.3);
          
          if (player.level % 3 === 0 && player.weaponLevel < 3) {
            player.weaponLevel++;
          }

          // Level up effect
          this.state.particles.push(...createExplosionParticles(player.pos, 20, this.canvas.width));
          this.state.floatingTexts.push(createFloatingText(
            { x: player.pos.x, y: player.pos.y - 30 },
            'LEVEL UP!',
            '#00FF66'
          ));
          audioManager.playSFX('levelup');
        } else {
          audioManager.playSFX('powerup');
        }
        break;
      
      case 'coin':
        this.state.score += 5;
        this.state.floatingTexts.push(createFloatingText(col.pos, '+5', '#FFCC00'));
        audioManager.playSFX('powerup');
        break;
      
      case 'weapon':
        if (player.weaponLevel < 3) {
          player.weaponLevel++;
        } else {
          player.shootCooldown = Math.max(0.05, player.shootCooldown * 0.85);
          player.baseDamage++;
        }
        this.state.floatingTexts.push(createFloatingText(col.pos, 'WEAPON UP!', '#00F0FF'));
        audioManager.playSFX('levelup');
        break;

      case 'life':
        if (player.lives < player.maxLives) {
          player.lives++;
          this.state.floatingTexts.push(createFloatingText(col.pos, 'LIFE +1', '#00FF66'));
        } else {
          this.state.score += 50;
          this.state.floatingTexts.push(createFloatingText(col.pos, '+50', '#FFCC00'));
        }
        audioManager.playSFX('powerup');
        break;

      case 'shield':
        player.shield = Math.min(player.shield + 1, 3);
        this.state.floatingTexts.push(createFloatingText(col.pos, 'SHIELD!', '#00F0FF'));
        this.state.particles.push(...createExplosionParticles(col.pos, 10, this.canvas.width, '#00F0FF'));
        audioManager.playSFX('levelup');
        break;

      case 'magnet':
        player.magnetTimer = 10;
        this.state.floatingTexts.push(createFloatingText(col.pos, 'MAGNET!', '#FF66FF'));
        audioManager.playSFX('levelup');
        break;

      case 'rage':
        player.rageTimer = 8;
        this.state.floatingTexts.push(createFloatingText(col.pos, 'RAGE!', '#FF0000'));
        this.state.particles.push(...createExplosionParticles(player.pos, 15, this.canvas.width, '#FF0000'));
        audioManager.playSFX('levelup');
        break;

      case 'bomb':
        this.state.floatingTexts.push(createFloatingText(col.pos, 'BOOM!', '#FFAA00'));
        this.state.particles.push(...createExplosionParticles(player.pos, 30, this.canvas.width, '#FFAA00'));
        this.state.screenShake = { intensity: 20, duration: 0.5, timer: 0.5 };
        for (const enemy of this.state.enemies) {
          if (!enemy.active) continue;
          if (enemy.enemyType === 'boss') {
            enemy.hp -= Math.floor(enemy.maxHp * 0.5);
            if (enemy.hp <= 0) this.killEnemy(enemy);
          } else {
            enemy.hp -= 999;
            if (enemy.hp <= 0) this.killEnemy(enemy);
          }
        }
        // Clear enemy bullets
        for (const bullet of this.state.bullets) {
          if (bullet.type === 'enemyBullet') {
            bullet.active = false;
          }
        }
        audioManager.playSFX('explosion');
        break;

      case 'missile':
        player.missileCount += col.value;
        this.state.floatingTexts.push(createFloatingText(col.pos, `MISSILE +${col.value}`, '#FF6600'));
        audioManager.playSFX('levelup');
        break;
    }
  }

  private cleanupEntities() {
    this.state.enemies = this.state.enemies.filter(e => e.active);
    this.state.bullets = this.state.bullets.filter(b => b.active);
    this.state.collectibles = this.state.collectibles.filter(c => c.active);
    this.state.particles = this.state.particles.filter(p => p.life > 0);
    this.state.floatingTexts = this.state.floatingTexts.filter(t => t.life > 0);
  }

  private checkGameConditions() {
    const player = this.state.player;

    // Lose condition
    if (player.lives <= 0) {
      player.active = false;
      this.state.screen = this.gameMode === 'endless' ? 'endlessGameOver' : 'gameOver';
      audioManager.stopBGM();
      this.onStateChange(this.state);
      return;
    }

    // Win condition (only in level mode)
    if (this.gameMode === 'level' && this.state.levelProgress >= 100) {
      // If boss level, need to kill boss
      if (this.levelConfig.bossLevel) {
        const hasBoss = this.state.enemies.some(e => e.enemyType === 'boss' && e.active);
        if (hasBoss) return;
      }
      this.state.screen = 'levelComplete';
      audioManager.stopBGM();
      this.onStateChange(this.state);
    }
  }

  // Input handling
  isPauseButtonClicked(x: number, y: number): boolean {
    const pauseCenterX = this.canvas.width - 30;
    const pauseCenterY = 30;
    const dist = Math.sqrt((x - pauseCenterX) ** 2 + (y - pauseCenterY) ** 2);
    return dist < 25;
  }

  handleTouchStart(x: number, y: number) {
    this.input.touchX = x;
    this.input.touchY = y;
    this.input.touchStartX = x;
    this.input.touchStartY = y;
    this.input.isTouching = true;
  }

  handleTouchMove(x: number, y: number) {
    this.input.touchX = x;
    this.input.touchY = y;
  }

  handleTouchEnd() {
    this.input.isTouching = false;
  }

  pause() {
    this.state.isPaused = true;
    audioManager.pauseBGM();
  }

  resume() {
    this.state.isPaused = false;
    this.lastTime = performance.now();
    audioManager.resumeBGM();
    this.gameLoop(this.lastTime);
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  getState(): GameState {
    return this.state;
  }

  getGameMode(): GameMode {
    return this.gameMode;
  }

  stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    audioManager.stopBGM();
  }
}
