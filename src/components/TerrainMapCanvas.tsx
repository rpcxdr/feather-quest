import React, { useEffect, useRef, useMemo } from 'react';
import { flightPath, LEVEL_LENGTH } from '../game/pathGenerator';
import { biomeRegistry, Biome, WATER_LEVEL } from '../biomes';

export interface VisibleLevelRange {
  minLevel: number;
  maxLevel: number;
}

interface TerrainMapCanvasProps {
  width: number;
  height: number;
  totalLevels: number;
  levelUnitSize?: number;
  visibleRange?: VisibleLevelRange;
}

interface TerrainLevelTileProps {
  level: number;
  width: number;
  height: number;
  rowTop: number;
}

// Module-level in-memory cache so each level's rendered terrain slice is computed at most ONCE
const tileCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * Individual Virtualized Terrain Level Tile
 * Computes a lightweight 64x16 sample grid for a single 250m level slice (< 0.2ms),
 * caches the result, and renders with a graceful fade-in animation as it enters the viewport.
 */
const TerrainLevelTile: React.FC<TerrainLevelTileProps> = ({
  level,
  width,
  height,
  rowTop,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const w = Math.floor(width);
    const h = Math.floor(height);
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cacheKey = `${level}_${w}_${h}`;
    const cached = tileCanvasCache.get(cacheKey);
    if (cached) {
      ctx.drawImage(cached, 0, 0, w, h);
      return;
    }

    // Single-level offscreen sampling grid:
    // 64 horizontal samples across 300m width (~4.7m resolution)
    // 16 vertical samples for this 250m level (~15.6m resolution)
    // Total 1,024 points computed in ~0.15ms
    const gridW = 64;
    const gridH = 16;

    const offscreen = document.createElement('canvas');
    offscreen.width = gridW;
    offscreen.height = gridH;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const imgData = offCtx.createImageData(gridW, gridH);
    const data = imgData.data;

    const mountainBiome = biomeRegistry.getByChar('M');
    const mountainLowBiome = biomeRegistry.getByChar('m');
    const cloudsBiome = biomeRegistry.getByChar('s');

    const zStart = level * LEVEL_LENGTH;
    const zEnd = (level + 1) * LEVEL_LENGTH;

    for (let gy = 0; gy < gridH; gy++) {
      // gy = 0 is top of level slice (zEnd), gy = gridH - 1 is bottom of level slice (zStart)
      const normY = gy / Math.max(1, gridH - 1);
      const worldZ = zEnd - normY * (zEnd - zStart);

      for (let gx = 0; gx < gridW; gx++) {
        const normX = gx / Math.max(1, gridW - 1);
        const worldX = (0.5 - normX) * 300.0; // 300m total span (+150m to -150m)

        // Query continuous biome weights and natural terrain height
        const weights = flightPath.getBiomeWeights(worldX, worldZ);
        const elevationH = flightPath.getNaturalTerrainHeight(worldX, worldZ, weights);

        // Compute smooth blended color across biomes
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let totalWeight = 0;

        if (weights.biomeWeights) {
          for (const [biome, weightVal] of weights.biomeWeights.entries()) {
            if (weightVal > 0.001) {
              const [cr, cg, cb] = biome.getVertexColor({
                x: worldX,
                z: worldZ,
                h: elevationH,
                distToBranch: 100.0,
                blockNoise: 0,
                bx: Math.floor(worldX),
                bz: Math.floor(worldZ),
              });
              totalR += weightVal * cr;
              totalG += weightVal * cg;
              totalB += weightVal * cb;
              totalWeight += weightVal;
            }
          }
        }

        if (totalWeight > 0.001) {
          totalR /= totalWeight;
          totalG /= totalWeight;
          totalB /= totalWeight;
        } else {
          totalR = 0.35;
          totalG = 0.58;
          totalB = 0.18;
        }

        // Smooth mountain snow peaks
        const mountainWeight =
          (mountainBiome ? weights.biomeWeights?.get(mountainBiome) || 0 : 0) +
          (mountainLowBiome ? weights.biomeWeights?.get(mountainLowBiome) || 0 : 0) +
          (cloudsBiome ? weights.biomeWeights?.get(cloudsBiome) || 0 : 0);

        if (mountainWeight > 0.01 && elevationH > 18.0) {
          const snowFactor = mountainWeight * Math.min(1.0, (elevationH - 18.0) / 8.0);
          const smoothSnow = snowFactor * snowFactor * (3.0 - 2.0 * snowFactor);
          totalR = totalR * (1 - smoothSnow) + 0.94 * smoothSnow;
          totalG = totalG * (1 - smoothSnow) + 0.96 * smoothSnow;
          totalB = totalB * (1 - smoothSnow) + 0.99 * smoothSnow;
        }

        // Continuous smooth topographic hillshading
        const hEast = flightPath.getNaturalTerrainHeight(worldX + 6.0, worldZ, weights);
        const hNorth = flightPath.getNaturalTerrainHeight(worldX, worldZ + 12.0, weights);
        const dhx = (hEast - elevationH) / 6.0;
        const dhz = (hNorth - elevationH) / 12.0;
        const shade = 1.0 + (-dhx * 0.22 + dhz * 0.16);
        let light = Math.max(0.72, Math.min(1.28, shade));

        if (elevationH < WATER_LEVEL) {
          const depth = WATER_LEVEL - elevationH;
          const waterCalm = Math.min(1.0, depth / 2.5);
          light = light + (1.0 - light) * (waterCalm * 0.75);
        }

        totalR = Math.max(0, Math.min(1, totalR * light));
        totalG = Math.max(0, Math.min(1, totalG * light));
        totalB = Math.max(0, Math.min(1, totalB * light));

        const pixelIdx = (gy * gridW + gx) * 4;
        data[pixelIdx] = Math.round(totalR * 255);
        data[pixelIdx + 1] = Math.round(totalG * 255);
        data[pixelIdx + 2] = Math.round(totalB * 255);
        data[pixelIdx + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    // Blit to cached canvas with bilinear interpolation and subtle aesthetic grading
    const cachedCanvas = document.createElement('canvas');
    cachedCanvas.width = w;
    cachedCanvas.height = h;
    const cCtx = cachedCanvas.getContext('2d');
    if (cCtx) {
      cCtx.imageSmoothingEnabled = true;
      cCtx.imageSmoothingQuality = 'high';
      cCtx.drawImage(offscreen, 0, 0, w, h);

      // Subtle atmospheric tint to keep grid lines and flight paths highly readable
      cCtx.fillStyle = 'rgba(10, 15, 26, 0.26)';
      cCtx.fillRect(0, 0, w, h);

      // Soft lateral edge gradient for refined framing
      const edgeGrad = cCtx.createLinearGradient(0, 0, w, 0);
      edgeGrad.addColorStop(0, 'rgba(3, 7, 18, 0.50)');
      edgeGrad.addColorStop(0.06, 'rgba(3, 7, 18, 0.0)');
      edgeGrad.addColorStop(0.94, 'rgba(3, 7, 18, 0.0)');
      edgeGrad.addColorStop(1, 'rgba(3, 7, 18, 0.50)');
      cCtx.fillStyle = edgeGrad;
      cCtx.fillRect(0, 0, w, h);

      tileCanvasCache.set(cacheKey, cachedCanvas);
      ctx.drawImage(cachedCanvas, 0, 0, w, h);
    }
  }, [level, width, height]);

  return (
    <div
      className="absolute inset-x-0 pointer-events-none animate-map-tile-fade"
      style={{
        top: `${rowTop}px`,
        height: `${height}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </div>
  );
};

/**
 * Topographic & Biome Terrain Background Canvas with Viewport Windowing
 *
 * Only generates and renders slices for levels within or immediately adjacent to the
 * visible scroll viewport. Slices are cached so scrolling is instantaneous, and
 * new tiles smoothly fade in as the player scrolls up and down the map.
 */
export const TerrainMapCanvas: React.FC<TerrainMapCanvasProps> = ({
  width,
  height,
  totalLevels,
  levelUnitSize,
  visibleRange,
}) => {
  const effectiveUnitSize = levelUnitSize ?? (totalLevels > 0 ? height / totalLevels : 60);

  // Compute the list of level indices to render in the current window
  const activeLevels = useMemo(() => {
    const minLvl = visibleRange ? Math.max(0, visibleRange.minLevel) : 0;
    const maxLvl = visibleRange ? Math.min(totalLevels - 1, visibleRange.maxLevel) : totalLevels - 1;

    const list: number[] = [];
    for (let l = minLvl; l <= maxLvl; l++) {
      list.push(l);
    }
    return list;
  }, [visibleRange, totalLevels]);

  if (width <= 0 || height <= 0 || totalLevels <= 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {activeLevels.map((lvl) => {
        const rowTop = height - (lvl + 1) * effectiveUnitSize;
        return (
          <TerrainLevelTile
            key={`terrain-slice-${lvl}`}
            level={lvl}
            width={width}
            height={effectiveUnitSize}
            rowTop={rowTop}
          />
        );
      })}
    </div>
  );
};
