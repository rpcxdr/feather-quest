import React from 'react';
import { Play } from 'lucide-react';

export interface ClickedTilePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TilePlayIndicatorProps {
  /**
   * When true, only appears on hover of the parent .group element (used in map tile grid).
   * When false, is always visible (used in the persistent selection animation).
   */
  isHoverOnly?: boolean;
  /**
   * When true, the play button component dynamically expands in size with glowing light rays.
   */
  isExpanding?: boolean;
  className?: string;
}

/**
 * Reusable Play Button indicator panel used for:
 * 1. Desktop hover effect over unlocked map tiles in the map modal.
 * 2. Persistent touch/click selection animation that persists and expands in size on screen after map modal closes.
 */
export const TilePlayIndicator: React.FC<TilePlayIndicatorProps> = ({
  isHoverOnly = false,
  isExpanding = !isHoverOnly,
  className = '',
}) => {
  if (isHoverOnly) {
    return (
      <div
        className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center scale-90 group-hover:scale-100 duration-150 drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] z-20 pointer-events-none select-none ${className}`}
      >
        <Play className="w-8 h-8 text-amber-300 fill-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
      </div>
    );
  }

  if (isExpanding) {
    return (
      <div
        className={`relative flex items-center justify-center z-20 pointer-events-none select-none animate-play-button-expand ${className}`}
      >
        {/* Soft radial golden aura backing expanding outward */}
        <div className="absolute inset-0 -m-3 rounded-full bg-amber-400/35 blur-lg animate-play-aura-expand pointer-events-none" />

        {/* Sharp expanding play icon with high-contrast amber glow */}
        <Play className="w-10 h-10 text-amber-300 fill-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.95)]" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)] z-20 pointer-events-none select-none ${className}`}
    >
      <Play className="w-8 h-8 text-amber-300 fill-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.85)]" />
    </div>
  );
};
