import * as THREE from 'three';
import { Biome, AtmosphereColors, CloudLightingColors, TerrainVertexColorContext, VoxelColorSpec } from './Biome';

/**
 * HillsBiome
 * Supports large hills ('H') with scale=2.0 and small hills ('h') with scale=0.75
 */
export class HillsBiome extends Biome {
  public readonly id: string;
  public readonly char: string;
  public readonly name: string;
  public readonly category = 'HILLS' as const;

  constructor(char: string = 'H', scale: number = 2.0, name: string = 'Rolling Hills') {
    super(scale);
    this.char = char;
    this.id = char === 'h' ? 'hills_small' : 'hills_large';
    this.name = name;
  }

  public getPathUndulation(z: number): number {
    // Incommensurate prime wavelengths (431m, 197m, 109m, 883m)
    // completely eliminates periodic repetition across 250m levels
    const base =
      Math.sin(z * 0.014578) * 8.0 +
      Math.cos(z * 0.031894 + 1.3) * 4.2 +
      Math.sin(z * 0.057644 - 0.7) * 2.2 +
      Math.sin(z * 0.007116 + 0.5) * 4.6;
    return base * this.scale;
  }

  public getNaturalTerrainHeight(x: number, z: number): number {
    // Multi-octave incommensurate waveform:
    // Uses prime spatial frequencies in both X and Z so hill crests and valleys
    // continuously vary across every single level segment without repeating
    const baseHills =
      Math.sin(x * 0.020074) * 6.5 +
      Math.cos(z * 0.013454 + 0.9) * 7.5 +
      Math.sin((x * 0.038547 + z * 0.028176) * 0.7071) * 4.8 +
      Math.cos((x * 0.020074 - z * 0.045863) * 0.7071 + 1.7) * 3.2 +
      Math.sin(z * 0.006677) * 4.0;
    return baseHills * this.scale;
  }

  public getVertexColor(ctx: TerrainVertexColorContext): [number, number, number] {
    const { distToBranch, blockNoise, bx, bz } = ctx;
    if (distToBranch < 4.2) {
      // Cobblestone & Mossy Stone ruins floor surrounding the pillar base
      const isMossy = Math.abs(bx + bz) % 3 === 0;
      if (isMossy) {
        return [0.28 + blockNoise, 0.44 + blockNoise, 0.20 + blockNoise * 0.5];
      } else {
        return [0.40 + blockNoise, 0.40 + blockNoise, 0.40 + blockNoise];
      }
    } else {
      // Grass Block top vs Dirt step sides
      const isStepFace = Math.abs(bx * 7 + bz * 13) % 5 === 0 && distToBranch > 6.0 && distToBranch < 24.0;
      if (isStepFace) {
        // Dirt block side
        return [0.52 + blockNoise, 0.37 + blockNoise, 0.25 + blockNoise * 0.5];
      } else {
        // Lush Voxel Grass Green
        return [0.35 + blockNoise * 0.5, 0.58 + blockNoise, 0.18 + blockNoise * 0.3];
      }
    }
  }

  public getAtmosphereColors(): AtmosphereColors {
    return {
      sky: new THREE.Color(0xbfe3f7),
      fog: new THREE.Color(0xbfe3f7),
      ground: new THREE.Color(0x4f772d),
    };
  }

  public getCloudLightingColors(): CloudLightingColors {
    return {
      baseShadow: { r: 0.776, g: 0.843, b: 0.909 }, // soft sky blue reflection (0xc6d7e8)
      coreTint: { r: 0.957, g: 0.968, b: 0.980 },
      sunlitCrest: { r: 1.0, g: 1.0, b: 1.0 },
    };
  }

  public getPillarVoxelColors(layer: number): VoxelColorSpec {
    // Rolling Hills Palette: Stone Bricks, Cobblestone, Mossy Stone & Oak Timber ties
    if (layer % 6 === 0) {
      // Oak Wood beam tie
      return {
        top: [0.55, 0.38, 0.22],
        side: [0.50, 0.32, 0.18],
        bot: [0.45, 0.28, 0.15],
      };
    } else if (layer % 3 === 0) {
      // Mossy Stone
      return {
        top: [0.32, 0.48, 0.24],
        side: [0.34, 0.42, 0.26],
        bot: [0.30, 0.38, 0.22],
      };
    } else if (layer % 4 === 0) {
      // Cobblestone
      return {
        top: [0.42, 0.42, 0.42],
        side: [0.38, 0.38, 0.38],
        bot: [0.34, 0.34, 0.34],
      };
    }
    // Default Stone Brick
    return {
      top: [0.48, 0.48, 0.48],
      side: [0.44, 0.44, 0.44],
      bot: [0.40, 0.40, 0.40],
    };
  }

  public getBaseVoxelColors(): VoxelColorSpec {
    return {
      top: [0.42, 0.42, 0.42], // Cobblestone
      side: [0.38, 0.38, 0.38],
      bot: [0.34, 0.34, 0.34],
    };
  }
}
