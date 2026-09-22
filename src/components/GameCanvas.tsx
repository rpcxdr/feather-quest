import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '../game/engine';
import { GameState, GameStats } from '../types';
import { soundManager } from '../game/audio';
import { UIOverlay } from './UIOverlay';

export const GameCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>('READY');
  const [score, setScore] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.getIsMuted());

  const [stats, setStats] = useState<GameStats>({
    score: 0,
    highScore: 0,
    distance: 0,
    flapsCount: 0,
    airTime: 0,
    isNewHigh: false,
    mapTile: { tileX: 0, tileZ: 0 },
    birdPosition: { x: 0, y: 0, z: 0 },
  });

  const lastActionTimeRef = useRef<number>(0);

  const handleFlap = useCallback(() => {
    const now = performance.now();
    if (now - lastActionTimeRef.current < 60) return; // Prevent double-trigger from pointerdown + click
    lastActionTimeRef.current = now;

    if (engineRef.current) {
      engineRef.current.flap();
    }
  }, []);

  const handleRestart = useCallback(() => {
    if (!engineRef.current) return;
    // Ignore restart attempts within 0.5s of death so player can see crash and final score
    if (!engineRef.current.canRestartAfterDeath()) return;

    const now = performance.now();
    if (now - lastActionTimeRef.current < 60) return;
    lastActionTimeRef.current = now;

    engineRef.current.resetGame();
  }, []);

  const handleToggleMute = useCallback(() => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
  }, []);

  const handleResetAllRecords = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.resetAllRecords();
    }
  }, []);

  const handleSelectStartLevel = useCallback((level: number, col: number) => {
    if (engineRef.current) {
      engineRef.current.setStartLevel(level, col);
    }
  }, []);

  // Initialize GameEngine once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current, {
      onStateChange: (newState) => {
        setGameState(newState);
      },
      onScoreUpdate: (newScore) => {
        setScore(newScore);
      },
      onStatsUpdate: (newStats) => {
        setStats(newStats);
      },
    });

    engineRef.current = engine;

    // Handle Window Resize with ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      engine.handleResize();
    });
    resizeObserver.observe(containerRef.current);

    // Keyboard controls: spacebar, up arrow, or W to flap/start
    const handleKeyDown = (e: KeyboardEvent) => {
      // If options modal or map modal is open, ignore game controls
      if (document.getElementById('options-modal-dialog') || document.getElementById('map-modal-dialog')) {
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        const currentEngine = engineRef.current;
        if (!currentEngine) return;

        if (currentEngine.getState() === 'GAMEOVER') {
          if (!currentEngine.canRestartAfterDeath()) return;
          currentEngine.resetGame();
        } else {
          currentEngine.flap();
        }
      }
      if (e.code === 'KeyM') {
        const muted = soundManager.toggleMute();
        setIsMuted(muted);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Touch / Pointer handling on screen
  const handlePointerDown = (e: React.PointerEvent) => {
    // If options modal or map modal is open, ignore game controls
    if (
      document.getElementById('options-modal-dialog') ||
      document.getElementById('map-modal-dialog') ||
      document.getElementById('options-modal-overlay') ||
      document.getElementById('map-modal-backdrop')
    ) {
      return;
    }

    // Ignore clicks on header utility buttons, bottom map button, and modal
    const target = e.target as HTMLElement;
    if (
      target.closest('#btn-sound-toggle') ||
      target.closest('#btn-options-gear') ||
      target.closest('#btn-map-toggle') ||
      target.closest('#btn-map-bottom') ||
      target.closest('#map-modal-backdrop') ||
      target.closest('#map-modal-dialog') ||
      target.closest('#options-modal-overlay') ||
      target.closest('#options-modal-dialog')
    ) {
      return;
    }

    const currentEngine = engineRef.current;
    if (!currentEngine) return;

    if (currentEngine.getState() === 'GAMEOVER') {
      if (!currentEngine.canRestartAfterDeath()) return;
      handleRestart();
    } else {
      handleFlap();
    }
  };

  return (
    <div
      id="game-viewport-container"
      className="relative w-full h-full overflow-hidden bg-slate-950 select-none cursor-pointer"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
    >
      {/* 3D WebGL Canvas host */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Cinematic HUD Overlay */}
      <UIOverlay
        gameState={gameState}
        score={score}
        stats={stats}
        isMuted={isMuted}
        onFlap={handleFlap}
        onRestart={handleRestart}
        onToggleMute={handleToggleMute}
        onResetAllRecords={handleResetAllRecords}
        onSelectStartLevel={handleSelectStartLevel}
      />
    </div>
  );
};
