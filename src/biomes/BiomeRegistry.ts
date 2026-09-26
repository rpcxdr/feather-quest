import { Biome } from './Biome';
import { HillsBiome } from './HillsBiome';
import { MountainBiome } from './MountainBiome';
import { CanyonBiome } from './CanyonBiome';
import { WaterBiome } from './WaterBiome';
import { CloudsBiome } from './CloudsBiome';

export interface BiomeWeightsResult {
  // Relative weight map keyed by biome character (e.g. 'H', 'h', 'M', 'm', 'C', 'c', 'W', 'w')
  weights: Map<Biome, number>;
  // Convenient category sums
  hills: number;
  hillsLow: number;
  mountain: number;
  mountainLow: number;
  canyon: number;
  canyonLow: number;
  waterDeep: number;
  waterShallow: number;
  clouds: number;
  primary: 'ROLLING_HILLS' | 'RUGGED_MOUNTAIN' | 'DEEP_CANYON_SLOTS' | 'SHALLOW_WATERS' | 'DEEP_WATERS' | 'HIGH_CLOUDS';
  primaryBiome: Biome;
}

/**
 * BiomeRegistry
 * Maintains the list of registered active biomes in the game,
 * maps ascii characters from the map to biome instances, and provides query utilities.
 */
export class BiomeRegistry {
  private biomes: Biome[] = [];
  private charMap: Map<string, Biome> = new Map();
  private idMap: Map<string, Biome> = new Map();
  private defaultBiome: Biome | null = null;

  public register(biome: Biome, isDefault: boolean = false): void {
    this.biomes.push(biome);
    this.charMap.set(biome.char, biome);
    this.idMap.set(biome.id, biome);
    if (isDefault || !this.defaultBiome) {
      this.defaultBiome = biome;
    }
  }

  public getAll(): readonly Biome[] {
    return this.biomes;
  }

  public getByChar(char: string): Biome | undefined {
    return this.charMap.get(char);
  }

  public getById(id: string): Biome | undefined {
    return this.idMap.get(id);
  }

  public getDefault(): Biome {
    if (!this.defaultBiome) {
      throw new Error('No default biome registered in BiomeRegistry');
    }
    return this.defaultBiome;
  }

  public getByCategory(category: 'HILLS' | 'MOUNTAIN' | 'CANYON' | 'WATER' | 'CLOUDS'): Biome[] {
    return this.biomes.filter((b) => b.category === category);
  }

  /**
   * Resets registry (e.g. during testing or hot reload)
   */
  public clear(): void {
    this.biomes = [];
    this.charMap.clear();
    this.idMap.clear();
    this.defaultBiome = null;
  }
}

// Global registry singleton
export const biomeRegistry = new BiomeRegistry();

/**
 * Standard initialization of active game biomes:
 * 'H' - Large Rolling Hills (scale 1.0)
 * 'h' - Small Rolling Hills (scale 0.75)
 * 'M' - Large Mountains (scale 1.0)
 * 'm' - Small Mountains (scale 0.75)
 * 'C' - Deep Canyon Slots (scale 1.0)
 * 'c' - Deep Canyon Slots (small, scale 0.75)
 * 's' - Sky / High Clouds (scale 1.0)
 * 'W' - Deep Waters (scale 1.5)
 * 'w' - Shallow Waters (scale 1.0)
 */
export function registerDefaultBiomes(registry: BiomeRegistry = biomeRegistry): void {
  registry.clear();

  // 1. Hills
  const hillsLarge = new HillsBiome('H', 1.0, 'Rolling Hills (Large)');
  const hillsSmall = new HillsBiome('h', 0.75, 'Rolling Hills (Small)');

  // 2. Mountains
  const mountainLarge = new MountainBiome('M', 1.0, 'Rugged Mountain (Large)');
  const mountainSmall = new MountainBiome('m', 0.75, 'Rugged Mountain (Small)');

  // 3. Canyons
  const canyonLarge = new CanyonBiome('C', 1.0, 'Deep Canyon Slots (Large)');
  const canyonSmall = new CanyonBiome('c', 0.75, 'Deep Canyon Slots (Small)');

  // 4. Waters
  const waterDeep = new WaterBiome('W', 1.5, 'Deep Waters');
  const waterShallow = new WaterBiome('w', 1.0, 'Shallow Waters');

  // 5. Sky / Clouds
  const cloudsBiome = new CloudsBiome('s', 1.0, 'Sky / Clouds');

  registry.register(hillsLarge, true); // HillsLarge as default
  registry.register(hillsSmall);
  registry.register(mountainLarge);
  registry.register(mountainSmall);
  registry.register(canyonLarge);
  registry.register(canyonSmall);
  registry.register(cloudsBiome);
  registry.register(waterDeep);
  registry.register(waterShallow);
}

// Automatically register defaults on import
registerDefaultBiomes();
