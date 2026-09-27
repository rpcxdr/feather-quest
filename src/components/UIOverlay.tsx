import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GameState, GameStats, CameraMode } from '../types';
import { CloudDissolve } from './CloudDissolve';
import { AmbientButtonClouds } from './AmbientButtonClouds';
import { MapModal } from './MapModal';
import { TatteredMapButton } from './TatteredMapButton';
import { flightPathHistory } from '../game/flightPathHistory';
import {
  Volume2,
  VolumeX,
  Trophy,
  Play,
  Feather,
  Settings,
  Trash2,
  X,
  AlertTriangle,
  Check,
  Eye,
  Video,
} from 'lucide-react';

interface UIOverlayProps {
  gameState: GameState;
  score: number;
  stats: GameStats;
  isMuted: boolean;
  cameraMode?: CameraMode;
  cameraToast?: { message: string; mode: CameraMode } | null;
  onFlap: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onToggleCameraMode?: () => void;
  onSetCameraMode?: (mode: CameraMode) => void;
  onResetAllRecords: () => void;
  onSelectStartLevel?: (level: number, col: number) => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  score,
  stats,
  isMuted,
  cameraMode = 'THIRD_PERSON',
  cameraToast,
  onFlap,
  onRestart,
  onToggleMute,
  onToggleCameraMode,
  onSetCameraMode,
  onResetAllRecords,
  onSelectStartLevel,
}) => {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Check if player has played one or more times
  const [historyCount, setHistoryCount] = useState<number>(() => {
    return flightPathHistory.getAllFlightPaths().length;
  });
  const [hasPlayedSession, setHasPlayedSession] = useState<boolean>(false);

  useEffect(() => {
    return flightPathHistory.subscribe(() => {
      setHistoryCount(flightPathHistory.getAllFlightPaths().length);
    });
  }, []);

  useEffect(() => {
    if (gameState === 'PLAYING' || gameState === 'GAMEOVER') {
      setHasPlayedSession(true);
    }
  }, [gameState]);

  const hasPlayed =
    hasPlayedSession ||
    historyCount > 0 ||
    (stats.crashCount !== undefined && stats.crashCount > 0) ||
    stats.highScore > 0;

  // Cloud dissolve state when clicking the Fly button
  const [isDissolving, setIsDissolving] = useState(false);
  const [cloudDissolveActive, setCloudDissolveActive] = useState(false);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const flyButtonRef = useRef<HTMLButtonElement>(null);
  const prevGameStateRef = useRef<GameState>(gameState);

  const handleFlyClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (isDissolving || gameState !== 'READY') return;

      if (flyButtonRef.current) {
        setButtonRect(flyButtonRef.current.getBoundingClientRect());
      }
      setIsDissolving(true);
      setCloudDissolveActive(true);
      onFlap();
    },
    [isDissolving, gameState, onFlap]
  );

  const handleCloudDissolveComplete = useCallback(() => {
    setCloudDissolveActive(false);
    setIsDissolving(false);
  }, []);

  // Sync dissolve if game starts via spacebar or background tap while in READY state
  useEffect(() => {
    if (prevGameStateRef.current === 'READY' && gameState === 'PLAYING') {
      if (!cloudDissolveActive && !isDissolving) {
        if (flyButtonRef.current) {
          setButtonRect(flyButtonRef.current.getBoundingClientRect());
        }
        setIsDissolving(true);
        setCloudDissolveActive(true);
      }
    } else if (gameState === 'READY') {
      setIsDissolving(false);
      setCloudDissolveActive(false);
    }
    prevGameStateRef.current = gameState;
  }, [gameState, cloudDissolveActive, isDissolving]);

  // Close options and map modal with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isOptionsOpen) {
          setIsOptionsOpen(false);
          setShowConfirmReset(false);
          setResetSuccess(false);
        }
        if (isMapOpen) {
          setIsMapOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOptionsOpen, isMapOpen]);

  // Benchmark high score for the active flight run
  const targetHighScoreRef = useRef<number>(stats.highScore);
  useEffect(() => {
    if (gameState === 'READY') {
      targetHighScoreRef.current = stats.highScore;
    }
  }, [gameState, stats.highScore]);

  const targetHighScore = targetHighScoreRef.current;
  const hasPassedHighScore = targetHighScore > 0 && score > targetHighScore;
  const showHighScoreMeter = gameState !== 'GAMEOVER' && targetHighScore > 0 && !hasPassedHighScore;
  const highScorePercent = targetHighScore > 0
    ? Math.min(100, Math.max(0, (score / targetHighScore) * 100))
    : 0;

  const isNewHighScore = score > 0 && (targetHighScore > 0 ? score > targetHighScore : true);

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden flex flex-col justify-between p-4 sm:p-6 font-sans">
      {/* Procedural Alpha-Blended Cumulus Cloud Dissolve Effect */}
      <CloudDissolve
        active={cloudDissolveActive}
        buttonRect={buttonRect}
        onComplete={handleCloudDissolveComplete}
      />

      {/* Camera Mode Toast Indicator */}
      {cameraToast && (
        <div className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-scale-in">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-white/20 backdrop-blur-md shadow-2xl text-xs font-semibold text-white">
            {cameraToast.mode === 'FIRST_PERSON' ? (
              <Eye className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Video className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>{cameraToast.message}</span>
            <span className="text-[10px] text-slate-400 font-mono pl-1 border-l border-white/10">Key: C</span>
          </div>
        </div>
      )}

      {/* Upper Right Control: Mute Button */}
      <div className="fixed right-4 sm:right-6 top-4 sm:top-6 z-30 pointer-events-none select-none">
        <button
          id="btn-sound-toggle"
          onClick={onToggleMute}
          className={`group relative w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center pointer-events-auto transition-all active:scale-95 cursor-pointer ${
            gameState === 'PLAYING'
              ? 'border-0 shadow-none'
              : 'border border-white/10 bg-slate-900/80 hover:bg-slate-800 text-slate-200 backdrop-blur-md shadow-lg opacity-100'
          }`}
          title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
        >
          {/* Blurred soft-edge background during gameplay at 50% translucency */}
          {gameState === 'PLAYING' && (
            <span
              className="absolute inset-0 rounded-full bg-slate-900/50 group-hover:bg-slate-900/70 blur-[3px] shadow-[0_0_8px_rgba(15,23,42,0.5)] pointer-events-none transition-all duration-200"
              aria-hidden="true"
            />
          )}
          {isMuted ? (
            <VolumeX className="relative z-10 w-4 h-4 text-rose-400" />
          ) : (
            <Volume2 className="relative z-10 w-4 h-4 text-emerald-400" />
          )}
        </button>
      </div>

      {/* High Score Progress Bar: Right-aligned all the way to the right, under the mute button and extending to the bottom of the screen */}
      {showHighScoreMeter && (
        <div
          id="meter-high-score-progress"
          className="fixed right-2 sm:right-2.5 md:right-3 top-16 sm:top-18 md:top-20 bottom-4 sm:bottom-6 md:bottom-8 z-30 pointer-events-none select-none flex flex-col justify-end items-center transition-opacity duration-500 animate-fade-in"
          aria-hidden="true"
        >
          {/* Outer Pill Track */}
          <div className="relative w-3 sm:w-3.5 md:w-4 h-full rounded-full bg-slate-950/45 backdrop-blur-md border border-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.55),inset_0_2px_6px_rgba(0,0,0,0.7)] p-0.5 overflow-hidden flex flex-col justify-end">
            {/* Inner Fill Bar from Bottom to Top */}
            <div
              className="w-full rounded-full bg-gradient-to-t from-amber-600 via-amber-400 to-yellow-200 shadow-[0_0_12px_rgba(251,191,36,0.8)] transition-[height] duration-500 ease-out relative"
              style={{
                height: `${highScorePercent}%`,
                minHeight: highScorePercent > 0 ? '6px' : '0px',
              }}
            >
              {/* Leading Top Meniscus Glow */}
              {highScorePercent > 0 && (
                <div className="absolute top-0 inset-x-0 h-1.5 rounded-full bg-white/95 shadow-[0_0_8px_#ffffff]" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Large Top-Centered Game Title with Fantastical Display Typography - Positioned below the gear and mute buttons */}
      <div
        className={`absolute top-18 sm:top-20 md:top-24 lg:top-28 inset-x-0 flex flex-col items-center justify-center pointer-events-none z-20 transition-all duration-1000 ease-out px-4 ${
          gameState === 'READY'
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 -translate-y-8 scale-95'
        }`}
      >
        <div className="relative flex flex-col items-center animate-float-airy">
          <h1 className="font-fantastical text-3xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-black tracking-wider uppercase text-white drop-shadow-[0_8px_32px_rgba(0,0,0,0.95)] select-none text-center leading-tight max-w-6xl">
            <span className="block">Feather Quest 3D</span>
            <span className="block">Tap to Flap</span>
          </h1>
        </div>
      </div>

      {/* Game Over Top Display: Score: [number of passed columns] Best: [best score] - Positioned below the mute button matching title */}
      {gameState === 'GAMEOVER' && (
        <div className="absolute top-18 sm:top-20 md:top-24 lg:top-28 inset-x-0 flex flex-col items-center justify-center pointer-events-none z-20 animate-fade-in px-4">
          <div className="font-fantastical text-3xl sm:text-5xl md:text-6xl font-black text-white score-title-shadow tracking-wider select-none text-center">
            Score: {score} &nbsp;&nbsp; Best: {stats.highScore}
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="flex items-start justify-between z-20">
        {/* Upper Left Control: Settings Gear & Camera Toggle */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {gameState === 'READY' ? (
            <>
              <button
                id="btn-options-gear"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOptionsOpen(true);
                  setShowConfirmReset(false);
                  setResetSuccess(false);
                }}
                className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 backdrop-blur-md shadow-lg transition-all active:scale-95 cursor-pointer"
                title="Game Options"
                aria-label="Game Options"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                id="btn-camera-toggle-header"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCameraMode?.();
                }}
                className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border backdrop-blur-md shadow-lg transition-all active:scale-95 cursor-pointer ${
                  cameraMode === 'FIRST_PERSON'
                    ? 'border-amber-400/60 bg-amber-500/25 text-amber-300 hover:bg-amber-500/35'
                    : 'border-white/10 bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white'
                }`}
                title={cameraMode === 'FIRST_PERSON' ? 'First Person Active (Press C to switch)' : 'Third Person Active (Press C to switch)'}
                aria-label="Toggle Camera Perspective"
              >
                {cameraMode === 'FIRST_PERSON' ? <Eye className="w-4 h-4 text-amber-300" /> : <Video className="w-4 h-4 text-slate-200" />}
              </button>
            </>
          ) : gameState === 'PLAYING' ? (
            <button
              id="btn-camera-toggle-playing"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCameraMode?.();
              }}
              className="group relative w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center pointer-events-auto transition-all active:scale-95 cursor-pointer border-0 shadow-none"
              title={cameraMode === 'FIRST_PERSON' ? 'First Person Active (Press C to switch)' : 'Third Person Active (Press C to switch)'}
              aria-label="Toggle Camera Perspective"
            >
              <span
                className="absolute inset-0 rounded-full bg-slate-900/50 group-hover:bg-slate-900/70 blur-[3px] shadow-[0_0_8px_rgba(15,23,42,0.5)] pointer-events-none transition-all duration-200"
                aria-hidden="true"
              />
              {cameraMode === 'FIRST_PERSON' ? (
                <Eye className="relative z-10 w-4 h-4 text-amber-300" />
              ) : (
                <Video className="relative z-10 w-4 h-4 text-slate-200" />
              )}
            </button>
          ) : (
            <div className="w-9 h-9" />
          )}
        </div>

        {/* Live Score */}
        {gameState === 'PLAYING' && score > 0 && (
          <div className="absolute left-1/2 -translate-x-1/2 top-4 sm:top-6 pointer-events-none flex flex-col items-center animate-fade-in z-20">
            <div className="font-fantastical text-6xl sm:text-7xl font-black text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.75)] tracking-widest select-none">
              {score}
            </div>
          </div>
        )}

        {/* Upper Right Spacer for header symmetry with Settings button */}
        <div className="w-9 h-9 pointer-events-none" />
      </header>

      {/* Center Screen: Large Single "Fly" Button or Game Over */}
      <main className={`self-center flex flex-col items-center justify-center my-auto z-20 w-full max-w-4xl pointer-events-none ${
        gameState === 'READY' && hasPlayed ? 'pb-20 sm:pb-24 md:pb-0' : ''
      }`}>
        {/* Single Very Large In-Theme "Fly" Button when in READY state */}
        {(gameState === 'READY' || isDissolving) && (
          <div className="relative flex flex-col items-center justify-center pointer-events-none">
            {/* Ambient Rotating Alpha-Blended Clouds behind the Fly Button */}
            <AmbientButtonClouds isDissolving={isDissolving} />

            {/* Ambient Pulsing Halo Glow behind the Fly Button - disappears instantly on click */}
            {!isDissolving && (
              <div
                className="absolute -inset-6 rounded-full bg-gradient-to-r from-amber-400/20 via-yellow-400/30 to-amber-500/20 blur-2xl pointer-events-none animate-halo-pulse"
              />
            )}

            {/* The Single Very Large "Fly" Button - 15% Translucent - disappears instantly on click */}
            {!isDissolving && (
              <button
                ref={flyButtonRef}
                id="btn-fly-start"
                type="button"
                onClick={handleFlyClick}
                className="pointer-events-auto cursor-pointer relative group flex items-center justify-center w-60 h-22 sm:w-72 sm:h-26 md:w-80 md:h-28 rounded-full bg-gradient-to-b from-amber-300/85 via-amber-400/85 to-amber-500/85 opacity-85 backdrop-blur-sm border-2 border-amber-100/90 shadow-[0_0_50px_rgba(251,191,36,0.65),0_14px_32px_rgba(0,0,0,0.55)] transition-transform select-none animate-float-button hover:scale-105 hover:opacity-90 hover:shadow-[0_0_70px_rgba(251,191,36,0.85),0_18px_40px_rgba(0,0,0,0.65)] hover:brightness-105 active:scale-95"
                aria-label="Fly - Start Game"
              >
                {/* Top-rim glossy reflection */}
                <div className="absolute inset-x-6 top-1.5 h-1/2 rounded-full bg-gradient-to-b from-white/45 to-transparent pointer-events-none" />

                {/* Just "Fly" in heavy, bold typography */}
                <span className="relative text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-widest text-slate-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.7)] group-hover:scale-105 transition-transform duration-150">
                  Fly
                </span>
              </button>
            )}
          </div>
        )}

        {/* Game Over Middle Display: "New", "High", "Score" on separate lines with slow gentle letter vibration & golden color wave */}
        {gameState === 'GAMEOVER' && isNewHighScore && (
          <div className="flex flex-col items-center justify-center pointer-events-none select-none px-4 animate-fade-in">
            <div className="flex flex-col items-center justify-center space-y-1 sm:space-y-2 md:space-y-3 drop-shadow-[0_8px_32px_rgba(0,0,0,0.95)]">
              {(['New', 'High', 'Score'] as const).map((word, wordIdx) => (
                <div key={word} className="flex justify-center items-center leading-[1.05] drop-shadow-[0_8px_32px_rgba(0,0,0,0.95)]">
                  {word.split('').map((char, charIdx) => {
                    const globalIdx = wordIdx * 5 + charIdx;
                    return (
                      <span
                        key={charIdx}
                        className="inline-block animate-gentle-vibrate drop-shadow-[0_8px_32px_rgba(0,0,0,0.95)]"
                        style={{
                          animationDelay: `${globalIdx * 0.22}s`,
                        }}
                      >
                        <span
                          className="inline-block golden-color-wave font-fantastical text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-widest uppercase text-center"
                          style={{
                            animationDelay: `${globalIdx * 0.35}s`,
                          }}
                        >
                          {char}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Map Button on Home Page (if player has played) */}
      {gameState === 'READY' && !isDissolving && hasPlayed && (
        <div
          id="container-map-bottom"
          className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center justify-center pointer-events-none animate-fade-in"
        >
          <TatteredMapButton
            onClick={() => setIsMapOpen(true)}
          />
        </div>
      )}

      {/* Options Modal Dialog Overlay */}
      {isOptionsOpen && typeof document !== 'undefined' && createPortal(
        <div
          id="options-modal-overlay"
          onClick={() => {
            setIsOptionsOpen(false);
            setShowConfirmReset(false);
            setResetSuccess(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto animate-fade-in"
        >
          <div
            id="options-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-slate-900/95 border border-white/15 p-5 sm:p-6 shadow-2xl backdrop-blur-2xl text-white flex flex-col gap-4 animate-scale-in pointer-events-auto"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                  <Settings className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base tracking-tight text-white">Game Options</h3>
              </div>
              <button
                id="btn-close-options"
                onClick={() => {
                  setIsOptionsOpen(false);
                  setShowConfirmReset(false);
                  setResetSuccess(false);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            {resetSuccess ? (
              <div className="py-6 flex flex-col items-center text-center gap-2 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mb-1">
                  <Check className="w-6 h-6" />
                </div>
                <p className="font-bold text-sm text-emerald-300">All Records Cleared!</p>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Scores, flight map history, crash feathers, and horizon have been reset.
                </p>
              </div>
            ) : showConfirmReset ? (
              <div className="flex flex-col gap-4 animate-fade-in">
                <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/40 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex flex-col text-left text-xs gap-1">
                    <span className="font-bold text-rose-300 text-sm">Reset All Scores and Flights?</span>
                    <span className="text-rose-200/80 leading-relaxed">
                      Are you sure you want to reset all scores and flight records? This will permanently clear your high score, flight map history, all prior crash feathers, and the record horizon landmark. This action cannot be undone.
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    id="btn-cancel-reset"
                    onClick={() => setShowConfirmReset(false)}
                    className="flex-1 py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-confirm-reset"
                    onClick={() => {
                      onResetAllRecords();
                      setHasPlayedSession(false);
                      setIsMapOpen(false);
                      setResetSuccess(true);
                      setTimeout(() => {
                        setResetSuccess(false);
                        setShowConfirmReset(false);
                        setIsOptionsOpen(false);
                      }, 1200);
                    }}
                    className="flex-1 py-2.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-rose-950/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Reset</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {/* Camera Perspective Option */}
                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-white/10 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                        {cameraMode === 'FIRST_PERSON' ? <Eye className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                      </div>
                      <span className="font-semibold text-sm text-white">Camera Perspective</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">
                      Key: C / V
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Choose between classic cinematic third-person chase or thrilling first-person flight.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-0.5">
                    <button
                      id="btn-option-third-person"
                      type="button"
                      onClick={() => onSetCameraMode?.('THIRD_PERSON')}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        cameraMode === 'THIRD_PERSON'
                          ? 'bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                          : 'bg-slate-900/80 hover:bg-slate-700/80 text-slate-300 border border-white/10'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Third Person</span>
                    </button>
                    <button
                      id="btn-option-first-person"
                      type="button"
                      onClick={() => onSetCameraMode?.('FIRST_PERSON')}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        cameraMode === 'FIRST_PERSON'
                          ? 'bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                          : 'bg-slate-900/80 hover:bg-slate-700/80 text-slate-300 border border-white/10'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>First Person</span>
                    </button>
                  </div>
                </div>

                {/* Option: Reset All Scores and Flights */}
                <button
                  id="btn-option-reset-high-score"
                  onClick={() => setShowConfirmReset(true)}
                  className="w-full text-left p-3.5 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-white/10 hover:border-rose-500/50 transition-all group cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 group-hover:bg-rose-500/30 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-white group-hover:text-rose-200 transition-colors">
                        Reset All Scores and Flights
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-rose-400 font-medium px-2.5 py-1 rounded-lg bg-rose-950/50 border border-rose-500/30 group-hover:bg-rose-900/60 transition-colors">
                    Reset
                  </span>
                </button>

                {/* Current Records Overview */}
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 text-xs text-slate-400 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5 text-amber-400" />
                      <span>Current High Score:</span>
                    </span>
                    <span className="font-bold text-white text-sm">{stats.highScore}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <Feather className="w-3.5 h-3.5 text-amber-400" />
                      <span>Prior Crash Feathers:</span>
                    </span>
                    <span className="font-bold text-amber-300">{stats.crashCount ?? 0}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Flight Path Map Modal */}
      <MapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        currentScore={score}
        currentDistance={stats.distance}
        currentStartLevel={stats.startLevel ?? 0}
        currentStartCol={stats.startCol ?? 2}
        onSelectStartLevel={onSelectStartLevel}
      />
    </div>
  );
};
