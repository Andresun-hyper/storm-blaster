import { useState, useRef, useEffect, useCallback } from 'react';
import type { GameState, GameImages, GameScreen } from '../game/types';
import { GameEngine } from '../game/engine';
import { Renderer } from '../game/renderer';
import { LEVELS } from '../game/levels';
import { audioManager } from '../game/audio';
import { Star, Lock, Play, RotateCcw, Home as HomeIcon, Settings, ChevronLeft, Volume2, VolumeX, Trophy, Infinity } from 'lucide-react';

export default function HomePage() {
  const [screen, setScreen] = useState<GameScreen>('menu');
  const [gameState, setGameState] = useState<GameState | null>(null);
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
  const rendererRef = useRef<Renderer | null>(null);
  const animFrameRef = useRef<number>(0);
  // Use a ref for screen to avoid stale closure in event handlers
  const screenRef = useRef<GameScreen>('menu');

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
      if (engineRef.current) engineRef.current.stop();
    };
  }, []);

  // Start game: switch screen first, let useEffect handle engine init
  const startGame = useCallback((level: number) => {
    setScreen('playing');
    setPendingLevel(level);
  }, []);

  const startEndlessGame = useCallback(() => {
    setScreen('playing');
    setPendingEndless(true);
  }, []);

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
              <Infinity size={24} />
              ENDLESS
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
