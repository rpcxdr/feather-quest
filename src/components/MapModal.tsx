import React, { useRef, useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Compass, Trophy, Layers, Play } from 'lucide-react';
import { flightPath, LEVEL_LENGTH, LATERAL_OFFSET } from '../game/pathGenerator';
import { flightPathHistory, RecordedFlightPath, getEnteredStartTiles } from '../game/flightPathHistory';
import { TerrainMapCanvas } from './TerrainMapCanvas';

interface MapModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentScore?: number;
  currentDistance?: number;
  currentStartLevel?: number;
  currentStartCol?: number;
  onSelectStartLevel?: (level: number, col: number) => void;
}

// Visually distinct aesthetic color palette for flight paths
const FLIGHT_COLORS = [
  { stroke: '#38bdf8', glow: '#0284c7', bg: 'bg-sky-500', text: 'text-sky-300', name: 'Sky' },
  { stroke: '#fbbf24', glow: '#d97706', bg: 'bg-amber-400', text: 'text-amber-300', name: 'Amber' },
  { stroke: '#34d399', glow: '#059669', bg: 'bg-emerald-400', text: 'text-emerald-300', name: 'Emerald' },
  { stroke: '#c084fc', glow: '#7c3aed', bg: 'bg-purple-400', text: 'text-purple-300', name: 'Violet' },
  { stroke: '#fb7185', glow: '#e11d48', bg: 'bg-rose-400', text: 'text-rose-300', name: 'Rose' },
  { stroke: '#fb923c', glow: '#ea580c', bg: 'bg-orange-400', text: 'text-orange-300', name: 'Coral' },
  { stroke: '#2dd4bf', glow: '#0d9488', bg: 'bg-teal-400', text: 'text-teal-300', name: 'Teal' },
  { stroke: '#f472b6', glow: '#db2777', bg: 'bg-pink-400', text: 'text-pink-300', name: 'Pink' },
];

export const MapModal: React.FC<MapModalProps> = ({
  isOpen,
  onClose,
  currentScore = 0,
  currentDistance = 0,
  currentStartLevel = 0,
  currentStartCol = 2,
  onSelectStartLevel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const flightListRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(360);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null);

  // Subscribe to flight history updates
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    return flightPathHistory.subscribe(() => {
      setHistoryVersion((v) => v + 1);
    });
  }, []);

  // Measure container width
  useEffect(() => {
    if (!isOpen) return;

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [isOpen]);

  // Saved flights from history (always genuine recorded flights in chronological order)
  const allDisplayFlights = useMemo(() => {
    return flightPathHistory.getAllFlightPaths();
  }, [historyVersion]);

  // (1) By default, highlight your most recent flight when opening or when flights change
  useEffect(() => {
    if (isOpen && allDisplayFlights.length > 0) {
      const mostRecent = allDisplayFlights[allDisplayFlights.length - 1];
      setSelectedFlightId(mostRecent.id);
    }
  }, [isOpen, historyVersion, allDisplayFlights.length]);

  // Best flight (highest distance)
  const bestFlightId = useMemo(() => {
    if (allDisplayFlights.length === 0) return null;
    let best = allDisplayFlights[0];
    for (const f of allDisplayFlights) {
      if (f.distance > best.distance) {
        best = f;
      }
    }
    return best.id;
  }, [allDisplayFlights]);

  // Determine levels list across all flights - always show at least 6 levels (Level 0 through 5)
  const levelsData = useMemo(() => {
    let highestLevel = 0;
    for (const f of allDisplayFlights) {
      highestLevel = Math.max(highestLevel, f.maxLevel);
    }
    const startLvl = currentStartLevel ?? 0;
    const maxLevel = Math.max(5, highestLevel, startLvl);

    const levels: number[] = [];
    for (let l = 0; l <= maxLevel; l++) {
      levels.push(l);
    }
    return { levels, maxLevel };
  }, [allDisplayFlights, currentStartLevel]);

  const { levels } = levelsData;

  // Level grid sizing: exactly 6 squares wide, square cells (levelUnitSize x levelUnitSize)
  const levelUnitSize = containerWidth > 0 ? containerWidth / 6 : 60;
  const totalLevelsCount = levels.length;
  const totalContentHeight = totalLevelsCount * levelUnitSize;

  // (2) When opening the modal, scroll so that current "Start" tile is centered; best effort
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      const scrollEl = scrollRef.current;
      const scrollToCenter = () => {
        const targetLvl = currentStartLevel ?? 0;
        const clientH = scrollEl.clientHeight;
        const tileCenterY = 20 + totalContentHeight - (targetLvl + 0.5) * levelUnitSize;
        const targetScroll = tileCenterY - clientH / 2;
        scrollEl.scrollTop = Math.max(0, targetScroll);
      };
      scrollToCenter();
      const raf = requestAnimationFrame(scrollToCenter);
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, totalContentHeight, currentStartLevel, levelUnitSize]);

  // Auto scroll the horizontal list of flights to the right (the most recent flight)
  useEffect(() => {
    if (isOpen && flightListRef.current) {
      const listEl = flightListRef.current;
      const scrollList = () => {
        listEl.scrollLeft = listEl.scrollWidth;
      };
      scrollList();
      const raf = requestAnimationFrame(scrollList);
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, allDisplayFlights.length]);

  // Scroll map vertically so that the beginning of the flight is vertically centered
  const scrollToFlightStart = (flight: RecordedFlightPath) => {
    if (!scrollRef.current) return;
    const startLvl =
      flight.startLevel ??
      (flight.startDistance ? Math.floor(flight.startDistance / LEVEL_LENGTH) : 0);
    const scrollEl = scrollRef.current;
    const clientH = scrollEl.clientHeight;
    const tileCenterY = 20 + totalContentHeight - (startLvl + 0.5) * levelUnitSize;
    const targetScroll = Math.max(0, tileCenterY - clientH / 2);
    scrollEl.scrollTo({ top: targetScroll, behavior: 'smooth' });
  };

  const handleFlightClick = (flight: RecordedFlightPath) => {
    setSelectedFlightId(flight.id);
    scrollToFlightStart(flight);
  };

  // Set of tiles whose start has been entered by the player during a flight
  const enteredStartTiles = useMemo(() => {
    return getEnteredStartTiles(allDisplayFlights);
  }, [allDisplayFlights]);

  // Handle clicking a square in the grid
  const handleSelectSquare = (lvl: number, col: number) => {
    const tileKey = `${lvl}-${col}`;
    if (!enteredStartTiles.has(tileKey)) {
      return;
    }
    if (onSelectStartLevel) {
      onSelectStartLevel(lvl, col);
    }
    onClose();
  };

  // Continuous 3D In-Game Spline Projection onto the 2D Level Grid:
  // - Rescales the deterministic 3D flight spline coordinates onto each level grid square.
  // - Anchors exactly to the corners:
  //   - Level 0: starts at center bottom of start square (gx = 3), ends at center top (gx = 3).
  //   - Level >= 1: starts in bottom corner (gx * levelUnitSize), ends in opposite top corner (nextGx * levelUnitSize).
  //     - LEFT: starts at bottom-right corner (gx), ends at top-left corner (gx - 1).
  //     - RIGHT: starts at bottom-left corner (gx), ends at top-right corner (gx + 1).
  // - Within each level, faithfully projects the in-game continuous trajectory:
  //   - Smooth Hermite ease-out turn right at the decision point
  //   - Mid-level rhythmic slalom wiggles
  //   - Smooth Hermite ease-in alignment into the next decision point
  const flightPathsData = useMemo(() => {
    if (containerWidth <= 0) return [];

    return allDisplayFlights.map((flight, idx) => {
      const color = FLIGHT_COLORS[idx % FLIGHT_COLORS.length];
      const isBest = flight.id === bestFlightId;
      const isActive = flight.id === 'active-live-flight';
      const points: { x: number; y: number }[] = [];

      const flightStartLvl = flight.startLevel ?? 0;
      const flightStartCol = flight.startCol ?? 2;
      const flightStartDist = flight.startDistance ?? (flightStartLvl * LEVEL_LENGTH);
      const totalDist = flightStartDist + Math.max(1, flight.distance);

      const mapCol = flightStartCol + 1;
      const isStartEven = (flightStartLvl + mapCol) % 2 === 0;
      const expectedStartBranch: 'LEFT' | 'RIGHT' = isStartEven ? 'LEFT' : 'RIGHT';
      const expectedStartX = isStartEven
        ? (2 - flightStartCol) * LATERAL_OFFSET
        : (3 - flightStartCol) * LATERAL_OFFSET;
      const sX = flightStartLvl === 0 ? 0 : (flight.startX ?? expectedStartX);

      // Determine initial horizontal grid line index gx (0..6)
      // Level 0 starts along the center grid line (gx = 3, separating Column 2 and 3).
      let gx = 3;
      if (flightStartLvl > 0) {
        // Checkerboard rule for levels >= 1:
        // Even: travels lower right to upper left ('LEFT') -> start is bottom-right gx = col + 1
        // Odd: travels lower left to upper right ('RIGHT') -> start is bottom-left gx = col
        gx = expectedStartBranch === 'LEFT' ? Math.min(6, flightStartCol + 1) : Math.max(0, flightStartCol);
      }

      // Initial start point of the flight
      const initialY = totalContentHeight - flightStartLvl * levelUnitSize;
      const initialX = gx * levelUnitSize;
      points.push({ x: initialX, y: initialY });

      const maxFlightLvl = Math.max(flightStartLvl, Math.floor(totalDist / LEVEL_LENGTH));
      const branchHistory: Record<number, 'LEFT' | 'RIGHT'> = { ...(flight.branches || {}) };

      for (let lvl = flightStartLvl; lvl <= maxFlightLvl; lvl++) {
        const lvlStartDist = lvl * LEVEL_LENGTH;
        const lvlEndDist = (lvl + 1) * LEVEL_LENGTH;

        if (totalDist <= lvlStartDist) break;

        const mapColAtLvl = flightStartCol + 1;
        const isLvlEven = (lvl + mapColAtLvl) % 2 === 0;
        const fallbackBranch: 'LEFT' | 'RIGHT' = isLvlEven ? 'LEFT' : 'RIGHT';

        let branch: 'SINGLE' | 'LEFT' | 'RIGHT' =
          lvl === 0
            ? 'SINGLE'
            : flightStartLvl > 0 && lvl === flightStartLvl
            ? expectedStartBranch
            : flight.branches?.[lvl] ||
              flightPath.chosenBranches.get(lvl) ||
              fallbackBranch;

        // Boundary constraint: if at gx <= 0 (3 tiles left), force turn back toward the middle ('RIGHT')
        // if at gx >= 6 (3 tiles right), force turn back toward the middle ('LEFT')
        if (lvl > 0 && !(flightStartLvl > 0 && lvl === flightStartLvl)) {
          if (gx <= 0) {
            branch = 'RIGHT';
          } else if (gx >= 6) {
            branch = 'LEFT';
          }
        }

        if (branch !== 'SINGLE') {
          branchHistory[lvl] = branch;
        }

        // Target grid line index at the end of this level
        let nextGx = gx;
        if (lvl > 0) {
          if (branch === 'LEFT') {
            nextGx = Math.max(0, Math.min(6, gx - 1));
          } else {
            nextGx = Math.max(0, Math.min(6, gx + 1));
          }
        }

        const startX3D = flightPath.getLevelStartX(lvl, branchHistory, flightStartLvl, sX);
        const currentStartX2D = gx * levelUnitSize;

        const subDistLimit = Math.min(lvlEndDist, totalDist);
        const step = 6.25; // 40 segments per 250m level for silky smooth spline curves

        // Sample along this level at regular distance intervals to project the continuous 3D spline
        for (let z = lvlStartDist + step; z < subDistLimit; z += step) {
          const x3D = flightPath.getLateralX(z, branch, branchHistory, flightStartLvl, sX);
          const offset3D = x3D - startX3D;
          const x = currentStartX2D - (offset3D / LATERAL_OFFSET) * levelUnitSize;
          const y = totalContentHeight - (z / LEVEL_LENGTH) * levelUnitSize;
          points.push({ x, y });
        }

        // Add the end of this level or the exact crash/endpoint
        const finalZ = subDistLimit;
        const finalX3D = flightPath.getLateralX(finalZ, branch, branchHistory, flightStartLvl, sX);
        const finalOffset3D = finalX3D - startX3D;
        const finalX = currentStartX2D - (finalOffset3D / LATERAL_OFFSET) * levelUnitSize;
        const finalY = totalContentHeight - (finalZ / LEVEL_LENGTH) * levelUnitSize;
        points.push({ x: finalX, y: finalY });

        if (totalDist >= lvlEndDist) {
          gx = nextGx;
        }
      }

      const polylineStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const startPt = points[0] || { x: initialX, y: initialY };
      const endPt = points[points.length - 1] || { x: initialX, y: initialY };

      return {
        flight,
        color,
        isBest,
        isActive,
        polyline: polylineStr,
        startPoint: startPt,
        endPoint: endPt,
      };
    });
  }, [allDisplayFlights, containerWidth, totalContentHeight, bestFlightId, levelUnitSize]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="map-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md animate-fade-in select-none pointer-events-auto"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div
        id="map-modal-dialog"
        className="relative w-full max-w-xl h-[88vh] max-h-[740px] rounded-3xl bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 border border-amber-400/30 shadow-[0_20px_60px_rgba(0,0,0,0.85),0_0_40px_rgba(245,158,11,0.15)] flex flex-col overflow-hidden text-slate-100 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* (6) & (7) Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-slate-900/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-amber-400/20 border border-amber-400/40 flex items-center justify-center shadow-[0_0_12px_rgba(251,191,36,0.3)]">
              <Compass className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wide text-white font-fantastical uppercase flex items-center gap-2">
                Flight Map
              </h2>
              <p className="text-xs text-amber-300/90 font-medium">
                Click unlocked areas to fly there
              </p>
            </div>
          </div>

          <button
            id="btn-close-map-modal"
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all cursor-pointer"
            aria-label="Close Map"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Flight Path Selector Toolbar */}
        {allDisplayFlights.length > 0 && (
          <div
            ref={flightListRef}
            className="px-4 py-2 bg-slate-950/70 border-b border-white/5 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0 text-xs"
          >
            <button
              type="button"
              onClick={() => setSelectedFlightId(null)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer border ${
                selectedFlightId === null
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.4)]'
                  : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>All Paths ({allDisplayFlights.length})</span>
            </button>

            {allDisplayFlights.map((f, idx) => {
              const isSelected = selectedFlightId === f.id;
              const isBest = f.id === bestFlightId;
              const color = FLIGHT_COLORS[idx % FLIGHT_COLORS.length];

              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleFlightClick(f)}
                  onMouseEnter={() => setHoveredFlightId(f.id)}
                  onMouseLeave={() => setHoveredFlightId(null)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer border ${
                    isSelected
                      ? 'bg-slate-800 text-white border-amber-400 shadow-md ring-1 ring-amber-400/50'
                      : 'bg-slate-900/80 text-slate-400 border-white/10 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color.stroke }}
                  />
                  <span>Flight #{f.flightNumber}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {f.distance}m
                  </span>
                  {isBest && (
                    <Trophy className="w-3 h-3 text-amber-400 inline shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Scrollable Map Container */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col items-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black scroll-smooth"
        >
          <div
            ref={containerRef}
            className="relative w-full max-w-md mx-auto"
            style={{ height: `${Math.max(340, totalContentHeight + 20)}px` }}
          >
            {/* Topographic & Biome Voxel Terrain Background Canvas */}
            <div
              className="absolute inset-x-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
              style={{ height: `${totalContentHeight}px`, top: 20 }}
            >
              <TerrainMapCanvas
                width={containerWidth}
                height={totalContentHeight}
                totalLevels={totalLevelsCount}
                levelUnitSize={levelUnitSize}
              />
            </div>

            {/* Level grid with special case for Level 0 start square */}
            <div
              className="absolute inset-0"
              style={{ height: `${totalContentHeight}px`, top: 20 }}
            >
              {levels.map((lvl) => {
                const rowTop = totalContentHeight - (lvl + 1) * levelUnitSize;

                // Special case for the start square:
                // Offset it to the right by 1/2 square so that the start and end of the very first level
                // align with the center bottom and center top of the square.
                if (lvl === 0) {
                  const isStartSelected = currentStartLevel === 0;

                  return (
                    <div
                      key={`level-row-${lvl}`}
                      className="absolute left-0 right-0 flex items-center"
                      style={{
                        top: `${rowTop}px`,
                        height: `${levelUnitSize}px`,
                      }}
                    >
                      {/* Start square offset to the right by 1/2 square (starts at 2.5 * levelUnitSize) */}
                      <button
                        key="cell-0-start"
                        id="grid-cell-0-start"
                        type="button"
                        onClick={() => handleSelectSquare(0, 2)}
                        style={{
                          left: `${2.5 * levelUnitSize}px`,
                          width: `${levelUnitSize}px`,
                          height: `${levelUnitSize}px`,
                        }}
                        className={`absolute group transition-all duration-150 flex items-center justify-center p-1 select-none overflow-hidden ${
                          isStartSelected
                            ? 'bg-amber-500/35 border-2 border-amber-400 ring-2 ring-inset ring-amber-400/90 shadow-[0_0_15px_rgba(251,191,36,0.35)] z-20 cursor-pointer'
                            : 'hover:bg-amber-400/20 active:bg-amber-500/30 backdrop-blur-[0.5px] cursor-pointer hover:z-20'
                        }`}
                        title="Click to fly from Level 0 (0m)"
                      >
                        {/* Center status badge */}
                        {isStartSelected ? (
                          <div className="flex flex-col items-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] z-20">
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
                            <span className="text-[8px] font-black tracking-wider text-amber-300 uppercase mt-0.5">
                              START
                            </span>
                          </div>
                        ) : (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center scale-90 group-hover:scale-100 duration-150 drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] z-20">
                            <Play className="w-8 h-8 text-amber-300 fill-amber-300" />
                          </div>
                        )}
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={`level-row-${lvl}`}
                    className="absolute left-0 right-0 flex items-center"
                    style={{
                      top: `${rowTop}px`,
                      height: `${levelUnitSize}px`,
                    }}
                  >
                    {/* 6 Interactive Clickable Square Grid Cells */}
                    <div className="absolute inset-0 grid grid-cols-6">
                      {[0, 1, 2, 3, 4, 5].map((col) => {
                        const tileKey = `${lvl}-${col}`;
                        const isEntered = enteredStartTiles.has(tileKey);
                        const isStartSelected =
                          currentStartLevel === lvl && currentStartCol === col;

                        return (
                          <button
                            key={`cell-${lvl}-${col}`}
                            id={`grid-cell-${lvl}-${col}`}
                            type="button"
                            disabled={!isEntered}
                            onClick={() => handleSelectSquare(lvl, col)}
                            className={`relative group transition-all duration-150 flex items-center justify-center p-1 select-none overflow-hidden ${
                              isStartSelected
                                ? 'bg-amber-500/35 border-2 border-amber-400 ring-2 ring-inset ring-amber-400/90 shadow-[0_0_15px_rgba(251,191,36,0.35)] z-20 cursor-pointer'
                                : isEntered
                                ? 'hover:bg-amber-400/20 active:bg-amber-500/30 backdrop-blur-[0.5px] cursor-pointer hover:z-20'
                                : 'opacity-40 bg-slate-950/70 cursor-default'
                            }`}
                            title={
                              isEntered
                                ? `Level ${lvl}, Column ${col + 1}`
                                : `Locked: Fly past the decision point leading to Level ${lvl}, Column ${col + 1} to unlock starting here.`
                            }
                          >
                            {/* Center status badge */}
                            {isStartSelected ? (
                              <div className="flex flex-col items-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] z-20">
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
                                <span className="text-[8px] font-black tracking-wider text-amber-300 uppercase mt-0.5">
                                  START
                                </span>
                              </div>
                            ) : isEntered ? (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center scale-90 group-hover:scale-100 duration-150 drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] z-20">
                                <Play className="w-8 h-8 text-amber-300 fill-amber-300" />
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* SVG Layer with All Flight Paths - pointer-events-none so grid clicks work effortlessly */}
            <svg
              className="absolute inset-x-0 pointer-events-none z-10"
              style={{
                top: 20,
                height: `${totalContentHeight}px`,
                width: '100%',
                overflow: 'visible',
              }}
            >
              <defs>
                {/* Glowing Filter */}
                <filter id="flight-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* All Flight Paths */}
              {flightPathsData.map(({ flight, color, polyline, isBest }) => {
                const isSelected = selectedFlightId === flight.id;
                const isHovered = hoveredFlightId === flight.id;
                const isDimmed =
                  (selectedFlightId !== null && !isSelected) ||
                  (hoveredFlightId !== null && !isHovered && selectedFlightId === null);

                const strokeColor = color.stroke;
                const strokeWidth = isSelected || isHovered ? 4.5 : 2.8;
                const opacity = isDimmed ? 0.22 : 0.95;

                return (
                  <g
                    key={`path-group-${flight.id}`}
                    className="transition-opacity duration-200 cursor-pointer"
                    onClick={() => handleFlightClick(flight)}
                    onMouseEnter={() => setHoveredFlightId(flight.id)}
                    onMouseLeave={() => setHoveredFlightId(null)}
                  >
                    {/* Glowing Underlay */}
                    <polyline
                      points={polyline}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth + 4}
                      strokeOpacity={isDimmed ? 0.08 : 0.28}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Main Sharp Flight Trajectory Line */}
                    <polyline
                      points={polyline}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeOpacity={opacity}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter={isSelected || isHovered || isBest ? 'url(#flight-glow)' : undefined}
                    />
                  </g>
                );
              })}

              {/* Endpoint Markers where each flight finished/crashed */}
              {flightPathsData.map(({ flight, color, endPoint, startPoint, isBest, isActive }) => {
                const isSelected = selectedFlightId === flight.id;
                const isHovered = hoveredFlightId === flight.id;
                const isDimmed =
                  (selectedFlightId !== null && !isSelected) ||
                  (hoveredFlightId !== null && !isHovered && selectedFlightId === null);

                const r = isSelected || isHovered ? 6.5 : isBest ? 5.5 : 4;

                return (
                  <g
                    key={`marker-${flight.id}`}
                    className="transition-all cursor-pointer"
                    onClick={() => handleFlightClick(flight)}
                    onMouseEnter={() => setHoveredFlightId(flight.id)}
                    onMouseLeave={() => setHoveredFlightId(null)}
                  >
                    {/* Start dot if custom start */}
                    {flight.startDistance && flight.startDistance > 0 && (
                      <circle
                        cx={startPoint.x}
                        cy={startPoint.y}
                        r={3.5}
                        fill={color.stroke}
                        stroke="#0f172a"
                        strokeWidth="1"
                        opacity={isDimmed ? 0.3 : 0.9}
                      />
                    )}

                    {/* Outer pulse for active or best flight */}
                    {(isActive || isBest || isSelected) && (
                      <circle
                        cx={endPoint.x}
                        cy={endPoint.y}
                        r={r + 4}
                        fill={color.stroke}
                        fillOpacity={isDimmed ? 0.1 : 0.35}
                        className={isActive ? 'animate-ping' : ''}
                      />
                    )}

                    {/* Main End Marker Dot */}
                    <circle
                      cx={endPoint.x}
                      cy={endPoint.y}
                      r={r}
                      fill={color.stroke}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                      opacity={isDimmed ? 0.3 : 1.0}
                    />

                    {/* Flight Number Badge if selected or hovered */}
                    {(isSelected || isHovered) && (
                      <g transform={`translate(${endPoint.x + 8}, ${endPoint.y - 8})`}>
                        <rect
                          x="0"
                          y="-12"
                          width="72"
                          height="18"
                          rx="4"
                          fill="#090d16"
                          stroke={color.stroke}
                          strokeWidth="1"
                          fillOpacity="0.95"
                        />
                        <text
                          x="6"
                          y="1"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          #{flight.flightNumber} {flight.distance}m
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* (5) Footer Controls */}
        <div className="px-5 py-3 border-t border-white/10 bg-slate-900/90 flex items-center justify-end shrink-0">
          <button
            id="btn-map-done"
            type="button"
            onClick={onClose}
            className="px-6 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
          >
            Fly
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
