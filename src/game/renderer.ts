import type { GameState, GameImages, Player, Enemy, Bullet, Collectible, Particle, FloatingText } from './types';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private images: GameImages;
  private canvasW: number;
  private canvasH: number;

  constructor(canvas: HTMLCanvasElement, images: GameImages) {
    this.ctx = canvas.getContext('2d')!;
    this.images = images;
    this.canvasW = canvas.width;
    this.canvasH = canvas.height;
  }

  setCanvasSize(w: number, h: number) {
    this.canvasW = w;
    this.canvasH = h;
  }

  render(state: GameState) {
    const ctx = this.ctx;
    ctx.save();

    // Apply screen shake
    if (state.screenShake.timer > 0) {
      const shakeX = (Math.random() - 0.5) * state.screenShake.intensity * 2;
      const shakeY = (Math.random() - 0.5) * state.screenShake.intensity * 2;
      ctx.translate(shakeX, shakeY);
    }

    // Clear and draw background
    this.drawBackground(state.bgOffset);

    // Draw entities
    this.drawCollectibles(state.collectibles);
    this.drawBullets(state.bullets);
    this.drawEnemies(state.enemies);
    this.drawPlayer(state.player);
    this.drawParticles(state.particles);
    this.drawFloatingTexts(state.floatingTexts);

    // Draw HUD
    this.drawHUD(state);

    ctx.restore();

    // Damage flash overlay (drawn outside shake)
    if (state.damageFlashTimer > 0) {
      const alpha = state.damageFlashTimer * 0.5;
      ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, this.canvasW, this.canvasH);
    }
  }

  private drawBackground(bgOffset: number) {
    const ctx = this.ctx;
    const w = this.canvasW;
    const h = this.canvasH;

    // Deep space gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0A0A1A');
    grad.addColorStop(1, '#1A1020');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw stars (parallax)
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 60; i++) {
      const x = (i * 137.5) % w;
      const y = ((i * 73.3 + bgOffset * (0.5 + (i % 3) * 0.3)) % (h + 10)) - 5;
      const size = 1 + (i % 3) * 0.5;
      const alpha = 0.3 + (i % 5) * 0.15;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Distant nebula effect
    ctx.fillStyle = 'rgba(100, 50, 150, 0.03)';
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.4 + bgOffset * 0.1, w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(50, 100, 200, 0.03)';
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.6 + bgOffset * 0.15, w * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayer(player: Player) {
    if (!player.active) return;
    
    const ctx = this.ctx;
    const img = this.images.player;
    const halfW = player.width / 2;
    const halfH = player.height / 2;

    ctx.save();
    
    // Invincibility flashing
    if (player.invincible) {
      ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.02) * 0.3;
    }

    // Rage mode: red tint
    if (player.rageTimer > 0) {
      ctx.globalCompositeOperation = 'source-atop';
    }

    // Draw player jet
    if (img && img.complete) {
      ctx.drawImage(img, player.pos.x - halfW, player.pos.y - halfH, player.width, player.height);
    } else {
      // Fallback
      ctx.fillStyle = '#FF2A2A';
      ctx.fillRect(player.pos.x - halfW, player.pos.y - halfH, player.width, player.height);
    }

    // Rage mode overlay
    if (player.rageTimer > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.2 + Math.sin(Date.now() * 0.015) * 0.1;
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(player.pos.x - halfW, player.pos.y - halfH, player.width, player.height);
      ctx.globalAlpha = 1;
    }

    // Engine glow
    const glowColor = player.rageTimer > 0 ? '#FF4400' : '#00CCFF';
    const glowAlpha = 0.5 + Math.sin(Date.now() * 0.01) * 0.3;
    ctx.fillStyle = `rgba(${player.rageTimer > 0 ? '255, 68, 0' : '0, 200, 255'}, ${glowAlpha})`;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(player.pos.x, player.pos.y + halfH, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Shield visualization
    if (player.shield > 0) {
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.4 + Math.sin(Date.now() * 0.005) * 0.2})`;
      ctx.lineWidth = 2 + player.shield;
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, halfW * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowColor = '#00F0FF';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  private drawEnemies(enemies: Enemy[]) {
    const ctx = this.ctx;

    for (const enemy of enemies) {
      if (!enemy.active) continue;

      const img = this.getEnemyImage(enemy.enemyType);
      const halfW = enemy.width / 2;
      const halfH = enemy.height / 2;

      ctx.save();

      // Hit flash effect
      if (enemy.hitFlashTimer > 0) {
        ctx.filter = 'brightness(3)';
      }

      if (img && img.complete) {
        ctx.drawImage(img, enemy.pos.x - halfW, enemy.pos.y - halfH, enemy.width, enemy.height);
      } else {
        ctx.fillStyle = '#FF0055';
        ctx.fillRect(enemy.pos.x - halfW, enemy.pos.y - halfH, enemy.width, enemy.height);
      }

      ctx.filter = 'none';

      // Boss health bar
      if (enemy.enemyType === 'boss') {
        const barW = enemy.width * 0.8;
        const barH = 6;
        const barX = enemy.pos.x - barW / 2;
        const barY = enemy.pos.y - halfH - 15;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(barX, barY, barW, barH);
        
        const hpRatio = enemy.hp / enemy.maxHp;
        const hpColor = hpRatio > 0.5 ? '#00FF66' : hpRatio > 0.25 ? '#FFCC00' : '#FF0055';
        ctx.fillStyle = hpColor;
        ctx.fillRect(barX, barY, barW * hpRatio, barH);
        
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
      }

      ctx.restore();
    }
  }

  private getEnemyImage(type: string): HTMLImageElement {
    switch (type) {
      case 'drone': return this.images.enemyDrone;
      case 'scout': return this.images.enemyScout;
      case 'heavy': return this.images.enemyHeavy;
      case 'suicide': return this.images.enemySuicide;
      case 'boss': return this.images.bossMothership;
      default: return this.images.enemyDrone;
    }
  }

  private drawBullets(bullets: Bullet[]) {
    const ctx = this.ctx;

    for (const bullet of bullets) {
      if (!bullet.active) continue;

      if (bullet.type === 'bullet') {
        // Check if this is a missile (larger bullet)
        const isMissile = bullet.width > 4;
        const color = isMissile ? '#FF6600' : '#00FF66';
        const shadowColor = isMissile ? '#FF4400' : '#00FF66';

        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = isMissile ? 14 : 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bullet.pos.x, bullet.pos.y, isMissile ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Bullet trail
        ctx.fillStyle = isMissile ? 'rgba(255, 100, 0, 0.4)' : 'rgba(0, 255, 100, 0.3)';
        ctx.fillRect(bullet.pos.x - (isMissile ? 3 : 2), bullet.pos.y, isMissile ? 6 : 4, isMissile ? 20 : 15);

        if (isMissile) {
          // Missile flame
          ctx.fillStyle = `rgba(255, 200, 0, ${0.5 + Math.random() * 0.3})`;
          ctx.beginPath();
          ctx.arc(bullet.pos.x, bullet.pos.y + 12, 3 + Math.random() * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Enemy bullet - red diamond
        ctx.save();
        ctx.shadowColor = '#FF0055';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#FF0055';
        ctx.beginPath();
        ctx.moveTo(bullet.pos.x, bullet.pos.y - 5);
        ctx.lineTo(bullet.pos.x + 5, bullet.pos.y);
        ctx.lineTo(bullet.pos.x, bullet.pos.y + 5);
        ctx.lineTo(bullet.pos.x - 5, bullet.pos.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawCollectibles(collectibles: Collectible[]) {
    const ctx = this.ctx;

    for (const col of collectibles) {
      if (!col.active) continue;

      ctx.save();
      ctx.translate(col.pos.x, col.pos.y);

      // Pulsing effect for all collectibles
      const pulse = 1 + Math.sin(Date.now() * 0.005 + col.id) * 0.1;
      ctx.scale(pulse, pulse);

      if (col.type === 'star') {
        // Draw star
        const r = col.width / 2;
        ctx.fillStyle = '#FFCC00';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowColor = '#FFCC00';
        ctx.shadowBlur = 10;
      } else if (col.type === 'coin') {
        // Draw coin
        const r = col.width / 2;
        ctx.fillStyle = '#FFCC00';
        ctx.shadowColor = '#FFCC00';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#FFAA00';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (col.type === 'powerup') {
        // Draw powerup (W letter)
        const size = col.width / 2;
        ctx.fillStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 12;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('W', 0, 0);
      } else if (col.type === 'shield') {
        const size = col.width / 2;
        ctx.strokeStyle = '#00F0FF';
        ctx.shadowColor = '#00F0FF';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = `bold ${size * 0.7}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#00F0FF';
        ctx.fillText('S', 0, 0);
      } else if (col.type === 'magnet') {
        const size = col.width / 2;
        ctx.fillStyle = '#FF66FF';
        ctx.shadowColor = '#FF66FF';
        ctx.shadowBlur = 12;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', 0, 0);
      } else if (col.type === 'rage') {
        const size = col.width / 2;
        ctx.fillStyle = '#FF0000';
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = 12;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('R', 0, 0);
      } else if (col.type === 'bomb') {
        const size = col.width / 2;
        ctx.fillStyle = '#FFAA00';
        ctx.shadowColor = '#FFAA00';
        ctx.shadowBlur = 12;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('B', 0, 0);
      } else if (col.type === 'missile') {
        const size = col.width / 2;
        ctx.fillStyle = '#FF6600';
        ctx.shadowColor = '#FF6600';
        ctx.shadowBlur = 12;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('R', 0, 0);
      }

      ctx.restore();
    }
  }

  private drawParticles(particles: Particle[]) {
    const ctx = this.ctx;

    for (const p of particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFloatingTexts(texts: FloatingText[]) {
    const ctx = this.ctx;

    for (const ft of texts) {
      const alpha = ft.life / ft.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.fillText(ft.text, ft.pos.x, ft.pos.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawHUD(state: GameState) {
    const ctx = this.ctx;
    const w = this.canvasW;
    const player = state.player;

    // Score
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(`SCORE: ${String(state.score).padStart(6, '0')}`, 15, 35);

    // Lives (hearts)
    for (let i = 0; i < player.maxLives; i++) {
      const hx = 15 + i * 28;
      const hy = 55;
      if (i < player.lives) {
        this.drawHeart(hx, hy, 12, '#FF0055');
      } else {
        this.drawHeart(hx, hy, 12, '#555555');
      }
    }

    // Combo indicator
    if (state.combo > 1) {
      const comboAlpha = Math.min(1, state.comboTimer);
      ctx.globalAlpha = comboAlpha;
      ctx.fillStyle = '#FFCC00';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'right';
      const multiplier = state.combo >= 20 ? 5.0 : state.combo >= 10 ? 3.0 : state.combo >= 5 ? 2.0 : state.combo >= 3 ? 1.5 : 1.2;
      ctx.fillText(`${state.combo}x COMBO (${multiplier.toFixed(1)}x)`, w - 15, 35);
      ctx.globalAlpha = 1;
    }

    // Weapon level & buffs
    ctx.fillStyle = '#00F0FF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    let hudY = w > 350 ? 95 : 90;
    ctx.fillText(`LV.${player.level}  WPN x${player.weaponLevel}  DMG ${player.baseDamage}`, 15, hudY);

    // Buff indicators
    hudY += 18;
    const buffs: { timer: number; text: string; color: string }[] = [
      { timer: player.magnetTimer, text: `MAGNET ${player.magnetTimer.toFixed(1)}s`, color: '#FF66FF' },
      { timer: player.rageTimer, text: `RAGE ${player.rageTimer.toFixed(1)}s`, color: '#FF0000' },
    ];
    for (const buff of buffs) {
      if (buff.timer > 0) {
        ctx.fillStyle = buff.color;
        ctx.font = 'bold 12px Arial';
        ctx.fillText(buff.text, 15, hudY);
        hudY += 16;
      }
    }
    if (player.missileCount > 0) {
      ctx.fillStyle = '#FF6600';
      ctx.font = 'bold 12px Arial';
      ctx.fillText(`MISSILE x${player.missileCount}`, 15, hudY);
      hudY += 16;
    }
    if (player.shield > 0) {
      ctx.fillStyle = '#00F0FF';
      ctx.font = 'bold 12px Arial';
      ctx.fillText(`SHIELD x${player.shield}`, 15, hudY);
      hudY += 16;
    }

    if (state.gameMode === 'level') {
      // Progress bar
      const progressW = w * 0.6;
      const progressH = 8;
      const progressX = (w - progressW) / 2;
      const progressY = w > 350 ? 85 : 80;

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(progressX, progressY, progressW, progressH, 4);
      ctx.fill();

      const progressRatio = Math.min(1, state.levelProgress / 100);
      ctx.fillStyle = '#00F0FF';
      ctx.beginPath();
      ctx.roundRect(progressX, progressY, progressW * progressRatio, progressH, 4);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(progressX, progressY, progressW, progressH, 4);
      ctx.stroke();

      // Level text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`LEVEL ${state.level}`, w / 2, progressY - 5);
    } else {
      // Endless mode: wave and time
      const progressY = w > 350 ? 85 : 80;
      ctx.fillStyle = '#FF0055';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`WAVE ${state.endlessWave}  TIME ${Math.floor(state.gameTime)}s`, w / 2, progressY);

      // Next wave progress bar
      const progressW = w * 0.6;
      const progressH = 6;
      const progressX = (w - progressW) / 2;
      const barY = progressY + 10;
      const waveProgress = 1 - (state.endlessNextWaveTime / 30);

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(progressX, barY, progressW, progressH, 3);
      ctx.fill();

      ctx.fillStyle = '#FF0055';
      ctx.beginPath();
      ctx.roundRect(progressX, barY, progressW * waveProgress, progressH, 3);
      ctx.fill();
    }

    // Pause button area (top right)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(w - 30, 30, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(w - 36, 22, 4, 16);
    ctx.fillRect(w - 28, 22, 4, 16);

    ctx.shadowBlur = 0;
  }

  private drawHeart(x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.3);
    ctx.bezierCurveTo(x, y, x - size, y, x - size, y + size * 0.3);
    ctx.bezierCurveTo(x - size, y + size * 0.7, x, y + size, x, y + size);
    ctx.bezierCurveTo(x, y + size, x + size, y + size * 0.7, x + size, y + size * 0.3);
    ctx.bezierCurveTo(x + size, y, x, y, x, y + size * 0.3);
    ctx.fill();
  }

  // Menu backgrounds
  drawMenuBackground() {
    const ctx = this.ctx;
    const w = this.canvasW;
    const h = this.canvasH;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0A0A1A');
    grad.addColorStop(1, '#1A1020');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Animated stars
    const time = Date.now() * 0.001;
    for (let i = 0; i < 80; i++) {
      const x = (i * 137.5 + time * 20) % w;
      const y = (i * 73.3 + time * 30 * (0.5 + (i % 3) * 0.3)) % h;
      const size = 1 + (i % 3);
      const alpha = 0.3 + Math.sin(time + i) * 0.2;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Red flash effect when player is hit
  drawDamageOverlay() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
    ctx.fillRect(0, 0, this.canvasW, this.canvasH);
  }
}
