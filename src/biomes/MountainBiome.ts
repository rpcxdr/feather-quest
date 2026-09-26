import * as THREE from 'three';
import { Biome, AtmosphereColors, CloudLightingColors, TerrainVertexColorContext, VoxelColorSpec } from './Biome';

/**
 * MountainBiome
 * Supports large mountains ('M') with scale=1.0 and small mountains ('m') with scale=0.75
 */
export class MountainBiome extends Biome {
  public readonly id: string;
  public readonly char: string;
  public readonly name: string;
  public readonly category = 'MOUNTAIN' as const;

  constructor(char: string = 'M', scale: number = 1.0, name: string = 'Rugged Mountain') {
    super(scale);
    this.char = char;
    this.id = char === 'm' ? 'mountain_small' : 'mountain_large';
    this.name = name;
  }

  public override getPreferredAltitude(): number {
    return this.char === 'm' ? 0.64 : 0.74;
  }

  public getPathUndulation(z: number): number {
    // Low mountains ('m'): scale 0.75, nominal center ~16.9m, range ~6.5m to ~27.0m
    if (this.char === 'm') {
      const base =
        2.5 +
        Math.sin(z * 0.016405) * 6.0 +
        Math.cos(z * 0.029778 + 1.1) * 3.8 +
        Math.sin(z * 0.045203 - 0.6) * 2.2 +
        Math.sin(z * 0.008300 + 0.4) * 3.0;
      return base * this.scale;
    }

    // High Mountains ('M'): scale 1.0, center elevation 18.5m (15.0m base + 3.5m offset), range ~9.0m to 31.0m
    const base =
      3.5 +
      Math.sin(z * 0.016405) * 5.0 +
      Math.cos(z * 0.029778 + 1.1) * 3.3 +
      Math.sin(z * 0.045203 - 0.6) * 1.8 +
      Math.sin(z * 0.008300 + 0.4) * 2.4;
    return base * this.scale;
  }

  public getNaturalTerrainHeight(x: number, z: number): number {
    // Triple-ridge incommensurate mountain waveform:
    // Peaks and saddles emerge at distinct forward intervals across all levels
    const peakFreq1 = Math.abs(Math.sin(x * 0.018644 + z * 0.013117));
    const peakFreq2 = Math.abs(Math.cos(x * 0.034714 - z * 0.023185 + 1.2));
    const peakFreq3 = Math.abs(Math.sin(x * 0.055603 + z * 0.037624 - 0.7));
    const p1 = peakFreq1 * Math.sqrt(peakFreq1);
    const p2 = peakFreq2 * Math.sqrt(Math.sqrt(peakFreq2));
    const p3 = peakFreq3 * peakFreq3;
    const hMountain =
      6.0 +
      p1 * 32.0 +
      p2 * 18.0 +
      p3 * 10.0 +
      Math.sin(z * 0.006837 + 0.8) * 6.5;
    return hMountain * this.scale;
  }

  public getColumnGapCenterY(distance: number): number {
    // Dynamic gap center relative to path using non-repeating incommensurate frequencies
    const baseAmp = 2.4 + this.scale * 0.5;
    return (
      Math.sin(distance * 0.09672) * baseAmp +
      Math.cos(distance * 0.04520 + 1.1) * 1.2 +
      Math.sin(distance * 0.01641) * 0.75
    );
  }

  public getVertexColor(ctx: TerrainVertexColorContext): [number, number, number] {
    const { h, distToBranch, blockNoise, bx, bz } = ctx;
    if (distToBranch < 4.2) {
      // Dark Slate & Stone Brick ruins around pillar base
      return [0.24 + blockNoise, 0.25 + blockNoise, 0.28 + blockNoise];
    } else if (h > 24.0) {
      // Pure Snow Block
      const snowT = Math.min(1.0, (h - 24.0) * 0.2);
      return [
        THREE.MathUtils.lerp(0.55, 0.94, snowT) + blockNoise * 0.2,
        THREE.MathUtils.lerp(0.55, 0.96, snowT) + blockNoise * 0.2,
        THREE.MathUtils.lerp(0.58, 0.99, snowT) + blockNoise * 0.2,
      ];
    } else if (h < 13.0) {
      // Low alpine pass cobblestone & grass
      return [0.28 + blockNoise, 0.38 + blockNoise, 0.22 + blockNoise];
    } else {
      // Natural Stone & Andesite block with ore speckle
      const isOre = Math.abs(bx * 3 + bz * 7) % 11 === 0;
      if (isOre) {
        return [0.18, 0.26, 0.20];
      } else {
        return [0.44 + blockNoise, 0.45 + blockNoise, 0.46 + blockNoise];
      }
    }
  }

  public getAtmosphereColors(): AtmosphereColors {
    return {
      sky: new THREE.Color(0x8fb0c7),
      fog: new THREE.Color(0xa2c4d8),
      ground: new THREE.Color(0x334155),
    };
  }

  public getCloudLightingColors(): CloudLightingColors {
    return {
      baseShadow: { r: 0.698, g: 0.772, b: 0.859 }, // crisp alpine slate shadow (0xb2c5db)
      coreTint: { r: 0.933, g: 0.949, b: 0.968 },
      sunlitCrest: { r: 1.0, g: 1.0, b: 1.0 },
    };
  }

  public getPillarVoxelColors(layer: number): VoxelColorSpec {
    // Rugged Mountain Palette: Dark Slate Bricks, Basalt, Andesite, Blue Crystal Ore & Snow Cap
    let topC: [number, number, number] = [0.26, 0.26, 0.28];
    let sideC: [number, number, number] = [0.22, 0.22, 0.24];
    let botC: [number, number, number] = [0.18, 0.18, 0.20];

    if (layer === 0) {
      // Snow-capped capital facing the opening
      topC = [0.96, 0.98, 1.0];
      sideC = [0.90, 0.94, 0.98];
      botC = [0.22, 0.22, 0.24];
    } else if (layer % 7 === 0) {
      // Blue Crystal Ore block
      topC = [0.22, 0.58, 0.88];
      sideC = [0.18, 0.48, 0.78];
      botC = [0.14, 0.38, 0.65];
    } else if (layer % 3 === 0) {
      // Polished Andesite
      topC = [0.52, 0.52, 0.54];
      sideC = [0.46, 0.46, 0.48];
      botC = [0.40, 0.40, 0.42];
    }

    return { top: topC, side: sideC, bot: botC };
  }

  public getBaseVoxelColors(): VoxelColorSpec {
    return {
      top: [0.22, 0.22, 0.24], // Dark Slate
      side: [0.18, 0.18, 0.20],
      bot: [0.14, 0.14, 0.16],
    };
  }
}
