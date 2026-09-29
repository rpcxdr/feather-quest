import * as THREE from 'three';
import {
  Biome,
  AtmosphereColors,
  CloudLightingColors,
  TerrainVertexColorContext,
  VoxelColorSpec,
} from './Biome';

/**
 * Global flat water level across all water regions and canyon riverbeds.
 * Positioned lower than rolling hills and matching the canyon river floor elevation.
 */
export const WATER_LEVEL = -7.0;

/**
 * WaterBiome
 *
 * Implements the aquatic biomes:
 * 'w' - Shallow Waters:
 *      Gentle terrain that undulates above and below the flat water level,
 *      forming sunny golden sand beaches, tidal sandbars, coastal dunes,
 *      and shallow turquoise lagoons.
 * 'W' - Deeper Waters:
 *      Vast deep ocean where the hidden terrain is submerged deep below the surface,
 *      with bathymetric depth reflected in darker, richer navy and midnight blue water.
 */
export class WaterBiome extends Biome {
  public readonly id: string;
  public readonly char: string;
  public readonly name: string;
  public readonly category = 'WATER' as const;

  constructor(
    char: 'w' | 'W' = 'w',
    scale: number = 1.0,
    name?: string
  ) {
    super(scale);
    this.char = char;
    if (char === 'w') {
      this.id = 'water_shallow';
      this.name = name || 'Shallow Waters';
    } else {
      this.id = 'water_deep';
      this.name = name || 'Deep Waters';
    }
  }

  public override getPreferredAltitude(): number {
    return this.char === 'W' ? 0.08 : 0.24;
  }

  /**
   * Flight corridor gentle ocean swell
   */
  public getPathUndulation(z: number): number {
    const swell =
      Math.sin(z * 0.0091) * 3.5 +
      Math.cos(z * 0.0215 + 1.2) * 2.0;
    return swell * (this.char === 'W' ? 1.0 : 0.8);
  }

  /**
   * 3D Natural Terrain Elevation
   *
   * 'w': Undulates naturally across WATER_LEVEL (-7.0m), creating beaches when above
   *      and shallow crystal lagoons when below.
   * 'W': Submerged deep beneath WATER_LEVEL, with underwater trenches and ridges.
   */
  public getNaturalTerrainHeight(x: number, z: number): number {
    if (this.char === 'w') {
      // Shallow waters: crosses above and below WATER_LEVEL
      const wave1 = Math.sin(x * 0.0234 + 0.4) * 4.4;
      const wave2 = Math.cos(z * 0.0178 + 0.9) * 4.0;
      const wave3 = Math.sin((x * 0.039 - z * 0.027) * 0.7071) * 2.5;
      const duneSand = Math.cos((x * 0.065 + z * 0.045) * 0.7071 + 1.4) * 1.6;

      // Ranges from approximately -16m (submerged shallows) to +2.5m (coastal beach dunes)
      return WATER_LEVEL + wave1 + wave2 + wave3 + duneSand;
    } else {
      // Deep waters: submerged deep beneath the water line
      const trench1 = Math.sin(x * 0.0152 + 1.3) * 5.4;
      const trench2 = Math.cos(z * 0.0118 + 0.6) * 5.8;
      const ridge = Math.sin((x * 0.0264 + z * 0.0212) * 0.7071) * 4.0;

      // Average depth is ~16m below water line (-11m to -28m elevation)
      return WATER_LEVEL - 16.0 + trench1 + trench2 + ridge;
    }
  }

  /**
   * Terrain & Surface Vertex Coloring
   *
   * 'w' shallow waters:
   *  - Above water line: Wet tidal sand at water's edge, warm golden beach sand, and coastal dune grass.
   *  - Below water line: Crystal-clear turquoise lagoon sandbars.
   * 'W' deep waters:
   *  - Deeper hidden terrain is represented by progressively darker ocean blues down to midnight abyssal navy.
   */
  public getVertexColor(ctx: TerrainVertexColorContext): [number, number, number] {
    const { h, blockNoise } = ctx;

    // 1. Terrain emerging ABOVE the flat water line: Beaches & Coastal Dunes
    if (h >= WATER_LEVEL) {
      const elevationAboveWater = h - WATER_LEVEL;
      if (elevationAboveWater < 0.8) {
        // Wet shoreline sand (damp, darker saturated sand where waves break)
        return [0.72 + blockNoise, 0.64 + blockNoise, 0.48 + blockNoise * 0.5];
      } else if (elevationAboveWater < 3.4) {
        // Warm sunlit golden beach sand
        return [0.88 + blockNoise, 0.80 + blockNoise, 0.58 + blockNoise * 0.5];
      } else {
        // Coastal dunes & maritime beach grass
        return [0.58 + blockNoise, 0.70 + blockNoise, 0.36 + blockNoise * 0.5];
      }
    }

    // 2. Terrain SUBMERGED below the flat water line:
    // Deeper hidden terrain is represented by darker water colors on the surface
    const depth = WATER_LEVEL - h;

    if (depth < 2.5) {
      // Shallow crystal-clear turquoise shallows / lagoon sandbar visible through water
      const t = depth / 2.5;
      return [
        THREE.MathUtils.lerp(0.24, 0.12, t) + blockNoise * 0.15,
        THREE.MathUtils.lerp(0.76, 0.60, t) + blockNoise * 0.15,
        THREE.MathUtils.lerp(0.82, 0.76, t),
      ];
    } else if (depth < 7.5) {
      // Moderate depth tropical azure / vibrant coastal shelf
      const t = (depth - 2.5) / 5.0;
      return [
        THREE.MathUtils.lerp(0.12, 0.07, t),
        THREE.MathUtils.lerp(0.60, 0.38, t),
        THREE.MathUtils.lerp(0.76, 0.64, t),
      ];
    } else if (depth < 15.0) {
      // Deeper waters: rich deep oceanic blue
      const t = (depth - 7.5) / 7.5;
      return [
        THREE.MathUtils.lerp(0.07, 0.03, t),
        THREE.MathUtils.lerp(0.38, 0.18, t),
        THREE.MathUtils.lerp(0.64, 0.44, t),
      ];
    } else {
      // Abyssal deep ocean trench: dark midnight navy blue
      const t = Math.min(1.0, (depth - 15.0) / 10.0);
      return [
        THREE.MathUtils.lerp(0.03, 0.015, t),
        THREE.MathUtils.lerp(0.18, 0.08, t),
        THREE.MathUtils.lerp(0.44, 0.22, t),
      ];
    }
  }

  /**
   * Tropical Ocean Atmosphere
   */
  public getAtmosphereColors(): AtmosphereColors {
    if (this.char === 'W') {
      // Deep maritime ocean: unified azure horizon so the water sheet blends seamlessly into the sky
      return {
        sky: new THREE.Color(0x38bdf8),    // Radiant maritime sky
        fog: new THREE.Color(0x38bdf8),    // Matching oceanic horizon fog
        ground: new THREE.Color(0x0284c7), // Deep azure reflection
      };
    }
    // Shallow waters: sunny tropical sky & matching sea haze
    return {
      sky: new THREE.Color(0x56c4f8),    // Radiant sunny tropical sky
      fog: new THREE.Color(0x56c4f8),    // Matching soft tropical sea haze
      ground: new THREE.Color(0x0284c7), // Lagoon azure reflection
    };
  }

  public getCloudLightingColors(): CloudLightingColors {
    return {
      baseShadow: { r: 0.14, g: 0.28, b: 0.44 },
      coreTint: { r: 0.88, g: 0.94, b: 0.98 },
      sunlitCrest: { r: 1.0, g: 0.98, b: 0.94 },
    };
  }

  public override getMinTreeOffset(): number {
    return 24.0;
  }

  public override hasTrees(): boolean {
    // "w" shallow waters has sparse palm trees on dry beaches; "W" deep ocean has no trees
    return this.char === 'w';
  }

  /**
   * Sunken Sea Temple Ruins & Prismarine Pillars
   */
  public getPillarVoxelColors(layer: number, isTop: boolean): VoxelColorSpec {
    if (layer === 0) {
      // Radiant sea lantern capital
      return {
        top: [0.78, 0.96, 0.92],
        side: [0.65, 0.90, 0.86],
        bot: [0.45, 0.82, 0.78],
      };
    } else if (layer % 6 === 0) {
      // Aquamarine crystal block
      return {
        top: [0.28, 0.68, 0.75],
        side: [0.22, 0.58, 0.65],
        bot: [0.18, 0.48, 0.55],
      };
    } else if (layer % 3 === 0) {
      // Dark Prismarine
      return {
        top: [0.12, 0.26, 0.28],
        side: [0.10, 0.22, 0.24],
        bot: [0.08, 0.18, 0.20],
      };
    }

    // Weathered prismarine bricks
    return {
      top: [0.24, 0.48, 0.50],
      side: [0.20, 0.42, 0.44],
      bot: [0.16, 0.36, 0.38],
    };
  }

  public getBaseVoxelColors(): VoxelColorSpec {
    return {
      top: [0.18, 0.34, 0.36], // Coral sea rock
      side: [0.14, 0.28, 0.30],
      bot: [0.10, 0.22, 0.24],
    };
  }
}
