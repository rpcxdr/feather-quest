import React, { useEffect, useRef } from 'react';
import { flightPath, LEVEL_LENGTH } from '../game/pathGenerator';
import { biomeRegistry, Biome, WATER_LEVEL } from '../biomes';

interface TerrainMapCanvasProps {
  width: number;
  height: number;
  totalLevels: number;
  levelUnitSize?: number;
}

/**
 * Topographic & Biome Terrain Background Canvas
 *
 * Smoothly blends biome colors and topographic hillshading according to the
 * game's continuous mathematical terrain model.
 *
 * Utilizes hardware-accelerated bilinear smoothing and continuous smoothstep
 * transitions so biomes flow naturally into each other without rectangular
 * block artifacts, while remaining ultra-lightweight on CPU.
 */
export const TerrainMapCanvas: React.FC<TerrainMapCanvasProps> = ({
  width,
  height,
  totalLevels,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0 || totalLevels <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);

    // Offscreen sampling grid dimensions
    // 64 horizontal samples across 300m width (~4.7m resolution)
    // 16 vertical samples per 250m level (~15.6m resolution)
    // For 6-10 levels, total samples is only ~6,000 to 10,000 points (< 3ms calculation)
    const gridW = 64;
    const gridH = Math.max(32, totalLevels * 16);

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

    // Sample terrain elevation, biome weights, and vertex colors
    for (let gy = 0; gy < gridH; gy++) {
      // gy = 0 is the top (furthest distance z)
      // gy = gridH - 1 is the bottom (start distance z = 0)
      const normZ = 1.0 - gy / (gridH - 1);
      const worldZ = normZ * totalLevels * LEVEL_LENGTH;

      for (let gx = 0; gx < gridW; gx++) {
        const normX = gx / (gridW - 1);
        // Canvas left (normX = 0) aligns with screen left (+150m), canvas right (normX = 1) aligns with screen right (-150m)
        const worldX = (0.5 - normX) * 300.0; // 300m total span (+150m to -150m)

        // Query continuous biome weights and natural terrain height
        const weights = flightPath.getBiomeWeights(worldX, worldZ);
        const h = flightPath.getNaturalTerrainHeight(worldX, worldZ, weights);

        // Compute smooth blended color across biomes (no block noise for continuous gradients)
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let totalWeight = 0;

        if (weights.biomeWeights) {
          for (const [biome, w] of weights.biomeWeights.entries()) {
            if (w > 0.001) {
              const [cr, cg, cb] = biome.getVertexColor({
                x: worldX,
                z: worldZ,
                h,
                distToBranch: 100.0, // Natural terrain surface (avoids artificial 3D pillar foundation/cobblestone artifacts along centerline)
                blockNoise: 0,
                bx: Math.floor(worldX),
                bz: Math.floor(worldZ),
              });
              totalR += w * cr;
              totalG += w * cg;
              totalB += w * cb;
              totalWeight += w;
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

        // Smooth Mountain snow peaks blending
        const mountainWeight =
          (mountainBiome ? weights.biomeWeights?.get(mountainBiome) || 0 : 0) +
          (mountainLowBiome ? weights.biomeWeights?.get(mountainLowBiome) || 0 : 0) +
          (cloudsBiome ? weights.biomeWeights?.get(cloudsBiome) || 0 : 0);

        if (mountainWeight > 0.01 && h > 18.0) {
          const snowFactor = mountainWeight * Math.min(1.0, (h - 18.0) / 8.0);
          const smoothSnow = snowFactor * snowFactor * (3.0 - 2.0 * snowFactor);
          totalR = totalR * (1 - smoothSnow) + 0.94 * smoothSnow;
          totalG = totalG * (1 - smoothSnow) + 0.96 * smoothSnow;
          totalB = totalB * (1 - smoothSnow) + 0.99 * smoothSnow;
        }

        // Continuous smooth topographic hillshading
        const hEast = flightPath.getNaturalTerrainHeight(worldX + 6.0, worldZ, weights);
        const hNorth = flightPath.getNaturalTerrainHeight(worldX, worldZ + 12.0, weights);
        const dhx = (hEast - h) / 6.0;
        const dhz = (hNorth - h) / 12.0;
        const shade = 1.0 + (-dhx * 0.22 + dhz * 0.16);
        let light = Math.max(0.72, Math.min(1.28, shade));

        // Submerged terrain sits under a flat water level; soften hillshading for glassy flat water
        if (h < WATER_LEVEL) {
          const depth = WATER_LEVEL - h;
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

    // Draw the offscreen terrain buffer onto main canvas with high-quality bilinear interpolation
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, width, height);

    // Subtle atmospheric tint to keep grid lines and flight paths highly readable
    ctx.fillStyle = 'rgba(10, 15, 26, 0.26)';
    ctx.fillRect(0, 0, width, height);

    // Soft lateral edge gradient for refined framing
    const edgeGrad = ctx.createLinearGradient(0, 0, width, 0);
    edgeGrad.addColorStop(0, 'rgba(3, 7, 18, 0.50)');
    edgeGrad.addColorStop(0.06, 'rgba(3, 7, 18, 0.0)');
    edgeGrad.addColorStop(0.94, 'rgba(3, 7, 18, 0.0)');
    edgeGrad.addColorStop(1, 'rgba(3, 7, 18, 0.50)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, width, height);
  }, [width, height, totalLevels]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden shadow-inner"
      style={{
        width: '100%',
        height: `${height}px`,
      }}
    />
  );
};
