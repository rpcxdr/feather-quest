import * as THREE from 'three';
import { BiomeWeights, FlightPathGenerator, flightPath } from './pathGenerator';
import { biomeRegistry, Biome } from '../biomes';

export type CloudFormationRole = 'LEFT_FLANK' | 'RIGHT_FLANK' | 'CANOPY' | 'FLOOR' | 'AMBIENT';

interface CloudPuffData {
  sprite: THREE.Sprite;
  baseLocalPos: THREE.Vector3;
  baseScale: THREE.Vector2;
  rotSpeed: number;
  isBase: boolean;
  isCrest: boolean;
}

interface CloudCluster {
  group: THREE.Group;
  type: 'cumulus' | 'cirrus' | 'heavy_corridor';
  puffs: CloudPuffData[];
  driftSpeedX: number;
  driftSpeedZ: number;
  baseX: number;
  baseY: number;
  initialScale: number;
  role: CloudFormationRole;
  phase: number;
}

/**
 * Deterministic pseudo-random number sampler driven by the path's static generator
 */
class DeterministicRNG {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  public next(): number {
    this.seed += 1.0;
    return FlightPathGenerator.pseudoRandom(this.seed);
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public sign(): number {
    return this.next() > 0.5 ? 1 : -1;
  }
}

/**
 * Creates a high-fidelity procedural cloud puff texture using a 2D canvas.
 * Applies multi-octave harmonic noise to deform a radial gradient, producing
 * soft, vaporous, cauliflower-like billows with realistic feathered edges.
 */
function createProceduralCloudTexture(isCirrus: boolean = false): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  // Simple, fast deterministic value noise generator
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = isCirrus ? 1337 : 42;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const noise2D = (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = perm[X] + Y;
    const b = perm[X + 1] + Y;
    const v00 = (perm[a] % 100) / 100;
    const v10 = (perm[b] % 100) / 100;
    const v01 = (perm[a + 1] % 100) / 100;
    const v11 = (perm[b + 1] % 100) / 100;
    const x1 = v00 + u * (v10 - v00);
    const x2 = v01 + u * (v11 - v01);
    return x1 + v * (x2 - x1);
  };

  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const ny = (y - half) / (isCirrus ? half * 0.45 : half * 0.88);
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / (isCirrus ? half * 0.95 : half * 0.88);
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist >= 1.0) continue;

      let n = 0;
      if (isCirrus) {
        n = noise2D(nx * 2.5 + 5.0, ny * 9.0 + 5.0) * 0.65 +
            noise2D(nx * 6.0 + 10.0, ny * 18.0 + 10.0) * 0.35;
      } else {
        n = noise2D(nx * 3.2 + 8.0, ny * 3.2 + 8.0) * 0.55 +
            noise2D(nx * 6.5 + 16.0, ny * 6.5 + 16.0) * 0.30 +
            noise2D(nx * 13.0 + 24.0, ny * 13.0 + 24.0) * 0.15;
      }

      const maxRadius = isCirrus ? (0.65 + 0.35 * n) : (0.72 + 0.38 * n);
      const normDist = dist / maxRadius;
      if (normDist >= 1.0) continue;

      const falloff = 1.0 - normDist;
      const ease = falloff * falloff * (3.0 - 2.0 * falloff);
      const alpha = Math.min(1.0, Math.pow(ease * (0.85 + 0.35 * n), isCirrus ? 1.4 : 1.15));

      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.floor(alpha * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export class CloudSystem {
  public group: THREE.Group;
  private clusters: CloudCluster[] = [];
  private heavyCorridorClusters: CloudCluster[] = [];
  private cumulusTexture: THREE.CanvasTexture;
  private cirrusTexture: THREE.CanvasTexture;

  // Distinct materials for realistic anatomical lighting:
  private baseMaterial: THREE.SpriteMaterial;
  private coreMaterial: THREE.SpriteMaterial;
  private crestMaterial: THREE.SpriteMaterial;
  private wispMaterial: THREE.SpriteMaterial;
  private cirrusMaterial: THREE.SpriteMaterial;

  // Dedicated materials for "s" sky terrain heavy corridor clouds (for smooth altitude-triggered fading)
  private heavyBaseMaterial: THREE.SpriteMaterial;
  private heavyCoreMaterial: THREE.SpriteMaterial;
  private heavyCrestMaterial: THREE.SpriteMaterial;
  private heavyWispMaterial: THREE.SpriteMaterial;

  private animTime: number = 0;

  constructor() {
    this.group = new THREE.Group();

    this.cumulusTexture = createProceduralCloudTexture(false);
    this.cirrusTexture = createProceduralCloudTexture(true);

    this.baseMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xc6d7e8),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      fog: true,
    });

    this.coreMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xf4f7fa),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: true,
    });

    this.crestMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: true,
    });

    this.wispMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      fog: true,
    });

    this.cirrusMaterial = new THREE.SpriteMaterial({
      map: this.cirrusTexture,
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      fog: true,
    });

    this.heavyBaseMaterial = this.baseMaterial.clone();
    this.heavyCoreMaterial = this.coreMaterial.clone();
    this.heavyCrestMaterial = this.crestMaterial.clone();
    this.heavyWispMaterial = this.wispMaterial.clone();

    this.initClouds();
  }

  /**
   * Initializes real-life cloud formations:
   * 1. Mid-altitude realistic cumulus formations
   * 2. High-altitude expansive cirrus and stratocumulus streaks
   * 3. Heavy corridor clouds structured to flank the path and frame columns clearly
   */
  private initClouds() {
    // 24 mid-altitude cumulus cloud formations
    const cumulusCount = 24;
    for (let i = 0; i < cumulusCount; i++) {
      const z = -60 + (i / cumulusCount) * 340;
      const seed = FlightPathGenerator.getSeed(0, z, i);
      const rng = new DeterministicRNG(seed);
      const x = (rng.next() - 0.5) * 190;
      const y = 34 + rng.next() * 24;
      const cluster = this.createCumulusCluster(x, y, z, seed);
      this.clusters.push(cluster);
      this.group.add(cluster.group);
    }

    // 10 high-altitude panoramic cirrus bands (y = 70 to 92)
    const cirrusCount = 10;
    for (let i = 0; i < cirrusCount; i++) {
      const z = -40 + (i / cirrusCount) * 340;
      const seed = FlightPathGenerator.getSeed(0, z, 100 + i);
      const rng = new DeterministicRNG(seed);
      const x = (rng.next() - 0.5) * 240;
      const y = 70 + rng.next() * 22;
      const cluster = this.createCirrusCluster(x, y, z, seed);
      this.clusters.push(cluster);
      this.group.add(cluster.group);
    }

    // 16 heavy corridor cloud formations for Clouds / Sky biome ("s")
    const heavyCount = 16;
    for (let i = 0; i < heavyCount; i++) {
      const z = 20 + i * 16;
      const spawn = this.getHeavyCorridorSpawn(z, i, flightPath);
      const cluster = this.createHeavyCorridorCluster(spawn.x, spawn.y, spawn.z, spawn.role);
      cluster.group.visible = false;
      this.heavyCorridorClusters.push(cluster);
      this.group.add(cluster.group);
    }
  }

  /**
   * Deterministically calculates a safe flanking, canopy, or floor position for a heavy corridor cloud
   * using the path's static pseudo-random number generator (x, z).
   *
   * Non-obscuring heuristics:
   * 1. Heavy clouds flank the corridor (left/right walls) or float as a high canopy or sea of clouds below.
   * 2. The flight corridor sightline is strictly guarded (min lateral clearance >= 22m, >= 26m near columns).
   * 3. Multi-branch safety: ensures clearance across all active branching corridors.
   * 4. Zero lateral cross-corridor drift: clouds never drift across the player's line of sight to upcoming columns.
   */
  public getHeavyCorridorSpawn(
    z: number,
    index: number,
    pathGen: FlightPathGenerator = flightPath
  ): { x: number; y: number; z: number; role: CloudFormationRole } {
    const pt = pathGen.getPathPoint(z);
    const seed = FlightPathGenerator.getSeed(pt.x, z, index + 1);
    const rng = new DeterministicRNG(seed);

    // Deterministic role cycling: Left Flank (40%), Right Flank (40%), Overhead Canopy (15%), Floor (5%)
    const roleCycle = index % 5;
    let role: CloudFormationRole = 'LEFT_FLANK';
    if (roleCycle === 0 || roleCycle === 3) {
      role = 'LEFT_FLANK';
    } else if (roleCycle === 1 || roleCycle === 4) {
      role = 'RIGHT_FLANK';
    } else {
      role = rng.next() > 0.25 ? 'CANOPY' : 'FLOOR';
    }

    // Check proximity to any upcoming column in this vicinity
    const colLevel = Math.max(0, Math.floor(z / 250.0));
    let isNearColumn = false;
    for (let c = 1; c <= 10; c++) {
      const colDist = colLevel * 250.0 + 22.0 + (c - 1) * 21.0;
      if (Math.abs(z - colDist) < 18.0) {
        isNearColumn = true;
        break;
      }
    }

    // Minimum lateral clearance from corridor center: 22m generally, 26m near upcoming columns
    const minClearanceX = isNearColumn ? 26.0 : 22.0;
    const lateralSpan = 16.0;

    let x = pt.x;
    let y = pt.y;

    if (role === 'LEFT_FLANK') {
      // In 3D world (camera looking +Z), left is positive X
      const offset = minClearanceX + rng.next() * lateralSpan;
      x = pt.x + offset;
      y = pt.y + (rng.next() - 0.5) * 4.0;
    } else if (role === 'RIGHT_FLANK') {
      // Right is negative X
      const offset = minClearanceX + rng.next() * lateralSpan;
      x = pt.x - offset;
      y = pt.y + (rng.next() - 0.5) * 4.0;
    } else if (role === 'CANOPY') {
      // High overhead canopy comfortably above columns and line of sight
      y = pt.y + (isNearColumn ? 17.0 : 14.0) + rng.next() * 10.0;
      x = pt.x + (rng.next() - 0.5) * 26.0;
    } else {
      // Sea of clouds below flight elevation
      y = pt.y - (isNearColumn ? 16.0 : 13.0) - rng.next() * 8.0;
      x = pt.x + (rng.next() - 0.5) * 26.0;
    }

    // Multi-branch safety: ensure clearance against all active corridors at distance z
    const activeOffsets = pathGen.getActiveCorridorOffsets(z);
    for (const off of activeOffsets) {
      const dX = Math.abs(x - off);
      const dY = Math.abs(y - pt.y);
      if (dX < minClearanceX && dY < 12.0) {
        x = x >= off ? off + minClearanceX + 2.0 : off - minClearanceX - 2.0;
      }
    }

    return { x, y, z, role };
  }

  /**
   * Constructs heavy, dense volumetric corridor clouds for the Clouds / Sky biome ("s"):
   * - Uses identical procedural cloud textures and materials as ambient cumulus
   * - Arranged into flanking canyon walls, canopy ceiling, and valley floor around flight corridor
   * - Strictly positioned outside the flight corridor sightline so columns are NEVER obscured
   * - Seeded with the path's static pseudo-random number generator derived from (x, z)
   */
  private createHeavyCorridorCluster(
    x: number,
    y: number,
    z: number,
    role: CloudFormationRole = 'LEFT_FLANK'
  ): CloudCluster {
    const group = new THREE.Group();
    const puffs: CloudPuffData[] = [];

    const seed = FlightPathGenerator.getSeed(x, z);
    const rng = new DeterministicRNG(seed);

    const clusterScale = 1.4 + rng.next() * 0.6;
    const widthSpread = (24 + rng.next() * 14) * clusterScale;
    const depthSpread = (18 + rng.next() * 12) * clusterScale;

    // Outward bias away from flight corridor center
    const biasX = role === 'LEFT_FLANK' ? 3.0 : role === 'RIGHT_FLANK' ? -3.0 : 0;
    const biasY = role === 'CANOPY' ? 3.0 : role === 'FLOOR' ? -3.0 : 0;

    // 1. Flat Base Puffs (5-7 puffs along condensation plane)
    const baseCount = 5 + Math.floor(rng.next() * 3);
    for (let b = 0; b < baseCount; b++) {
      const sprite = new THREE.Sprite(this.heavyBaseMaterial);
      const bx = ((b / (baseCount - 1 || 1)) - 0.5) * widthSpread * 0.85 + (rng.next() - 0.5) * 4 + biasX;
      const bz = (rng.next() - 0.5) * depthSpread * 0.7;
      const by = (rng.next() - 0.5) * 1.2 + biasY;

      const pScale = (15 + rng.next() * 8) * clusterScale;
      sprite.scale.set(pScale * 1.35, pScale * 0.8, 1);
      sprite.position.set(bx, by, bz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.016,
        isBase: true,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 2. Heavy Volumetric Core Puffs (7-10 dense overlapping puffs)
    const coreCount = 7 + Math.floor(rng.next() * 4);
    for (let c = 0; c < coreCount; c++) {
      const sprite = new THREE.Sprite(this.heavyCoreMaterial);
      const cx = (rng.next() - 0.5) * widthSpread * 0.7 + biasX;
      const cz = (rng.next() - 0.5) * depthSpread * 0.7;
      const cy = (2.0 + rng.next() * 3.2) * clusterScale + biasY;

      const pScale = (18 + rng.next() * 10) * clusterScale;
      sprite.scale.set(pScale, pScale * 0.95, 1);
      sprite.position.set(cx, cy, cz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.012,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 3. Cauliflower Crest Billows (5-7 puffs)
    const crestCount = 5 + Math.floor(rng.next() * 3);
    for (let cr = 0; cr < crestCount; cr++) {
      const sprite = new THREE.Sprite(this.heavyCrestMaterial);
      const crx = (rng.next() - 0.5) * widthSpread * 0.5 + biasX;
      const crz = (rng.next() - 0.5) * depthSpread * 0.5;
      const cry = (4.5 + rng.next() * 4.0) * clusterScale + biasY;

      const pScale = (13 + rng.next() * 8) * clusterScale;
      sprite.scale.set(pScale, pScale, 1);
      sprite.position.set(crx, cry, crz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.01,
        isBase: false,
        isCrest: true,
      });
      group.add(sprite);
    }

    // 4. Wisps (3-5 feathered vapor margins)
    const wispCount = 3 + Math.floor(rng.next() * 3);
    for (let w = 0; w < wispCount; w++) {
      const sprite = new THREE.Sprite(this.heavyWispMaterial);
      const wx = (rng.next() > 0.5 ? 1 : -1) * (widthSpread * 0.5 + rng.next() * 5) + biasX;
      const wz = (rng.next() - 0.5) * depthSpread;
      const wy = (1.5 + rng.next() * 4.0) * clusterScale + biasY;

      const pScale = (12 + rng.next() * 7) * clusterScale;
      sprite.scale.set(pScale * 1.25, pScale * 0.75, 1);
      sprite.position.set(wx, wy, wz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.018,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    group.position.set(x, y, z);
    return {
      group,
      type: 'heavy_corridor',
      puffs,
      driftSpeedX: 0, // No lateral cross-corridor drift to prevent obscuring columns
      driftSpeedZ: -0.45 - rng.next() * 0.25,
      baseX: x,
      baseY: y,
      initialScale: clusterScale,
      role,
      phase: rng.next() * Math.PI * 2,
    };
  }

  /**
   * Constructs an anatomically realistic Cumulus cloud using static pseudo-random sampling
   */
  private createCumulusCluster(x: number, y: number, z: number, clusterSeed?: number): CloudCluster {
    const group = new THREE.Group();
    const puffs: CloudPuffData[] = [];

    const seed = clusterSeed ?? FlightPathGenerator.getSeed(x, z);
    const rng = new DeterministicRNG(seed);

    const clusterScale = 0.85 + rng.next() * 0.9;
    const widthSpread = (22 + rng.next() * 18) * clusterScale;
    const depthSpread = (15 + rng.next() * 14) * clusterScale;

    // 1. Flat Base Puffs (3-5 horizontal puffs along the condensation plane)
    const baseCount = 3 + Math.floor(rng.next() * 3);
    for (let b = 0; b < baseCount; b++) {
      const sprite = new THREE.Sprite(this.baseMaterial);
      const bx = ((b / (baseCount - 1 || 1)) - 0.5) * widthSpread * 0.85 + (rng.next() - 0.5) * 4;
      const bz = (rng.next() - 0.5) * depthSpread * 0.6;
      const by = (rng.next() - 0.5) * 0.8;

      const pScale = (13 + rng.next() * 7) * clusterScale;
      sprite.scale.set(pScale * 1.3, pScale * 0.75, 1);
      sprite.position.set(bx, by, bz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.015,
        isBase: true,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 2. Volumetric Core Puffs (4-6 puffs)
    const coreCount = 4 + Math.floor(rng.next() * 3);
    for (let c = 0; c < coreCount; c++) {
      const sprite = new THREE.Sprite(this.coreMaterial);
      const cx = (rng.next() - 0.5) * widthSpread * 0.7;
      const cz = (rng.next() - 0.5) * depthSpread * 0.7;
      const cy = (1.5 + rng.next() * 2.8) * clusterScale;

      const pScale = (16 + rng.next() * 8) * clusterScale;
      sprite.scale.set(pScale, pScale * 0.9, 1);
      sprite.position.set(cx, cy, cz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.012,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 3. Cauliflower Crest Domes (3-5 puffs)
    const crestCount = 3 + Math.floor(rng.next() * 3);
    for (let cr = 0; cr < crestCount; cr++) {
      const sprite = new THREE.Sprite(this.crestMaterial);
      const crx = (rng.next() - 0.5) * widthSpread * 0.5;
      const crz = (rng.next() - 0.5) * depthSpread * 0.5;
      const cry = (4.0 + rng.next() * 3.8) * clusterScale;

      const pScale = (11 + rng.next() * 6) * clusterScale;
      sprite.scale.set(pScale, pScale, 1);
      sprite.position.set(crx, cry, crz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.01,
        isBase: false,
        isCrest: true,
      });
      group.add(sprite);
    }

    // 4. Wispy Margins (2-4 puffs)
    const wispCount = 2 + Math.floor(rng.next() * 3);
    for (let w = 0; w < wispCount; w++) {
      const sprite = new THREE.Sprite(this.wispMaterial);
      const wx = (rng.next() > 0.5 ? 1 : -1) * (widthSpread * 0.5 + rng.next() * 6);
      const wz = (rng.next() - 0.5) * depthSpread;
      const wy = (1.0 + rng.next() * 3.5) * clusterScale;

      const pScale = (9 + rng.next() * 7) * clusterScale;
      sprite.scale.set(pScale * 1.2, pScale * 0.7, 1);
      sprite.position.set(wx, wy, wz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (rng.next() - 0.5) * 0.02,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    group.position.set(x, y, z);

    return {
      group,
      type: 'cumulus',
      puffs,
      driftSpeedX: 0.45 + rng.next() * 0.35,
      driftSpeedZ: 0.12 + rng.next() * 0.15,
      baseX: x,
      baseY: y,
      initialScale: clusterScale,
      role: 'AMBIENT',
      phase: rng.next() * Math.PI * 2,
    };
  }

  /**
   * Constructs high-altitude sweeping Cirrus bands using static pseudo-random sampling
   */
  private createCirrusCluster(x: number, y: number, z: number, clusterSeed?: number): CloudCluster {
    const group = new THREE.Group();
    const puffs: CloudPuffData[] = [];

    const seed = clusterSeed ?? FlightPathGenerator.getSeed(x, z);
    const rng = new DeterministicRNG(seed);

    const count = 2 + Math.floor(rng.next() * 2);
    const bandLength = 55 + rng.next() * 35;
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(this.cirrusMaterial);
      const cx = (i - 0.5) * 18 + (rng.next() - 0.5) * 8;
      const cz = (rng.next() - 0.5) * 12;
      const cy = (rng.next() - 0.5) * 3;

      const sx = bandLength * (0.8 + rng.next() * 0.4);
      const sy = (10 + rng.next() * 8);
      sprite.scale.set(sx, sy, 1);
      sprite.position.set(cx, cy, cz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sx, sy),
        rotSpeed: (rng.next() - 0.5) * 0.005,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    group.position.set(x, y, z);

    return {
      group,
      type: 'cirrus',
      puffs,
      driftSpeedX: 0.85 + rng.next() * 0.45,
      driftSpeedZ: 0.25 + rng.next() * 0.2,
      baseX: x,
      baseY: y,
      initialScale: 1.0,
      role: 'AMBIENT',
      phase: rng.next() * Math.PI * 2,
    };
  }

  /**
   * Repositions clouds around a new start distance using static pseudo-random seeding
   */
  public reposition(startZ: number = 0, startX: number = 0) {
    const count = this.clusters.length;
    this.clusters.forEach((cluster, idx) => {
      const z = startZ - 60 + (idx / count) * 340;
      const seed = FlightPathGenerator.getSeed(startX, z, idx);
      const rng = new DeterministicRNG(seed);
      const x = startX + (rng.next() - 0.5) * (cluster.type === 'cirrus' ? 240 : 190);
      const y = cluster.type === 'cirrus'
        ? 70 + rng.next() * 22
        : 34 + rng.next() * 24;
      cluster.baseX = x;
      cluster.baseY = y;
      cluster.group.position.set(x, y, z);
    });

    this.heavyCorridorClusters.forEach((cluster, idx) => {
      const z = startZ + 20 + idx * 16;
      const spawn = this.getHeavyCorridorSpawn(z, idx, flightPath);
      cluster.baseX = spawn.x;
      cluster.baseY = spawn.y;
      cluster.role = spawn.role;
      cluster.group.position.set(spawn.x, spawn.y, spawn.z);
    });
  }

  /**
   * Updates cloud drift, subtle organic billow movement, biome lighting, and infinite horizon streaming.
   * Enforces that upcoming columns and flight corridors are never obscured.
   */
  public update(
    delta: number,
    birdZ: number,
    biomeWeights?: BiomeWeights,
    birdX: number = 0,
    flightPathGen?: FlightPathGenerator,
    birdY?: number
  ) {
    this.animTime += delta;
    const pathGen = flightPathGen || flightPath;

    // 1. Biome Lighting Adaptation
    if (biomeWeights) {
      let baseR = 0, baseG = 0, baseB = 0;
      let coreR = 0, coreG = 0, coreB = 0;
      let crestR = 0, crestG = 0, crestB = 0;
      let totalWeight = 0;

      if (biomeWeights.biomeWeights) {
        for (const [biome, w] of biomeWeights.biomeWeights.entries()) {
          if (w > 0.0001) {
            const cl = biome.getCloudLightingColors();
            baseR += w * cl.baseShadow.r;
            baseG += w * cl.baseShadow.g;
            baseB += w * cl.baseShadow.b;

            coreR += w * cl.coreTint.r;
            coreG += w * cl.coreTint.g;
            coreB += w * cl.coreTint.b;

            crestR += w * cl.sunlitCrest.r;
            crestG += w * cl.sunlitCrest.g;
            crestB += w * cl.sunlitCrest.b;

            totalWeight += w;
          }
        }
      }

      if (totalWeight > 0.0001) {
        baseR /= totalWeight;
        baseG /= totalWeight;
        baseB /= totalWeight;
        coreR /= totalWeight;
        coreG /= totalWeight;
        coreB /= totalWeight;
        crestR /= totalWeight;
        crestG /= totalWeight;
        crestB /= totalWeight;
      } else {
        const hills = biomeWeights.hills + (biomeWeights.hillsLow || 0);
        const mtn = biomeWeights.mountain + (biomeWeights.mountainLow || 0);
        const canyon = biomeWeights.canyon + (biomeWeights.canyonLow || 0);
        baseR = hills * 0.776 + mtn * 0.698 + canyon * 0.875;
        baseG = hills * 0.843 + mtn * 0.772 + canyon * 0.820;
        baseB = hills * 0.909 + mtn * 0.859 + canyon * 0.749;
        coreR = hills * 0.957 + mtn * 0.933 + canyon * 0.980;
        coreG = hills * 0.968 + mtn * 0.949 + canyon * 0.965;
        coreB = hills * 0.980 + mtn * 0.968 + canyon * 0.941;
        crestR = hills * 1.0 + mtn * 1.0 + canyon * 1.0;
        crestG = hills * 1.0 + mtn * 1.0 + canyon * 0.984;
        crestB = hills * 1.0 + mtn * 1.0 + canyon * 0.945;
      }

      this.baseMaterial.color.setRGB(baseR, baseG, baseB);
      this.coreMaterial.color.setRGB(coreR, coreG, coreB);
      this.crestMaterial.color.setRGB(crestR, crestG, crestB);

      this.heavyBaseMaterial.color.setRGB(baseR, baseG, baseB);
      this.heavyCoreMaterial.color.setRGB(coreR, coreG, coreB);
      this.heavyCrestMaterial.color.setRGB(crestR, crestG, crestB);
    }

    // 2. Ambient Cloud Drift, Horizon Recycling & Corridor Clearance
    for (let i = 0; i < this.clusters.length; i++) {
      const cluster = this.clusters[i];
      const pos = cluster.group.position;

      // Natural atmospheric wind drift
      pos.x += cluster.driftSpeedX * delta;
      pos.z += cluster.driftSpeedZ * delta;

      // Gentle vertical floating buoyancy
      pos.y = cluster.baseY + Math.sin(this.animTime * 0.35 + i * 1.7) * 0.6;

      // Subtle slow 3D rotation
      cluster.group.rotation.y += (0.004 + (i % 3) * 0.002) * delta;

      // Non-obscuring heuristic: ensure ambient clouds never drift into the flight corridor sightline
      if (cluster.type === 'cumulus' && pathGen && Math.abs(pos.z - birdZ) < 220) {
        const pt = pathGen.getPathPoint(pos.z);
        const dX = Math.abs(pos.x - pt.x);
        const dY = Math.abs(pos.y - pt.y);
        if (dX < 20.0 && dY < 12.0) {
          // Push cloud outward away from the corridor center so it doesn't block upcoming columns
          if (pos.x >= pt.x) {
            pos.x = pt.x + 21.0;
          } else {
            pos.x = pt.x - 21.0;
          }
        }
      }

      // Recycle clouds that pass behind camera into the far horizon ahead (>175m)
      if (pos.z < birdZ - 75) {
        const newZ = birdZ + 175 + FlightPathGenerator.pseudoRandom(pos.z + i) * 85;
        const seed = FlightPathGenerator.getSeed(birdX, newZ, i);
        const rng = new DeterministicRNG(seed);
        pos.z = newZ;
        pos.x = birdX + (rng.next() - 0.5) * (cluster.type === 'cirrus' ? 240 : 190);
        pos.y = cluster.type === 'cirrus'
          ? 70 + rng.next() * 22
          : 34 + rng.next() * 24;
        cluster.baseX = pos.x;
        cluster.baseY = pos.y;
      }
    }

    // 3. Heavy Corridor Cloud Formations in Sky / Clouds Biome ("s")
    // Flanks the flight corridor without ever obscuring upcoming columns
    // Don't fade in too soon: only fade in once the bird has reached the specified altitude
    // for this terrain (around the mountain peaks, >= 38m up to ~48m).
    const cloudsW = biomeWeights?.clouds ?? 0;
    const minFadeAltitude = 38.0; // Summit level of the mountain peaks below (~38-42m)
    const fullFadeAltitude = 48.0; // Specified sky terrain flight altitude (~50-55m)
    const currentBirdY = birdY !== undefined ? birdY : (pathGen ? pathGen.getPathPoint(birdZ).y : 0);

    const altitudeFactor = THREE.MathUtils.clamp(
      (currentBirdY - minFadeAltitude) / (fullFadeAltitude - minFadeAltitude),
      0.0,
      1.0
    );
    const smoothAltitude = altitudeFactor * altitudeFactor * (3.0 - 2.0 * altitudeFactor);

    // Only fade in once bird reaches the specified altitude around the mountain peaks
    const effectiveCloudsFactor = cloudsW * smoothAltitude;
    const isCloudsActive = effectiveCloudsFactor > 0.005;

    // Smoothly fade opacity of heavy sky clouds
    const fade = Math.min(1.0, effectiveCloudsFactor);
    this.heavyBaseMaterial.opacity = 0.88 * fade;
    this.heavyCoreMaterial.opacity = 0.92 * fade;
    this.heavyCrestMaterial.opacity = 0.95 * fade;
    this.heavyWispMaterial.opacity = 0.45 * fade;

    for (let i = 0; i < this.heavyCorridorClusters.length; i++) {
      const cluster = this.heavyCorridorClusters[i];
      if (!isCloudsActive) {
        cluster.group.visible = false;
        continue;
      }
      cluster.group.visible = true;
      const targetScale = Math.min(1.0, 0.4 + effectiveCloudsFactor * 0.6);
      cluster.group.scale.set(targetScale, targetScale, targetScale);

      const pos = cluster.group.position;

      // Gentle longitudinal breeze along flight direction
      pos.z += cluster.driftSpeedZ * delta;

      // Organic gentle sway strictly within safe flank bounds (never crosses corridor center)
      if (cluster.role === 'LEFT_FLANK' || cluster.role === 'RIGHT_FLANK') {
        pos.x = cluster.baseX + Math.sin(this.animTime * 0.25 + cluster.phase) * 1.5;
        pos.y = cluster.baseY + Math.sin(this.animTime * 0.35 + cluster.phase) * 0.6;
      } else {
        pos.x = cluster.baseX + Math.sin(this.animTime * 0.2 + cluster.phase) * 1.2;
        pos.y = cluster.baseY + Math.sin(this.animTime * 0.3 + cluster.phase) * 0.6;
      }
      cluster.group.rotation.y += 0.002 * delta;

      // Recycle heavy clouds when behind camera
      if (pos.z < birdZ - 30) {
        let maxZ = birdZ + 50;
        for (let k = 0; k < this.heavyCorridorClusters.length; k++) {
          if (this.heavyCorridorClusters[k].group.position.z > maxZ) {
            maxZ = this.heavyCorridorClusters[k].group.position.z;
          }
        }
        const spawnZ = maxZ + 14.0 + FlightPathGenerator.pseudoRandom(pos.z + i) * 8.0;
        const spawn = this.getHeavyCorridorSpawn(spawnZ, i, pathGen);
        pos.x = spawn.x;
        pos.y = spawn.y;
        pos.z = spawn.z;
        cluster.baseX = spawn.x;
        cluster.baseY = spawn.y;
        cluster.role = spawn.role;
      }
    }
  }

  /**
   * Disposes of textures and materials cleanly
   */
  public dispose() {
    this.cumulusTexture.dispose();
    this.cirrusTexture.dispose();
    this.baseMaterial.dispose();
    this.coreMaterial.dispose();
    this.crestMaterial.dispose();
    this.wispMaterial.dispose();
    this.cirrusMaterial.dispose();
    this.heavyBaseMaterial.dispose();
    this.heavyCoreMaterial.dispose();
    this.heavyCrestMaterial.dispose();
    this.heavyWispMaterial.dispose();
  }
}
