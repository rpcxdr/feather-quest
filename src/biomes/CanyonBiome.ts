import * as THREE from 'three';
import { Biome, AtmosphereColors, CloudLightingColors, TerrainVertexColorContext, VoxelColorSpec } from './Biome';
import { WATER_LEVEL } from './WaterBiome';

/**
 * CanyonBiome
 * Supports deep canyons ('C') with depthScale=1.0 and shallower canyons ('c') with depthScale=0.75
 */
export class CanyonBiome extends Biome {
  public readonly id: string;
  public readonly char: string;
  public readonly name: string;
  public readonly category = 'CANYON' as const;

  constructor(char: string = 'C', scale: number = 1.0, name: string = 'Deep Canyon Slots') {
    super(scale);
    this.char = char;
    this.id = char === 'c' ? 'canyon_small' : 'canyon_large';
    this.name = name;
  }

  public override getPreferredAltitude(): number {
    return this.char === 'c' ? 0.52 : 0.565;
  }

  public getPathUndulation(z: number): number {
    // Smooth, stable canyon flight path cruising naturally through the canyon gorge
    // Centered gracefully between the river (-6.6m) and canyon shoulder (12.0m)
    const base =
      -7.0 +
      Math.sin(z * 0.01898) * 1.8 +
      Math.cos(z * 0.03841 + 0.9) * 1.2;
    return base * this.scale;
  }

  public override getColumnGapCenterY(distance: number): number {
    // Dynamic canyon column gap undulation:
    // Low frequency variations drive broad, sweeping transitions across the canyon depth and mesa heights,
    // while high-frequency variations have greatly reduced magnitude to eliminate erratic step jumps between adjacent columns.
    const lowFreq1 = Math.sin(distance * 0.0165 + 0.2) * 10.2;
    const lowFreq2 = Math.cos(distance * 0.0278 - 0.5) * 3.8;

    // Reduced magnitude high frequency variations (fine organic texture without sharp height jumps)
    const highFreq =
      Math.sin(distance * 0.0712 + 1.1) * 1.80 +
      Math.cos(distance * 0.128 + 0.7) * 1.40;

    const baseCenter = 7.8;
    let rawY = baseCenter + lowFreq1 + lowFreq2 + highFreq;

    // Soft bounds preserving deep river approaches and mesa crests
    if (rawY < -3.5) {
      rawY = -3.5 + 0.25 * (rawY - (-3.5)) / (1.0 + Math.abs(rawY - (-3.5)) * 0.4);
    } else if (rawY > 20.5) {
      rawY = 20.5 + 0.25 * (rawY - 20.5) / (1.0 + Math.abs(rawY - 20.5) * 0.4);
    }

    const targetWorldGapY = rawY * this.scale;
    const flightPathY = 15.0 + this.getPathUndulation(distance);
    return targetWorldGapY - flightPathY;
  }

  public getNaturalTerrainHeight(
    x: number,
    z: number,
    context?: { rawCenterX?: number; rawCenterY?: number }
  ): number {
    const rawCenterX = context?.rawCenterX ?? 0;

    // River altitude set just above sea level (WATER_LEVEL = -7.0m)
    // allowing smooth natural transition when merging into ocean / shallow water biomes
    const waterY = WATER_LEVEL + (this.scale === 1.0 ? 0.38 : 0.28);
    const riverBedY = waterY - 1.5;

    const riverHalfWidth = 2.8; // Narrower bottom river channel (~5.6m wide)
    const slotHalfWidth = 10.5; // Sharp steep slot canyon gorge
    const canyonShoulder = 12.0 * this.scale;
    const plateauHeight = 18.0 * this.scale;

    const dx = Math.abs(x - rawCenterX);
    let hCanyon: number;

    if (dx <= riverHalfWidth) {
      // Submerged riverbed: sharp V-notch converging at dx = 0
      const r = dx / riverHalfWidth;
      hCanyon = riverBedY + Math.pow(r, 0.95) * (waterY - riverBedY);
    } else if (dx <= slotHalfWidth) {
      // Sharp, steep V-angled canyon walls rising continuously out of the bottom notch
      const u = (dx - riverHalfWidth) / (slotHalfWidth - riverHalfWidth);
      const sharpWall = Math.pow(u, 0.92);
      const rockyCrags =
        Math.sin(u * Math.PI * 3.5 + z * 0.045) * 0.40 +
        Math.cos(z * 0.019) * 0.25;
      hCanyon = waterY + sharpWall * (canyonShoulder - waterY) + rockyCrags;
    } else {
      // Upper mesa rim transitions up to plateau (the flat mesa tops of the canyon)
      const wallDist = dx - slotHalfWidth;
      const wallRatio = Math.min(1.0, wallDist / 12.0);
      const smoothWall = wallRatio * wallRatio * (3.0 - 2.0 * wallRatio);
      const strata = smoothWall + Math.sin(smoothWall * Math.PI * 5.0) * 0.045;
      // Incommensurate mesa rim rolls across upper plateaus
      const rimUndulation =
        (Math.sin(z * 0.01732 + x * 0.02341) * 2.2 +
          Math.cos(z * 0.03814 - x * 0.01912 + 1.1) * 1.4) *
        smoothWall;
      hCanyon = THREE.MathUtils.lerp(canyonShoulder, plateauHeight, Math.min(1.0, Math.max(0.0, strata))) + rimUndulation;
    }

    return hCanyon;
  }

  public override getMinTreeOffset(): number {
    return 24.0; // Trees stay up on the high mesa rim rather than inside the flight channel
  }

  public override hasRiver(): boolean {
    return true;
  }

  public override getRiverWaterY(_activeBranchY?: number): number {
    // Just above sea level (-7.0m)
    return WATER_LEVEL + (this.scale === 1.0 ? 0.38 : 0.28);
  }

  public getVertexColor(ctx: TerrainVertexColorContext): [number, number, number] {
    const { h, distToBranch, blockNoise } = ctx;
    const isWaterLevel = h < WATER_LEVEL + 0.8;
    if (isWaterLevel && distToBranch < 2.8) {
      // Submerged wet riverbed slate & dark river rock
      return [0.11, 0.22, 0.28];
    } else if (isWaterLevel && distToBranch < 4.2) {
      // Damp shoreline gravel & clay
      const tShore = (distToBranch - 2.8) / 1.4;
      return [
        THREE.MathUtils.lerp(0.11, 0.48, tShore),
        THREE.MathUtils.lerp(0.22, 0.30, tShore),
        THREE.MathUtils.lerp(0.28, 0.20, tShore),
      ];
    } else {
      // Canyon horizontal terracotta block strata
      const layer = Math.abs(Math.floor(h)) % 6;
      if (layer === 0) {
        return [0.58 + blockNoise, 0.24 + blockNoise, 0.14]; // Red Terracotta
      } else if (layer === 1) {
        return [0.66 + blockNoise, 0.36 + blockNoise, 0.16]; // Orange Terracotta
      } else if (layer === 2) {
        return [0.72 + blockNoise, 0.52 + blockNoise, 0.18]; // Yellow Terracotta
      } else if (layer === 3) {
        return [0.32 + blockNoise, 0.21 + blockNoise, 0.14]; // Brown Terracotta
      } else if (layer === 4) {
        return [0.82 + blockNoise, 0.72 + blockNoise, 0.62]; // White Terracotta
      } else {
        return [0.60 + blockNoise, 0.38 + blockNoise, 0.26]; // Standard Terracotta
      }
    }
  }

  public getAtmosphereColors(): AtmosphereColors {
    return {
      sky: new THREE.Color(0xfed7aa),
      fog: new THREE.Color(0xfcd3a7),
      ground: new THREE.Color(0x9a3412),
    };
  }

  public getCloudLightingColors(): CloudLightingColors {
    return {
      baseShadow: { r: 0.875, g: 0.820, b: 0.749 }, // warm canyon sandstone bounce (0xdfd1bf)
      coreTint: { r: 0.980, g: 0.965, b: 0.941 },
      sunlitCrest: { r: 1.0, g: 0.984, b: 0.945 },
    };
  }

  public getPillarVoxelColors(layer: number): VoxelColorSpec {
    // Banded Badlands Terracotta strata matching canyon wall colors
    const strata: VoxelColorSpec[] = [
      { top: [0.58, 0.24, 0.14], side: [0.52, 0.20, 0.12], bot: [0.46, 0.16, 0.10] }, // Red
      { top: [0.68, 0.38, 0.16], side: [0.62, 0.32, 0.14], bot: [0.54, 0.26, 0.12] }, // Orange
      { top: [0.74, 0.54, 0.18], side: [0.68, 0.48, 0.16], bot: [0.60, 0.40, 0.14] }, // Yellow
      { top: [0.34, 0.22, 0.14], side: [0.28, 0.18, 0.12], bot: [0.24, 0.14, 0.10] }, // Brown
      { top: [0.84, 0.74, 0.64], side: [0.78, 0.68, 0.58], bot: [0.70, 0.60, 0.50] }, // White
    ];
    const s = strata[layer % strata.length];
    let topC = s.top;
    let sideC = s.side;
    let botC = s.bot;

    if (layer % 8 === 0) {
      // Gold Ore block
      topC = [0.94, 0.76, 0.18];
      sideC = [0.88, 0.68, 0.16];
      botC = [0.80, 0.58, 0.14];
    }

    return { top: topC, side: sideC, bot: botC };
  }

  public getBaseVoxelColors(): VoxelColorSpec {
    return {
      top: [0.68, 0.38, 0.16], // Red Sandstone
      side: [0.62, 0.32, 0.14],
      bot: [0.54, 0.26, 0.12],
    };
  }
}
