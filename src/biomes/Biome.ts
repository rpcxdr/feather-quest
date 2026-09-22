import * as THREE from 'three';

export interface VoxelColorSpec {
  top: [number, number, number];
  side: [number, number, number];
  bot: [number, number, number];
}

export interface TerrainVertexColorContext {
  x: number;
  z: number;
  h: number;
  distToBranch: number;
  blockNoise: number;
  bx: number;
  bz: number;
}

export interface AtmosphereColors {
  sky: THREE.Color;
  fog: THREE.Color;
  ground: THREE.Color;
}

export interface CloudLightingColors {
  baseShadow: { r: number; g: number; b: number };
  coreTint: { r: number; g: number; b: number };
  sunlitCrest: { r: number; g: number; b: number };
}

/**
 * Base class for all biomes.
 * Encapsulates biome attributes, terrain mathematics, materials, atmosphere, and architectural rules.
 */
export abstract class Biome {
  public abstract readonly id: string;
  public abstract readonly char: string;
  public abstract readonly name: string;
  public abstract readonly category: 'HILLS' | 'MOUNTAIN' | 'CANYON';

  // Relative scale (e.g. 1.0 for standard, 0.75 for 25% lower, 2.0 for doubled)
  public readonly scale: number;

  constructor(scale: number = 1.0) {
    this.scale = scale;
  }

  // --- 1. Path undulation (Flight corridor) ---
  public abstract getPathUndulation(z: number): number;

  // --- 2. Natural 3D terrain surface height ---
  public abstract getNaturalTerrainHeight(
    x: number,
    z: number,
    context?: { rawCenterX?: number; rawCenterY?: number }
  ): number;

  // --- 3. Terrain vertex coloring (RGB in 0..1) ---
  public abstract getVertexColor(ctx: TerrainVertexColorContext): [number, number, number];

  // --- 4. Sky, Fog & Ground Atmospheric lighting colors ---
  public abstract getAtmosphereColors(): AtmosphereColors;

  // --- 5. Cloud shading and highlights ---
  public abstract getCloudLightingColors(): CloudLightingColors;

  // --- 6. Tree placement offset constraints (meters) ---
  public getMinTreeOffset(): number {
    return 14.0;
  }

  // --- 7. Column gap elevation offset ---
  public getColumnGapCenterY(distance: number): number {
    return 0;
  }

  // --- 8. Riverbed / water elevation if biome contains river features ---
  public hasRiver(): boolean {
    return false;
  }

  public getRiverWaterY(activeBranchY: number): number {
    return activeBranchY - 21.8;
  }

  // --- 9. Architectural voxel block pillar materials/colors ---
  public abstract getPillarVoxelColors(layer: number, isTop: boolean): VoxelColorSpec;

  public abstract getBaseVoxelColors(): VoxelColorSpec;
}
