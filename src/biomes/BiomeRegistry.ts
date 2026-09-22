import { Biome } from './Biome';
import { HillsBiome } from './HillsBiome';
import { MountainBiome } from './MountainBiome';
import { CanyonBiome } from './CanyonBiome';

export interface BiomeWeightsResult {
  // Relative weight map keyed by biome character (e.g. 'H', 'h', 'M', 'm', 'C', 'c')
  weights: Map<Biome, number>;
  // Convenient category sums
  hills: number;
  hillsLow: number;
  mountain: number;
  mountainLow: number;
  canyon: number;
  canyonLow: number;
  primary: 'ROLLING_HILLS' | 'RUGGED_MOUNTAIN' | 'DEEP_CANYON_SLOTS';
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

  public getByCategory(category: 'HILLS' | 'MOUNTAIN' | 'CANYON'): Biome[] {
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
 * 'H' - Large Rolling Hills (scale 2.0)
 * 'h' - Small Rolling Hills (scale 0.75)
 * 'M' - Large Mountains (scale 1.0)
 * 'm' - Small Mountains (scale 0.75)
 * 'C' - Deep Canyon Slots (scale 1.0)
 * 'c' - Shallow Canyons (scale 0.75)
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

  registry.register(hillsLarge, true); // HillsLarge as default
  registry.register(hillsSmall);
  registry.register(mountainLarge);
  registry.register(mountainSmall);
  registry.register(canyonLarge);
  registry.register(canyonSmall);
}

// Automatically register defaults on import
registerDefaultBiomes();
