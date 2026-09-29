/**
 * Biome Map System
 *
 * Defines the 2D ascii tile-based biome map:
 * '.' - Default / no biome specified (falls back to cycling heuristic)
 * 'H' - Rolling Hills (standard)
 * 'h' - Rolling Hills (small)
 * 'M' - Rugged Mountain (standard)
 * 'm' - Mountain (small)
 * 'C' - Deep Canyon Slots (standard)
 * 'c' - Deep Canyon Slots (small)
 * 's' - Sky / High Clouds (highest path elevation, heavy clouds over mountain terrain)
 * 'w' - Shallow Waters (beaches when terrain goes above and below water line)
 * 'W' - Deeper Waters (darker water colors representing deeper hidden terrain)
 */

export const rawTerrain = ``;`
ssssssssssssssss
ssssssssssssssss
ssssssssssssssss
ssssssssssssssss
ssssssssssssssss
ssssssssssssssss
WWWWWWWWWWWwwWWW
WWWWWWWWWWWwwWWW
WWWWWWWWWWWwwWWW
WWWWWWWWWWWWWWWW
wwwwwwwwwWWWWwww
WWWWWWWWWWwwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
CCCCCCCCCCCCCCCC
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
wwwwwWWWWWWwwwww
`;

/**
 * Initializes the biome terrain map from a multi-line ascii template literal.
 * Removes empty lines and whitespace within lines.
 * Returns an array representing the map grid (mapZ rows deep, mapX elements wide).
 */
export function init(raw: string = rawTerrain): string[][] {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length > 0);

  return lines.map((line) => line.split(''));
}

// Initialized global map grid and dimensions
export const terrainMap: string[][] = init(rawTerrain);
export const mapZ: number = terrainMap.length;
export const mapX: number = terrainMap[0]?.length ?? 16;
export const TILE_SIZE: number = 25.0; // 25m by 25m per tile

export interface BiomeAltitudeConfig {
  char: string;
  name: string;
  preferredAltitude: number;
  minAltitude: number;
  maxAltitude: number;
}

/**
 * Biome altitude hierarchy from "W" (deepest ocean) to "s" (highest sky).
 * Tuned with:
 * - Expanded water thresholds (32% of total range) so "w" and "W" appear frequently.
 * - Narrowed canyon thresholds (only 9% of range) to prevent over-representation.
 * - Expanded sky thresholds (21% of range) so the flight path frequently reaches the clouds.
 */
export const BIOME_ALTITUDE_SPECS: BiomeAltitudeConfig[] = [
  { char: 'W', name: 'Deep Waters (Deepest Ocean)', preferredAltitude: 0.08, minAltitude: 0.00, maxAltitude: 0.16 },
  { char: 'w', name: 'Shallow Waters', preferredAltitude: 0.24, minAltitude: 0.16, maxAltitude: 0.32 },
  { char: 'h', name: 'Rolling Hills (low)', preferredAltitude: 0.37, minAltitude: 0.32, maxAltitude: 0.42 },
  { char: 'H', name: 'Rolling Hills (high)', preferredAltitude: 0.46, minAltitude: 0.42, maxAltitude: 0.50 },
  { char: 'c', name: 'Deep Canyon Slots (low)', preferredAltitude: 0.52, minAltitude: 0.50, maxAltitude: 0.54 },
  { char: 'C', name: 'Deep Canyon Slots (deep)', preferredAltitude: 0.565, minAltitude: 0.54, maxAltitude: 0.59 },
  { char: 'm', name: 'Rugged Mountain (low)', preferredAltitude: 0.64, minAltitude: 0.59, maxAltitude: 0.69 },
  { char: 'M', name: 'Rugged Mountain (high)', preferredAltitude: 0.74, minAltitude: 0.69, maxAltitude: 0.79 },
  { char: 's', name: 'Sky / Clouds (Highest Sky)', preferredAltitude: 0.895, minAltitude: 0.79, maxAltitude: 1.00 },
];

/**
 * Selects a biome based on normalized altitude in [0, 1].
 * Tuned with wider water and sky brackets, and narrow canyon thresholds.
 */
export function getBiomeForAltitude(altitude: number): string {
  const clamped = Math.max(0, Math.min(1.0, altitude));
  if (clamped < 0.16) return 'W';
  if (clamped < 0.32) return 'w';
  if (clamped < 0.42) return 'h';
  if (clamped < 0.50) return 'H';
  if (clamped < 0.54) return 'c';
  if (clamped < 0.59) return 'C';
  if (clamped < 0.69) return 'm';
  if (clamped < 0.79) return 'M';
  return 's';
}

/**
 * 2D Classic Perlin Gradient Noise implementation with seed 67.
 */
export class PerlinNoise {
  private p: Uint8Array = new Uint8Array(512);

  constructor(seed: number = 67) {
    this.reseed(seed);
  }

  public reseed(seed: number) {
    const permutation = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      permutation[i] = i;
    }

    // Deterministic Linear Congruential Generator seeded with given seed
    let s = (seed >>> 0) || 67;
    const nextRand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let i = 255; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      const temp = permutation[i];
      permutation[i] = permutation[j];
      permutation[j] = temp;
    }

    for (let i = 0; i < 256; i++) {
      this.p[i] = permutation[i];
      this.p[256 + i] = permutation[i];
    }
  }

  private fade(t: number): number {
    // Ken Perlin's quintic polynomial: 6t^5 - 15t^4 + 10t^3
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private grad2D(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * Classic 2D Perlin gradient noise returning a value in [-1, 1]
   */
  public noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.p[this.p[X] + Y];
    const ab = this.p[this.p[X] + Y + 1];
    const ba = this.p[this.p[X + 1] + Y];
    const bb = this.p[this.p[X + 1] + Y + 1];

    const g00 = this.grad2D(aa, xf, yf);
    const g10 = this.grad2D(ba, xf - 1, yf);
    const g01 = this.grad2D(ab, xf, yf - 1);
    const g11 = this.grad2D(bb, xf - 1, yf - 1);

    const x1 = g00 + u * (g10 - g00);
    const x2 = g01 + u * (g11 - g01);

    return x1 + v * (x2 - x1);
  }

  /**
   * Evaluates continuous normalized altitude in [0, 1] at world coordinates (x, z).
   * Regional scale (~280m base wavelength) with multi-octave synthesis and dynamic range
   * expansion (1.55 multiplier) to ensure ocean basins ("W", "w") and soaring skies ("s")
   * are frequently reached.
   */
  public sampleAltitude(x: number, z: number): number {
    const freq = 0.0035; // ~285m wavelength for broad, sweeping continental biomes
    const n1 = this.noise2D(x * freq, z * freq);
    const n2 = this.noise2D(x * freq * 2.0 + 19.3, z * freq * 2.0 + 47.7);
    // Standard 2D Perlin noise is concentrated around 0 with stdev ~0.35.
    // Multiplying by 1.55 expands the dynamic range so that deep valleys (<= -0.65 -> altitude < 0.16)
    // and high peaks (>= +0.58 -> altitude > 0.79) are frequently visited.
    const combined = (n1 * 0.78 + n2 * 0.22) * 1.55;
    return Math.max(0, Math.min(1.0, (combined + 1.0) * 0.5));
  }
}

export const perlinNoise67 = new PerlinNoise(67);

/**
 * Maps world coordinates (x, z) onto the biome map grid according to constraints:
 * - Tile size: 25m x 25m
 * - World coordinates (0, 0) map to map coordinates (mapX / 2, mapZ)
 * - The player starts at the bottom center of the map and works upward as z increases
 * - When out of bounds or on '.', chooses a biome based on altitude using 2D Perlin noise
 *   with a seed of 67, progressing from "W" (deepest ocean) to "s" (highest sky).
 */
export function getBiomeFromMap(
  x: number,
  z: number,
  grid: string[][] = terrainMap
): string {
  // Compute altitude and fallback biome using Perlin noise with seed 67
  const fallbackAltitude = perlinNoise67.sampleAltitude(x, z);
  const defaultChar = getBiomeForAltitude(fallbackAltitude);

  const mZ = grid.length;
  if (mZ === 0) return defaultChar;
  const mX = grid[0].length;
  if (mX === 0) return defaultChar;

  // World (0, 0) maps to (mX / 2, mZ) in map space
  // In the 3D world (camera looking down +Z), screen left is +x and screen right is -x.
  // We use - x / TILE_SIZE so that what appears on the player's screen left comes from the left of the map string,
  // and what appears on the player's screen right comes from the right of the map string.
  const mapXCoord = mX / 2 - x / TILE_SIZE;
  const mapZCoord = mZ - z / TILE_SIZE;

  const col = Math.floor(mapXCoord);
  // As z increases from 0, mapZCoord decreases from mZ towards 0.
  // At z = 0, player is at the bottom edge entering row (mZ - 1).
  let row = Math.floor(mapZCoord);
  if (row === mZ && z >= 0) {
    row = mZ - 1;
  }

  // Check bounds: off the map uses Perlin noise altitude heuristic with seed 67
  if (col < 0 || col >= mX || row < 0 || row >= mZ) {
    return defaultChar;
  }

  const char = grid[row][col];
  if (!char || char === '.') {
    return defaultChar;
  }

  return char;
}
