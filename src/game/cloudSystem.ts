import * as THREE from 'three';
import { BiomeWeights } from './pathGenerator';
import { biomeRegistry, Biome } from '../biomes';

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
  type: 'cumulus' | 'cirrus';
  puffs: CloudPuffData[];
  driftSpeedX: number;
  driftSpeedZ: number;
  baseY: number;
  initialScale: number;
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
    // Cirrus is stretched horizontally
    const ny = (y - half) / (isCirrus ? half * 0.45 : half * 0.88);
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / (isCirrus ? half * 0.95 : half * 0.88);
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist >= 1.0) continue;

      let n = 0;
      if (isCirrus) {
        // Elongated horizontal fibril streaks
        n = noise2D(nx * 2.5 + 5.0, ny * 9.0 + 5.0) * 0.65 +
            noise2D(nx * 6.0 + 10.0, ny * 18.0 + 10.0) * 0.35;
      } else {
        // Multi-harmonic turbulent cumulus lobes
        n = noise2D(nx * 3.2 + 8.0, ny * 3.2 + 8.0) * 0.55 +
            noise2D(nx * 6.5 + 16.0, ny * 6.5 + 16.0) * 0.30 +
            noise2D(nx * 13.0 + 24.0, ny * 13.0 + 24.0) * 0.15;
      }

      // Deform radial falloff using noise
      const maxRadius = isCirrus ? (0.65 + 0.35 * n) : (0.72 + 0.38 * n);
      const normDist = dist / maxRadius;
      if (normDist >= 1.0) continue;

      const falloff = 1.0 - normDist;
      // Smooth vaporous cubic ease
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
  private cumulusTexture: THREE.CanvasTexture;
  private cirrusTexture: THREE.CanvasTexture;

  // Distinct materials for realistic anatomical lighting:
  // Base material (cooler, ambient sky shadow on flat underside)
  private baseMaterial: THREE.SpriteMaterial;
  // Core material (dense, volumetric body)
  private coreMaterial: THREE.SpriteMaterial;
  // Crest material (sunlit cauliflower tops with brilliant warm highlights)
  private crestMaterial: THREE.SpriteMaterial;
  // Wisp material (delicate peripheral translucent fringe)
  private wispMaterial: THREE.SpriteMaterial;
  // Cirrus material (high-altitude horizontal ice crystal bands)
  private cirrusMaterial: THREE.SpriteMaterial;

  private animTime: number = 0;

  constructor() {
    this.group = new THREE.Group();

    this.cumulusTexture = createProceduralCloudTexture(false);
    this.cirrusTexture = createProceduralCloudTexture(true);

    // Initial materials with fair-weather summer palette
    this.baseMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xc6d7e8), // ambient sky-tinted underside
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      fog: true,
    });

    this.coreMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xf4f7fa), // dense white body
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: true,
    });

    this.crestMaterial = new THREE.SpriteMaterial({
      map: this.cumulusTexture,
      color: new THREE.Color(0xffffff), // gleaming sunlit top
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

    this.initClouds();
  }

  /**
   * Initializes real-life cloud formations:
   * 1. Mid-altitude realistic cumulus formations (flat bases, cauliflower billow domes, wisps)
   * 2. High-altitude expansive cirrus and stratocumulus streaks
   */
  private initClouds() {
    // 24 mid-altitude cumulus cloud formations (-60m to +280m)
    const cumulusCount = 24;
    for (let i = 0; i < cumulusCount; i++) {
      const z = -60 + (i / cumulusCount) * 340 + (Math.random() - 0.5) * 20;
      const x = (Math.random() - 0.5) * 190;
      const y = 34 + Math.random() * 24;
      const cluster = this.createCumulusCluster(x, y, z);
      this.clusters.push(cluster);
      this.group.add(cluster.group);
    }

    // 10 high-altitude panoramic cirrus bands (y = 70 to 92)
    const cirrusCount = 10;
    for (let i = 0; i < cirrusCount; i++) {
      const z = -40 + (i / cirrusCount) * 340 + (Math.random() - 0.5) * 30;
      const x = (Math.random() - 0.5) * 240;
      const y = 70 + Math.random() * 22;
      const cluster = this.createCirrusCluster(x, y, z);
      this.clusters.push(cluster);
      this.group.add(cluster.group);
    }
  }

  /**
   * Constructs an anatomically realistic Cumulus cloud:
   * - Flat condensation base at the bottom (lifting condensation level)
   * - Volumetric core with dense overlapping puffs
   * - Rising cauliflower billow domes catching direct sunlight
   * - Vaporous peripheral wisps
   */
  private createCumulusCluster(x: number, y: number, z: number): CloudCluster {
    const group = new THREE.Group();
    const puffs: CloudPuffData[] = [];

    // Overall scale variation: some are huge majestic cumulus, some medium, some cloudlets
    const clusterScale = 0.85 + Math.random() * 0.9;
    const widthSpread = (22 + Math.random() * 18) * clusterScale;
    const depthSpread = (15 + Math.random() * 14) * clusterScale;

    // 1. Flat Base Puffs (3-5 horizontal puffs along the condensation plane)
    const baseCount = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < baseCount; b++) {
      const sprite = new THREE.Sprite(this.baseMaterial);
      const bx = ((b / (baseCount - 1 || 1)) - 0.5) * widthSpread * 0.85 + (Math.random() - 0.5) * 4;
      const bz = (Math.random() - 0.5) * depthSpread * 0.6;
      const by = (Math.random() - 0.5) * 0.8; // distinctly flat base

      const pScale = (13 + Math.random() * 7) * clusterScale;
      sprite.scale.set(pScale * 1.3, pScale * 0.75, 1); // flattened bottom aspect
      sprite.position.set(bx, by, bz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (Math.random() - 0.5) * 0.015,
        isBase: true,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 2. Volumetric Core Puffs (dense interior body, 4-6 puffs)
    const coreCount = 4 + Math.floor(Math.random() * 3);
    for (let c = 0; c < coreCount; c++) {
      const sprite = new THREE.Sprite(this.coreMaterial);
      const cx = (Math.random() - 0.5) * widthSpread * 0.7;
      const cz = (Math.random() - 0.5) * depthSpread * 0.7;
      const cy = (1.5 + Math.random() * 2.8) * clusterScale;

      const pScale = (16 + Math.random() * 8) * clusterScale;
      sprite.scale.set(pScale, pScale * 0.9, 1);
      sprite.position.set(cx, cy, cz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (Math.random() - 0.5) * 0.012,
        isBase: false,
        isCrest: false,
      });
      group.add(sprite);
    }

    // 3. Towering Cauliflower Crest Domes (sunlit billows, 3-5 puffs rising higher)
    const crestCount = 3 + Math.floor(Math.random() * 3);
    for (let cr = 0; cr < crestCount; cr++) {
      const sprite = new THREE.Sprite(this.crestMaterial);
      const crx = (Math.random() - 0.5) * widthSpread * 0.5;
      const crz = (Math.random() - 0.5) * depthSpread * 0.5;
      const cry = (4.0 + Math.random() * 3.8) * clusterScale;

      const pScale = (11 + Math.random() * 6) * clusterScale;
      sprite.scale.set(pScale, pScale, 1);
      sprite.position.set(crx, cry, crz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (Math.random() - 0.5) * 0.01,
        isBase: false,
        isCrest: true,
      });
      group.add(sprite);
    }

    // 4. Wispy Peripheral Margins (2-4 soft feathered tendrils)
    const wispCount = 2 + Math.floor(Math.random() * 3);
    for (let w = 0; w < wispCount; w++) {
      const sprite = new THREE.Sprite(this.wispMaterial);
      const wx = (Math.random() > 0.5 ? 1 : -1) * (widthSpread * 0.5 + Math.random() * 6);
      const wz = (Math.random() - 0.5) * depthSpread;
      const wy = (1.0 + Math.random() * 3.5) * clusterScale;

      const pScale = (9 + Math.random() * 7) * clusterScale;
      sprite.scale.set(pScale * 1.2, pScale * 0.7, 1);
      sprite.position.set(wx, wy, wz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sprite.scale.x, sprite.scale.y),
        rotSpeed: (Math.random() - 0.5) * 0.02,
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
      driftSpeedX: 0.45 + Math.random() * 0.35,
      driftSpeedZ: 0.12 + Math.random() * 0.15,
      baseY: y,
      initialScale: clusterScale,
    };
  }

  /**
   * Constructs high-altitude sweeping Cirrus bands
   */
  private createCirrusCluster(x: number, y: number, z: number): CloudCluster {
    const group = new THREE.Group();
    const puffs: CloudPuffData[] = [];

    // 2-3 overlapping horizontally elongated wisps
    const count = 2 + Math.floor(Math.random() * 2);
    const bandLength = 55 + Math.random() * 35;
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(this.cirrusMaterial);
      const cx = (i - 0.5) * 18 + (Math.random() - 0.5) * 8;
      const cz = (Math.random() - 0.5) * 12;
      const cy = (Math.random() - 0.5) * 3;

      const sx = bandLength * (0.8 + Math.random() * 0.4);
      const sy = (10 + Math.random() * 8);
      sprite.scale.set(sx, sy, 1);
      sprite.position.set(cx, cy, cz);

      puffs.push({
        sprite,
        baseLocalPos: sprite.position.clone(),
        baseScale: new THREE.Vector2(sx, sy),
        rotSpeed: (Math.random() - 0.5) * 0.005,
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
      driftSpeedX: 0.85 + Math.random() * 0.45,
      driftSpeedZ: 0.25 + Math.random() * 0.2,
      baseY: y,
      initialScale: 1.0,
    };
  }

  /**
   * Repositions clouds around a new start distance (e.g. after game restart or branch change)
   */
  public reposition(startZ: number = 0, startX: number = 0) {
    const count = this.clusters.length;
    this.clusters.forEach((cluster, idx) => {
      const z = startZ - 60 + (idx / count) * 340 + (Math.random() - 0.5) * 20;
      const x = startX + (Math.random() - 0.5) * (cluster.type === 'cirrus' ? 240 : 190);
      const y = cluster.type === 'cirrus'
        ? 70 + Math.random() * 22
        : 34 + Math.random() * 24;
      cluster.baseY = y;
      cluster.group.position.set(x, y, z);
    });
  }

  /**
   * Updates cloud drift, subtle organic billow movement, biome lighting, and infinite horizon streaming
   */
  public update(delta: number, birdZ: number, biomeWeights?: BiomeWeights, birdX: number = 0) {
    this.animTime += delta;

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
    }

    // 2. Cloud Drift and Stream Recycling
    for (let i = 0; i < this.clusters.length; i++) {
      const cluster = this.clusters[i];
      const pos = cluster.group.position;

      // Natural atmospheric wind drift
      pos.x += cluster.driftSpeedX * delta;
      pos.z += cluster.driftSpeedZ * delta;

      // Gentle vertical floating buoyancy
      pos.y = cluster.baseY + Math.sin(this.animTime * 0.35 + i * 1.7) * 0.6;

      // Subtle slow 3D evolution: rotating the 3D puff cluster gently around Y
      cluster.group.rotation.y += (0.004 + (i % 3) * 0.002) * delta;

      // Recycle clouds that pass behind camera into the far horizon ahead (>175m)
      if (pos.z < birdZ - 75) {
        pos.z = birdZ + 175 + Math.random() * 85;
        pos.x = birdX + (Math.random() - 0.5) * (cluster.type === 'cirrus' ? 240 : 190);
        pos.y = cluster.type === 'cirrus'
          ? 70 + Math.random() * 22
          : 34 + Math.random() * 24;
        cluster.baseY = pos.y;
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
  }
}
