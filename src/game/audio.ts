import { Howl } from 'howler';

class AudioManager {
  private sounds: Map<string, Howl> = new Map();
  private bgm: Howl | null = null;
  private enabled: boolean = true;
  private sfxVolume: number = 0.5;
  private bgmVolume: number = 0.3;

  constructor() {
    this.loadSounds();
  }

  private loadSounds() {
    const soundConfigs = [
      { key: 'shoot', src: '/sounds/shoot.mp3', volume: 0.3 },
      { key: 'explosion', src: '/sounds/explosion.mp3', volume: 0.5 },
      { key: 'powerup', src: '/sounds/powerup.mp3', volume: 0.6 },
      { key: 'hit', src: '/sounds/hit.mp3', volume: 0.5 },
      { key: 'levelup', src: '/sounds/levelup.mp3', volume: 0.7 },
    ];

    for (const config of soundConfigs) {
      const sound = new Howl({
        src: [config.src],
        volume: config.volume,
        preload: true,
      });
      this.sounds.set(config.key, sound);
    }
  }

  playBGM() {
    if (!this.enabled) return;
    if (this.bgm) {
      this.bgm.play();
      return;
    }
    this.bgm = new Howl({
      src: ['/sounds/bgm_game.mp3'],
      volume: this.bgmVolume,
      loop: true,
      preload: true,
    });
    this.bgm.play();
  }

  stopBGM() {
    if (this.bgm) {
      this.bgm.stop();
    }
  }

  pauseBGM() {
    if (this.bgm) {
      this.bgm.pause();
    }
  }

  resumeBGM() {
    if (this.bgm && this.enabled) {
      this.bgm.play();
    }
  }

  playSFX(key: string) {
    if (!this.enabled) return;
    const sound = this.sounds.get(key);
    if (sound) {
      // Allow multiple overlapping instances for shoot
      if (key === 'shoot') {
        sound.play();
      } else {
        if (!sound.playing()) {
          sound.play();
        }
      }
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopBGM();
    }
  }

  setSFXVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    for (const [, sound] of this.sounds) {
      sound.volume(this.sfxVolume);
    }
  }

  setBGMVolume(vol: number) {
    this.bgmVolume = Math.max(0, Math.min(1, vol));
    if (this.bgm) {
      this.bgm.volume(this.bgmVolume);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const audioManager = new AudioManager();
