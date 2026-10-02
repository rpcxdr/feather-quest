import * as THREE from 'three';
import { terrainMap, TILE_SIZE, getBiomeFromMap } from './map';
import { Biome, biomeRegistry } from '../biomes';

export type TerrainType =
  | 'ROLLING_HILLS'
  | 'RUGGED_MOUNTAIN'
  | 'DEEP_CANYON_SLOTS'
  | 'SHALLOW_WATERS'
  | 'DEEP_WATERS'
  | 'HIGH_CLOUDS';

export const LEVEL_LENGTH = 250.0; // Exactly 10 tiles (250m)
export const MAP_TILE_SIZE = 25.0; // 25m per tile
export const COLUMNS_PER_LEVEL = 10;
export const LATERAL_TILES = 2; // Exactly 2 tiles = 50m
export const LATERAL_OFFSET = 50.0; // 2 tiles * 25m = 50m

export interface ForkDecision {
  tier: number;
  forkDistance: number;
  chosenBranch: 'LEFT' | 'RIGHT';
  unchosenBranch: 'LEFT' | 'RIGHT';
  baseOffset: number;
  chosenTargetOffset: number;
}

export interface ActiveBranchInfo {
  offset: number;
  point: THREE.Vector3;
  branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  isVeering?: boolean;
}

export interface BiomeWeights {
  hills: number;
  hillsLow: number;
  mountain: number;
  mountainLow: number;
  canyon: number;
  canyonLow: number;
  waterDeep?: number;
  waterShallow?: number;
  clouds?: number;
  primary: TerrainType;
  primaryBiome?: Biome;
  biomeWeights?: Map<Biome, number>;
}

export interface PathFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  curvature: number; // for aerodynamic banking calculation
  elevationSlope: number;
}

/**
 * Static deterministic pseudo-random number generator using the same formula
 * as the flight path (seeded from x, z).
 */
export function pseudoRandom(seed: number): number {
  const s = Math.sin(seed) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Derives a deterministic integer seed from world (x, z) coordinates and an optional extra modifier.
 */
export function getCoordinateSeed(x: number, z: number, extra: number = 0): number {
  const mZ = terrainMap.length;
  const mX = terrainMap[0]?.length ?? 16;
  const tileX = Math.floor(mX / 2 + x / TILE_SIZE);
  const tileY = Math.floor(mZ - z / TILE_SIZE);
  return (
    ((tileX & 0xffff) * 374761393 +
      (tileY & 0xffff) * 668265263 +
      extra * 1013904223) >>>
    0
  );
}

export class FlightPathGenerator {
  public static pseudoRandom(seed: number): number {
    return pseudoRandom(seed);
  }

  public static getSeed(x: number, z: number, extra: number = 0): number {
    return getCoordinateSeed(x, z, extra);
  }
  // Continuous 3D flight path adapting to 3 distinct terrain biomes over 750m (3 levels * 250m):
  // Level 0 (0 - 250m): Rolling Hills
  // Level 1 (250 - 500m): Rugged Mountain
  // Level 2 (500 - 750m): Deep Canyon Slots
  public readonly cycleLength: number = 750.0;
  public readonly biomeSpan: number = 250.0;

  public chosenBranches: Map<number, 'LEFT' | 'RIGHT'> = new Map();
  public activeBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE';
  public activeBranchOffset: number = 0;
  public forkDecisions: Map<number, ForkDecision> = new Map();

  public readonly columnGapHeight: number = 5.2;
  public readonly columnGapHalfHeight: number = 2.6; // 5.2 / 2
  public readonly clearanceMargin: number = 4.8; // Guaranteed minimum meters below column gap bottom opening

  public customStartLevel: number = 0;
  public customStartX: number = 0;
  public customStartCol: number = 2;

  // --- Local Caching for Biome Weight Lookups ---
  private tileBiomeCache = new Map<string, Biome>();
  private pureBiomeWeightsCache = new Map<Biome, BiomeWeights>();

  public clearBiomeWeightsCache(): void {
    this.tileBiomeCache.clear();
    this.pureBiomeWeightsCache.clear();
  }

  private getTileBiome(r: number, c: number, mX: number, mZ: number, tileSize: number): Biome {
    const key = `${r},${c}`;
    const cached = this.tileBiomeCache.get(key);
    if (cached) return cached;

    const sampleX = (mX / 2 - (c + 0.5)) * tileSize;
    const sampleZ = (mZ - (r + 0.5)) * tileSize;
    const char = getBiomeFromMap(sampleX, sampleZ);
    const registered = biomeRegistry.getByChar(char);
    const biome = registered || biomeRegistry.getDefault();
    this.tileBiomeCache.set(key, biome);
    return biome;
  }

  private getPureBiomeWeights(biome: Biome): BiomeWeights {
    const cached = this.pureBiomeWeightsCache.get(biome);
    if (cached) return cached;

    const bH = biomeRegistry.getByChar('H');
    const bh = biomeRegistry.getByChar('h');
    const bM = biomeRegistry.getByChar('M');
    const bm = biomeRegistry.getByChar('m');
    const bC = biomeRegistry.getByChar('C');
    const bc = biomeRegistry.getByChar('c');
    const bs = biomeRegistry.getByChar('s');
    const bW = biomeRegistry.getByChar('W');
    const bw = biomeRegistry.getByChar('w');

    const hills = biome === bH ? 1.0 : 0;
    const hillsLow = biome === bh ? 1.0 : 0;
    const mountain = biome === bM ? 1.0 : 0;
    const mountainLow = biome === bm ? 1.0 : 0;
    const canyon = biome === bC ? 1.0 : 0;
    const canyonLow = biome === bc ? 1.0 : 0;
    const clouds = biome === bs ? 1.0 : 0;
    const waterDeep = biome === bW ? 1.0 : 0;
    const waterShallow = biome === bw ? 1.0 : 0;

    let primary: TerrainType = 'ROLLING_HILLS';
    if (biome === bs) {
      primary = 'HIGH_CLOUDS';
    } else if (biome === bW) {
      primary = 'DEEP_WATERS';
    } else if (biome === bw) {
      primary = 'SHALLOW_WATERS';
    } else if (biome === bM || biome === bm) {
      primary = 'RUGGED_MOUNTAIN';
    } else if (biome === bC || biome === bc) {
      primary = 'DEEP_CANYON_SLOTS';
    } else {
      primary = 'ROLLING_HILLS';
    }

    const biomeWeightsMap = new Map<Biome, number>();
    const allBiomes = biomeRegistry.getAll();
    for (let i = 0; i < allBiomes.length; i++) {
      const b = allBiomes[i];
      biomeWeightsMap.set(b, b === biome ? 1.0 : 0);
    }

    const weights: BiomeWeights = {
      hills,
      hillsLow,
      mountain,
      mountainLow,
      canyon,
      canyonLow,
      waterDeep,
      waterShallow,
      clouds,
      primary,
      primaryBiome: biome,
      biomeWeights: biomeWeightsMap,
    };

    this.pureBiomeWeightsCache.set(biome, weights);
    return weights;
  }

  public setStartLevel(level: number, startX: number, startCol: number = 2) {
    if (level <= 0) {
      this.customStartLevel = 0;
      this.customStartX = 0;
      this.customStartCol = 2;
      this.resetBranches();
      return;
    }
    this.customStartLevel = level;
    this.customStartX = startX;
    this.customStartCol = Math.max(0, Math.min(5, Math.floor(startCol)));
    this.resetBranches();
    if (level > 0) {
      // Checkerboard rule for levels >= 1:
      // If (level + mapCol) is even: path travels from lower right to upper left ('LEFT')
      // If (level + mapCol) is odd: path travels from lower left to upper right ('RIGHT')
      const mapCol = this.customStartCol + 1;
      const isEven = (level + mapCol) % 2 === 0;
      const initialBranch: 'LEFT' | 'RIGHT' = isEven ? 'LEFT' : 'RIGHT';
      this.chosenBranches.set(level, initialBranch);
      this.activeBranch = initialBranch;
      this.activeBranchOffset = initialBranch === 'LEFT' ? LATERAL_OFFSET : -LATERAL_OFFSET;
    }
  }

  public resetStartLevel() {
    this.customStartLevel = 0;
    this.customStartX = 0;
    this.resetBranches();
  }

  public resetBranches() {
    this.chosenBranches.clear();
    this.forkDecisions.clear();
    if (this.customStartLevel > 0) {
      const mapCol = this.customStartCol + 1;
      const isEven = (this.customStartLevel + mapCol) % 2 === 0;
      const initialBranch: 'LEFT' | 'RIGHT' = isEven ? 'LEFT' : 'RIGHT';
      this.chosenBranches.set(this.customStartLevel, initialBranch);
      this.activeBranch = initialBranch;
      this.activeBranchOffset = initialBranch === 'LEFT' ? LATERAL_OFFSET : -LATERAL_OFFSET;
    } else {
      this.activeBranch = 'SINGLE';
      this.activeBranchOffset = 0;
    }
  }

  /**
   * Returns the forced branch direction if the player has reached the map boundary
   * (3 map tiles to the left or 3 map tiles to the right):
   * - 3 tiles left (startX >= +150m, gx = 0): forced 'RIGHT' back toward the middle.
   * - 3 tiles right (startX <= -150m, gx = 6): forced 'LEFT' back toward the middle.
   * Returns null if not at the boundary.
   */
  public getForcedBoundaryBranch(
    level: number,
    branchHistory?: Record<number, 'LEFT' | 'RIGHT'> | Map<number, 'LEFT' | 'RIGHT'>,
    customStartLvl?: number,
    customStartXVal?: number
  ): 'LEFT' | 'RIGHT' | null {
    if (level <= 0) return null;
    const sLvl = customStartLvl !== undefined ? customStartLvl : this.customStartLevel;
    if (sLvl > 0 && level <= sLvl) return null;

    const startX = this.getLevelStartX(level, branchHistory, customStartLvl, customStartXVal);
    // In 3D: left is +X (+150m is 3 tiles left, grid line gx = 0)
    if (startX >= 3 * LATERAL_OFFSET - 1.0) {
      return 'RIGHT';
    }
    // In 3D: right is -X (-150m is 3 tiles right, grid line gx = 6)
    if (startX <= -3 * LATERAL_OFFSET + 1.0) {
      return 'LEFT';
    }
    return null;
  }

  public getLevelBranch(level: number): 'SINGLE' | 'LEFT' | 'RIGHT' {
    if (level <= 0) return 'SINGLE';
    if (this.customStartLevel > 0 && level < this.customStartLevel) return 'SINGLE';

    // 1. Boundary constraint: 3 tiles left/right forces turn back toward middle
    const forced = this.getForcedBoundaryBranch(level);
    if (forced) {
      this.chosenBranches.set(level, forced);
      return forced;
    }

    // 2. Already chosen branch (e.g. from gust trigger or prior selection)
    const chosen = this.chosenBranches.get(level);
    if (chosen) return chosen;

    // 3. Fallback default choice
    let defaultChoice: 'LEFT' | 'RIGHT' = 'RIGHT';
    if (this.customStartLevel > 0 && level === this.customStartLevel) {
      const mapCol = this.customStartCol + 1;
      const isEven = (level + mapCol) % 2 === 0;
      defaultChoice = isEven ? 'LEFT' : 'RIGHT';
    }
    this.chosenBranches.set(level, defaultChoice);
    return defaultChoice;
  }

  public getBranchAtDistance(z: number): 'SINGLE' | 'LEFT' | 'RIGHT' {
    const level = Math.max(0, Math.floor(z / LEVEL_LENGTH));
    return this.getLevelBranch(level);
  }

  public setActiveBranchOffset(offset: number) {
    this.activeBranchOffset = offset;
  }

  public onBranchSelected(level: number, chosenBranch: 'LEFT' | 'RIGHT') {
    const forced = this.getForcedBoundaryBranch(level);
    const effectiveBranch = forced ?? chosenBranch;

    this.chosenBranches.set(level, effectiveBranch);
    this.activeBranch = effectiveBranch;
    this.activeBranchOffset = effectiveBranch === 'LEFT' ? -LATERAL_OFFSET : LATERAL_OFFSET;

    const unchosenBranch: 'LEFT' | 'RIGHT' = effectiveBranch === 'RIGHT' ? 'LEFT' : 'RIGHT';
    const fork: ForkDecision = {
      tier: level,
      forkDistance: this.getDecisionPointDistance(level - 1),
      chosenBranch: effectiveBranch,
      unchosenBranch,
      baseOffset: this.getLevelStartX(level),
      chosenTargetOffset: this.getLevelEndX(level, effectiveBranch),
    };
    this.forkDecisions.set(level, fork);
  }

  // Calculate smooth biome blend weights at coordinates (x, z) using continuous 2D smoothstep interpolation between tiles
  // with cached discrete tile samples and pure single-biome fast-path for high performance and zero discretization noise.
  public getBiomeWeights(x: number, z: number): BiomeWeights {
    const mZ = terrainMap.length;
    const mX = terrainMap[0]?.length ?? 16;
    const tileSize = TILE_SIZE; // 25.0m

    // Map space continuous coordinates where world (0, 0) maps to (mX / 2, mZ)
    // In 3D world (camera looking down +Z), screen left is +x, screen right is -x.
    // mapXCoord = mX / 2 - x / tileSize aligns screen left with left columns of map string
    const mapXCoord = mX / 2 - x / tileSize;
    const mapZCoord = mZ - z / tileSize;

    // Shift coordinates by 0.5 so tile centers (col + 0.5, row + 0.5) lie on integer grid points
    const u = mapXCoord - 0.5;
    const v = mapZCoord - 0.5;

    const c0 = Math.floor(u);
    const c1 = c0 + 1;
    const r0 = Math.floor(v);
    const r1 = r0 + 1;

    // Sample the 4 bounding tiles with local tile cache
    const b00 = this.getTileBiome(r0, c0, mX, mZ, tileSize);
    const b10 = this.getTileBiome(r0, c1, mX, mZ, tileSize);
    const b01 = this.getTileBiome(r1, c0, mX, mZ, tileSize);
    const b11 = this.getTileBiome(r1, c1, mX, mZ, tileSize);

    // Fast-path: if all 4 bounding tiles have identical biome, weights strictly equal 1.0 for that biome
    if (b00 === b10 && b00 === b01 && b00 === b11) {
      return this.getPureBiomeWeights(b00);
    }

    // Fractional offset within cell [0, 1)
    const fx = u - c0;
    const fz = v - r0;

    // Smoothstep curves (C^1 continuous with zero derivatives at tile centers)
    const sx = fx * fx * (3.0 - 2.0 * fx);
    const sz = fz * fz * (3.0 - 2.0 * fz);

    // Continuous 2D weights for the 4 bounding tile centers (sums strictly to 1.0)
    const w00 = (1.0 - sx) * (1.0 - sz);
    const w10 = sx * (1.0 - sz);
    const w01 = (1.0 - sx) * sz;
    const w11 = sx * sz;

    const allBiomes = biomeRegistry.getAll();
    const biomeWeightsMap = new Map<Biome, number>();
    for (let i = 0; i < allBiomes.length; i++) {
      const b = allBiomes[i];
      let weight = 0;
      if (b00 === b) weight += w00;
      if (b10 === b) weight += w10;
      if (b01 === b) weight += w01;
      if (b11 === b) weight += w11;
      biomeWeightsMap.set(b, weight);
    }

    const bH = biomeRegistry.getByChar('H');
    const bh = biomeRegistry.getByChar('h');
    const bM = biomeRegistry.getByChar('M');
    const bm = biomeRegistry.getByChar('m');
    const bC = biomeRegistry.getByChar('C');
    const bc = biomeRegistry.getByChar('c');
    const bs = biomeRegistry.getByChar('s');
    const bW = biomeRegistry.getByChar('W');
    const bw = biomeRegistry.getByChar('w');

    const hills = (bH ? biomeWeightsMap.get(bH) : 0) || 0;
    const hillsLow = (bh ? biomeWeightsMap.get(bh) : 0) || 0;
    const mountain = (bM ? biomeWeightsMap.get(bM) : 0) || 0;
    const mountainLow = (bm ? biomeWeightsMap.get(bm) : 0) || 0;
    const canyon = (bC ? biomeWeightsMap.get(bC) : 0) || 0;
    const canyonLow = (bc ? biomeWeightsMap.get(bc) : 0) || 0;
    const clouds = (bs ? biomeWeightsMap.get(bs) : 0) || 0;
    const waterDeep = (bW ? biomeWeightsMap.get(bW) : 0) || 0;
    const waterShallow = (bw ? biomeWeightsMap.get(bw) : 0) || 0;

    const totalHills = hills + hillsLow;
    const totalMountain = mountain + mountainLow;
    const totalCanyon = canyon + canyonLow;
    const totalWater = waterDeep + waterShallow;
    const totalClouds = clouds;

    let primary: TerrainType = 'ROLLING_HILLS';
    let primaryBiome: Biome = bH || biomeRegistry.getDefault();

    const maxWeight = Math.max(totalHills, totalMountain, totalCanyon, totalWater, totalClouds);

    if (maxWeight === totalClouds && totalClouds > 0.001 && bs) {
      primary = 'HIGH_CLOUDS';
      primaryBiome = bs;
    } else if (maxWeight === totalWater && totalWater > 0.001) {
      if (waterDeep >= waterShallow && bW) {
        primary = 'DEEP_WATERS';
        primaryBiome = bW;
      } else if (bw) {
        primary = 'SHALLOW_WATERS';
        primaryBiome = bw;
      }
    } else if (maxWeight === totalMountain) {
      primary = 'RUGGED_MOUNTAIN';
      primaryBiome = mountain >= mountainLow ? (bM || bm!) : (bm || bM!);
    } else if (maxWeight === totalCanyon) {
      primary = 'DEEP_CANYON_SLOTS';
      primaryBiome = canyon >= canyonLow ? (bC || bc!) : (bc || bC!);
    } else {
      primary = 'ROLLING_HILLS';
      primaryBiome = hills >= hillsLow ? (bH || bh!) : (bh || bH!);
    }

    return {
      hills,
      hillsLow,
      mountain,
      mountainLow,
      canyon,
      canyonLow,
      waterDeep,
      waterShallow,
      clouds,
      primary,
      primaryBiome,
      biomeWeights: biomeWeightsMap,
    };
  }

  /**
   * Returns the exact X starting coordinate for a given level.
   * Level 0 starts at X = 0.
   * Level 1 starts at X = 0 (since Level 0 finishes straight ahead).
   * Level L starts at the endpoint of the chosen branch of Level L - 1.
   */
  public getLevelStartX(
    level: number,
    branchHistory?: Record<number, 'LEFT' | 'RIGHT'> | Map<number, 'LEFT' | 'RIGHT'>,
    customStartLvl?: number,
    customStartXVal?: number
  ): number {
    const sLvl = customStartLvl !== undefined ? customStartLvl : this.customStartLevel;
    const sX = customStartXVal !== undefined ? customStartXVal : this.customStartX;

    if (sLvl > 0 || sX !== 0) {
      if (level <= sLvl) return sX;
      let x = sX;
      for (let l = sLvl; l < level; l++) {
        let choice: 'LEFT' | 'RIGHT';
        if (x >= 3 * LATERAL_OFFSET - 1.0) {
          choice = 'RIGHT';
        } else if (x <= -3 * LATERAL_OFFSET + 1.0) {
          choice = 'LEFT';
        } else if (branchHistory) {
          const fromHist = branchHistory instanceof Map ? branchHistory.get(l) : branchHistory[l];
          choice = fromHist === 'LEFT' ? 'LEFT' : 'RIGHT';
        } else {
          const chosen = this.chosenBranches.get(l);
          if (chosen) {
            choice = chosen;
          } else {
            const br = this.getLevelBranch(l);
            choice = br === 'LEFT' ? 'LEFT' : 'RIGHT';
          }
        }
        x += choice === 'LEFT' ? LATERAL_OFFSET : -LATERAL_OFFSET;
      }
      return x;
    }

    if (level <= 0) return 0;
    let x = 0;
    for (let l = 1; l < level; l++) {
      let choice: 'LEFT' | 'RIGHT';
      if (x >= 3 * LATERAL_OFFSET - 1.0) {
        choice = 'RIGHT';
      } else if (x <= -3 * LATERAL_OFFSET + 1.0) {
        choice = 'LEFT';
      } else if (branchHistory) {
        const fromHist = branchHistory instanceof Map ? branchHistory.get(l) : branchHistory[l];
        choice = fromHist === 'LEFT' ? 'LEFT' : 'RIGHT';
      } else {
        const chosen = this.chosenBranches.get(l);
        if (chosen) {
          choice = chosen;
        } else {
          const br = this.getLevelBranch(l);
          choice = br === 'LEFT' ? 'LEFT' : 'RIGHT';
        }
      }
      x += choice === 'LEFT' ? LATERAL_OFFSET : -LATERAL_OFFSET;
    }
    return x;
  }

  /**
   * Returns the exact X finish coordinate for a level and branch:
   * - First level (Level 0): finish is exactly straight ahead of start (0 shift).
   * - Branching decision point (Level >= 1):
   *     - Left path: ends exactly 2 tiles to the left of start (+50m in world = screen left).
   *     - Right path: ends exactly 2 tiles to the right of start (-50m in world = screen right).
   */
  public getLevelEndX(
    level: number,
    branch?: 'SINGLE' | 'LEFT' | 'RIGHT',
    branchHistory?: Record<number, 'LEFT' | 'RIGHT'> | Map<number, 'LEFT' | 'RIGHT'>,
    customStartLvl?: number,
    customStartXVal?: number
  ): number {
    const sLvl = customStartLvl !== undefined ? customStartLvl : this.customStartLevel;
    const sX = customStartXVal !== undefined ? customStartXVal : this.customStartX;
    const startX = this.getLevelStartX(level, branchHistory, sLvl, sX);

    const forced = this.getForcedBoundaryBranch(level, branchHistory, sLvl, sX);

    let effectiveBranch: 'SINGLE' | 'LEFT' | 'RIGHT' | undefined =
      level <= 0
        ? 'SINGLE'
        : forced
        ? forced
        : branch && branch !== 'SINGLE'
        ? branch
        : undefined;

    if (!effectiveBranch) {
      if (branchHistory) {
        const fromHist = branchHistory instanceof Map ? branchHistory.get(level) : branchHistory[level];
        if (fromHist === 'LEFT' || fromHist === 'RIGHT') {
          effectiveBranch = fromHist;
        }
      }
      if (!effectiveBranch) {
        effectiveBranch = this.getLevelBranch(level);
      }
    }

    if (effectiveBranch === 'SINGLE') {
      return startX; // finish is exactly straight ahead
    }
    if (effectiveBranch === 'LEFT') {
      return startX + LATERAL_OFFSET; // exactly 2 tiles left (screen left = +X)
    }
    return startX - LATERAL_OFFSET; // exactly 2 tiles right (screen right = -X)
  }

  /**
   * "Ease In and Ease Out" for Decision Points:
   * 
   * (1) Ease In:
   * The two columns and their path before a Decision Point (Column 9 and 10)
   * smoothly turn in toward the decision point and align with the Z direction.
   * By Column 9 and 10 (u >= 0.80), the transition factor reaches 1.0 with
   * zero derivative, and all lateral wiggles taper to 0, ensuring the bird
   * flies straight ahead along +Z through Column 9, Column 10, and into the Decision Point.
   * 
   * (2) Ease Out:
   * The two columns and their path after a Decision Point (Column 1 and 2, u in [0, 0.20])
   * smoothly turn outward (turn left for a left path and turn right for a right path).
   * Formulated so the change of direction happens EXACTLY as you pass through the gust:
   * - Starts at u = 0 (the wind gust) with an immediate outward turn trajectory (T'(0) = 1.2, ~13.5° angle)
   * - Separation begins widening immediately from the very first meter after the gust
   * - Column 1 (u = 0.088, distance 22m): T = 0.18 (18m separation between Left and Right columns)
   * - Column 2 (u = 0.172, distance 43m): T = 0.40 (40m separation between Left and Right columns)
   * - Column 6 (u = 0.50, distance 125m): T = 0.84
   * - Column 9/10 (u = 0.80, distance 200m): T = 1.0, T' = 0 (smooth alignment with +Z into the next gust)
   */
  public getEaseInOutTransition(u: number): number {
    if (u <= 0) return 0;
    if (u >= 0.80) return 1.0;

    // Piecewise cubic Hermite spline ensuring C^1 continuity and immediate visual separation:
    if (u < 0.088) {
      const t = u / 0.088;
      // Hermite segment from (0, 0) with immediate outward slope T'(0) = 1.2 (~13.5° angle)
      // to (0.088, 0.18) with slope T'(0.088) = 2.4.
      // Direction change starts EXACTLY as you pass through the wind gust!
      return (-0.0432 * t + 0.1176) * t * t + 0.1056 * t;
    }
    if (u < 0.172) {
      const t = (u - 0.088) / 0.084;
      // Hermite segment from (0.088, 0.18, 2.4) to (0.172, 0.40, 2.6)
      const h00 = (2 * t - 3) * t * t + 1;
      const h10 = ((t - 2) * t + 1) * t;
      const h01 = (3 - 2 * t) * t * t;
      const h11 = (t - 1) * t * t;
      return h00 * 0.18 + h10 * 0.2016 + h01 * 0.40 + h11 * 0.2184;
    }
    if (u < 0.50) {
      const t = (u - 0.172) / 0.328;
      // Hermite segment from (0.172, 0.40, 2.6) to (0.50, 0.84, 0.9)
      const h00 = (2 * t - 3) * t * t + 1;
      const h10 = ((t - 2) * t + 1) * t;
      const h01 = (3 - 2 * t) * t * t;
      const h11 = (t - 1) * t * t;
      return h00 * 0.40 + h10 * 0.8528 + h01 * 0.84 + h11 * 0.2952;
    }
    // u in [0.50, 0.80]: Hermite segment from (0.50, 0.84, 0.9) to (0.80, 1.0, 0.0)
    const t = (u - 0.50) / 0.30;
    const h00 = (2 * t - 3) * t * t + 1;
    const h10 = ((t - 2) * t + 1) * t;
    const h01 = (3 - 2 * t) * t * t;
    const h11 = (t - 1) * t * t;
    return h00 * 0.84 + h10 * 0.27 + h01 * 1.0;
  }

  /**
   * Amplitude envelope for the mid-level slalom wiggles:
   * - 0 during Ease Out (Columns 1 & 2) so the outward turn is clean and predictable
   * - Smoothly ramps up for middle Columns 3 to 8
   * - Smoothly ramps down and is 0 during Ease In (Columns 9 & 10) so the path aligns
   *   completely straight with the Z direction into and through the Decision Point.
   */
  public getWiggleEnvelope(u: number): number {
    if (u <= 0.18) return 0;
    if (u < 0.28) {
      const t = (u - 0.18) / 0.10;
      return t * t * (3.0 - 2.0 * t);
    }
    if (u <= 0.66) return 1.0;
    if (u < 0.76) {
      const t = (0.76 - u) / 0.10;
      return t * t * (3.0 - 2.0 * t);
    }
    return 0;
  }

  /**
   * Continuous lateral X position along the path at distance z.
   * Incorporates Decision Point Ease In (Columns 9 & 10 align with +Z)
   * and Ease Out (Columns 1 & 2 smoothly turn outward).
   */
  public getLateralX(
    z: number,
    branch?: 'SINGLE' | 'LEFT' | 'RIGHT',
    branchHistory?: Record<number, 'LEFT' | 'RIGHT'> | Map<number, 'LEFT' | 'RIGHT'>,
    customStartLvl?: number,
    customStartXVal?: number
  ): number {
    const sLvl = customStartLvl !== undefined ? customStartLvl : this.customStartLevel;
    const sX = customStartXVal !== undefined ? customStartXVal : this.customStartX;

    if (z <= sLvl * LEVEL_LENGTH) return sX;
    const level = Math.floor(z / LEVEL_LENGTH);
    const zInLevel = z - level * LEVEL_LENGTH;
    const u = Math.max(0, Math.min(1.0, zInLevel / LEVEL_LENGTH));

    const forced = this.getForcedBoundaryBranch(level, branchHistory, sLvl, sX);

    let effectiveBranch: 'SINGLE' | 'LEFT' | 'RIGHT' | undefined =
      level <= 0
        ? 'SINGLE'
        : forced
        ? forced
        : branch && branch !== 'SINGLE'
        ? branch
        : undefined;

    if (!effectiveBranch) {
      if (branchHistory) {
        const fromHist = branchHistory instanceof Map ? branchHistory.get(level) : branchHistory[level];
        if (fromHist === 'LEFT' || fromHist === 'RIGHT') {
          effectiveBranch = fromHist;
        }
      }
      if (!effectiveBranch) {
        effectiveBranch = this.getLevelBranch(level);
      }
    }

    const startX = this.getLevelStartX(level, branchHistory, sLvl, sX);
    const endX = this.getLevelEndX(level, effectiveBranch, branchHistory, sLvl, sX);
    const deltaX = endX - startX;

    // Ease In and Ease Out transition between startX and endX:
    // - Ease Out: Column 1 and 2 smoothly turn outward (left for left branch, right for right branch)
    // - Middle: Columns 3 to 8 carry through the main level corridor
    // - Ease In: Column 9 and 10 smoothly turn in toward the decision point and align with +Z
    const easeT = this.getEaseInOutTransition(u);
    const baseTransition = startX + deltaX * easeT;

    // Mid-level slalom wiggles with envelope that is strictly 0 during Ease Out (Col 1-2)
    // and strictly 0 during Ease In (Col 9-10), preserving the smooth lead in and lead out.
    const envelope = this.getWiggleEnvelope(u);

    // Deterministic random seed derived from world (startX, level * LEVEL_LENGTH) coordinates
    const branchMod = effectiveBranch === 'LEFT' ? 1.0 : effectiveBranch === 'RIGHT' ? 2.0 : 0.0;
    const seed = FlightPathGenerator.getSeed(startX, level * LEVEL_LENGTH, branchMod);

    // Use the tile seed to dynamically sculpt the rhythm (frequencies), shape (phases), and amplitudes:
    // 1. Rhythms: vary frequency multipliers so wave cycles and turning points differ per level
    const f1 = 1.6 + pseudoRandom(seed + 1.0) * 1.2; // 1.6 to 2.8 cycles
    const f2 = 3.2 + pseudoRandom(seed + 2.0) * 2.0; // 3.2 to 5.2 cycles
    const f3 = 5.5 + pseudoRandom(seed + 3.0) * 2.5; // 5.5 to 8.0 cycles

    // 2. Shapes: phase shifts so peaks and troughs shift position along the level
    const phi1 = pseudoRandom(seed + 4.0) * Math.PI * 2.0;
    const phi2 = pseudoRandom(seed + 5.0) * Math.PI * 2.0;
    const phi3 = pseudoRandom(seed + 6.0) * Math.PI * 2.0;

    // 3. Amplitudes and initial turn biases
    const ampScale = level === 0 || effectiveBranch === 'SINGLE' ? 1.15 : 1.0;
    const a1 = (11.0 + pseudoRandom(seed + 7.0) * 5.0) * ampScale;
    const a2 = (5.5 + pseudoRandom(seed + 8.0) * 3.5) * ampScale;
    const a3 = (2.5 + pseudoRandom(seed + 9.0) * 2.0) * ampScale;

    // Directional bias derived from branch and tile seed
    const dirBias = effectiveBranch === 'LEFT' ? -1 : effectiveBranch === 'RIGHT' ? 1 : (pseudoRandom(seed + 10.0) > 0.5 ? 1 : -1);
    const sign2 = pseudoRandom(seed + 11.0) > 0.5 ? 1 : -1;

    const curve =
      envelope *
      (Math.sin(u * Math.PI * f1 + phi1) * a1 * dirBias +
        Math.sin(u * Math.PI * f2 + phi2) * a2 * sign2 +
        Math.sin(u * Math.PI * f3 + phi3) * a3);

    return baseTransition + curve;
  }

  /**
   * Continuous elevation Y along the path following the biomes.
   * Samples along the true flight trajectory (x(z), z) and applies
   * low-pass moving-average filtering over a 56m forward/backward window (~2.67 columns).
   * This ensures altitude transitions (such as climbing into and descending from the clouds)
   * occur smoothly over two to three columns. Short cloud sections gracefully crest without forcing
   * full altitude.
   */
  public getElevationY(z: number, x?: number): number {
    // 7-point Hann-weighted moving average filter over a 56m forward/backward window (~2.67 columns)
    // Sample spacing = 7.0m (1/3 column). Offsets: 0, ±7m, ±14m, ±21m.
    // Weights: cos^2 tapered window normalized strictly to 1.0 (w0 + 2*w1 + 2*w2 + 2*w3 = 1.0)
    const w0 = 0.25;
    const w1 = 0.213388;
    const w2 = 0.125;
    const w3 = 0.036612;

    const yMid = this.getRawElevationAt(z, x);
    const yPrev1 = this.getRawElevationAt(z - 7.0, x);
    const yNext1 = this.getRawElevationAt(z + 7.0, x);
    const yPrev2 = this.getRawElevationAt(z - 14.0, x);
    const yNext2 = this.getRawElevationAt(z + 14.0, x);
    const yPrev3 = this.getRawElevationAt(z - 21.0, x);
    const yNext3 = this.getRawElevationAt(z + 21.0, x);

    return (
      w0 * yMid +
      w1 * (yPrev1 + yNext1) +
      w2 * (yPrev2 + yNext2) +
      w3 * (yPrev3 + yNext3)
    );
  }

  private getRawElevationAt(z: number, x?: number): number {
    const resolvedX = x !== undefined ? x : this.getLateralX(z, 'SINGLE');
    const weights = this.getBiomeWeights(resolvedX, z);

    // Harmonized base corridor elevation to prevent artificial step jumps across biome borders
    const baseCorridorY = 15.0;

    let undulation = 0;
    if (weights.biomeWeights) {
      for (const [biome, w] of weights.biomeWeights.entries()) {
        if (w > 0.0001) {
          undulation += w * biome.getPathUndulation(z, resolvedX);
        }
      }
    } else {
      // Fallback
      undulation =
        weights.hills * (biomeRegistry.getByChar('H')?.getPathUndulation(z, resolvedX) ?? 0) +
        weights.hillsLow * (biomeRegistry.getByChar('h')?.getPathUndulation(z, resolvedX) ?? 0) +
        weights.mountain * (biomeRegistry.getByChar('M')?.getPathUndulation(z, resolvedX) ?? 0) +
        weights.mountainLow * (biomeRegistry.getByChar('m')?.getPathUndulation(z, resolvedX) ?? 0) +
        weights.canyon * (biomeRegistry.getByChar('C')?.getPathUndulation(z, resolvedX) ?? 0) +
        weights.canyonLow * (biomeRegistry.getByChar('c')?.getPathUndulation(z, resolvedX) ?? 0) +
        (weights.clouds || 0) * (biomeRegistry.getByChar('s')?.getPathUndulation(z, resolvedX) ?? 0) +
        (weights.waterDeep || 0) * (biomeRegistry.getByChar('W')?.getPathUndulation(z, resolvedX) ?? 0) +
        (weights.waterShallow || 0) * (biomeRegistry.getByChar('w')?.getPathUndulation(z, resolvedX) ?? 0);
    }

    return baseCorridorY + undulation;
  }

  public getRawCenterPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const x = this.getLateralX(t, 'SINGLE');
    const y = this.getElevationY(t, x);
    target.set(x, y, t);
    return target;
  }

  public getPathPoint(
    z: number,
    branch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE',
    lateralOffset: number = 0,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    const x = this.getLateralX(z, branch) + lateralOffset;
    const y = this.getElevationY(z, x);
    target.set(x, y, z);
    return target;
  }

  public getPoint(
    z: number,
    branchOrOffset?: 'SINGLE' | 'LEFT' | 'RIGHT' | number,
    lateralOffset: number = 0,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    let branch: 'SINGLE' | 'LEFT' | 'RIGHT';
    let offset = lateralOffset;

    if (typeof branchOrOffset === 'number') {
      offset = branchOrOffset;
      branch = this.getBranchAtDistance(z);
    } else if (typeof branchOrOffset === 'string') {
      const level = Math.floor(z / LEVEL_LENGTH);
      branch =
        level === 0
          ? 'SINGLE'
          : branchOrOffset !== 'SINGLE'
          ? branchOrOffset
          : this.getLevelBranch(level);
    } else {
      branch = this.getBranchAtDistance(z);
    }

    return this.getPathPoint(z, branch, offset, target);
  }

  public getDerivative(
    z: number,
    branchOrOffset?: 'SINGLE' | 'LEFT' | 'RIGHT' | number,
    lateralOffset: number = 0,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    const eps = 0.1; // Central difference over 20cm window for clean, smooth C^1 continuity
    const pPrev = this.getPoint(z - eps, branchOrOffset, lateralOffset);
    const pNext = this.getPoint(z + eps, branchOrOffset, lateralOffset);
    target.subVectors(pNext, pPrev).multiplyScalar(1.0 / (2.0 * eps));
    target.z = 1.0;
    return target;
  }

  public getSecondDerivative(
    z: number,
    branchOrOffset?: 'SINGLE' | 'LEFT' | 'RIGHT' | number,
    lateralOffset: number = 0,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    const eps = 0.1; // Central second difference over 20cm window for stable curvature
    const p0 = this.getPoint(z, branchOrOffset, lateralOffset);
    const pPrev = this.getPoint(z - eps, branchOrOffset, lateralOffset);
    const pNext = this.getPoint(z + eps, branchOrOffset, lateralOffset);
    target.set(
      (pNext.x - 2.0 * p0.x + pPrev.x) / (eps * eps),
      (pNext.y - 2.0 * p0.y + pPrev.y) / (eps * eps),
      0.0
    );
    return target;
  }

  public getFrame(
    z: number,
    branchOrOffset?: 'SINGLE' | 'LEFT' | 'RIGHT' | number,
    lateralOffset: number = 0
  ): PathFrame {
    const pos = this.getPoint(z, branchOrOffset, lateralOffset);
    const deriv = this.getDerivative(z, branchOrOffset, lateralOffset);
    const tangent = deriv.clone().normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(worldUp, tangent).normalize();
    if (right.lengthSq() < 0.0001) {
      right = new THREE.Vector3(1, 0, 0);
    }
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();

    const d2 = this.getSecondDerivative(z, branchOrOffset, lateralOffset);
    const curvature = d2.x;
    const elevationSlope = deriv.y;

    return {
      position: pos,
      tangent,
      right,
      up,
      curvature,
      elevationSlope,
    };
  }

  /**
   * Distance for 1-indexed columns.
   * Each level contains exactly 10 columns within 250m.
   */
  public getColumnDistance(colIndex: number): number {
    const level = Math.max(0, Math.floor((colIndex - 1) / COLUMNS_PER_LEVEL));
    const j = (colIndex - 1) % COLUMNS_PER_LEVEL;
    return level * LEVEL_LENGTH + 22.0 + j * 21.0;
  }

  /**
   * Distance for the Wind Gust decision point for a given level (0-indexed).
   * Placed exactly at the boundary between levels (e.g. Level 0 -> 250m, Level 1 -> 500m)
   * where Ease In finishes (columns 9 & 10 aligned with +Z) and Ease Out immediately begins turning outward
   * exactly as you pass through the gust.
   */
  public getDecisionPointDistance(level: number): number {
    return (level + 1) * LEVEL_LENGTH;
  }

  public getColumnGapCenterY(distance: number, _mountainWeight?: number, x?: number): number {
    const resolvedX = x !== undefined ? x : this.getLateralX(distance, 'SINGLE');
    const weights = this.getBiomeWeights(resolvedX, distance);

    let gapCenterY = 0;
    if (weights.biomeWeights) {
      for (const [biome, w] of weights.biomeWeights.entries()) {
        if (w > 0.0001) {
          gapCenterY += w * biome.getColumnGapCenterY(distance);
        }
      }
      return gapCenterY;
    }

    // Generic evaluation fallback across active biomes
    const m = (weights.mountain || 0) + (weights.mountainLow || 0) * 0.75;
    const c = (weights.canyon || 0) + (weights.canyonLow || 0) * 0.75;
    const s = weights.clouds || 0;

    const mBiome = biomeRegistry.getByChar('M');
    const cBiome = biomeRegistry.getByChar('C');
    const sBiome = biomeRegistry.getByChar('s');

    if (m > 0.001 && mBiome) gapCenterY += m * mBiome.getColumnGapCenterY(distance);
    if (c > 0.001 && cBiome) gapCenterY += c * cBiome.getColumnGapCenterY(distance);
    if (s > 0.001 && sBiome) gapCenterY += s * sBiome.getColumnGapCenterY(distance);

    return gapCenterY;
  }

  public getColumnGapBottomRelY(z: number): number {
    const level = Math.max(0, Math.floor(z / LEVEL_LENGTH));
    const zStart = level * LEVEL_LENGTH;
    const zInLevel = z - zStart;

    // 10 columns are at relative distances: 22, 43, 64, 85, 106, 127, 148, 169, 190, 211
    if (zInLevel <= 22.0) {
      const t = Math.max(0, zInLevel / 22.0);
      const s = t * t * (3.0 - 2.0 * t);
      const gapCenterY = s * this.getColumnGapCenterY(zStart + 22.0);
      return gapCenterY - this.columnGapHalfHeight;
    }

    if (zInLevel >= 211.0) {
      // Between column 10 and next level's column 1
      const zCol10 = zStart + 211.0;
      const zNextCol1 = (level + 1) * LEVEL_LENGTH + 22.0;
      const t = Math.max(0, Math.min(1.0, (z - zCol10) / (zNextCol1 - zCol10)));
      const s = t * t * (3.0 - 2.0 * t);
      const gapCenterA = this.getColumnGapCenterY(zCol10);
      const gapCenterB = this.getColumnGapCenterY(zNextCol1);
      return gapCenterA + s * (gapCenterB - gapCenterA) - this.columnGapHalfHeight;
    }

    // Between columns within the level
    const j = Math.max(0, Math.min(8, Math.floor((zInLevel - 22.0) / 21.0)));
    const zA = zStart + 22.0 + j * 21.0;
    const zB = zA + 21.0;
    const t = Math.max(0, Math.min(1.0, (z - zA) / 21.0));
    const s = t * t * (3.0 - 2.0 * t);
    const gapCenterA = this.getColumnGapCenterY(zA);
    const gapCenterB = this.getColumnGapCenterY(zB);
    return gapCenterA + s * (gapCenterB - gapCenterA) - this.columnGapHalfHeight;
  }

  /**
   * Lateral offsets of all active flight corridors at distance z.
   * Level 0: 1 corridor (straight ahead).
   * Level >= 1: 2 corridors (LEFT and RIGHT, both fixed!).
   */
  public getActiveCorridorOffsets(z: number): number[] {
    const level = Math.floor(z / LEVEL_LENGTH);
    if (level <= 0 && this.customStartLevel === 0 && this.customStartX === 0) {
      return [this.getLateralX(z, 'SINGLE')];
    }
    return [this.getLateralX(z, 'LEFT'), this.getLateralX(z, 'RIGHT')];
  }

  private branchPool: ActiveBranchInfo[] = [
    { offset: 0, point: new THREE.Vector3(), branch: 'SINGLE', isVeering: false },
    { offset: 0, point: new THREE.Vector3(), branch: 'LEFT', isVeering: false },
  ];
  private branchResult: ActiveBranchInfo[] = [];

  public getActiveBranchesAt(z: number): ActiveBranchInfo[] {
    const level = Math.floor(z / LEVEL_LENGTH);
    this.branchResult.length = 0;

    if (level <= 0 && this.customStartLevel === 0 && this.customStartX === 0) {
      const b0 = this.branchPool[0];
      b0.branch = 'SINGLE';
      b0.offset = this.getLateralX(z, 'SINGLE');
      this.getPathPoint(z, 'SINGLE', 0, b0.point);
      b0.isVeering = false;
      this.branchResult.push(b0);
    } else {
      const forced = this.getForcedBoundaryBranch(level);
      if (forced === 'RIGHT') {
        const bRight = this.branchPool[1];
        bRight.branch = 'RIGHT';
        bRight.offset = this.getLateralX(z, 'RIGHT');
        this.getPathPoint(z, 'RIGHT', 0, bRight.point);
        bRight.isVeering = false;
        this.branchResult.push(bRight);
      } else if (forced === 'LEFT') {
        const bLeft = this.branchPool[0];
        bLeft.branch = 'LEFT';
        bLeft.offset = this.getLateralX(z, 'LEFT');
        this.getPathPoint(z, 'LEFT', 0, bLeft.point);
        bLeft.isVeering = false;
        this.branchResult.push(bLeft);
      } else {
        const bLeft = this.branchPool[0];
        bLeft.branch = 'LEFT';
        bLeft.offset = this.getLateralX(z, 'LEFT');
        this.getPathPoint(z, 'LEFT', 0, bLeft.point);
        bLeft.isVeering = false;

        const bRight = this.branchPool[1];
        bRight.branch = 'RIGHT';
        bRight.offset = this.getLateralX(z, 'RIGHT');
        this.getPathPoint(z, 'RIGHT', 0, bRight.point);
        bRight.isVeering = false;

        this.branchResult.push(bLeft, bRight);
      }
    }

    return this.branchResult;
  }

  public getNaturalTerrainHeight(x: number, z: number, weights: BiomeWeights): number {
    let natural = 0;
    const rawCenter = this.getRawCenterPoint(z);

    // Resolve nearest active corridor branch at (x, z) so canyon gorges and rivers strictly follow active flight paths
    const branches = this.getActiveBranchesAt(z);
    let rawCenterX = rawCenter.x;
    let rawCenterY = rawCenter.y;
    if (branches && branches.length > 0) {
      let minPerp = Infinity;
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        const d = Math.abs(x - b.point.x);
        if (d < minPerp) {
          minPerp = d;
          rawCenterX = b.point.x;
          rawCenterY = b.point.y;
        }
      }
    }
    const context = { rawCenterX, rawCenterY };

    if (weights.biomeWeights) {
      for (const [biome, w] of weights.biomeWeights.entries()) {
        if (w > 0.0001) {
          natural += w * biome.getNaturalTerrainHeight(x, z, context);
        }
      }
    } else {
      const bH = biomeRegistry.getByChar('H');
      const bh = biomeRegistry.getByChar('h');
      const bM = biomeRegistry.getByChar('M');
      const bm = biomeRegistry.getByChar('m');
      const bC = biomeRegistry.getByChar('C');
      const bc = biomeRegistry.getByChar('c');
      const bs = biomeRegistry.getByChar('s');
      const bW = biomeRegistry.getByChar('W');
      const bw = biomeRegistry.getByChar('w');

      if (weights.hills > 0.001 && bH) natural += weights.hills * bH.getNaturalTerrainHeight(x, z, context);
      if (weights.hillsLow > 0.001 && bh) natural += weights.hillsLow * bh.getNaturalTerrainHeight(x, z, context);
      if (weights.mountain > 0.001 && bM) natural += weights.mountain * bM.getNaturalTerrainHeight(x, z, context);
      if (weights.mountainLow > 0.001 && bm) natural += weights.mountainLow * bm.getNaturalTerrainHeight(x, z, context);
      if (weights.canyon > 0.001 && bC) natural += weights.canyon * bC.getNaturalTerrainHeight(x, z, context);
      if (weights.canyonLow > 0.001 && bc) natural += weights.canyonLow * bc.getNaturalTerrainHeight(x, z, context);
      if ((weights.clouds || 0) > 0.001 && bs) natural += weights.clouds! * bs.getNaturalTerrainHeight(x, z, context);
      if ((weights.waterDeep || 0) > 0.001 && bW) natural += weights.waterDeep! * bW.getNaturalTerrainHeight(x, z, context);
      if ((weights.waterShallow || 0) > 0.001 && bw) natural += weights.waterShallow! * bw.getNaturalTerrainHeight(x, z, context);
    }

    // Deep canyon valley incision:
    // When canyon biome is present, carve the deep slot canyon gorge and riverbed through the terrain
    const canyonWeight = (weights.canyon || 0) + (weights.canyonLow || 0);
    if (canyonWeight > 0.15) {
      const bC = biomeRegistry.getByChar('C');
      const bc = biomeRegistry.getByChar('c');
      const canyonBiome = (weights.canyon || 0) >= (weights.canyonLow || 0) ? bC : bc;
      if (canyonBiome) {
        const canyonH = canyonBiome.getNaturalTerrainHeight(x, z, context);
        const dx = Math.abs(x - rawCenterX);
        if (dx <= 10.5) {
          const gorgeT = THREE.MathUtils.clamp((10.5 - dx) / 4.5, 0, 1);
          const cutDepth = THREE.MathUtils.clamp(canyonWeight * 1.5, 0, 1) * gorgeT;
          natural = THREE.MathUtils.lerp(natural, Math.min(natural, canyonH), cutDepth);
        }
      }
    }

    return natural;
  }

  private scratchPt = new THREE.Vector3();

  /**
   * Sample continuous terrain height at (x, z).
   * Both left and right corridors are carved permanently into the terrain.
   */
  public getTerrainHeight(
    x: number,
    z: number,
    precomputedWeights?: BiomeWeights,
    precomputedBranches?: ActiveBranchInfo[]
  ): number {
    const weights = precomputedWeights || this.getBiomeWeights(x, z);
    const naturalHeight = this.getNaturalTerrainHeight(x, z, weights);

    // Corridor geometry parameters
    const canyonWeight = (weights.canyon || 0) + (weights.canyonLow || 0);
    const rFloor = THREE.MathUtils.lerp(7.0, 0.8, canyonWeight);  // Narrow floor width to preserve sharp V bottom in canyon (m)
    const rWall = THREE.MathUtils.lerp(22.0, 10.5, canyonWeight);  // Transition width from corridor floor up to natural terrain (m)

    const gapBottomRelY = this.getColumnGapBottomRelY(z);

    let minCeiling = Infinity;
    let closestDist = Infinity;

    // Check all active flight corridors at distance z
    const offsets = this.getActiveCorridorOffsets(z);
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i];
      const dPerp = Math.abs(x - offset);
      if (dPerp < closestDist) {
        closestDist = dPerp;
      }

      if (dPerp < rWall) {
        const elevationY = this.getElevationY(z, offset);
        const worldGapBottomY = elevationY + gapBottomRelY;
        const safeFloor = worldGapBottomY - this.clearanceMargin;

        let ceiling: number;
        if (dPerp <= rFloor) {
          ceiling = safeFloor;
        } else {
          const u = (dPerp - rFloor) / (rWall - rFloor);
          const s = u * u * (3.0 - 2.0 * u);
          ceiling = safeFloor + s * Math.max(0, naturalHeight - safeFloor);
        }

        if (ceiling < minCeiling) {
          minCeiling = ceiling;
        }
      }
    }

    let finalHeight = Math.min(naturalHeight, minCeiling);

    // Voxel block stepping around pillars
    const pillarInfluence = Math.max(0, Math.min(1.0, (26.0 - closestDist) / 18.0));
    if (pillarInfluence > 0.0) {
      const blockVariant = Math.sin(Math.floor(x / 2.5) * 1.7 + Math.floor(z / 2.5) * 1.3) * 0.35;
      const stepped = Math.floor(finalHeight + blockVariant * pillarInfluence);
      finalHeight = Math.min(finalHeight, THREE.MathUtils.lerp(finalHeight, stepped, pillarInfluence));
    }

    return finalHeight;
  }
}

export const flightPath = new FlightPathGenerator();
