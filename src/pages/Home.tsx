import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { GameState, GameImages, GameScreen } from '../game/types';
import { GameEngine } from '../game/engine';
import { Renderer } from '../game/renderer';
import { LEVELS } from '../game/levels';
import { audioManager } from '../game/audio';
import { LocalBattleEngine, type BattleFighterConfig, type BattleReport, type BattleState } from '../game/battle';
import {
  createBotController,
  listBotMetadata,
  type BotKind,
  parseImportUrl,
  type BotPolicy,
  normalizeBotPolicy,
  parseModulesFromUrl,
  createStrategyImportSummary,
  createStrategyImportUrl,
  createSystemStrategyImport,
  generateBriefingUrl,
  generateBriefingPromptForImportUrl,
  parseStrategyImportUrl,
  validateStrategyImportUrl,
  type SystemStrategyMode,
} from '../game/bots';
import type { ClientMessage, MatchReport, RoomInfo, ServerMessage, LadderEntry } from '../game/multiplayer/protocol';
import { Star, Lock, Play, RotateCcw, Home as HomeIcon, Settings, ChevronLeft, Volume2, VolumeX, Trophy, Infinity as InfinityIcon, Swords, Bot, Crown, Users } from 'lucide-react';

type AppScreen = GameScreen | 'battleArena' | 'battleRoom';
type AppLanguage = 'en' | 'zh';

function tx(language: AppLanguage, en: string, zh: string): string {
  return language === 'zh' ? zh : en;
}

function getBackendUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  const isHttps = window.location.protocol === 'https:';
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'localhost:3001' 
    : window.location.host;
  return `${isHttps ? 'https' : 'http'}://${host}`;
}

function getFighterFilter(color: string): string {
  const lowerColor = color.toLowerCase();
  if (lowerColor === '#ff4d8d' || lowerColor.includes('pink') || lowerColor === '#e53e3e' || lowerColor.includes('red')) {
    return 'hue-rotate(330deg) saturate(1.2) brightness(1.1)';
  }
  if (lowerColor === '#00f0ff' || lowerColor.includes('cyan') || lowerColor === '#3182ce' || lowerColor.includes('blue')) {
    return 'hue-rotate(180deg) saturate(1.8) brightness(1.1)';
  }
  if (lowerColor === '#ffcc00' || lowerColor.includes('yellow') || lowerColor === '#dd6b20' || lowerColor.includes('gold')) {
    return 'hue-rotate(45deg) saturate(1.8) brightness(1.2)';
  }
  if (lowerColor === '#b28dff' || lowerColor.includes('purple') || lowerColor.includes('indigo')) {
    return 'hue-rotate(270deg) saturate(1.8) brightness(1.1)';
  }
  return '';
}

function renderFighterModules(modules?: readonly string[]) {
  if (!modules || modules.length === 0) return null;
  return (
    <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex gap-0.5 z-10 scale-90">
      {modules.map((entry) => {
        const lower = entry.toLowerCase();
        let label = '';
        let colorClass = 'bg-[#718096]';
        if (lower.includes('wing swarm')) { label = 'WS'; colorClass = 'bg-cyan-500'; }
        else if (lower.includes('missile storm')) { label = 'MS'; colorClass = 'bg-red-500'; }
        else if (lower.includes('overload lance')) { label = 'OL'; colorClass = 'bg-orange-500'; }
        else if (lower.includes('phantom echo')) { label = 'PE'; colorClass = 'bg-purple-500'; }
        else if (lower.includes('ghost veil')) { label = 'GV'; colorClass = 'bg-indigo-600'; }
        else if (lower.includes('blackout pulse')) { label = 'BP'; colorClass = 'bg-purple-600'; }
        else if (lower.includes('aegis layer')) { label = 'AL'; colorClass = 'bg-blue-600'; }
        else if (lower.includes('vector drive')) { label = 'VD'; colorClass = 'bg-teal-500'; }
        else if (lower.includes('repair')) { label = 'RW'; colorClass = 'bg-green-500'; }
        
        if (!label) return null;
        
        const match = /lv\s*([1-3])/i.exec(entry);
        const lvl = match ? match[1] : '1';
        
        return (
          <span 
            key={entry} 
            className={`${colorClass} text-white font-extrabold text-[8px] px-1 rounded shadow-sm border border-white/20`}
            title={entry}
          >
            {label}{lvl}
          </span>
        );
      })}
    </div>
  );
}

const BATTLE_ROSTER: Array<{ id: string; name: string; kind: BotKind; color: string }> = [
  { id: 'viper', name: 'Viper-01', kind: 'aggressive', color: '#FF4D8D' },
  { id: 'aegis', name: 'Aegis-07', kind: 'defensive', color: '#00F0FF' },
  { id: 'midas', name: 'Midas-03', kind: 'collector', color: '#FFCC00' },
  { id: 'oracle', name: 'Oracle-09', kind: 'llm-strategy', color: '#B28DFF' },
];

const MODULE_POINT_LIMIT = 12;

const MODULE_CATALOG = [
  {
    name: 'Wing Swarm',
    zh: '僚机蜂群',
    short: 'WS',
    accent: 'cyan',
    descZh: '召唤僚机侧翼协同射击，火力密度高。',
    descEn: 'Adds wingmen that fire alongside the craft.',
    hintZh: '怕黯灭脉冲，适合强攻开局。',
    hintEn: 'Countered by Blackout Pulse; good for assault starts.',
  },
  {
    name: 'Missile Storm',
    zh: '导弹风暴',
    short: 'MS',
    accent: 'rose',
    descZh: '增加扇形导弹弹幕，压低多个目标血线。',
    descEn: 'Adds fan-shaped missile volleys for pressure.',
    hintZh: '配合僚机蜂群可形成高压火网。',
    hintEn: 'Pairs well with Wing Swarm for sustained pressure.',
  },
  {
    name: 'Overload Lance',
    zh: '超载长枪',
    short: 'OL',
    accent: 'amber',
    descZh: '强化主炮单发伤害，适合点杀威胁目标。',
    descEn: 'Boosts main-shot damage for focused kills.',
    hintZh: '会被幻影回响误导，需搭配机动或验证。',
    hintEn: 'Can be baited by Phantom Echo; verify targets first.',
  },
  {
    name: 'Phantom Echo',
    zh: '幻影回响',
    short: 'PE',
    accent: 'violet',
    descZh: '制造诱饵残影，扰乱锁定和火力判断。',
    descEn: 'Creates echoes that disrupt targeting.',
    hintZh: '克制超载长枪，适合欺骗战术。',
    hintEn: 'Counters Overload Lance; strong in deception plans.',
  },
  {
    name: 'Ghost Veil',
    zh: '幽灵面纱',
    short: 'GV',
    accent: 'indigo',
    descZh: '周期性进入隐身，降低被集火概率。',
    descEn: 'Periodically cloaks to reduce focus fire.',
    hintZh: '配合幻影回响提高生存和误导。',
    hintEn: 'Combines with Phantom Echo for survival and baiting.',
  },
  {
    name: 'Blackout Pulse',
    zh: '黯灭脉冲',
    short: 'BP',
    accent: 'fuchsia',
    descZh: '释放短暂干扰脉冲，压制蜂群和高频火力。',
    descEn: 'Emits disruption pulses against swarm fire.',
    hintZh: '直接克制僚机蜂群，是控制流核心。',
    hintEn: 'Directly counters Wing Swarm; core control module.',
  },
  {
    name: 'Aegis Layer',
    zh: '宙斯盾层',
    short: 'AL',
    accent: 'blue',
    descZh: '提供额外护盾层，提高换血容错。',
    descEn: 'Adds shield layers for safer trades.',
    hintZh: '和修复妖精组成稳定防守套。',
    hintEn: 'Pairs with Repair Wisp for durable defense.',
  },
  {
    name: 'Repair Wisp',
    zh: '修复妖精',
    short: 'RW',
    accent: 'emerald',
    descZh: '周期修复耐久，拖长对局收益高。',
    descEn: 'Repairs over time and rewards long fights.',
    hintZh: '怕持续高压伤害，避免被导弹风暴压制。',
    hintEn: 'Weak to sustained pressure such as Missile Storm.',
  },
  {
    name: 'Vector Drive',
    zh: '矢量引擎',
    short: 'VD',
    accent: 'teal',
    descZh: '提高机动和闪避效率，适合游走拉扯。',
    descEn: 'Improves mobility and dodge efficiency.',
    hintZh: '适合搭配超载长枪做高速点杀。',
    hintEn: 'Useful with Overload Lance for fast strike plans.',
  },
] as const;

const MODULE_PRESETS: Array<{ key: 'aggressive' | 'defensive' | 'control' | 'deception' | 'mobility'; zh: string; en: string; modules: Record<string, number> }> = [
  { key: 'aggressive', zh: '强攻', en: 'Assault', modules: { 'Wing Swarm': 3, 'Missile Storm': 3, 'Overload Lance': 3, 'Vector Drive': 3 } },
  { key: 'defensive', zh: '防守', en: 'Defense', modules: { 'Aegis Layer': 3, 'Repair Wisp': 3, 'Vector Drive': 2, 'Ghost Veil': 2, 'Blackout Pulse': 2 } },
  { key: 'control', zh: '控制', en: 'Control', modules: { 'Blackout Pulse': 3, 'Phantom Echo': 3, 'Ghost Veil': 2, 'Wing Swarm': 2, 'Aegis Layer': 2 } },
  { key: 'deception', zh: '欺骗', en: 'Deception', modules: { 'Phantom Echo': 3, 'Ghost Veil': 3, 'Vector Drive': 2, 'Blackout Pulse': 2, 'Repair Wisp': 2 } },
  { key: 'mobility', zh: '机动', en: 'Mobility', modules: { 'Vector Drive': 3, 'Overload Lance': 3, 'Ghost Veil': 2, 'Missile Storm': 2, 'Aegis Layer': 2 } },
];

function createEmptyModuleState(): Record<string, number> {
  return Object.fromEntries(MODULE_CATALOG.map((module) => [module.name, 0]));
}

function normalizeModuleName(name: string): string {
  if (/repair\s+nanites/i.test(name)) return 'Repair Wisp';
  const match = MODULE_CATALOG.find((module) => module.name.toLowerCase() === name.trim().toLowerCase());
  return match?.name ?? name.trim();
}

function createModuleStateFromList(modules: readonly string[]): Record<string, number> {
  const state = createEmptyModuleState();
  for (const entry of modules) {
    const match = /^(.+?)(?:[-\s]+Lv\s*|\s+Lv\s*)([1-3])$/i.exec(entry.trim());
    const name = normalizeModuleName(match?.[1] ?? entry);
    const level = match ? Number(match[2]) : 1;
    if (name in state) {
      state[name] = Math.max(0, Math.min(3, level));
    }
  }
  return state;
}

function createPresetModuleState(preset: Record<string, number>): Record<string, number> {
  return { ...createEmptyModuleState(), ...preset };
}

function createRandomModuleState(seed = Date.now()): Record<string, number> {
  const state = createEmptyModuleState();
  let remaining = MODULE_POINT_LIMIT;
  let random = seed >>> 0;
  const next = () => {
    random = Math.imul(random || 1, 1664525) + 1013904223;
    return (random >>> 0) / 4294967296;
  };

  const pool = [...MODULE_CATALOG].sort(() => next() - 0.5);
  for (const module of pool) {
    if (remaining <= 0) break;
    if (next() < 0.35 && remaining < 8) continue;
    const level = Math.min(3, remaining, Math.max(1, Math.ceil(next() * 3)));
    state[module.name] = level;
    remaining -= level;
  }

  if (moduleLoadoutPoints(state) === 0) {
    state['Wing Swarm'] = 2;
    state['Missile Storm'] = 2;
    state['Aegis Layer'] = 2;
  }

  return state;
}

function moduleLoadoutPoints(modules: Record<string, number>): number {
  return Object.values(modules).reduce((sum, level) => sum + Math.max(0, level), 0);
}

function moduleStateToList(modules: Record<string, number>): string[] {
  return Object.entries(modules)
    .filter(([, level]) => level > 0)
    .map(([name, level]) => `${normalizeModuleName(name)}-Lv${level}`);
}

const ROOM_SERVER_URL =
  (import.meta.env.VITE_BATTLE_SERVER_URL as string | undefined) ??
  (() => {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const host = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'localhost:3001'
      : typeof window !== 'undefined'
        ? window.location.host
        : '127.0.0.1:3001';
    return `${isHttps ? 'wss' : 'ws'}://${host}/ws`;
  })();

function createBattleFighters(): BattleFighterConfig[] {
  return BATTLE_ROSTER.map((fighter) => {
    // Pre-assign distinct modules to showcase different premium skill effects
    let modules: string[] = [];
    if (fighter.id === 'viper') {
      modules = ['Wing Swarm Lv 3', 'Missile Storm Lv 2'];
    } else if (fighter.id === 'aegis') {
      modules = ['Aegis Layer Lv 3', 'Repair Wisp Lv 2'];
    } else if (fighter.id === 'midas') {
      modules = ['Phantom Echo Lv 3', 'Vector Drive Lv 2'];
    } else if (fighter.id === 'oracle') {
      modules = ['Ghost Veil Lv 3', 'Overload Lance Lv 2'];
    }

    return {
      id: fighter.id,
      name: fighter.name,
      color: fighter.color,
      modules,
      bot: createBotController(fighter.kind, { id: `${fighter.id}-${fighter.kind}` }),
    };
  });
}

export default function HomePage() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [battleReport, setBattleReport] = useState<BattleReport | null>(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(() => {
    try { const saved = localStorage.getItem('storm_blaster_unlocked'); return saved ? JSON.parse(saved) : [1]; }
    catch { return [1]; }
  });
  const [levelStars, setLevelStars] = useState<Record<number, number>>(() => {
    try { const saved = localStorage.getItem('storm_blaster_stars'); return saved ? JSON.parse(saved) : {}; }
    catch { return {}; }
  });
  const [highScores, setHighScores] = useState<Record<number, number>>(() => {
    try { const saved = localStorage.getItem('storm_blaster_scores'); return saved ? JSON.parse(saved) : {}; }
    catch { return {}; }
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>(() => {
    try {
      const saved = localStorage.getItem('astra_gambit_language');
      return saved === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });

  const changeLanguage = (lang: AppLanguage) => {
    setLanguage(lang);
    try {
      localStorage.setItem('astra_gambit_language', lang);
    } catch (e) {
      console.error(e);
    }
  };
  const [finalScore, setFinalScore] = useState(0);
  const [earnedStars, setEarnedStars] = useState(0);

  // Endless stats
  const [endlessHighScore, setEndlessHighScore] = useState<number>(() => {
    try { const saved = localStorage.getItem('storm_blaster_endless_score'); return saved ? parseInt(saved, 10) : 0; }
    catch { return 0; }
  });
  const [endlessBestTime, setEndlessBestTime] = useState<number>(() => {
    try { const saved = localStorage.getItem('storm_blaster_endless_time'); return saved ? parseInt(saved, 10) : 0; }
    catch { return 0; }
  });

  // Pending level to start after screen switches to playing
  const [pendingLevel, setPendingLevel] = useState<number | null>(null);
  const [pendingEndless, setPendingEndless] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const battleEngineRef = useRef<LocalBattleEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const battleFrameRef = useRef<number>(0);
  const battleLastTimeRef = useRef<number>(0);
  // Use a ref for screen to avoid stale closure in event handlers
  const screenRef = useRef<AppScreen>('menu');
  const botMetadata = useMemo(() => listBotMetadata(), []);

  // Keep screenRef in sync
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Load images
  const [images, setImages] = useState<GameImages | null>(null);

  useEffect(() => {
    const imageUrls: Record<string, string> = {
      player: '/images/player_jet.png',
      enemyDrone: '/images/enemy_drone.png',
      enemyScout: '/images/enemy_scout.png',
      enemyHeavy: '/images/enemy_heavy.png',
      enemySuicide: '/images/enemy_suicide.png',
      bossMothership: '/images/boss_mothership.png',
    };

    const loadedImages: Partial<GameImages> = {};
    let loaded = 0;
    const total = Object.keys(imageUrls).length;

    for (const [key, url] of Object.entries(imageUrls)) {
      const img = new Image();
      img.src = url;
      img.onload = () => {
        loaded++;
        loadedImages[key as keyof GameImages] = img;
        if (loaded === total) {
          setImages(loadedImages as GameImages);
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === total) {
          setImages(loadedImages as GameImages);
        }
      };
    }
  }, []);

  // Initialize game engine when pendingLevel is set and canvas is visible
  useEffect(() => {
    if ((pendingLevel === null && !pendingEndless) || !images || !canvasRef.current) return;

    // Wait for next frame so canvas is visible and has proper dimensions
    const timeoutId = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Force canvas to fill its container
      const container = canvas.parentElement;
      if (container) {
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }

      const rect = canvas.getBoundingClientRect();
      const w = Math.max(rect.width, window.innerWidth);
      const h = Math.max(rect.height, window.innerHeight);

      // Skip if dimensions are invalid
      if (w < 10 || h < 10) {
        console.warn('Canvas dimensions too small, retrying...');
        return;
      }

      // Set canvas internal resolution (no DPR scaling to keep logic simple)
      canvas.width = w;
      canvas.height = h;

      // Stop previous engine
      if (engineRef.current) {
        engineRef.current.stop();
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }

      const isEndless = pendingEndless;
      const level = pendingLevel || 1;
      if (!isEndless) setSelectedLevel(level);

      const engine = new GameEngine(canvas, images, (state) => {
        setGameState({ ...state });
        if (state.screen !== 'playing') {
          setScreen(state.screen);
          if (state.screen === 'gameOver') {
            setFinalScore(state.score);
            setHighScores(prev => {
              const prevHigh = prev[level] || 0;
              if (state.score > prevHigh) {
                const next = { ...prev, [level]: state.score };
                localStorage.setItem('storm_blaster_scores', JSON.stringify(next));
                return next;
              }
              return prev;
            });
          } else if (state.screen === 'levelComplete') {
            setFinalScore(state.score);
            // Calculate stars
            const livesRemaining = state.player.lives;
            let stars = 1;
            if (livesRemaining >= 2) stars = 2;
            if (livesRemaining >= 3) stars = 3;
            setEarnedStars(stars);

            // Update level stars
            setLevelStars(prev => {
              const currentStars = prev[level] || 0;
              if (stars > currentStars) {
                const next = { ...prev, [level]: stars };
                localStorage.setItem('storm_blaster_stars', JSON.stringify(next));
                return next;
              }
              return prev;
            });

            // Unlock next level
            setUnlockedLevels(prev => {
              if (!prev.includes(level + 1) && level < 10) {
                const next = [...prev, level + 1];
                localStorage.setItem('storm_blaster_unlocked', JSON.stringify(next));
                return next;
              }
              return prev;
            });

            // Update high score
            setHighScores(prev => {
              const prevHigh = prev[level] || 0;
              if (state.score > prevHigh) {
                const next = { ...prev, [level]: state.score };
                localStorage.setItem('storm_blaster_scores', JSON.stringify(next));
                return next;
              }
              return prev;
            });
          } else if (state.screen === 'endlessGameOver') {
            setFinalScore(state.score);
            const survivedTime = Math.floor(state.gameTime);
            const endlessScore = state.score;
            setEndlessBestTime(prev => {
              if (survivedTime > prev) {
                localStorage.setItem('storm_blaster_endless_time', String(survivedTime));
                return survivedTime;
              }
              return prev;
            });
            setEndlessHighScore(prev => {
              if (endlessScore > prev) {
                localStorage.setItem('storm_blaster_endless_score', String(endlessScore));
                return endlessScore;
              }
              return prev;
            });
          }
        }
      });

      engineRef.current = engine;

      const renderer = new Renderer(canvas, images);
      renderer.setCanvasSize(w, h);
      rendererRef.current = renderer;

      if (isEndless) {
        engine.startEndless();
      } else {
        engine.startLevel(level);
      }

      // Game render loop
      const renderLoop = () => {
        if (engineRef.current && rendererRef.current) {
          const state = engineRef.current.getState();
          rendererRef.current.setCanvasSize(w, h);
          rendererRef.current.render(state);
        }
        animFrameRef.current = requestAnimationFrame(renderLoop);
      };
      renderLoop();

      setPendingLevel(null);
      setPendingEndless(false);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [pendingLevel, pendingEndless, images]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (battleFrameRef.current) cancelAnimationFrame(battleFrameRef.current);
      if (engineRef.current) engineRef.current.stop();
      battleEngineRef.current = null;
    };
  }, []);

  const stopBattleArena = useCallback(() => {
    if (battleFrameRef.current) {
      cancelAnimationFrame(battleFrameRef.current);
      battleFrameRef.current = 0;
    }
    battleEngineRef.current = null;
    battleLastTimeRef.current = 0;
  }, []);

  // Start game: switch screen first, let useEffect handle engine init
  const startGame = useCallback((level: number) => {
    stopBattleArena();
    setScreen('playing');
    setPendingLevel(level);
  }, [stopBattleArena]);

  const startEndlessGame = useCallback(() => {
    stopBattleArena();
    setScreen('playing');
    setPendingEndless(true);
  }, [stopBattleArena]);

  const startBattleArena = useCallback(() => {
    if (engineRef.current) engineRef.current.stop();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopBattleArena();

    const engine = new LocalBattleEngine({
      fighters: createBattleFighters(),
      simulation: {
        battleId: `local-${Date.now()}`,
        seed: Math.floor(Date.now() % 100000),
        arena: { width: 360, height: 620 },
        maxTicks: 60 * 70,
      },
    });

    battleEngineRef.current = engine;
    setBattleReport(null);
    setBattleState(engine.start());
    setScreen('battleArena');

    const loop = (timestamp: number) => {
      const activeEngine = battleEngineRef.current;
      if (!activeEngine) return;

      const lastTime = battleLastTimeRef.current || timestamp;
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      battleLastTimeRef.current = timestamp;

      const nextState = activeEngine.step(dt);
      setBattleState(nextState);

      if (nextState.phase === 'finished') {
        try {
          setBattleReport(activeEngine.getReport());
        } catch {
          setBattleReport(activeEngine.finish('manual'));
        }
        battleFrameRef.current = 0;
        return;
      }

      battleFrameRef.current = requestAnimationFrame(loop);
    };

    battleFrameRef.current = requestAnimationFrame(loop);
  }, [stopBattleArena]);

  const openBattleRoom = useCallback(() => {
    if (engineRef.current) engineRef.current.stop();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopBattleArena();
    setScreen('battleRoom');
  }, [stopBattleArena]);

  // Pause handler
  const handlePause = useCallback(() => {
    if (screenRef.current === 'playing' && engineRef.current) {
      engineRef.current.pause();
      setScreen('paused');
    }
  }, []);

  // Touch handlers - use screenRef to avoid stale closure
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!engineRef.current || screenRef.current !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    // Check pause button first
    if (engineRef.current.isPauseButtonClicked(x, y)) {
      handlePause();
      return;
    }
    engineRef.current.handleTouchStart(x, y);
  }, [handlePause]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!engineRef.current || screenRef.current !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    engineRef.current.handleTouchMove(touch.clientX - rect.left, touch.clientY - rect.top);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!engineRef.current) return;
    engineRef.current.handleTouchEnd();
  }, []);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!engineRef.current || screenRef.current !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Check pause button first
    if (engineRef.current.isPauseButtonClicked(x, y)) {
      handlePause();
      return;
    }
    engineRef.current.handleTouchStart(x, y);
  }, [handlePause]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!engineRef.current || screenRef.current !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    engineRef.current.handleTouchMove(e.clientX - rect.left, e.clientY - rect.top);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.handleTouchEnd();
  }, []);

  // Check pause button click (desktop fallback)
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // Mousedown already handles pause, prevent duplicate
    if (screenRef.current !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Only handle if not on pause button (mousedown handled it)
    if (engineRef.current?.isPauseButtonClicked(x, y)) {
      return;
    }
  }, []);

  // Toggle sound
  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const newEnabled = !prev;
      audioManager.setEnabled(newEnabled);
      return newEnabled;
    });
  }, []);

  // Render stars
  const renderStars = (count: number, max: number = 3) => {
    return Array.from({ length: max }, (_, i) => (
      <Star
        key={i}
        size={20}
        className={i < count ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}
      />
    ));
  };

  const liveBattleStats = battleState
    ? Object.values(battleState.stats)
        .map((stats) => {
          const fighter = battleState.fighters.find((item) => item.id === stats.fighterId);
          return {
            ...stats,
            color: fighter?.color ?? '#FFFFFF',
            hp: fighter?.hp ?? 0,
            maxHp: fighter?.maxHp ?? 1,
            lives: fighter?.lives ?? 0,
            eliminated: fighter?.eliminated ?? false,
          };
        })
        .sort((a, b) => b.score - a.score || b.kills - a.kills || b.lives - a.lives)
    : [];

  return (
    <div className="w-full h-screen bg-[#eef2f7] overflow-hidden relative"
         style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
      {/* Game Canvas - conditionally rendered but always in DOM */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full`}
        style={{
          touchAction: 'none',
          display: screen === 'playing' || screen === 'paused' || screen === 'gameOver' || screen === 'levelComplete' ? 'block' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
      />

      {/* Pause overlay */}
      {screen === 'paused' && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-cyan-500/30">
            <h2 className="text-3xl font-bold text-white text-center mb-6">
              {tx(language, 'PAUSED', '已暂停')}
            </h2>

            <button
              onClick={() => {
                if (engineRef.current) {
                  engineRef.current.resume();
                  setScreen('playing');
                }
              }}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <Play size={20} />
              {tx(language, 'Continue', '继续游戏')}
            </button>

            <button
              onClick={() => {
                if (engineRef.current) engineRef.current.stop();
                if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
                startGame(selectedLevel);
              }}
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={20} />
              {tx(language, 'Restart', '重新开始')}
            </button>

            <button
              onClick={() => {
                if (engineRef.current) engineRef.current.stop();
                if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
                setScreen('menu');
              }}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              {tx(language, 'Quit', '退出游戏')}
            </button>
          </div>
        </div>
      )}

      {/* Game Over overlay */}
      {screen === 'gameOver' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-red-500/30">
            <h2 className="text-4xl font-bold text-red-500 text-center mb-2">
              {tx(language, 'GAME OVER', '游戏结束')}
            </h2>
            <p className="text-gray-400 text-center mb-6">
              {tx(language, 'Mission Failed', '任务失败')}
            </p>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm">
                  {tx(language, 'Final Score', '最终得分')}
                </p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="flex justify-center gap-4 mt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Level', '关卡')}
                  </p>
                  <p className="text-lg font-bold text-cyan-400">{selectedLevel}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Kills', '击杀数')}
                  </p>
                  <p className="text-lg font-bold text-green-400">{gameState?.totalKills || 0}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => startGame(selectedLevel)}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={20} />
              {tx(language, 'Try Again', '再试一次')}
            </button>

            <button
              onClick={() => setScreen('menu')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              {tx(language, 'Main Menu', '返回主页')}
            </button>
          </div>
        </div>
      )}

      {/* Endless Game Over overlay */}
      {screen === 'endlessGameOver' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-orange-500/30">
            <h2 className="text-3xl font-bold text-orange-400 text-center mb-2">
              {tx(language, 'WAVE CLEAR', '对局结束')}
            </h2>
            <p className="text-gray-400 text-center mb-4">
              {tx(language, 'Endless Mode', '无尽生存模式')}
            </p>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center mb-3">
                <p className="text-gray-400 text-sm">
                  {tx(language, 'Final Score', '最终得分')}
                </p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Wave', '波次')}
                  </p>
                  <p className="text-lg font-bold text-red-400">{gameState?.endlessWave || 1}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Time', '时间')}
                  </p>
                  <p className="text-lg font-bold text-cyan-400">{Math.floor(gameState?.gameTime || 0)}s</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Best Score', '最高得分')}
                  </p>
                  <p className="text-lg font-bold text-yellow-400">{endlessHighScore.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Best Time', '最长时间')}
                  </p>
                  <p className="text-lg font-bold text-green-400">{endlessBestTime}s</p>
                </div>
                <div className="text-center col-span-2">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Kills', '击杀数')}
                  </p>
                  <p className="text-lg font-bold text-green-400">{gameState?.totalKills || 0}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => startEndlessGame()}
              className="w-full bg-orange-500 hover:bg-orange-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={20} />
              {tx(language, 'Try Again', '再试一次')}
            </button>

            <button
              onClick={() => setScreen('menu')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              {tx(language, 'Main Menu', '返回主页')}
            </button>
          </div>
        </div>
      )}

      {/* Level Complete overlay */}
      {screen === 'levelComplete' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-green-500/30">
            <h2 className="text-3xl font-bold text-green-400 text-center mb-2">
              {tx(language, 'COMPLETE!', '通关成功!')}
            </h2>
            <p className="text-gray-400 text-center mb-4">
              {tx(language, `Level ${selectedLevel} Cleared`, `第 ${selectedLevel} 关 通关成功`)}
            </p>

            <div className="flex justify-center gap-2 mb-4">
              {renderStars(earnedStars)}
            </div>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm">
                  {tx(language, 'Score', '本关得分')}
                </p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="flex justify-center gap-4 mt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'High Score', '最高得分')}
                  </p>
                  <p className="text-lg font-bold text-yellow-400">{(highScores[selectedLevel] || 0).toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">
                    {tx(language, 'Kills', '击杀数')}
                  </p>
                  <p className="text-lg font-bold text-green-400">{gameState?.totalKills || 0}</p>
                </div>
              </div>
            </div>

            {selectedLevel < 10 && (
              <button
                onClick={() => startGame(selectedLevel + 1)}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
              >
                <Play size={20} />
                {tx(language, 'Next Level', '下一关卡')}
              </button>
            )}

            <button
              onClick={() => setScreen('levelSelect')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              {tx(language, 'Level Select', '关卡选择')}
            </button>
          </div>
        </div>
      )}

      {/* Main Menu */}
      {screen === 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <MenuBackground />

          <div className="relative z-10 flex flex-col items-center px-4">
            {/* Title */}
            <div className="mb-10 text-center">
              <h1 className="text-5xl font-black text-[#4a5568] mb-2 tracking-wide font-sans"
                  style={{ textShadow: '2px 2px 4px var(--neu-shadow), -2px -2px 4px var(--neu-light)' }}>
                STORM BLASTER
              </h1>
              <p className="text-[#718096] text-xs font-bold tracking-[0.3em] uppercase">
                {tx(language, 'Astra Gambit', '雷电风暴 · 空域协议')}
              </p>
            </div>

            {/* Menu buttons */}
            <button
              onClick={() => setScreen('levelSelect')}
              className="w-64 neu-btn-primary font-black text-xl py-4 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <Play size={24} fill="white" />
              {tx(language, 'START', '开始游戏')}
            </button>

            <button
              onClick={startEndlessGame}
              className="w-64 neu-btn font-bold text-lg py-3 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <InfinityIcon size={24} className="text-[#6d8bb0]" />
              {tx(language, 'ENDLESS', '无尽模式')}
            </button>

            <button
              onClick={openBattleRoom}
              className="w-64 neu-btn-primary font-black text-xl py-4 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <Swords size={24} fill="white" />
              {tx(language, 'AI BATTLE ROOM', 'AI 多人对战')}
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="w-64 neu-btn font-bold py-3 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <Settings size={20} className="text-[#718096]" />
              {tx(language, 'Settings', '系统设置')}
            </button>

            <button
              onClick={() => setScreen('levelSelect')}
              className="w-64 neu-btn font-bold py-3 px-8 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <Trophy size={20} className="text-[#718096]" />
              {tx(language, 'Level Select', '关卡选择')}
            </button>

            {/* Endless stats */}
            {(endlessHighScore > 0 || endlessBestTime > 0) && (
              <div className="mt-6 neu-inset rounded-xl px-5 py-2.5 border border-white/20">
                <p className="text-[#718096] text-[10px] text-center uppercase tracking-wider mb-1.5 font-bold">
                  {tx(language, 'Endless Best', '无尽最高纪录')}
                </p>
                <div className="flex gap-4 text-xs font-bold text-[#4a5568]">
                  <span>
                    {tx(language, 'Score: ', '积分: ')}
                    <span className="text-[#5e7fa8]">{endlessHighScore.toLocaleString()}</span>
                  </span>
                  <span>
                    {tx(language, 'Time: ', '时间: ')}
                    <span className="text-[#5e7fa8]">{endlessBestTime}s</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Sound toggle */}
          <button
            onClick={toggleSound}
            className="absolute top-4 right-4 z-20 neu-btn text-[#4a5568] p-3 rounded-full hover:scale-105 active:scale-95 transition-all"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>
      )}

      {/* AI Battle Arena */}
      {screen === 'battleArena' && (
        <div className="absolute inset-0 flex flex-col z-10 text-[#4a5568] bg-[#eef2f7]">
          <MenuBackground />

          <div className="relative z-10 flex h-full flex-col px-4 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  stopBattleArena();
                  setBattleState(null);
                  setBattleReport(null);
                  setScreen('menu');
                }}
                className="neu-btn text-[#4a5568] p-2.5 rounded-xl hover:scale-105 active:scale-95 transition-all"
                aria-label="Back to menu"
              >
                <ChevronLeft size={24} />
              </button>

              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-black text-[#2d3748] truncate tracking-wide">
                  {tx(language, 'AI BATTLE ARENA', '情报沙盒模拟器')}
                </h2>
                <p className="text-xs text-[#718096] font-bold uppercase tracking-[0.16em]">
                  {battleState?.phase === 'finished' 
                    ? tx(language, 'Match Complete', '模拟对局已结束') 
                    : tx(language, 'Local Simulation', '本地战术仿真模拟中')}
                </p>
              </div>

              <button
                onClick={startBattleArena}
                className="neu-btn text-[#4a5568] font-bold px-4 py-2 rounded-xl flex items-center gap-2 active:scale-95 transition-all"
              >
                <RotateCcw size={18} className="text-[#6d8bb0]" />
                {tx(language, 'Restart', '重新开始')}
              </button>
            </div>

            <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_360px]">
              <div className="relative min-h-[360px] overflow-hidden rounded-3xl border-4 border-white/70 bg-[#e1e8f0] shadow-[inset_6px_6px_14px_rgba(163,177,198,0.65),_inset_-6px_-6px_14px_rgba(255,255,255,0.8)] bg-[radial-gradient(#d1d9e6_1px,transparent_1px)] [background-size:16px_16px]">
                <div className="absolute left-4 top-4 z-10 rounded-xl neu-flat px-3 py-2 text-xs font-bold text-[#4a5568] border border-white/40 bg-[#eef2f7]">
                  {tx(language, 'T+', '用时 T+')}{formatBattleTime(battleState?.time ?? 0)} · {tx(language, 'Tick', '周期')}{battleState?.tick ?? 0}
                </div>

                {battleState ? (
                  <div className="absolute inset-0">
                    {battleState.collectibles.map((item) => (
                      <div
                        key={item.id}
                        className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 shadow-[2px_2px_4px_rgba(0,0,0,0.15)]"
                        style={{
                          left: `${(item.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(item.pos.y / battleState.arena.height) * 100}%`,
                          backgroundColor: item.kind === 'repair' ? '#48bb78' : item.kind === 'shield' ? '#3182ce' : item.kind === 'rage' ? '#e53e3e' : '#dd6b20',
                        }}
                      />
                    ))}

                    {battleState.projectiles.map((projectile) => (
                      <div
                        key={projectile.id}
                        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4a5568] border border-white/50 shadow-[1px_1px_3px_rgba(0,0,0,0.1)]"
                        style={{
                          left: `${(projectile.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(projectile.pos.y / battleState.arena.height) * 100}%`,
                        }}
                      />
                    ))}

                    {battleState.fighters.map((fighter) => (
                      <div
                        key={fighter.id}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${fighter.eliminated ? 'opacity-35 grayscale' : ''} ${fighter.ghostActive ? 'opacity-30' : ''}`}
                        style={{
                          left: `${(fighter.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(fighter.pos.y / battleState.arena.height) * 100}%`,
                        }}
                      >
                        {/* Capsules module list */}
                        {renderFighterModules(fighter.modules)}

                        {/* Stealth Indicator */}
                        {fighter.ghostActive && (
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-black bg-indigo-600/90 text-white px-1.5 py-0.5 rounded shadow border border-indigo-400/30 animate-pulse whitespace-nowrap z-20">
                            {tx(language, 'STEALTH', '隐身')}
                          </span>
                        )}

                        {/* Wing Swarm - Auxiliary Wingmen */}
                        {(() => {
                          const hasWingSwarm = fighter.modules?.some(m => m.toLowerCase().includes('wing swarm'));
                          if (!hasWingSwarm || fighter.eliminated) return null;
                          return (
                            <>
                              <div className="absolute -left-6 bottom-[-4px] opacity-85 scale-50 pointer-events-none transition-all duration-300">
                                <img
                                  src="/images/player_jet.png"
                                  alt="wingman"
                                  className="w-10 h-10 object-contain"
                                  style={{
                                    filter: `${getFighterFilter(fighter.color)} drop-shadow(0 0 2px ${fighter.color})`,
                                  }}
                                />
                              </div>
                              <div className="absolute -right-6 bottom-[-4px] opacity-85 scale-50 pointer-events-none transition-all duration-300">
                                <img
                                  src="/images/player_jet.png"
                                  alt="wingman"
                                  className="w-10 h-10 object-contain"
                                  style={{
                                    filter: `${getFighterFilter(fighter.color)} drop-shadow(0 0 2px ${fighter.color})`,
                                  }}
                                />
                              </div>
                            </>
                          );
                        })()}

                        {/* Phantom Echo - Holographic twins */}
                        {(() => {
                          const hasPhantomEcho = fighter.modules?.some(m => m.toLowerCase().includes('phantom echo'));
                          if (!hasPhantomEcho || fighter.eliminated) return null;
                          return (
                            <>
                              <div className="absolute -left-5 top-1 opacity-20 scale-75 pointer-events-none transition-all duration-300">
                                <img
                                  src="/images/player_jet.png"
                                  alt="phantom"
                                  className="w-10 h-10 object-contain"
                                  style={{
                                    filter: `${getFighterFilter(fighter.color)} opacity(0.5) drop-shadow(0 0 4px ${fighter.color})`,
                                  }}
                                />
                              </div>
                              <div className="absolute -right-5 top-1 opacity-20 scale-75 pointer-events-none transition-all duration-300">
                                <img
                                  src="/images/player_jet.png"
                                  alt="phantom"
                                  className="w-10 h-10 object-contain"
                                  style={{
                                    filter: `${getFighterFilter(fighter.color)} opacity(0.5) drop-shadow(0 0 4px ${fighter.color})`,
                                  }}
                                />
                              </div>
                            </>
                          );
                        })()}

                        <div
                          className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-[#eef2f7] neu-flat transition-transform"
                          style={{ borderColor: fighter.color }}
                        >
                          <img
                            src="/images/player_jet.png"
                            alt={fighter.name}
                            className="w-10 h-10 object-contain transition-transform"
                            style={{
                              filter: getFighterFilter(fighter.color),
                            }}
                          />
                          {fighter.shield > 0 && (
                            <div className="absolute inset-[-5px] rounded-full border-2 border-[#6d8bb0] animate-pulse" />
                          )}
                        </div>
                        <div className="mt-1.5 h-2 w-14 overflow-hidden rounded-full bg-[#d1d9e6] p-0.5 neu-inset">
                          <div
                            className="h-full rounded-full bg-[#48bb78]"
                            style={{ width: `${Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100))}%` }}
                          />
                        </div>
                        <p className="mt-1 w-20 -translate-x-3 truncate text-center text-[10px] font-bold" style={{ color: fighter.color }}>
                          {fighter.name}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-[#718096] font-bold">
                    {tx(language, 'Preparing arena...', '正在初始化沙盒战场...')}
                  </div>
                )}
              </div>

              <div className="min-h-0 overflow-y-auto rounded-[24px] neu-card border border-white/60 bg-[#eef2f7] p-5 flex flex-col gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#2d3748]">
                    <Swords size={16} className="text-[#6d8bb0]" />
                    {tx(language, 'Fighters', '阵营席位')}
                  </div>
                  <div className="grid gap-2">
                    {BATTLE_ROSTER.map((fighter) => {
                      const meta = botMetadata.find((item) => item.kind === fighter.kind);
                      return (
                        <div key={fighter.id} className="rounded-xl border border-white/30 bg-[#eef2f7] p-3 neu-flat text-[#4a5568]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-black" style={{ color: fighter.color }}>{fighter.name}</span>
                            <span className="rounded-full bg-[#d1d9e6]/50 px-2 py-0.5 text-[10px] font-bold text-[#4a5568]">{meta?.displayName ?? fighter.kind}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-black text-[#718096] uppercase">
                            <span>ATK <span className="text-[#4a5568]">{meta?.offense ?? 0}</span></span>
                            <span>DEF <span className="text-[#4a5568]">{meta?.defense ?? 0}</span></span>
                            <span>COL <span className="text-[#4a5568]">{meta?.collect ?? 0}</span></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#2d3748]">
                    <Trophy size={16} className="text-[#6d8bb0]" />
                    {tx(language, 'Live Board', '实时战绩榜')}
                  </div>
                  <div className="grid gap-2">
                    {liveBattleStats.map((stats, index) => (
                      <div key={stats.fighterId} className="rounded-xl border border-white/30 bg-[#eef2f7] p-3 neu-flat text-[#4a5568]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-[#718096] font-bold text-xs">#{index + 1}</span>
                            <span className="truncate font-black" style={{ color: stats.color }}>{stats.name}</span>
                          </div>
                          <span className="text-[#5e7fa8] font-black">{stats.score}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] font-bold text-[#718096] uppercase">
                          <span>K <span className="text-[#4a5568]">{stats.kills}</span></span>
                          <span>D <span className="text-[#4a5568]">{stats.deaths}</span></span>
                          <span>HP <span className="text-[#4a5568]">{Math.ceil(stats.hp)}</span></span>
                          <span>L <span className="text-[#4a5568]">{stats.lives}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {battleReport && (
                  <div className="rounded-2xl border border-white/30 bg-[#eef2f7] p-4 neu-inset">
                    <div className="mb-3 flex items-center gap-2 text-yellow-600">
                      <Crown size={18} />
                      <span className="font-black">
                        {tx(language, 'Winner: ', '获胜方席位: ')}
                        {battleReport.winnerName ?? tx(language, 'Draw', '平局 / 未能决出')}
                      </span>
                    </div>
                    <div className="grid gap-2 text-xs font-bold text-[#4a5568]">
                      {battleReport.rankings.map((entry) => (
                        <div key={entry.fighterId} className="flex items-center justify-between gap-3 border-b border-white/10 pb-1">
                          <span className="min-w-0 truncate">#{entry.rank} {entry.name}</span>
                          <span className="shrink-0 text-[#5e7fa8]">{entry.score} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Online Battle Room */}
      {screen === 'battleRoom' && (
        <BattleRoomPanel
          botMetadata={botMetadata}
          onBack={() => setScreen('menu')}
          language={language}
        />
      )}

      {/* Level Select */}
      {screen === 'levelSelect' && (
        <div className="absolute inset-0 flex flex-col z-10 bg-[#eef2f7]">
          <MenuBackground />

          <div className="relative z-10 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center px-4 py-4">
              <button
                onClick={() => setScreen('menu')}
                className="neu-btn text-[#4a5568] p-2.5 rounded-xl hover:scale-105 active:scale-95 transition-all"
              >
                <ChevronLeft size={24} />
              </button>
              <h2 className="text-2xl font-black text-[#2d3748] ml-4">
                {tx(language, 'Select Level', '选择关卡')}
              </h2>
            </div>

            {/* Level Grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-4">
                {LEVELS.map((level) => {
                  const isUnlocked = unlockedLevels.includes(level.id);
                  const stars = levelStars[level.id] || 0;
                  const highScore = highScores[level.id] || 0;

                  // Dynamic localization of level name & description
                  const name = tx(language,
                    level.id === 1 ? 'Beginner Cruise' :
                    level.id === 2 ? 'First Resistance' :
                    level.id === 3 ? 'Meteor Zone' :
                    level.id === 4 ? 'Barrage Threat' :
                    level.id === 5 ? 'Elite Squad' :
                    level.id === 6 ? 'Pincer Attack' :
                    level.id === 7 ? 'Maneuver Dodge' :
                    level.id === 8 ? 'Carpet Bombing' :
                    level.id === 9 ? 'Mothership Shadow' :
                    'Storm Blaster Ultimate',
                    level.name
                  );

                  const desc = tx(language,
                    level.id === 1 ? 'Familiarize with touch control & shooting' :
                    level.id === 2 ? 'Defeat 40 enemy fighters' :
                    level.id === 3 ? 'Survive and reach 100% progress' :
                    level.id === 4 ? 'Defeat mixed formations with new enemies' :
                    level.id === 5 ? 'Defeat designated elite enemies' :
                    level.id === 6 ? 'Reach 100% progress' :
                    level.id === 7 ? 'Dodge dense enemy fighter formations' :
                    level.id === 8 ? 'Reach 100% progress' :
                    level.id === 9 ? 'Destroy the small mothership' :
                    'Ultimate challenge, mixing all enemy types',
                    level.description
                  );

                  return (
                    <button
                      key={level.id}
                      onClick={() => isUnlocked && startGame(level.id)}
                      disabled={!isUnlocked}
                      className={`relative p-4 rounded-[20px] transition-all duration-300 ${
                        isUnlocked
                          ? 'neu-card hover:scale-[1.01] active:scale-95'
                          : 'neu-inset opacity-55'
                      }`}
                    >
                      {!isUnlocked && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <Lock size={32} className="text-[#a0aec0]" />
                        </div>
                      )}

                      <div className={`${!isUnlocked ? 'opacity-30' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-black text-[#6d8bb0]">{level.id}</span>
                          {level.bossLevel && (
                            <span className="text-[10px] font-bold bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">BOSS</span>
                          )}
                        </div>

                        <p className="text-[#2d3748] font-bold text-sm text-left mb-1">{name}</p>
                        <p className="text-[#718096] text-xs text-left mb-2">{desc}</p>

                        {isUnlocked && (
                          <>
                            <div className="flex gap-1 mb-1">
                              {renderStars(stars)}
                            </div>
                            {highScore > 0 && (
                              <p className="text-[#718096] text-xs text-left">
                                {tx(language, 'Best: ', '最高分: ')}
                                <span className="font-bold text-[#5e7fa8]">{highScore.toLocaleString()}</span>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings overlay */}
      {showSettings && (
        <div className="absolute inset-0 bg-slate-200/50 backdrop-blur-sm flex items-center justify-center z-30">
          <div className="neu-card p-8 w-80 border border-white/60 bg-[#eef2f7]">
            <h2 className="text-2xl font-black text-[#2d3748] text-center mb-6">
              {tx(language, 'Settings', '系统设置')}
            </h2>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[#4a5568] font-bold">
                  {tx(language, 'Sound', '游戏音效')}
                </span>
                <button
                  onClick={toggleSound}
                  className={`p-2.5 rounded-xl transition-all ${soundEnabled ? 'neu-btn-primary' : 'neu-btn text-gray-400 active:scale-95'}`}
                >
                  {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[#4a5568] font-bold">
                  {tx(language, 'Language', '语言切换')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => changeLanguage('zh')}
                    className={`py-1.5 px-3 text-xs rounded-xl font-bold transition-all ${
                      language === 'zh'
                        ? 'neu-btn-primary'
                        : 'neu-btn text-[#718096] hover:text-[#5e7fa8] active:scale-95'
                    }`}
                  >
                    中文
                  </button>
                  <button
                    onClick={() => changeLanguage('en')}
                    className={`py-1.5 px-3 text-xs rounded-xl font-bold transition-all ${
                      language === 'en'
                        ? 'neu-btn-primary'
                        : 'neu-btn text-[#718096] hover:text-[#5e7fa8] active:scale-95'
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-[#718096] text-xs font-bold uppercase tracking-wider mb-3">
                {tx(language, 'Progress', '游戏进度')}
              </p>
              <button
                onClick={() => {
                  if (
                    confirm(
                      tx(
                        language,
                        'Reset all progress? This cannot be undone.',
                        '确定要重置所有游戏进度吗？此操作将不可逆转。'
                      )
                    )
                  ) {
                    setUnlockedLevels([1]);
                    setLevelStars({});
                    setHighScores({});
                    localStorage.removeItem('storm_blaster_unlocked');
                    localStorage.removeItem('storm_blaster_stars');
                    localStorage.removeItem('storm_blaster_scores');
                  }
                }}
                className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold py-2.5 px-4 rounded-xl transition-colors"
              >
                {tx(language, 'Reset Progress', '重置所有进度')}
              </button>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full neu-btn text-[#4a5568] font-bold py-3 px-6 rounded-xl hover:scale-102 active:scale-98 transition-all"
            >
              {tx(language, 'Close', '关闭')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBattleTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function BattleRoomPanel({
  botMetadata,
  onBack,
  language,
}: {
  botMetadata: ReturnType<typeof listBotMetadata>;
  onBack: () => void;
  language: AppLanguage;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef('');
  const [displayName, setDisplayName] = useState(() => {
    try {
      return localStorage.getItem('astra_gambit_callsign') || 'Pilot';
    } catch {
      return 'Pilot';
    }
  });
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotKind>('aggressive');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [snapshot, setSnapshot] = useState<BattleState | null>(null);
  const [roomReport, setRoomReport] = useState<MatchReport<BattleReport> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState('');

  // Ranked Arena states
  const [roomSubMode, setRoomSubMode] = useState<'multiplayer' | 'ranked'>('multiplayer');
  const [ladderList, setLadderList] = useState<LadderEntry[]>([]);
  const [personalRank, setPersonalRank] = useState(7);
  const [personalScore, setPersonalScore] = useState(1000);
  const [personalCP, setPersonalCP] = useState(2000);

  // Challenge animation & outcome states
  const [activeChallengeOpponent, setActiveChallengeOpponent] = useState<LadderEntry | null>(null);
  const [challengerOutcome, setChallengerOutcome] = useState<'win' | 'lose' | null>(null);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);

  const [importTab, setImportTab] = useState<'manual' | 'agent'>('manual');
  const [agentUrl, setAgentUrl] = useState('http://127.0.0.1:8000/strategy');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'linking' | 'success' | 'error'>('idle');

  const [selectedModules, setSelectedModules] = useState<Record<string, number>>(() => createPresetModuleState(MODULE_PRESETS[0].modules));
  const [importUrl, setImportUrl] = useState('');
  const [parsedPolicy, setParsedPolicy] = useState<BotPolicy | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [quickStartPending, setQuickStartPending] = useState(false);

  const ownParticipant = room?.participants.find((participant) => participant.playerId === playerId);
  const humanParticipants = room?.participants.filter((participant) => !participant.playerId.startsWith('system-')) ?? [];
  const canStart = Boolean(
    room?.role === 'host' &&
    room.phase === 'lobby' &&
    humanParticipants.length >= 1 &&
    humanParticipants.every((participant) => participant.ready && participant.bot !== null)
  );
  const loadoutPoints = moduleLoadoutPoints(selectedModules);
  const loadoutOverLimit = loadoutPoints > MODULE_POINT_LIMIT;
  const strategyImportSummary = useMemo(() => {
    if (!importUrl.trim()) return null;
    try {
      return createStrategyImportSummary(parseStrategyImportUrl(importUrl), language === 'zh' ? 'zh' : 'en');
    } catch {
      return null;
    }
  }, [importUrl, language]);
  const briefingTicket = room?.code ?? 'TICKET';
  const briefingCallsign = displayName.trim() || 'Pilot';
  const briefingOpponents = useMemo(() => (
    (room?.participants ?? [])
      .filter((participant) => participant.playerId !== playerId)
      .map((participant) => participant.displayName)
  ), [playerId, room?.participants]);
  const briefingModules = useMemo(() => (
    moduleStateToList(selectedModules).map((entry) => entry.replace('-Lv', ' Lv'))
  ), [selectedModules]);
  const briefingUrl = generateBriefingUrl(briefingTicket, briefingCallsign);
  const briefingPrompt = generateBriefingPromptForImportUrl({
    ticket: briefingTicket,
    callsign: briefingCallsign,
    modules: briefingModules,
    opponents: briefingOpponents,
  });

  const ensurePlayerId = useCallback(() => {
    if (!playerIdRef.current) {
      let stored = '';
      try {
        stored = localStorage.getItem('astra_gambit_player_id') || '';
      } catch {
        stored = '';
      }
      playerIdRef.current = stored || globalThis.crypto?.randomUUID?.() || `player-${Date.now()}`;
      try {
        localStorage.setItem('astra_gambit_player_id', playerIdRef.current);
      } catch (e) {
        console.error(e);
      }
      setPlayerId(playerIdRef.current);
    }
    return playerIdRef.current;
  }, []);

  const updateDisplayName = useCallback((value: string) => {
    setDisplayName(value);
    try {
      localStorage.setItem('astra_gambit_callsign', value);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Generate and set player ID immediately on mount to ensure the Gateway Key has a complete, unique suffix
  useEffect(() => {
    ensurePlayerId();
  }, [ensurePlayerId]);

  const handleServerMessage = useCallback((message: ServerMessage<BattleState, BattleReport>) => {
    switch (message.type) {
      case 'ladder.sync':
        setLadderList(message.payload.leaderboard);
        setPersonalRank(message.payload.personalRank);
        setPersonalScore(message.payload.personalScore);
        setPersonalCP(message.payload.personalCombatPower);
        setError(null);
        break;
      case 'room.created':
      case 'room.joined':
      case 'room.updated':
        setRoom(message.payload.room);
        setError(null);
        break;
      case 'match.bot.selected':
        setRoom(message.payload.room);
        setError(null);
        break;
      case 'room.readied':
        setRoom(message.payload.room);
        setError(null);
        break;
      case 'match.started':
        setError(null);
        break;
      case 'match.state':
        setSnapshot(message.payload.snapshot.state);
        setError(null);
        break;
      case 'match.report':
        setRoomReport(message.payload.report);
        if (message.payload.report.summary) {
          setSnapshot(message.payload.report.summary.finalState);
        }
        setError(null);
        break;
      case 'error':
        setError(message.payload.error.message);
        break;
    }
  }, []);

  const attachSocketHandlers = useCallback((socket: WebSocket) => {
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        handleServerMessage(JSON.parse(event.data) as ServerMessage<BattleState, BattleReport>);
      } catch {
        setError('Received an unreadable room message.');
      }
    };
    socket.onclose = () => setConnectionStatus('closed');
    socket.onerror = () => setError(`Could not reach ${ROOM_SERVER_URL}`);
  }, [handleServerMessage]);

  const connectAndSend = useCallback((messageFactory: (playerId: string) => ClientMessage) => {
    setError(null);
    const playerId = ensurePlayerId();
    const existing = socketRef.current;

    if (existing?.readyState === WebSocket.OPEN) {
      existing.send(JSON.stringify(messageFactory(playerId)));
      return;
    }

    existing?.close();
    const socket = new WebSocket(ROOM_SERVER_URL);
    socketRef.current = socket;
    setConnectionStatus('connecting');
    attachSocketHandlers(socket);
    socket.onopen = () => {
      setConnectionStatus('connected');
      socket.send(JSON.stringify(messageFactory(playerId)));
    };
  }, [attachSocketHandlers, ensurePlayerId]);

  const sendRoomMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('Room socket is not connected.');
      return;
    }
    socket.send(JSON.stringify(message));
  }, []);

  const applyStrategyImportUrl = useCallback((url: string) => {
    const parsed = parseStrategyImportUrl(url);
    const validation = validateStrategyImportUrl(parsed, {
      ticket: room?.code,
      callsigns: room?.participants.map((participant) => participant.displayName),
    });

    if (!validation.ok) {
      throw new Error(validation.errors.join(' '));
    }

    const policy = parseImportUrl(url);
    setImportUrl(url);
    setParsedPolicy(normalizeBotPolicy(policy));
    setSelectedBot('llm-strategy');

    const parsedModules = parseModulesFromUrl(url);
    if (parsedModules.length > 0) {
      setSelectedModules(createModuleStateFromList(parsedModules));
    }

    setError(validation.warnings[0] ?? null);
  }, [room?.code, room?.participants]);

  const applySystemStrategy = useCallback((mode: SystemStrategyMode = 'auto', modulesOverride?: Record<string, number>) => {
    const modules = moduleStateToList(modulesOverride ?? selectedModules);
    const opponents = (room?.participants ?? [])
      .filter((participant) => participant.playerId !== playerId)
      .map((participant) => participant.displayName);
    const parsed = createSystemStrategyImport({
      ticket: room?.code ?? 'LOCAL',
      callsign: displayName.trim() || 'Pilot',
      modules,
      opponents,
      mode,
      seed: Date.now(),
    });
    applyStrategyImportUrl(createStrategyImportUrl(parsed));
  }, [applyStrategyImportUrl, displayName, playerId, room?.code, room?.participants, selectedModules]);

  const applyModulePreset = useCallback((preset: Record<string, number>) => {
    const nextModules = createPresetModuleState(preset);
    setSelectedModules(nextModules);
    setError(null);
  }, []);

  const applyRandomLoadout = useCallback(() => {
    const nextModules = createRandomModuleState();
    setSelectedModules(nextModules);
    setError(null);
    return nextModules;
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  // Sync client-side policy & modules visualization with server updates (e.g. from Agent HTTP push)
  useEffect(() => {
    if (!room || !playerId) return;
    const self = room.participants.find((p) => p.playerId === playerId);
    if (self?.bot?.policy) {
      setParsedPolicy(self.bot.policy);
      setSelectedBot('llm-strategy');
    }
    if (self?.bot?.modules) {
      const updatedModules = createModuleStateFromList(self.bot.modules);
      setSelectedModules((prev) => {
        const hasChanged = Object.entries(updatedModules).some(([k, v]) => prev[k] !== v);
        return hasChanged ? updatedModules : prev;
      });
    }
  }, [room, playerId]);

  // Save active gateway key to local file via backend API for AI coding agents to read
  useEffect(() => {
    if (!playerId) return;
    const roomCode = room?.code || 'LOBBY';
    fetch(`${getBackendUrl()}/api/agent/save-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomCode, playerId }),
    }).catch((err) => {
      console.warn('Failed to auto-save gateway key to agent-gateway.json:', err);
    });
  }, [room?.code, playerId]);



  // Load leaderboard when WebSocket connects
  useEffect(() => {
    if (connectionStatus === 'connected') {
      sendRoomMessage({
        v: 1,
        type: 'ladder.get',
        payload: {
          playerId: ensurePlayerId(),
        },
      });
    }
  }, [connectionStatus, ensurePlayerId, sendRoomMessage]);

  const syncDefenseFleet = () => {
    const modulesList = moduleStateToList(selectedModules);

    sendRoomMessage({
      v: 1,
      type: 'ladder.upload_defense',
      payload: {
        playerId: ensurePlayerId(),
        displayName: displayName.trim() || 'Pilot',
        modules: modulesList,
        botKind: selectedBot,
        policy: parsedPolicy || undefined,
      },
    });
  };

  const startRankedMatch = (opponent: LadderEntry) => {
    setError(null);
    setActiveChallengeOpponent(opponent);
    setChallengerOutcome(null);
    setShowOutcomeModal(false);

    const modulesList = moduleStateToList(selectedModules);

    // Build Challenger Fighter config
    let challengerController;
    if (parsedPolicy) {
      challengerController = createBotController('llm-strategy', { id: 'challenger', policy: parsedPolicy });
    } else {
      challengerController = createBotController(selectedBot, { id: 'challenger' });
    }

    // Build Defender Fighter config
    let defenderController;
    if (opponent.policy) {
      defenderController = createBotController('llm-strategy', { id: 'defender', policy: opponent.policy });
    } else {
      defenderController = createBotController(opponent.botKind as BotKind, { id: 'defender' });
    }

    const challengerFighter = {
      id: 'challenger',
      name: displayName.trim() || 'Pilot',
      color: '#FF4D8D', // Pink-red
      modules: modulesList,
      bot: challengerController,
    };

    const defenderFighter = {
      id: 'defender',
      name: opponent.displayName,
      color: '#00F0FF', // Cyan
      modules: opponent.modules,
      bot: defenderController,
    };

    const engine = new LocalBattleEngine({
      fighters: [challengerFighter, defenderFighter],
      simulation: {
        battleId: `ranked-${Date.now()}`,
        seed: Math.floor(Math.random() * 100000),
        arena: { width: 360, height: 620 },
        maxTicks: 60 * 70,
      },
    });

    setSnapshot(engine.start());

    let lastTime = performance.now();
    const loop = (timestamp: number) => {
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;

      const nextState = engine.step(dt);
      setSnapshot(nextState);

      if (nextState.phase === 'finished') {
        const report = engine.getReport();
        const won = report.winnerId === 'challenger';
        const outcome = won ? 'win' : 'lose';

        setChallengerOutcome(outcome);
        setShowOutcomeModal(true);

        // Upload results via WebSocket
        sendRoomMessage({
          v: 1,
          type: 'ladder.battle_result',
          payload: {
            challengerId: ensurePlayerId(),
            opponentId: opponent.playerId,
            outcome,
          },
        });
        return;
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  };

  const createRoom = useCallback(() => {
    connectAndSend((playerId) => ({
      v: 1,
      type: 'room.create',
      payload: {
        playerId,
        displayName: displayName.trim() || 'Pilot',
        maxPlayers: 4,
      },
    }));
  }, [connectAndSend, displayName]);

  const joinRoom = useCallback(() => {
    const roomCode = roomCodeInput.trim().toUpperCase();
    if (!roomCode) {
      setError('Enter a room code first.');
      return;
    }
    connectAndSend((playerId) => ({
      v: 1,
      type: 'room.join',
      payload: {
        roomCode,
        playerId,
        displayName: displayName.trim() || 'Pilot',
      },
    }));
  }, [connectAndSend, displayName, roomCodeInput]);

  const selectCurrentBot = useCallback(() => {
    if (!room) return;
    if (loadoutOverLimit) {
      setError(tx(language, 'Loadout exceeds the 12 point limit.', '模组装配超过 12 点上限，请先降低等级。'));
      return;
    }
    const meta = botMetadata.find((item) => item.kind === selectedBot);
    const modulesList = moduleStateToList(selectedModules);

    sendRoomMessage({
      v: 1,
      type: 'match.bot.select',
      payload: {
        roomId: room.roomId,
        playerId: ensurePlayerId(),
        bot: {
          botId: selectedBot,
          label: parsedPolicy ? `AI Briefing (${selectedBot})` : (meta?.displayName ?? selectedBot),
          difficulty: 'normal',
          modules: modulesList,
          policy: parsedPolicy || undefined,
        },
      },
    });
  }, [botMetadata, ensurePlayerId, language, loadoutOverLimit, parsedPolicy, room, selectedBot, selectedModules, sendRoomMessage]);

  // Automatically sync bot selection and modules to the server whenever local selectedBot, selectedModules, or parsedPolicy changes
  useEffect(() => {
    if (!room || room.phase !== 'lobby') return;
    const modulesList = moduleStateToList(selectedModules);
    
    const self = room.participants.find((p) => p.playerId === playerId);
    const selfModules = self?.bot?.modules || [];
    const isBotEqual = self?.bot?.botId === selectedBot;
    const isModulesEqual = selfModules.length === modulesList.length && modulesList.every(m => selfModules.includes(m));
    const isPolicyEqual = JSON.stringify(self?.bot?.policy || {}) === JSON.stringify(parsedPolicy || {});

    if (isBotEqual && isModulesEqual && isPolicyEqual) {
      return; // Already synchronized
    }

    selectCurrentBot();
  }, [room, playerId, selectedBot, selectedModules, parsedPolicy, selectCurrentBot]);

  const toggleReady = useCallback(() => {
    if (!room) return;
    if (loadoutOverLimit) {
      setError(tx(language, 'Loadout exceeds the 12 point limit.', '模组装配超过 12 点上限，请先降低等级。'));
      return;
    }
    sendRoomMessage({
      v: 1,
      type: 'room.ready',
      payload: {
        roomId: room.roomId,
        playerId: ensurePlayerId(),
        ready: !(ownParticipant?.ready ?? false),
      },
    });
  }, [ensurePlayerId, language, loadoutOverLimit, ownParticipant?.ready, room, sendRoomMessage]);

  const startOnlineMatch = useCallback(() => {
    if (!room) return;
    sendRoomMessage({
      v: 1,
      type: 'match.start',
      payload: {
        roomId: room.roomId,
        playerId: ensurePlayerId(),
      },
    });
  }, [ensurePlayerId, room, sendRoomMessage]);

  const startQuickPlay = useCallback(() => {
    const nextModules = applyRandomLoadout();
    setRoomSubMode('multiplayer');
    setQuickStartPending(true);
    if (room) {
      try {
        applySystemStrategy('random', nextModules);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } else {
      createRoom();
    }
    setError(tx(
      language,
      'Quick play armed: random loadout, system strategy, and ready state will be applied as soon as the room is available.',
      '小白快速模式已启动：系统会随机装配、生成策略，并在房间可用后自动标记就绪。'
    ));
  }, [applyRandomLoadout, applySystemStrategy, createRoom, language, room]);

  useEffect(() => {
    if (!quickStartPending || !room || room.phase !== 'lobby') return;
    try {
      applySystemStrategy('random');
      if (!ownParticipant?.ready) {
        sendRoomMessage({
          v: 1,
          type: 'room.ready',
          payload: {
            roomId: room.roomId,
            playerId: ensurePlayerId(),
            ready: true,
          },
        });
      }
      setQuickStartPending(false);
      setError(tx(
        language,
        'Quick play is ready. Host can press Start Match; the server will add system agents automatically.',
        '快速模式已配置完成。房主可直接点击“启动协议仿真战斗”，服务器会自动补齐系统代理。'
      ));
    } catch (err) {
      setQuickStartPending(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applySystemStrategy, ensurePlayerId, language, ownParticipant?.ready, quickStartPending, room, sendRoomMessage]);

  const challengeOpponents = useMemo(() => {
    const index = ladderList.findIndex((e) => e.playerId === playerId);
    const sliceStart = Math.max(0, index - 3);
    const sliceEnd = index > 0 ? index : Math.min(3, ladderList.length);
    if (index === -1) {
      return ladderList.slice(Math.max(0, ladderList.length - 3));
    }
    return ladderList.slice(sliceStart, sliceEnd).reverse();
  }, [ladderList, playerId]);

  return (
    <div className="absolute inset-0 flex flex-col z-10 text-[#4a5568] bg-[#eef2f7]">
      <MenuBackground />
      <div className="relative z-10 flex h-full flex-col px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="neu-btn text-[#4a5568] p-2.5 rounded-xl hover:scale-105 active:scale-95 transition-all"
            aria-label="Back to menu"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-black text-[#2d3748] truncate tracking-wide">
              {tx(language, 'ONLINE BATTLE ROOM', '空域协议多人联机舱')}
            </h2>
            <p className="text-xs text-[#718096] font-bold uppercase tracking-[0.16em]">
              {tx(language, connectionStatus, connectionStatus === 'connected' ? '协议链路已建立' : connectionStatus === 'connecting' ? '建立链路中...' : connectionStatus === 'closed' ? '链路已断开' : '等待连接')} · {ROOM_SERVER_URL}
            </p>
          </div>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(280px,1fr)_340px]">
          <div className="min-h-0 overflow-y-auto rounded-[24px] neu-card border border-white/60 bg-[#eef2f7] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#2d3748]">
                <Users size={16} className="text-[#6d8bb0]" />
                {tx(language, 'Room Setup', '席位配置室')}
              </div>
            </div>

            {/* Cockpit Mode Toggle */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#e1e8f0] shadow-inner">
              <button
                type="button"
                onClick={() => setRoomSubMode('multiplayer')}
                className={`py-2 text-[10px] font-black rounded-lg transition-all ${
                  roomSubMode === 'multiplayer'
                    ? 'bg-[#eef2f7] text-[#4a5568] shadow-sm'
                    : 'text-[#718096] hover:text-[#4a5568]'
                }`}
              >
                {tx(language, 'Online Match', '多人联机舱')}
              </button>
              <button
                type="button"
                onClick={() => setRoomSubMode('ranked')}
                className={`py-2 text-[10px] font-black rounded-lg transition-all ${
                  roomSubMode === 'ranked'
                    ? 'bg-[#eef2f7] text-[#4a5568] shadow-sm'
                    : 'text-[#718096] hover:text-[#4a5568]'
                }`}
              >
                {tx(language, 'Ranked Arena', '空域排位舱')}
              </button>
            </div>

            {roomSubMode === 'multiplayer' ? (
              <div className="flex flex-col gap-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#718096]">
                  {tx(language, 'Display name', '席位显示代号')}
                  <input
                    value={displayName}
                    onChange={(event) => updateDisplayName(event.target.value)}
                    className="mt-1.5 w-full neu-input px-3.5 py-2 text-sm"
                  />
                </label>

                <button
                  onClick={startQuickPlay}
                  className="w-full neu-btn-primary rounded-xl px-4 py-3 text-sm font-black transition-all active:scale-95"
                >
                  {tx(language, 'Novice Quick Play', '小白快速模式：一键配置并准备')}
                </button>

                <button
                  onClick={createRoom}
                  className="w-full neu-btn-primary py-3 font-black text-sm rounded-xl"
                >
                  {tx(language, 'Create Room', '申请建立空域协议')}
                </button>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={roomCodeInput}
                    onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                    placeholder={tx(language, 'ROOM CODE', '空域票据代码')}
                    className="neu-input px-3.5 py-2 text-sm"
                  />
                  <button
                    onClick={joinRoom}
                    className="neu-btn font-bold px-4 py-2 text-sm text-[#4a5568] rounded-xl active:scale-95"
                  >
                    {tx(language, 'Join', '加入空域')}
                  </button>
                </div>

                {room && (
                  <div className="rounded-xl border border-white/30 bg-[#eef2f7] p-3.5 neu-flat text-[#4a5568]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#718096]">
                      {tx(language, 'Room Code', '空域票据代码 (Room Code)')}
                    </p>
                    <p className="text-3xl font-black text-[#6d8bb0] tracking-wider mt-0.5">{room.code}</p>
                    <p className="mt-1.5 text-xs text-[#718096] font-bold uppercase">
                      {tx(language, room.phase, room.phase === 'lobby' ? '大厅组网中' : '对局仿真中')} · {room.readyPlayers}/{room.players} {tx(language, 'ready', '就绪')}
                    </p>
                    <p className="mt-2 text-[11px] font-bold text-[#718096] leading-relaxed">
                      {tx(
                        language,
                        'Solo hosts can start after ready. The server auto-fills system agents to reach the battle roster.',
                        '单人房主标记就绪后也可以开战，服务器会自动补齐系统代理席位。'
                      )}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4 flex-1 min-h-0">
                {/* Personal ELO Card */}
                <div className="rounded-2xl border border-white/40 bg-[#eef2f7] p-4 neu-flat flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#6d8bb0]/10 flex items-center justify-center text-cyan-600 border border-[#6d8bb0]/20 font-black text-xl shadow-inner shrink-0">
                      #{personalRank}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-black text-[#2d3748] text-sm truncate">{displayName}</h4>
                      <p className="text-[9px] text-[#718096] font-bold uppercase tracking-wider mt-0.5">
                        {tx(language, 'Ranked Score', '天梯排位积分')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-extrabold text-cyan-600 text-sm">{personalScore} pts</span>
                      <p className="text-[9px] text-gray-400 font-bold uppercase mt-0.5">CP {personalCP}</p>
                    </div>
                  </div>
                  <button
                    onClick={syncDefenseFleet}
                    className="w-full neu-btn border border-white/20 py-2.5 px-3 text-[10px] font-black text-cyan-600 hover:text-cyan-500 active:scale-98 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Crown size={12} />
                    {tx(language, 'Sync Defense Fleet', '同步防守阵容及战术')}
                  </button>
                </div>

                {/* Challenge Ranks */}
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="text-[9px] font-black uppercase tracking-wider text-[#718096] mb-1">
                    {tx(language, 'Challenge Candidates', '空域挑擂目标')}
                  </div>
                  {challengeOpponents.length === 0 ? (
                    <p className="text-center text-[10px] text-[#718096] py-3">{tx(language, 'No opponents available.', '暂无挑擂对手。')}</p>
                  ) : (
                    challengeOpponents.map((opponent) => (
                      <div key={opponent.playerId} className="rounded-2xl border border-white/20 bg-[#eef2f7] p-2.5 neu-flat text-[#4a5568] flex items-center justify-between gap-3 relative overflow-hidden group">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-[10px] text-gray-500">#{ladderList.findIndex(e => e.playerId === opponent.playerId) + 1}</span>
                            <span className="font-black text-xs text-[#2d3748] truncate">{opponent.displayName}</span>
                          </div>
                          <p className="mt-0.5 text-[8px] text-[#718096] font-bold uppercase tracking-wider">
                            {opponent.botKind} · CP {opponent.combatPower}
                          </p>
                        </div>
                        <button
                          onClick={() => startRankedMatch(opponent)}
                          className="neu-btn-primary font-black py-1.5 px-3 text-[9px] rounded-xl active:scale-95 shrink-0 shadow"
                        >
                          {tx(language, 'CHALLENGE', '挑战')}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Leaderboard scroll list */}
                <div className="flex flex-col gap-2 flex-1 min-h-[140px]">
                  <div className="text-[9px] font-black uppercase tracking-wider text-[#718096] flex items-center gap-1">
                    <Trophy size={11} className="text-cyan-600" />
                    {tx(language, 'Real-time Leaderboard', '天梯协议排名榜')}
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[160px] rounded-2xl border border-white/20 bg-[#eef2f7] p-2 neu-inset flex flex-col gap-1.5 pr-1">
                    {ladderList.map((entry, idx) => {
                      const isSelf = entry.playerId === playerId;
                      return (
                        <div
                          key={entry.playerId}
                          className={`rounded-xl px-2.5 py-1.5 border transition-all text-[11px] font-bold text-[#4a5568] flex items-center justify-between gap-2 ${
                            isSelf
                              ? 'bg-cyan-500/10 border-cyan-500/30 shadow-[inset_1px_1px_3px_rgba(0,0,0,0.15)] text-[#2d3748]'
                              : 'border-white/20 bg-[#eef2f7] neu-flat'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[9px] font-black shrink-0 w-3 text-center ${
                              idx === 0 ? 'text-yellow-500 font-black' :
                              idx === 1 ? 'text-slate-400 font-black' :
                              idx === 2 ? 'text-amber-600 font-black' : 'text-gray-500'
                            }`}>
                              {idx + 1}
                            </span>
                            <span className="truncate font-extrabold truncate max-w-[80px]">{entry.displayName}</span>
                            {isSelf && (
                              <span className="bg-cyan-500/20 text-cyan-600 font-black text-[7px] px-1 rounded shrink-0">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-extrabold text-cyan-600">{entry.score} pts</span>
                            <p className="text-[7px] text-[#718096] font-bold mt-0.5">CP {entry.combatPower}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/10 bg-red-500/10 px-3.5 py-2 text-xs font-bold text-red-500">
                {error}
              </div>
            )}
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-3xl border-4 border-white/70 bg-[#e1e8f0] shadow-[inset_6px_6px_14px_rgba(163,177,198,0.65),_inset_-6px_-6px_14px_rgba(255,255,255,0.8)] bg-[radial-gradient(#d1d9e6_1px,transparent_1px)] [background-size:16px_16px]">
            {activeChallengeOpponent && snapshot && snapshot.phase !== 'finished' && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 neu-card bg-[#eef2f7] text-[#4a5568] border border-white/60 px-6 py-2.5 rounded-2xl animate-bounce font-black text-sm whitespace-nowrap">
                <span className="text-[#FF4D8D] truncate max-w-[90px]">{displayName}</span>
                <span className="text-[9px] text-[#718096] bg-[#e1e8f0] px-1.5 py-0.5 rounded">CP {personalCP}</span>
                <span className="text-yellow-400 italic font-black">VS</span>
                <span className="text-[#5e7fa8] truncate max-w-[90px]">{activeChallengeOpponent.displayName}</span>
                <span className="text-[9px] text-[#718096] bg-[#e1e8f0] px-1.5 py-0.5 rounded">CP {activeChallengeOpponent.combatPower}</span>
              </div>
            )}

            {snapshot ? (
              <BattleStateField state={snapshot} language={language} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[#718096] font-bold text-sm leading-relaxed">
                {roomSubMode === 'multiplayer' ? tx(
                  language,
                  'Create or join a room, select bots, mark every player ready, then start the server-authoritative match.',
                  '请先申请建立或加入空域协议，装配席位模组及战术，全员标记就绪以启动对局仿真战斗。'
                ) : tx(
                  language,
                  'Select a pilot from the challenge list on the left and click CHALLENGE to initiate the tactical ranked simulation!',
                  '请从左侧空域挑擂列表中选择对手，点击挑战按钮以在模拟舱中拉起战术排位仿真战斗！'
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-[24px] neu-card border border-white/60 bg-[#eef2f7] p-5 flex flex-col gap-4">
            <div className="rounded-2xl neu-flat border border-white/40 bg-[#eef2f7] p-3.5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#2d3748]">
                    {tx(language, 'Module Loadout', '模组装配')}
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-[#718096]">
                    {tx(language, 'Pick levels. Cost equals level. Max 12 points.', '选择等级，等级即消耗，最多 12 点。')}
                  </p>
                </div>
                <div className={`rounded-xl px-3 py-2 text-right font-black shadow-inner ${loadoutOverLimit ? 'bg-red-500/10 text-red-500' : 'bg-[#e1e8f0] text-[#5e7fa8]'}`}>
                  <p className="text-[9px] uppercase tracking-wider">{tx(language, 'Points', '点数')}</p>
                  <p className="text-lg leading-none">{loadoutPoints}/{MODULE_POINT_LIMIT}</p>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={applyRandomLoadout}
                  className="neu-btn rounded-lg px-2 py-1.5 text-[10px] font-black text-[#4a5568] active:scale-95"
                >
                  {tx(language, 'Random', '随机')}
                </button>
                {MODULE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyModulePreset(preset.modules)}
                    className="neu-btn rounded-lg px-2 py-1.5 text-[10px] font-black text-[#4a5568] active:scale-95"
                  >
                    {tx(language, preset.en, preset.zh)}
                  </button>
                ))}
              </div>

              <div className="grid gap-2">
                {MODULE_CATALOG.map((module) => {
                  const currentLevel = selectedModules[module.name] ?? 0;
                  return (
                    <div key={module.name} className="rounded-xl border border-white/30 bg-[#eef2f7] p-2.5 neu-flat">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-7 w-8 shrink-0 items-center justify-center rounded-lg border border-white/50 bg-[#e1e8f0] text-[10px] font-black text-[#5e7fa8] shadow-inner">
                          {module.short}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black text-[#2d3748]">
                            {tx(language, module.name, module.zh)}
                          </p>
                          <p className="mt-0.5 text-[10px] font-bold leading-relaxed text-[#718096]">
                            {tx(language, module.descEn, module.descZh)}
                          </p>
                          <p className="mt-1 text-[9px] font-bold leading-relaxed text-[#5e7fa8]">
                            {tx(language, module.hintEn, module.hintZh)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {[0, 1, 2, 3].map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => {
                              setSelectedModules((prev) => ({ ...prev, [module.name]: level }));
                              setError(null);
                            }}
                            className={`rounded-lg border px-2 py-1.5 text-[10px] font-black transition-all active:scale-95 ${
                              currentLevel === level
                                ? 'border-white/70 bg-[#dbe7f4] text-[#2d3748] shadow-inner'
                                : 'border-white/40 bg-[#eef2f7] text-[#718096]'
                            }`}
                          >
                            {level === 0 ? tx(language, 'Off', '关闭') : `Lv${level}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {loadoutOverLimit && (
                <p className="mt-3 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-2 text-[11px] font-bold text-red-400">
                  {tx(language, 'Over limit. Lower module levels before readying.', '已超过 12 点上限，请降低模组等级后再标记就绪。')}
                </p>
              )}
            </div>

            {/* AI Command Briefing & Strategy Import */}
            <div className="border-t border-white/30 pt-3 flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-[#718096]">
                {tx(language, 'AI Strategy Integration', 'AI 战术协议对接')}
              </div>

              {/* Neumorphic Tab Toggle */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#e1e8f0] shadow-inner mb-1.5">
                <button
                  type="button"
                  onClick={() => setImportTab('manual')}
                  className={`py-1.5 text-[10px] font-black rounded-lg transition-all ${
                    importTab === 'manual'
                      ? 'bg-[#eef2f7] text-[#4a5568] shadow-sm'
                      : 'text-[#718096] hover:text-[#4a5568]'
                  }`}
                >
                  {tx(language, 'Manual LLM Import', '手动对接 (LLM)')}
                </button>
                <button
                  type="button"
                  onClick={() => setImportTab('agent')}
                  className={`py-1.5 text-[10px] font-black rounded-lg transition-all ${
                    importTab === 'agent'
                      ? 'bg-[#eef2f7] text-[#4a5568] shadow-sm'
                      : 'text-[#718096] hover:text-[#4a5568]'
                  }`}
                >
                  {tx(language, 'Autonomous Agent', '智能代理 (Agent)')}
                </button>
              </div>

              {importTab === 'manual' ? (
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => setShowPromptModal(true)}
                    className="w-full rounded-xl neu-btn border border-white/20 py-2.5 px-3 text-xs font-bold text-[#4a5568] transition-colors disabled:opacity-40 disabled:pointer-events-none active:scale-98 flex items-center justify-center gap-1.5"
                  >
                    <Bot size={14} />
                    {tx(language, 'Generate AI Prompt', '1. 生成战术提示词 (Prompt)')}
                  </button>

                  <div className="rounded-xl border border-white/30 bg-[#eef2f7] p-2.5 neu-flat">
                    <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-[#718096]">
                      {tx(language, 'Briefing URL', 'Briefing 简报链接')}
                    </p>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <code className="truncate rounded-lg bg-[#e1e8f0] px-2 py-1.5 text-[10px] font-black text-[#5e7fa8] shadow-inner" title={briefingUrl}>
                        {briefingUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(briefingUrl);
                          setError(tx(language, 'Briefing URL copied.', 'Briefing 简报链接已复制。'));
                        }}
                        className="neu-btn rounded-lg px-2 text-[10px] font-black text-[#4a5568] active:scale-95"
                      >
                        {tx(language, 'Copy', '复制')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          applySystemStrategy('auto');
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      className="neu-btn rounded-xl px-3 py-2 text-[11px] font-black text-[#4a5568] active:scale-95"
                    >
                      {tx(language, 'System Strategy', '系统策略')}
                    </button>
                    <button
                      type="button"
                      onClick={startQuickPlay}
                      className="neu-btn-primary rounded-xl px-3 py-2 text-[11px] font-black active:scale-95"
                    >
                      {tx(language, 'Quick Play', '小白快速')}
                    </button>
                  </div>

                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#718096]">
                    {tx(language, '2. Paste Strategy Import URL', '2. 粘贴外部 AI 战术导入链接')}
                    <input
                      placeholder="https://astra-gambit.com/import?..."
                      value={importUrl}
                      onChange={(event) => {
                        const url = event.target.value;
                        setImportUrl(url);
                        if (url.includes('import?')) {
                          try {
                            applyStrategyImportUrl(url);
                          } catch {
                            setError(tx(language, 'Malformed Import URL.', '无效的战术导入链接。'));
                          }
                        } else if (!url.trim()) {
                          setParsedPolicy(null);
                        }
                      }}
                      className="mt-1 w-full rounded-lg neu-input px-2.5 py-1.5 text-xs"
                    />
                  </label>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 text-xs">
                  {/* Gateway Key Card */}
                  <div className="rounded-xl border border-white/30 bg-[#eef2f7] p-2.5 neu-flat">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#718096]">
                        {tx(language, 'Agent Gateway Key', 'Agent 接入密钥 (Gateway Key)')}
                      </span>
                      {(() => {
                        const isLinked = ownParticipant?.agentConnected ?? false;
                        return isLinked ? (
                          <span className="flex items-center gap-1 text-[8px] font-extrabold text-[#48bb78] bg-[#48bb78]/10 px-1.5 py-0.5 rounded border border-[#48bb78]/25 shadow-sm animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#48bb78]" />
                            {tx(language, 'CONNECTED', '连接成功')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[8px] font-extrabold text-[#d69e2e] bg-[#d69e2e]/10 px-1.5 py-0.5 rounded border border-[#d69e2e]/25 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#d69e2e]" />
                            {tx(language, 'WAITING...', '等待对接')}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <code className="text-[10px] font-black text-[#5e7fa8] select-all bg-black/5 px-2 py-0.5 rounded truncate max-w-[200px]" title={`${getBackendUrl()}/api/agent/strategy?key=ASTRA-GATEWAY-${room?.code || 'LOBBY'}-${playerId.slice(0, 6).toUpperCase()}`}>
                        {`${getBackendUrl()}/api/agent/strategy?key=ASTRA-GATEWAY-${room?.code || 'LOBBY'}-${playerId.slice(0, 6).toUpperCase()}`}
                      </code>
                      <button
                        onClick={() => {
                          const key = `ASTRA-GATEWAY-${room?.code || 'LOBBY'}-${playerId.slice(0, 6).toUpperCase()}`;
                          const urlKey = `${getBackendUrl()}/api/agent/strategy?key=${key}`;
                          navigator.clipboard.writeText(urlKey);
                          alert(tx(language, 'Gateway URL Key copied!', 'Agent 接入 URL 密钥已成功复制到剪贴板！'));
                        }}
                        className="text-[9px] font-black text-cyan-600 hover:text-cyan-500 transition-colors bg-white/40 px-2 py-1 rounded border border-white/60 shadow-sm active:scale-95 shrink-0"
                      >
                        {tx(language, 'Copy', '复制')}
                      </button>
                    </div>
                  </div>

                  {/* Active Endpoint Info */}
                  <div className="text-[9px] font-bold text-[#718096] bg-[#e1e8f0] p-2 rounded-lg leading-relaxed shadow-inner">
                    <p className="font-extrabold text-[#4a5568]">{tx(language, 'Active HTTP Push Endpoint:', 'Agent 接收主动推送端口:')}</p>
                    <code className="block select-all font-mono text-[8px] bg-white/50 px-1 py-0.5 rounded mt-0.5 text-indigo-600 overflow-x-auto">
                      {`POST ${getBackendUrl()}/api/agent/strategy`}
                    </code>
                    <p className="mt-1">{tx(language, 'Send JSON with your Gateway Key and compiled strategy URL.', '通过 POST 发送包含密钥与编译后战术 URL 的 JSON 载荷即可连接。')}</p>
                  </div>

                  {/* Pull API Hotlink Input */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-[#718096] uppercase tracking-wider">
                      {tx(language, 'Or Pull strategy from local Agent API', '或从本地 Agent API 路径热联拉取')}
                    </span>
                    <div className="grid grid-cols-[1fr_auto] gap-1.5">
                      <input
                        placeholder="http://127.0.0.1:8000/strategy"
                        value={agentUrl}
                        onChange={(e) => setAgentUrl(e.target.value)}
                        className="w-full rounded-lg neu-input px-2 py-1 text-[11px]"
                      />
                      <button
                        onClick={async () => {
                          if (!agentUrl.trim()) return;
                          setAgentStatus('linking');
                          try {
                            const key = `ASTRA-GATEWAY-${room?.code || 'LOBBY'}-${playerId.slice(0, 6).toUpperCase()}`;
                            const response = await fetch(agentUrl, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'X-Agent-Gateway-Key': key,
                              },
                              body: JSON.stringify({ key, roomCode: room?.code, playerId })
                            }).catch(() => {
                              return fetch(`${agentUrl}?key=${encodeURIComponent(key)}`);
                            });

                            if (!response.ok) throw new Error('API returned non-200');
                            const resData = await response.json();
                            const strategyUrl = resData.strategyUrl || resData.url || (typeof resData === 'string' ? resData : '');
                            
                            if (strategyUrl && strategyUrl.includes('import?')) {
                              applyStrategyImportUrl(strategyUrl);
                              setAgentStatus('success');
                            } else {
                              throw new Error('No strategy URL found in response');
                            }
                          } catch (err) {
                            console.error(err);
                            setAgentStatus('error');
                            setError(tx(language, 'Failed to fetch strategy from Agent. Check console or CORS.', '无法从 Agent API 拉取战术。请检查服务运行或跨域。'));
                          }
                        }}
                        disabled={agentStatus === 'linking'}
                        className="neu-btn px-2 text-[10px] font-black text-cyan-600 hover:text-cyan-500 rounded-lg active:scale-95 disabled:opacity-40"
                      >
                        {agentStatus === 'linking' ? tx(language, 'Fetching...', '获取中...') : tx(language, 'Link & Fetch', '连接并抓取')}
                      </button>
                    </div>
                  </div>

                  {/* Mock Simulate Button */}
                  <button
                    onClick={() => {
                      const mockTarget = ['lowest_hp', 'highest_threat', 'nearest'][Math.floor(Math.random() * 3)];
                      const mockFormation = ['aggressive', 'balanced', 'conservative'][Math.floor(Math.random() * 3)];
                      const mockUrl = `https://astra-gambit.com/import?t=${room?.code || 'LOCAL'}&v=1&target=${mockTarget}&avoid=none&betray=never&skill=${mockFormation}&survive=survival_first&promise=honor`;
                      
                      applyStrategyImportUrl(mockUrl);
                      setAgentStatus('success');
                      alert(tx(language, 'Successfully simulated Agent push event!', '智能 Agent 密钥匹配，已成功连接并推送最新战术配置！'));
                    }}
                    className="w-full border border-dashed border-[#6d8bb0]/40 text-[#6d8bb0] rounded-xl py-1.5 px-3 text-[10px] font-black bg-[#6d8bb0]/5 hover:bg-[#6d8bb0]/10 transition-all active:scale-95"
                  >
                    {tx(language, '🧪 Simulate Agent Push Connection', '🧪 模拟 Agent 主动推送连接')}
                  </button>
                </div>
              )}

              {parsedPolicy && (
                <div className="mt-1 rounded-xl border border-white/25 bg-[#eef2f7] p-2.5 text-[10px] font-bold text-[#4a5568] neu-inset">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-black text-[#5e7fa8] text-[10px]">
                      {tx(language, 'Tactical Protocol Parsed:', 'AI 战术协议解析成功:')}
                    </p>
                    <span className="bg-green-500/10 text-green-600 font-extrabold text-[8px] px-1.5 py-0.5 rounded border border-green-500/20">
                      {tx(language, 'ACTIVE', '生效中')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[#718096] uppercase text-[9px]">
                    <p>{tx(language, 'Target: ', '集火策略: ')}<span className="text-[#4a5568]">{parsedPolicy.targetPriority}</span></p>
                    <p>{tx(language, 'Form: ', '编队构型: ')}<span className="text-[#4a5568]">{parsedPolicy.formation}</span></p>
                    <p>{tx(language, 'Dodge: ', '机动闪避: ')}<span className="text-[#4a5568]">{parsedPolicy.dodgeStyle}</span></p>
                    <p>{tx(language, 'Aggro: ', '激进系数: ')}<span className="text-[#4a5568]">{Math.round(parsedPolicy.aggression * 100)}%</span></p>
                    <p>{tx(language, 'Retreat: ', '规避系数: ')}<span className="text-[#4a5568]">{Math.round(parsedPolicy.retreatBias * 100)}%</span></p>
                    <p>{tx(language, 'Bias: ', '侧摆倾角: ')}<span className="text-[#4a5568]">{Math.round(parsedPolicy.dodgeBias * 100)}%</span></p>
                  </div>
                </div>
              )}

              {strategyImportSummary && (
                <div className="rounded-xl border border-white/30 bg-[#eef2f7] p-3 text-[10px] font-bold text-[#4a5568] neu-inset">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#5e7fa8]">
                      {tx(language, 'Pre-Battle Gambit', '战前博弈自动动作')}
                    </p>
                    <span className="rounded bg-[#e1e8f0] px-1.5 py-0.5 text-[8px] font-black text-[#5e7fa8]">
                      {strategyImportSummary.title}
                    </span>
                  </div>
                  <div className="grid gap-1 leading-relaxed">
                    <p>{tx(language, 'Declaration: ', '公开宣言: ')}<span className="text-[#718096]">{strategyImportSummary.declaration}</span></p>
                    <p>{tx(language, 'Cipher: ', '秘密密信: ')}<span className="text-[#718096]">{strategyImportSummary.cipherMessage}</span></p>
                    <p>{tx(language, 'Verification: ', '验证动作: ')}<span className="text-[#718096]">{strategyImportSummary.verification}</span></p>
                    <p>{tx(language, 'Vote: ', '投票倾向: ')}<span className="text-[#718096]">{strategyImportSummary.vote}</span></p>
                  </div>
                </div>
              )}
            </div>

            {/* Sync Bot & Loadout button hidden as synchronization is now fully automatic */}

            <button
              onClick={toggleReady}
              disabled={!room || room.phase !== 'lobby' || loadoutOverLimit}
              className={`mb-1 w-full rounded-xl py-3 font-black text-sm active:scale-95 disabled:opacity-45 disabled:pointer-events-none transition-all ${
                ownParticipant?.ready ? 'neu-btn-primary' : 'neu-btn text-[#4a5568]'
              }`}
            >
              {ownParticipant?.ready ? tx(language, 'Cancel Ready', '取消就绪') : tx(language, 'Ready', '标记就绪')}
            </button>

            <button
              onClick={startOnlineMatch}
              disabled={!canStart || loadoutOverLimit}
              className="mb-2 w-full rounded-xl neu-btn-primary py-3.5 font-black text-sm active:scale-95 disabled:opacity-45 disabled:pointer-events-none transition-all"
            >
              {tx(language, 'Start Match', '启动协议仿真战斗')}
            </button>

            <div>
              <div className="mb-2.5 text-[10px] font-black uppercase tracking-wider text-[#718096]">
                {tx(language, 'Participants', '当前席位成员')}
              </div>
              <div className="grid gap-2">
                {(room?.participants ?? []).map((participant) => (
                  <div key={participant.playerId} className="rounded-xl border border-white/20 bg-[#eef2f7] p-3 neu-flat text-[#4a5568]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-black text-[#2d3748] flex items-center gap-1.5">
                        {participant.displayName}
                        {participant.playerId.startsWith('system-') && (
                          <span className="rounded bg-[#e1e8f0] px-1.5 py-0.5 text-[8px] font-black text-[#5e7fa8]">
                            {tx(language, 'SYS', '系统')}
                          </span>
                        )}
                        {participant.agentConnected && (
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500 shadow-[0_0_4px_rgba(72,187,120,0.5)] animate-pulse" title={tx(language, 'Agent Connected', '智能代理已连接')} />
                        )}
                      </span>
                      <span className={`text-[10px] font-bold uppercase ${participant.ready ? 'text-[#48bb78]' : 'text-[#718096]'}`}>
                        {participant.ready ? tx(language, 'READY', '已就绪') : tx(language, 'WAIT', '等待中')}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-[#718096]">
                      {participant.isHost ? tx(language, 'Host', '主控舱 (Host)') : tx(language, 'Guest', '副舱 (Guest)')} · <span className="text-[#4a5568] font-bold">{participant.bot?.label ?? tx(language, 'No bot selected', '未同步策略 AI')}</span>
                    </p>
                    {participant.bot?.modules && participant.bot.modules.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {participant.bot.modules.map((module) => (
                          <span key={module} className="rounded border border-white/40 bg-[#e1e8f0] px-1.5 py-0.5 text-[9px] font-black text-[#5e7fa8]">
                            {module.replace('-Lv', ' Lv')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {roomReport && (
              <div className="rounded-xl border border-white/20 bg-[#eef2f7] p-4 neu-inset text-xs font-bold text-[#4a5568]">
                <div className="mb-2 flex items-center gap-2 text-yellow-600 font-black">
                  <Crown size={18} />
                  <span>{tx(language, 'Server Report', '空域评判报告')}</span>
                </div>
                <p>
                  {tx(language, 'Outcome: ', '仿真局势: ')}
                  <span className="text-[#5e7fa8] uppercase">{roomReport.outcome}</span> · {tx(language, 'Winner: ', '优胜席位: ')}
                  <span className="text-[#5e7fa8]">{roomReport.summary?.winnerName ?? tx(language, 'Draw', '平局')}</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPromptModal && (
        <div className="fixed inset-0 bg-slate-200/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="neu-card p-6 w-full max-w-lg border border-white/60 bg-[#eef2f7] flex flex-col max-h-[85vh] text-[#4a5568]">
            <h3 className="text-xl font-black text-[#2d3748] mb-3">
              {tx(language, 'AI Briefing Prompt', 'AI 战术规划指令')}
            </h3>
            <p className="text-xs text-[#718096] mb-3">
              {tx(
                language,
                'Copy the complete prompt below and send it to an external LLM to formulate your combat strategy:',
                '请完整复制下方自动格式化的战术指令提示词，并粘贴给外部大语言模型（如 Gemini、Kimi），让其为您规划本场对局的 AI 战斗脚本：'
              )}
            </p>
            
            <textarea
              readOnly
              value={briefingPrompt}
              className="flex-1 w-full rounded-2xl neu-input p-4 text-xs text-[#4a5568] font-mono outline-none resize-none overflow-y-auto mb-4 min-h-[220px]"
            />
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(briefingPrompt);
                  alert(tx(language, 'Command Prompt copied to clipboard!', '战术规划指令已成功复制到剪贴板！'));
                }}
                className="flex-1 neu-btn-primary py-3 px-4 font-black rounded-xl text-sm transition-all active:scale-95"
              >
                {tx(language, 'Copy Prompt', '复制指令提示词')}
              </button>
              <button
                onClick={() => setShowPromptModal(false)}
                className="bg-gray-600 hover:bg-gray-500 text-white py-2.5 px-6 rounded-xl text-sm font-bold transition-all"
              >
                {tx(language, 'Close', '关闭')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOutcomeModal && activeChallengeOpponent && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#eef2f7] border-4 border-white rounded-[32px] p-8 w-80 text-center shadow-[10px_10px_20px_var(--neu-shadow),_-10px_-10px_20px_var(--neu-light)] relative">
            {challengerOutcome === 'win' ? (
              <>
                <div className="w-20 h-20 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-green-500/30 animate-pulse">
                  <Trophy size={44} />
                </div>
                <h3 className="text-3xl font-black text-green-600 tracking-wide mb-1 uppercase">
                  {tx(language, 'VICTORY!', '对局胜利!')}
                </h3>
                <p className="text-[#718096] text-xs font-bold uppercase tracking-wider mb-6">
                  {tx(language, 'Rank Promoted', '协议排位升阶')}
                </p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-red-500/30 animate-pulse">
                  <RotateCcw size={44} />
                </div>
                <h3 className="text-3xl font-black text-red-600 tracking-wide mb-1 uppercase">
                  {tx(language, 'DEFEAT', '对局失败')}
                </h3>
                <p className="text-[#718096] text-xs font-bold uppercase tracking-wider mb-6">
                  {tx(language, 'Rank Maintained', '协议排位未变')}
                </p>
              </>
            )}

            <div className="bg-[#e1e8f0] rounded-2xl p-4 mb-6 shadow-inner border border-white/40">
              <p className="text-[10px] font-black text-[#718096] uppercase tracking-wider mb-2">
                {tx(language, 'ELO RATING CHANGES', '天梯协议分变动')}
              </p>
              <div className="flex flex-col gap-2 font-bold text-sm text-[#4a5568]">
                <div className="flex justify-between items-center">
                  <span>{displayName} (YOU):</span>
                  <span className={challengerOutcome === 'win' ? 'text-green-600 font-extrabold' : 'text-red-500 font-extrabold'}>
                    {challengerOutcome === 'win' ? `+25 pts` : `-15 pts`}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-[#718096]">
                  <span>{activeChallengeOpponent.displayName}:</span>
                  <span className={challengerOutcome === 'win' ? 'text-red-500' : 'text-green-600'}>
                    {challengerOutcome === 'win' ? `-15 pts` : `+10 pts`}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowOutcomeModal(false);
                setSnapshot(null);
                setActiveChallengeOpponent(null);
                sendRoomMessage({
                  v: 1,
                  type: 'ladder.get',
                  payload: {
                    playerId: ensurePlayerId(),
                  },
                });
              }}
              className="w-full neu-btn-primary font-black py-3 rounded-2xl text-sm transition-all active:scale-95 shadow-md"
            >
              {tx(language, 'CONFIRM & EXIT', '确认并回舱')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BattleStateField({ state, language }: { state: BattleState; language: AppLanguage }) {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-4 top-4 z-10 rounded-xl neu-flat px-3 py-2 text-xs font-bold text-[#4a5568] border border-white/40 bg-[#eef2f7]">
        {tx(language, 'T+', '时长 T+')}{formatBattleTime(state.time)} · {tx(language, 'Tick', '周期')}{state.tick} · <span className="uppercase text-[#5e7fa8]">{tx(language, state.phase, state.phase === 'finished' ? '已结束' : '协议仿真中')}</span>
      </div>

      {state.collectibles.map((item) => (
        <div
          key={item.id}
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 shadow-[2px_2px_4px_rgba(0,0,0,0.15)]"
          style={{
            left: `${(item.pos.x / state.arena.width) * 100}%`,
            top: `${(item.pos.y / state.arena.height) * 100}%`,
            backgroundColor:
              item.kind === 'repair' ? '#48bb78' : item.kind === 'shield' ? '#3182ce' : item.kind === 'rage' ? '#e53e3e' : '#dd6b20',
          }}
        />
      ))}

      {state.projectiles.map((projectile) => (
        <div
          key={projectile.id}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4a5568] border border-white/50 shadow-[1px_1px_3px_rgba(0,0,0,0.1)]"
          style={{
            left: `${(projectile.pos.x / state.arena.width) * 100}%`,
            top: `${(projectile.pos.y / state.arena.height) * 100}%`,
          }}
        />
      ))}

      {state.fighters.map((fighter) => (
        <div
          key={fighter.id}
          className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${fighter.eliminated ? 'opacity-35 grayscale' : ''} ${fighter.ghostActive ? 'opacity-30' : ''}`}
          style={{
            left: `${(fighter.pos.x / state.arena.width) * 100}%`,
            top: `${(fighter.pos.y / state.arena.height) * 100}%`,
          }}
        >
          {/* Capsules module list */}
          {renderFighterModules(fighter.modules)}

          {/* Stealth Indicator */}
          {fighter.ghostActive && (
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-black bg-indigo-600/90 text-white px-1.5 py-0.5 rounded shadow border border-indigo-400/30 animate-pulse whitespace-nowrap z-20">
              {tx(language, 'STEALTH', '隐身')}
            </span>
          )}

          {/* Wing Swarm - Auxiliary Wingmen */}
          {(() => {
            const hasWingSwarm = fighter.modules?.some(m => m.toLowerCase().includes('wing swarm'));
            if (!hasWingSwarm || fighter.eliminated) return null;
            return (
              <>
                <div className="absolute -left-6 bottom-[-4px] opacity-85 scale-50 pointer-events-none transition-all duration-300">
                  <img
                    src="/images/player_jet.png"
                    alt="wingman"
                    className="w-10 h-10 object-contain"
                    style={{
                      filter: `${getFighterFilter(fighter.color)} drop-shadow(0 0 2px ${fighter.color})`,
                    }}
                  />
                </div>
                <div className="absolute -right-6 bottom-[-4px] opacity-85 scale-50 pointer-events-none transition-all duration-300">
                  <img
                    src="/images/player_jet.png"
                    alt="wingman"
                    className="w-10 h-10 object-contain"
                    style={{
                      filter: `${getFighterFilter(fighter.color)} drop-shadow(0 0 2px ${fighter.color})`,
                    }}
                  />
                </div>
              </>
            );
          })()}

          {/* Phantom Echo - Holographic twins */}
          {(() => {
            const hasPhantomEcho = fighter.modules?.some(m => m.toLowerCase().includes('phantom echo'));
            if (!hasPhantomEcho || fighter.eliminated) return null;
            return (
              <>
                <div className="absolute -left-5 top-1 opacity-20 scale-75 pointer-events-none transition-all duration-300">
                  <img
                    src="/images/player_jet.png"
                    alt="phantom"
                    className="w-10 h-10 object-contain"
                    style={{
                      filter: `${getFighterFilter(fighter.color)} opacity(0.5) drop-shadow(0 0 4px ${fighter.color})`,
                    }}
                  />
                </div>
                <div className="absolute -right-5 top-1 opacity-20 scale-75 pointer-events-none transition-all duration-300">
                  <img
                    src="/images/player_jet.png"
                    alt="phantom"
                    className="w-10 h-10 object-contain"
                    style={{
                      filter: `${getFighterFilter(fighter.color)} opacity(0.5) drop-shadow(0 0 4px ${fighter.color})`,
                    }}
                  />
                </div>
              </>
            );
          })()}

          <div
            className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-[#eef2f7] neu-flat transition-transform"
            style={{ borderColor: fighter.color }}
          >
            <img
              src="/images/player_jet.png"
              alt={fighter.name}
              className="w-10 h-10 object-contain transition-transform"
              style={{
                filter: getFighterFilter(fighter.color),
              }}
            />
            {fighter.shield > 0 && <div className="absolute inset-[-5px] rounded-full border-2 border-[#6d8bb0] animate-pulse" />}
          </div>
          <div className="mt-1.5 h-2 w-14 overflow-hidden rounded-full bg-[#d1d9e6] p-0.5 neu-inset">
            <div
              className="h-full rounded-full bg-[#48bb78]"
              style={{ width: `${Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100))}%` }}
            />
          </div>
          <p className="mt-1 w-20 -translate-x-3 truncate text-center text-[10px] font-bold" style={{ color: fighter.color }}>
            {fighter.name}
          </p>
        </div>
      ))}
    </div>
  );
}

// Animated menu background component
function MenuBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      // Base Neumorphic background color
      ctx.fillStyle = '#eef2f7';
      ctx.fillRect(0, 0, w, h);

      // Draw soft white organic radial blob (top-left) - mimics soft light source
      const radial1 = ctx.createRadialGradient(w * 0.2, h * 0.1, 10, w * 0.2, h * 0.1, Math.min(w, h) * 0.7);
      radial1.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      radial1.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = radial1;
      ctx.fillRect(0, 0, w, h);

      // Draw soft gray-blue organic blob (bottom-right) - mimics soft physical ambient shadows
      const radial2 = ctx.createRadialGradient(w * 0.8, h * 0.9, 20, w * 0.8, h * 0.9, Math.min(w, h) * 0.6);
      radial2.addColorStop(0, 'rgba(209, 217, 230, 0.55)');
      radial2.addColorStop(1, 'rgba(209, 217, 230, 0)');
      ctx.fillStyle = radial2;
      ctx.fillRect(0, 0, w, h);

      // Draw beautiful, organic fluid waves at the bottom
      ctx.save();
      const time = Date.now() * 0.0003;
      
      // Wave 1: Soft grayish-blue wave
      ctx.fillStyle = 'rgba(109, 139, 176, 0.05)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 10) {
        const y = h - 140 + Math.sin(x * 0.003 + time) * 35 + Math.cos(x * 0.0015 - time * 0.5) * 15;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      // Wave 2: Soft white wave (highlight)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 10) {
        const y = h - 90 + Math.cos(x * 0.0025 + time * 1.2) * 25 + Math.sin(x * 0.001 - time * 0.8) * 20;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
    />
  );
}
