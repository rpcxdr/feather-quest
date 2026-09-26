import * as THREE from 'three';
import { Biome, AtmosphereColors, CloudLightingColors, TerrainVertexColorContext, VoxelColorSpec } from './Biome';

/**
 * CloudsBiome ("s" - Sky / Clouds)
 * Highest path elevation in the game, soaring high into the heavy cloud deck.
 * Terrain below is rugged mountains like "M" mountains.
 */
export class CloudsBiome extends Biome {
  public readonly id: string;
  public readonly char: string;
  public readonly name: string;
  public readonly category = 'CLOUDS' as const;

  constructor(char: string = 's', scale: number = 1.0, name: string = 'High Clouds') {
    super(scale);
    this.char = char;
    this.id = 'clouds';
    this.name = name;
  }

  public override getPreferredAltitude(): number {
    return 0.895;
  }

  /**
   * Highest path elevation in the game, elevated at about 40.0m:
   * Base corridor is 15.0m; adding an undulation base of +25.0m sets the center elevation to ~40.0m,
   * comfortably higher than the mountain peaks below (which reach 28-32m).
   * Altitude transitions into and out of clouds occur smoothly over two to three columns.
   */
  public getPathUndulation(z: number): number {
    const base =
      25.0 +
      Math.sin(z * 0.01524) * 2.2 +
      Math.cos(z * 0.02781 + 1.2) * 1.5 +
      Math.sin(z * 0.00689 - 0.4) * 1.8;
    return base * this.scale;
  }

  /**
   * Terrain below is rugged alpine mountains:
   * Majestic peaks reach 28-32m, passing safely beneath the ~40m flight path
   * so the player looks down through the clouds to see the mountain summits below.
   */
  public getNaturalTerrainHeight(x: number, z: number): number {
    const peakFreq1 = Math.abs(Math.sin(x * 0.018644 + z * 0.013117));
    const peakFreq2 = Math.abs(Math.cos(x * 0.034714 - z * 0.023185 + 1.2));
    const peakFreq3 = Math.abs(Math.sin(x * 0.055603 + z * 0.037624 - 0.7));
    const p1 = peakFreq1 * Math.sqrt(peakFreq1);
    const p2 = peakFreq2 * Math.sqrt(Math.sqrt(peakFreq2));
    const p3 = peakFreq3 * peakFreq3;
    const hMountain =
      5.0 +
      p1 * 14.0 +
      p2 * 8.0 +
      p3 * 4.0 +
      Math.sin(z * 0.006837 + 0.8) * 2.0;
    return hMountain * this.scale;
  }

  /**
   * No trees in the high-altitude mountains in the clouds
   */
  public override hasTrees(): boolean {
    return false;
  }

  public getColumnGapCenterY(distance: number): number {
    return (
      Math.sin(distance * 0.0821) * 1.8 +
      Math.cos(distance * 0.0384 + 0.9) * 1.1
    );
  }

  public getVertexColor(ctx: TerrainVertexColorContext): [number, number, number] {
    const h = ctx.h;
    if (h > 54.0) {
      // High-altitude snowy peaks catching brilliant sunlight above the cloud deck
      const snowNoise = Math.sin(ctx.x * 0.45 + ctx.z * 0.35) * 0.04;
      return [0.94 + snowNoise, 0.96 + snowNoise, 0.99];
    }
    if (h > 38.0) {
      // Craggy snow patches mixed with dark exposed granite
      const stoneNoise = Math.sin(ctx.x * 0.8 + ctx.z * 0.6) * 0.05;
      return [0.62 + stoneNoise, 0.66 + stoneNoise, 0.72 + stoneNoise];
    }
    if (h > 20.0) {
      // Rugged alpine granite, slate, and basalt
      const stoneNoise = Math.sin(ctx.x * 0.8 + ctx.z * 0.6) * 0.05;
      return [0.42 + stoneNoise, 0.45 + stoneNoise, 0.48 + stoneNoise];
    }
    // Deep mountain passes and rock scree (no green trees or moss)
    const screeNoise = Math.sin(ctx.x * 0.6 + ctx.z * 0.7) * 0.04;
    return [0.32 + screeNoise, 0.35 + screeNoise, 0.38 + screeNoise];
  }

  public getAtmosphereColors(): AtmosphereColors {
    return {
      sky: new THREE.Color(0xb0d8f5),
      fog: new THREE.Color(0xdce7f2),
      ground: new THREE.Color(0x384654),
    };
  }

  public getCloudLightingColors(): CloudLightingColors {
    return {
      baseShadow: { r: 0.80, g: 0.84, b: 0.90 },
      coreTint: { r: 0.96, g: 0.98, b: 1.0 },
      sunlitCrest: { r: 1.0, g: 1.0, b: 1.0 },
    };
  }

  public getPillarVoxelColors(_layer: number, isTop: boolean): VoxelColorSpec {
    if (isTop) {
      // Sky-temple quartz & marble
      return {
        top: [0.95, 0.96, 0.98],
        side: [0.72, 0.76, 0.84],
        bot: [0.48, 0.52, 0.60],
      };
    }
    return {
      top: [0.88, 0.91, 0.96],
      side: [0.65, 0.70, 0.78],
      bot: [0.42, 0.46, 0.54],
    };
  }

  public getBaseVoxelColors(): VoxelColorSpec {
    return {
      top: [0.74, 0.78, 0.86],
      side: [0.55, 0.59, 0.68],
      bot: [0.35, 0.38, 0.44],
    };
  }
}
