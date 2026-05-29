import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { GameState, GameImages, GameScreen } from '../game/types';
import { GameEngine } from '../game/engine';
import { Renderer } from '../game/renderer';
import { LEVELS } from '../game/levels';
import { audioManager } from '../game/audio';
import { LocalBattleEngine, type BattleFighterConfig, type BattleReport, type BattleState } from '../game/battle';
import { createBotController, listBotMetadata, type BotKind, parseImportUrl, type BotPolicy, normalizeBotPolicy } from '../game/bots';
import type { ClientMessage, MatchReport, RoomInfo, ServerMessage } from '../game/multiplayer/protocol';
import { Star, Lock, Play, RotateCcw, Home as HomeIcon, Settings, ChevronLeft, Volume2, VolumeX, Trophy, Infinity as InfinityIcon, Swords, Bot, Crown, Wifi, Users } from 'lucide-react';

type AppScreen = GameScreen | 'battleArena' | 'battleRoom';

const BATTLE_ROSTER: Array<{ id: string; name: string; kind: BotKind; color: string }> = [
  { id: 'viper', name: 'Viper-01', kind: 'aggressive', color: '#FF4D8D' },
  { id: 'aegis', name: 'Aegis-07', kind: 'defensive', color: '#00F0FF' },
  { id: 'midas', name: 'Midas-03', kind: 'collector', color: '#FFCC00' },
  { id: 'oracle', name: 'Oracle-09', kind: 'llm-strategy', color: '#B28DFF' },
];

const ROOM_SERVER_URL =
  (import.meta.env.VITE_BATTLE_SERVER_URL as string | undefined) ??
  (() => {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:3001';
    return `${isHttps ? 'wss' : 'ws'}://${host}/ws`;
  })();

function createBattleFighters(): BattleFighterConfig[] {
  return BATTLE_ROSTER.map((fighter) => ({
    id: fighter.id,
    name: fighter.name,
    color: fighter.color,
    bot: createBotController(fighter.kind, { id: `${fighter.id}-${fighter.kind}` }),
  }));
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
    <div className="w-full h-screen bg-[#0A0A1A] overflow-hidden relative"
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
            <h2 className="text-3xl font-bold text-white text-center mb-6">PAUSED</h2>

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
              Continue
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
              Restart
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
              Quit
            </button>
          </div>
        </div>
      )}

      {/* Game Over overlay */}
      {screen === 'gameOver' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-red-500/30">
            <h2 className="text-4xl font-bold text-red-500 text-center mb-2">GAME OVER</h2>
            <p className="text-gray-400 text-center mb-6">Mission Failed</p>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm">Final Score</p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="flex justify-center gap-4 mt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Level</p>
                  <p className="text-lg font-bold text-cyan-400">{selectedLevel}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Kills</p>
                  <p className="text-lg font-bold text-green-400">{gameState?.totalKills || 0}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => startGame(selectedLevel)}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={20} />
              Try Again
            </button>

            <button
              onClick={() => setScreen('menu')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              Main Menu
            </button>
          </div>
        </div>
      )}

      {/* Endless Game Over overlay */}
      {screen === 'endlessGameOver' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-orange-500/30">
            <h2 className="text-3xl font-bold text-orange-400 text-center mb-2">WAVE CLEAR</h2>
            <p className="text-gray-400 text-center mb-4">Endless Mode</p>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center mb-3">
                <p className="text-gray-400 text-sm">Final Score</p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Wave</p>
                  <p className="text-lg font-bold text-red-400">{gameState?.endlessWave || 1}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Time</p>
                  <p className="text-lg font-bold text-cyan-400">{Math.floor(gameState?.gameTime || 0)}s</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Best Score</p>
                  <p className="text-lg font-bold text-yellow-400">{endlessHighScore.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Best Time</p>
                  <p className="text-lg font-bold text-green-400">{endlessBestTime}s</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Kills</p>
                  <p className="text-lg font-bold text-green-400">{gameState?.totalKills || 0}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => startEndlessGame()}
              className="w-full bg-orange-500 hover:bg-orange-400 text-black font-bold py-3 px-6 rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw size={20} />
              Try Again
            </button>

            <button
              onClick={() => setScreen('menu')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              Main Menu
            </button>
          </div>
        </div>
      )}

      {/* Level Complete overlay */}
      {screen === 'levelComplete' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-green-500/30">
            <h2 className="text-3xl font-bold text-green-400 text-center mb-2">COMPLETE!</h2>
            <p className="text-gray-400 text-center mb-4">Level {selectedLevel} Cleared</p>

            <div className="flex justify-center gap-2 mb-4">
              {renderStars(earnedStars)}
            </div>

            <div className="bg-black/40 rounded-xl p-4 mb-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm">Score</p>
                <p className="text-3xl font-bold text-white">{finalScore.toLocaleString()}</p>
              </div>
              <div className="flex justify-center gap-4 mt-3">
                <div className="text-center">
                  <p className="text-gray-400 text-xs">High Score</p>
                  <p className="text-lg font-bold text-yellow-400">{(highScores[selectedLevel] || 0).toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400 text-xs">Kills</p>
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
                Next Level
              </button>
            )}

            <button
              onClick={() => setScreen('levelSelect')}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <HomeIcon size={20} />
              Level Select
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
              <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-cyan-300 to-blue-600 mb-2"
                  style={{ textShadow: '0 0 40px rgba(0,240,255,0.5)', filter: 'drop-shadow(0 0 20px rgba(0,240,255,0.3))' }}>
                STORM BLASTER
              </h1>
              <p className="text-cyan-400/60 text-sm tracking-[0.3em] uppercase">雷电风暴</p>
            </div>

            {/* Menu buttons */}
            <button
              onClick={() => setScreen('levelSelect')}
              className="w-64 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-black font-black text-xl py-4 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all hover:scale-105 shadow-lg shadow-cyan-500/30 active:scale-95"
            >
              <Play size={24} fill="black" />
              START
            </button>

            <button
              onClick={startEndlessGame}
              className="w-64 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-black font-bold text-lg py-3 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all hover:scale-105 shadow-lg shadow-orange-500/30 active:scale-95"
            >
              <InfinityIcon size={24} />
              ENDLESS
            </button>

            <button
              onClick={startBattleArena}
              className="w-64 bg-gradient-to-r from-fuchsia-500 to-cyan-500 hover:from-fuchsia-400 hover:to-cyan-400 text-black font-bold text-lg py-3 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all hover:scale-105 shadow-lg shadow-fuchsia-500/30 active:scale-95"
            >
              <Swords size={24} />
              AI BATTLE
            </button>

            <button
              onClick={openBattleRoom}
              className="w-64 bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-400 hover:to-sky-400 text-black font-bold text-lg py-3 px-8 rounded-2xl mb-3 flex items-center justify-center gap-3 transition-all hover:scale-105 shadow-lg shadow-emerald-500/30 active:scale-95"
            >
              <Wifi size={24} />
              ONLINE ROOM
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="w-64 bg-gray-800/80 hover:bg-gray-700/80 text-white font-bold py-3 px-8 rounded-xl mb-3 flex items-center justify-center gap-3 transition-all border border-gray-600/50 active:scale-95"
            >
              <Settings size={20} />
              Settings
            </button>

            <button
              onClick={() => setScreen('levelSelect')}
              className="w-64 bg-gray-800/80 hover:bg-gray-700/80 text-white font-bold py-3 px-8 rounded-xl flex items-center justify-center gap-3 transition-all border border-gray-600/50 active:scale-95"
            >
              <Trophy size={20} />
              Level Select
            </button>

            {/* Endless stats */}
            {(endlessHighScore > 0 || endlessBestTime > 0) && (
              <div className="mt-6 bg-black/30 rounded-xl px-4 py-2 border border-orange-500/20">
                <p className="text-orange-400/70 text-xs text-center uppercase tracking-wider mb-1">Endless Best</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-yellow-400">Score: {endlessHighScore.toLocaleString()}</span>
                  <span className="text-cyan-400">Time: {endlessBestTime}s</span>
                </div>
              </div>
            )}
          </div>

          {/* Sound toggle */}
          <button
            onClick={toggleSound}
            className="absolute top-4 right-4 z-20 bg-gray-800/60 hover:bg-gray-700/60 text-white p-3 rounded-full transition-colors"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>
      )}

      {/* AI Battle Arena */}
      {screen === 'battleArena' && (
        <div className="absolute inset-0 flex flex-col z-10 text-white">
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
                className="bg-gray-800/80 hover:bg-gray-700/80 text-white p-2 rounded-lg transition-colors"
                aria-label="Back to menu"
              >
                <ChevronLeft size={24} />
              </button>

              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-300 to-cyan-300 truncate">
                  AI BATTLE ARENA
                </h2>
                <p className="text-xs text-cyan-300/70 uppercase tracking-[0.16em]">
                  {battleState?.phase === 'finished' ? 'Match Complete' : 'Local Simulation'}
                </p>
              </div>

              <button
                onClick={startBattleArena}
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
              >
                <RotateCcw size={18} />
                Restart
              </button>
            </div>

            <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,1fr)_360px]">
              <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-cyan-500/30 bg-[#080817]/90 shadow-lg shadow-cyan-950/40">
                <div className="absolute left-4 top-4 z-10 rounded bg-black/55 px-3 py-2 text-xs text-cyan-200 border border-cyan-500/20">
                  T+{formatBattleTime(battleState?.time ?? 0)} · Tick {battleState?.tick ?? 0}
                </div>

                {battleState ? (
                  <div className="absolute inset-0">
                    <div className="absolute inset-0 opacity-60"
                         style={{
                           backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(0,240,255,0.16), transparent 25%), radial-gradient(circle at 70% 65%, rgba(255,77,141,0.14), transparent 28%)',
                         }}
                    />

                    {battleState.collectibles.map((item) => (
                      <div
                        key={item.id}
                        className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded border border-white/40 shadow-lg"
                        style={{
                          left: `${(item.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(item.pos.y / battleState.arena.height) * 100}%`,
                          backgroundColor: item.kind === 'repair' ? '#00FF66' : item.kind === 'shield' ? '#00F0FF' : item.kind === 'rage' ? '#FF4D8D' : '#FFCC00',
                        }}
                      />
                    ))}

                    {battleState.projectiles.map((projectile) => (
                      <div
                        key={projectile.id}
                        className="absolute h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
                        style={{
                          left: `${(projectile.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(projectile.pos.y / battleState.arena.height) * 100}%`,
                        }}
                      />
                    ))}

                    {battleState.fighters.map((fighter) => (
                      <div
                        key={fighter.id}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 transition-transform ${fighter.eliminated ? 'opacity-35 grayscale' : ''}`}
                        style={{
                          left: `${(fighter.pos.x / battleState.arena.width) * 100}%`,
                          top: `${(fighter.pos.y / battleState.arena.height) * 100}%`,
                        }}
                      >
                        <div
                          className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-black/70 shadow-lg"
                          style={{ borderColor: fighter.color, boxShadow: `0 0 22px ${fighter.color}80` }}
                        >
                          <Bot size={24} style={{ color: fighter.color }} />
                          {fighter.shield > 0 && (
                            <div className="absolute inset-[-5px] rounded-full border border-cyan-300/70" />
                          )}
                        </div>
                        <div className="mt-1 h-1.5 w-14 overflow-hidden rounded bg-black/70">
                          <div
                            className="h-full rounded bg-green-400"
                            style={{ width: `${Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100))}%` }}
                          />
                        </div>
                        <p className="mt-1 w-20 -translate-x-3 truncate text-center text-[11px] font-bold" style={{ color: fighter.color }}>
                          {fighter.name}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-cyan-200">
                    Preparing arena...
                  </div>
                )}
              </div>

              <div className="min-h-0 overflow-y-auto rounded-lg border border-fuchsia-500/25 bg-[#111122]/90 p-4">
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-fuchsia-200">
                    <Swords size={16} />
                    Fighters
                  </div>
                  <div className="grid gap-2">
                    {BATTLE_ROSTER.map((fighter) => {
                      const meta = botMetadata.find((item) => item.kind === fighter.kind);
                      return (
                        <div key={fighter.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-bold" style={{ color: fighter.color }}>{fighter.name}</span>
                            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">{meta?.displayName ?? fighter.kind}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-300">
                            <span>ATK {meta?.offense ?? 0}</span>
                            <span>DEF {meta?.defense ?? 0}</span>
                            <span>COL {meta?.collect ?? 0}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-cyan-200">
                    <Trophy size={16} />
                    Live Board
                  </div>
                  <div className="grid gap-2">
                    {liveBattleStats.map((stats, index) => (
                      <div key={stats.fighterId} className="rounded-lg border border-white/10 bg-black/25 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-gray-400">#{index + 1}</span>
                            <span className="truncate font-bold" style={{ color: stats.color }}>{stats.name}</span>
                          </div>
                          <span className="text-yellow-300">{stats.score}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-gray-300">
                          <span>K {stats.kills}</span>
                          <span>D {stats.deaths}</span>
                          <span>HP {Math.ceil(stats.hp)}</span>
                          <span>L {stats.lives}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {battleReport && (
                  <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-yellow-200">
                      <Crown size={18} />
                      <span className="font-black">Winner: {battleReport.winnerName ?? 'Draw'}</span>
                    </div>
                    <div className="grid gap-2 text-sm">
                      {battleReport.rankings.map((entry) => (
                        <div key={entry.fighterId} className="flex items-center justify-between gap-3 text-gray-100">
                          <span className="min-w-0 truncate">#{entry.rank} {entry.name}</span>
                          <span className="shrink-0 text-yellow-300">{entry.score} pts</span>
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
        />
      )}

      {/* Level Select */}
      {screen === 'levelSelect' && (
        <div className="absolute inset-0 flex flex-col z-10">
          <MenuBackground />

          <div className="relative z-10 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center px-4 py-4">
              <button
                onClick={() => setScreen('menu')}
                className="bg-gray-800/80 hover:bg-gray-700/80 text-white p-2 rounded-xl transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
              <h2 className="text-2xl font-bold text-white ml-4">Select Level</h2>
            </div>

            {/* Level Grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                {LEVELS.map((level) => {
                  const isUnlocked = unlockedLevels.includes(level.id);
                  const stars = levelStars[level.id] || 0;
                  const highScore = highScores[level.id] || 0;

                  return (
                    <button
                      key={level.id}
                      onClick={() => isUnlocked && startGame(level.id)}
                      disabled={!isUnlocked}
                      className={`relative rounded-2xl p-4 border transition-all ${
                        isUnlocked
                          ? 'bg-[#1A1A2E]/90 border-cyan-500/30 hover:border-cyan-400/60 hover:bg-[#1A1A2E] active:scale-95'
                          : 'bg-gray-900/50 border-gray-700/30 opacity-60'
                      }`}
                    >
                      {!isUnlocked && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <Lock size={32} className="text-gray-500" />
                        </div>
                      )}

                      <div className={`${!isUnlocked ? 'opacity-30' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-black text-cyan-400">{level.id}</span>
                          {level.bossLevel && (
                            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">BOSS</span>
                          )}
                        </div>

                        <p className="text-white font-bold text-sm text-left mb-1">{level.name}</p>
                        <p className="text-gray-400 text-xs text-left mb-2">{level.description}</p>

                        {isUnlocked && (
                          <>
                            <div className="flex gap-1 mb-1">
                              {renderStars(stars)}
                            </div>
                            {highScore > 0 && (
                              <p className="text-gray-500 text-xs text-left">Best: {highScore.toLocaleString()}</p>
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
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-30">
          <div className="bg-[#1A1A2E]/95 rounded-2xl p-8 w-80 border border-cyan-500/30">
            <h2 className="text-2xl font-bold text-white text-center mb-6">Settings</h2>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-white">Sound</span>
                <button
                  onClick={toggleSound}
                  className={`p-2 rounded-xl transition-colors ${soundEnabled ? 'bg-cyan-500 text-black' : 'bg-gray-600 text-gray-400'}`}
                >
                  {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-gray-400 text-sm mb-3">Progress</p>
              <button
                onClick={() => {
                  if (confirm('Reset all progress? This cannot be undone.')) {
                    setUnlockedLevels([1]);
                    setLevelStars({});
                    setHighScores({});
                    localStorage.removeItem('storm_blaster_unlocked');
                    localStorage.removeItem('storm_blaster_stars');
                    localStorage.removeItem('storm_blaster_scores');
                  }
                }}
                className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold py-2 px-4 rounded-xl transition-colors border border-red-500/30"
              >
                Reset Progress
              </button>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              Close
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
}: {
  botMetadata: ReturnType<typeof listBotMetadata>;
  onBack: () => void;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef('');
  const [displayName, setDisplayName] = useState('Pilot');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotKind>('aggressive');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [snapshot, setSnapshot] = useState<BattleState | null>(null);
  const [roomReport, setRoomReport] = useState<MatchReport<BattleReport> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState('');

  const [selectedModules, setSelectedModules] = useState<Record<string, number>>({
    'Wing Swarm': 0,
    'Missile Storm': 0,
    'Overload Lance': 0,
    'Phantom Echo': 0,
    'Ghost Veil': 0,
    'Blackout Pulse': 0,
    'Aegis Layer': 0,
    'Vector Drive': 0,
    'Repair Nanites': 0,
  });
  const [importUrl, setImportUrl] = useState('');
  const [parsedPolicy, setParsedPolicy] = useState<BotPolicy | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);

  const ownParticipant = room?.participants.find((participant) => participant.playerId === playerId);
  const canStart = room?.role === 'host' && room.players >= 2 && room.participants.every((participant) => participant.ready && participant.bot !== null);

  const ensurePlayerId = useCallback(() => {
    if (!playerIdRef.current) {
      playerIdRef.current = globalThis.crypto?.randomUUID?.() ?? `player-${Date.now()}`;
      setPlayerId(playerIdRef.current);
    }
    return playerIdRef.current;
  }, []);

  const handleServerMessage = useCallback((message: ServerMessage<BattleState, BattleReport>) => {
    switch (message.type) {
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

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const createRoom = () => {
    connectAndSend((playerId) => ({
      v: 1,
      type: 'room.create',
      payload: {
        playerId,
        displayName: displayName.trim() || 'Pilot',
        maxPlayers: 4,
      },
    }));
  };

  const joinRoom = () => {
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
  };

  const selectCurrentBot = () => {
    if (!room) return;
    const meta = botMetadata.find((item) => item.kind === selectedBot);
    const modulesList = Object.entries(selectedModules)
      .filter(([, lvl]) => lvl > 0)
      .map(([name, lvl]) => `${name}-Lv${lvl}`);

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
  };

  const toggleReady = () => {
    if (!room) return;
    sendRoomMessage({
      v: 1,
      type: 'room.ready',
      payload: {
        roomId: room.roomId,
        playerId: ensurePlayerId(),
        ready: !(ownParticipant?.ready ?? false),
      },
    });
  };

  const startOnlineMatch = () => {
    if (!room) return;
    sendRoomMessage({
      v: 1,
      type: 'match.start',
      payload: {
        roomId: room.roomId,
        playerId: ensurePlayerId(),
      },
    });
  };

  const totalCost = Object.values(selectedModules).reduce((sum, lvl) => sum + (lvl > 0 ? lvl * 2 : 0), 0);

  return (
    <div className="absolute inset-0 flex flex-col z-10 text-white">
      <MenuBackground />
      <div className="relative z-10 flex h-full flex-col px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="bg-gray-800/80 hover:bg-gray-700/80 text-white p-2 rounded-lg transition-colors"
            aria-label="Back to menu"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-sky-300 truncate">
              ONLINE BATTLE ROOM
            </h2>
            <p className="text-xs text-emerald-300/70 uppercase tracking-[0.16em]">
              {connectionStatus} · {ROOM_SERVER_URL}
            </p>
          </div>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(280px,1fr)_340px]">
          <div className="min-h-0 overflow-y-auto rounded-lg border border-emerald-500/25 bg-[#111122]/90 p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-emerald-200">
              <Users size={16} />
              Room Setup
            </div>

            <label className="mb-3 block text-sm text-gray-300">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-white outline-none focus:border-emerald-400"
              />
            </label>

            <button
              onClick={createRoom}
              className="mb-3 w-full rounded-lg bg-emerald-500 px-4 py-3 font-bold text-black transition-colors hover:bg-emerald-400"
            >
              Create Room
            </button>

            <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
              <input
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-white outline-none focus:border-sky-400"
              />
              <button
                onClick={joinRoom}
                className="rounded-lg bg-sky-500 px-4 py-2 font-bold text-black transition-colors hover:bg-sky-400"
              >
                Join
              </button>
            </div>

            {room && (
              <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-gray-400">Room Code</p>
                <p className="text-3xl font-black text-emerald-300">{room.code}</p>
                <p className="mt-1 text-sm text-gray-300">
                  {room.phase} · {room.readyPlayers}/{room.players} ready
                </p>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-sky-500/25 bg-[#080817]/90">
            {snapshot ? (
              <BattleStateField state={snapshot} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sky-200">
                Create or join a room, select bots, mark every player ready, then start the server-authoritative match.
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-lg border border-sky-500/25 bg-[#111122]/90 p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-sky-200">
              <Bot size={16} />
              Bot Selection & Strategy
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              {botMetadata.map((meta) => (
                <button
                  key={meta.kind}
                  onClick={() => setSelectedBot(meta.kind)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selectedBot === meta.kind
                      ? 'border-sky-300 bg-sky-400/15'
                      : 'border-white/10 bg-black/25 hover:border-sky-400/50'
                  }`}
                >
                  <p className="font-bold text-white">{meta.displayName}</p>
                  <p className="mt-1 text-xs text-gray-400">ATK {meta.offense} · DEF {meta.defense}</p>
                </button>
              ))}
            </div>

            {/* Modules Loadout Selector */}
            <div className="mb-4 border-t border-white/10 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Modules Loadout ({totalCost}/12 pt)</span>
                <button 
                  onClick={() => setSelectedModules({
                    'Wing Swarm': 0, 'Missile Storm': 0, 'Overload Lance': 0,
                    'Phantom Echo': 0, 'Ghost Veil': 0, 'Blackout Pulse': 0,
                    'Aegis Layer': 0, 'Vector Drive': 0, 'Repair Nanites': 0
                  })}
                  className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-xs max-h-40 overflow-y-auto pr-1">
                {Object.entries(selectedModules).map(([name, lvl]) => {
                  const incrementModule = () => {
                    const nextLvl = (lvl + 1) % 4;
                    const addedCost = nextLvl === 0 ? -6 : 2;
                    if (totalCost + addedCost > 12 && nextLvl > 0) return;
                    const activeCount = Object.entries(selectedModules).filter(([k, v]) => v > 0 && k !== name).length;
                    if (activeCount >= 3 && nextLvl > 0) return;
                    setSelectedModules(prev => ({ ...prev, [name]: nextLvl }));
                  };

                  return (
                    <div key={name} className="flex items-center justify-between rounded bg-black/25 px-2 py-1 border border-white/5">
                      <span className="text-[11px] text-gray-300">{name}</span>
                      <button 
                        onClick={incrementModule}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-all ${
                          lvl === 1 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
                          lvl === 2 ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
                          lvl === 3 ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                          'bg-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {lvl === 0 ? 'Equip' : `Lv${lvl}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Command Briefing & Strategy Import */}
            <div className="mb-4 border-t border-white/10 pt-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-300">AI Command & Import</div>
              <button 
                onClick={() => setShowPromptModal(true)}
                disabled={!room}
                className="w-full mb-3 rounded bg-cyan-600/30 hover:bg-cyan-500/30 border border-cyan-500/40 py-2 px-3 text-xs font-bold text-cyan-200 transition-colors disabled:opacity-40"
              >
                Generate AI Briefing Prompt
              </button>

              <label className="block text-[11px] text-gray-300">
                Paste Strategy Import URL
                <input
                  placeholder="https://astra-gambit.com/import?..."
                  value={importUrl}
                  onChange={(event) => {
                    const url = event.target.value;
                    setImportUrl(url);
                    if (url.includes('import?')) {
                      try {
                        const policy = parseImportUrl(url);
                        setParsedPolicy(normalizeBotPolicy(policy));
                        setSelectedBot('llm-strategy');
                        setError(null);
                      } catch {
                        setError('Malformed Import URL.');
                      }
                    } else if (!url.trim()) {
                      setParsedPolicy(null);
                    }
                  }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/35 px-2 py-1 text-xs text-white outline-none focus:border-cyan-400"
                />
              </label>

              {parsedPolicy && (
                <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs">
                  <p className="font-bold text-emerald-300 text-[11px]">Strategy Parsed successfully:</p>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-gray-300">
                    <p>Target: {parsedPolicy.targetPriority}</p>
                    <p>Formation: {parsedPolicy.formation}</p>
                    <p>Dodge: {parsedPolicy.dodgeStyle}</p>
                    <p>Aggression: {Math.round(parsedPolicy.aggression * 100)}%</p>
                    <p>Retreat: {Math.round(parsedPolicy.retreatBias * 100)}%</p>
                    <p>Dodge bias: {Math.round(parsedPolicy.dodgeBias * 100)}%</p>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={selectCurrentBot}
              disabled={!room || room.phase !== 'lobby'}
              className="mb-3 w-full rounded-lg bg-sky-500 px-4 py-3 font-bold text-black transition-colors enabled:hover:bg-sky-400 disabled:opacity-45"
            >
              Select Bot & Loadout
            </button>

            <button
              onClick={toggleReady}
              disabled={!room || room.phase !== 'lobby'}
              className="mb-3 w-full rounded-lg bg-emerald-500 px-4 py-3 font-bold text-black transition-colors enabled:hover:bg-emerald-400 disabled:opacity-45"
            >
              {ownParticipant?.ready ? 'Cancel Ready' : 'Ready'}
            </button>

            <button
              onClick={startOnlineMatch}
              disabled={!canStart}
              className="mb-4 w-full rounded-lg bg-yellow-400 px-4 py-3 font-bold text-black transition-colors enabled:hover:bg-yellow-300 disabled:opacity-45"
            >
              Start Match
            </button>

            <div className="mb-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Participants</div>
              <div className="grid gap-2">
                {(room?.participants ?? []).map((participant) => (
                  <div key={participant.playerId} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-bold text-white">{participant.displayName}</span>
                      <span className={participant.ready ? 'text-emerald-300' : 'text-gray-400'}>
                        {participant.ready ? 'READY' : 'WAIT'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {participant.isHost ? 'Host' : 'Guest'} · {participant.bot?.label ?? 'No bot selected'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {roomReport && (
              <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-yellow-200">
                  <Crown size={18} />
                  <span className="font-black">Server Report</span>
                </div>
                <p className="text-sm text-gray-200">
                  Outcome: {roomReport.outcome} · Winner: {roomReport.summary?.winnerName ?? 'Draw'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPromptModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1A1A2E] rounded-2xl p-6 w-full max-w-lg border border-cyan-500/30 flex flex-col max-h-[85vh]">
            <h3 className="text-lg font-bold text-cyan-300 mb-3">AI Briefing Prompt</h3>
            <p className="text-xs text-gray-400 mb-3">将下面这段提示词完整复制并发送给外部大模型以生成策略导入链接：</p>
            
            <textarea
              readOnly
              value={`你正在为《Astra Gambit / 空域协议》生成一条策略导入链接。

你不是在驾驶战机，你只需要为该席位生成战术协议。战斗将由官方 App 的本地 BattleEngine 执行。

你的席位：${displayName}
对局票据（ticket）：${room?.code || 'TICKET'}

你的模组：
${Object.entries(selectedModules)
  .filter(([, lvl]) => lvl > 0)
  .map(([name, lvl]) => `- ${name} Lv${lvl}`)
  .join('\n') || '- 无'}

其他席位：
${room?.participants.filter(p => p.playerId !== playerId).map(p => `- ${p.displayName}`).join('\n') || '- 无'}

请根据以下枚举选择合适的策略：

target: lowest_hp, highest_threat, nearest, specific:${room?.participants.map(p => p.displayName).join(', ') || ''}
avoid: none, ${room?.participants.map(p => p.displayName).join(', ') || ''}
betray: never, final3, target_low40, power_spike  
skill: aggressive, balanced, conservative  
survive: trade, def50, survival_first  
promise: honor, opportunistic, ignore

Import URL 模板：
https://astra-gambit.com/import?t=${room?.code || 'TICKET'}&v=1&target=...&avoid=...&betray=...&skill=...&survive=...&promise=...

请只返回一条完整的 Import URL，不要解释、不要 Markdown，也不要其他文字。`}
              className="flex-1 w-full rounded border border-white/10 bg-black/45 p-3 text-xs text-cyan-100 font-mono outline-none resize-none overflow-y-auto mb-4 min-h-[220px]"
            />
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const text = `你正在为《Astra Gambit / 空域协议》生成一条策略导入链接。\n\n你不是在驾驶战机，你只需要为该席位生成战术协议。战斗将由官方 App 的本地 BattleEngine 执行。\n\n你的席位：${displayName}\n对局票据（ticket）：${room?.code || 'TICKET'}\n\n你的模组：\n${Object.entries(selectedModules).filter(([, lvl]) => lvl > 0).map(([name, lvl]) => `- ${name} Lv${lvl}`).join('\n') || '- 无'}\n\n其他席位：\n${room?.participants.filter(p => p.playerId !== playerId).map(p => `- ${p.displayName}`).join('\n') || '- 无'}\n\n请根据以下枚举选择合适的策略：\n\ntarget: lowest_hp, highest_threat, nearest, specific:${room?.participants.map(p => p.displayName).join(', ') || ''}\navoid: none, ${room?.participants.map(p => p.displayName).join(', ') || ''}\nbetray: never, final3, target_low40, power_spike  \nskill: aggressive, balanced, conservative  \nsurvive: trade, def50, survival_first  \npromise: honor, opportunistic, ignore\n\nImport URL 模板：\nhttps://astra-gambit.com/import?t=${room?.code || 'TICKET'}&v=1&target=...&avoid=...&betray=...&skill=...&survive=...&promise=...\n\n请只返回一条完整的 Import URL，不要解释、不要 Markdown，也不要其他文字。`;
                  navigator.clipboard.writeText(text);
                  alert('Command Prompt copied to clipboard!');
                }}
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black py-2.5 px-4 rounded-xl text-sm font-bold transition-all active:scale-95"
              >
                Copy Prompt
              </button>
              <button
                onClick={() => setShowPromptModal(false)}
                className="bg-gray-600 hover:bg-gray-500 text-white py-2.5 px-6 rounded-xl text-sm font-bold transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BattleStateField({ state }: { state: BattleState }) {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-4 top-4 z-10 rounded bg-black/55 px-3 py-2 text-xs text-sky-200 border border-sky-500/20">
        T+{formatBattleTime(state.time)} · Tick {state.tick} · {state.phase}
      </div>

      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(16,185,129,0.16), transparent 25%), radial-gradient(circle at 70% 65%, rgba(14,165,233,0.14), transparent 28%)',
        }}
      />

      {state.collectibles.map((item) => (
        <div
          key={item.id}
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded border border-white/40 shadow-lg"
          style={{
            left: `${(item.pos.x / state.arena.width) * 100}%`,
            top: `${(item.pos.y / state.arena.height) * 100}%`,
            backgroundColor:
              item.kind === 'repair' ? '#00FF66' : item.kind === 'shield' ? '#00F0FF' : item.kind === 'rage' ? '#FF4D8D' : '#FFCC00',
          }}
        />
      ))}

      {state.projectiles.map((projectile) => (
        <div
          key={projectile.id}
          className="absolute h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
          style={{
            left: `${(projectile.pos.x / state.arena.width) * 100}%`,
            top: `${(projectile.pos.y / state.arena.height) * 100}%`,
          }}
        />
      ))}

      {state.fighters.map((fighter) => (
        <div
          key={fighter.id}
          className={`absolute -translate-x-1/2 -translate-y-1/2 transition-transform ${fighter.eliminated ? 'opacity-35 grayscale' : ''}`}
          style={{
            left: `${(fighter.pos.x / state.arena.width) * 100}%`,
            top: `${(fighter.pos.y / state.arena.height) * 100}%`,
          }}
        >
          <div
            className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-black/70 shadow-lg"
            style={{ borderColor: fighter.color, boxShadow: `0 0 22px ${fighter.color}80` }}
          >
            <Bot size={24} style={{ color: fighter.color }} />
            {fighter.shield > 0 && <div className="absolute inset-[-5px] rounded-full border border-cyan-300/70" />}
          </div>
          <div className="mt-1 h-1.5 w-14 overflow-hidden rounded bg-black/70">
            <div
              className="h-full rounded bg-green-400"
              style={{ width: `${Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100))}%` }}
            />
          </div>
          <p className="mt-1 w-20 -translate-x-3 truncate text-center text-[11px] font-bold" style={{ color: fighter.color }}>
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
    let offset = 0;

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

      offset += 0.5;

      // Background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0A0A1A');
      grad.addColorStop(1, '#1A1020');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Stars
      const time = Date.now() * 0.001;
      for (let i = 0; i < 80; i++) {
        const x = (i * 137.5 + time * 15) % w;
        const y = (i * 73.3 + offset * (0.3 + (i % 4) * 0.2)) % (h + 10);
        const size = 1 + (i % 3);
        const alpha = 0.2 + Math.sin(time + i * 0.5) * 0.15;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nebula effects
      ctx.fillStyle = 'rgba(100, 50, 150, 0.04)';
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.4 + Math.sin(time * 0.5) * 30, w * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(50, 100, 200, 0.03)';
      ctx.beginPath();
      ctx.arc(w * 0.7, h * 0.6 + Math.cos(time * 0.3) * 20, w * 0.25, 0, Math.PI * 2);
      ctx.fill();

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
