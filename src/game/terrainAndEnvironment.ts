import * as THREE from 'three';
import { flightPath, FlightPathGenerator, ForkDecision, LEVEL_LENGTH } from './pathGenerator';
import { ObstacleData } from '../types';
import { WindGustPair, WindGustTriggerResult } from './windGust';
import { CanyonRiverManager } from './canyonRiver';
import { CloudSystem } from './cloudSystem';
import { FeatherManager } from './featherManager';
import { TotemManager } from './totemManager';
import { Biome, biomeRegistry } from '../biomes';

export type { ForkDecision };

interface TerrainChunk {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  posAttr: THREE.BufferAttribute;
  colorAttr: THREE.BufferAttribute;
  centerX: number;
  centerZ: number;
  gridX: number;
  gridZ: number;
}

interface VoxelBlock {
  x: number;
  y: number;
  z: number;
  topC: [number, number, number];
  sideC: [number, number, number];
  botC: [number, number, number];
}

function voxelKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
}

/**
 * Authentic Voxel Quad Mesher with Neighbor-Aware Face Culling.
 * Prevents Z-fighting and shimmering by strictly eliminating internal, touching coplanar faces
 * between adjacent blocks in the pillar shaft, capital, and stepped foundation.
 */
function buildVoxelGeometry(
  voxels: VoxelBlock[],
  solidMask?: Set<string>
): THREE.BufferGeometry {
  const occupied = new Set<string>();

  for (const v of voxels) {
    occupied.add(voxelKey(v.x, v.y, v.z));
  }

  if (solidMask) {
    for (const k of solidMask) {
      occupied.add(k);
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  function addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    norm: [number, number, number],
    color: [number, number, number]
  ) {
    positions.push(...p0, ...p1, ...p2, ...p3);
    normals.push(...norm, ...norm, ...norm, ...norm);
    colors.push(...color, ...color, ...color, ...color);
    indices.push(
      vertexOffset, vertexOffset + 1, vertexOffset + 2,
      vertexOffset, vertexOffset + 2, vertexOffset + 3
    );
    vertexOffset += 4;
  }

  for (const v of voxels) {
    const { x, y, z, topC, sideC, botC } = v;
    const x0 = x - 0.5, x1 = x + 0.5;
    const y0 = y - 0.5, y1 = y + 0.5;
    const z0 = z - 0.5, z1 = z + 0.5;

    // +Y (Top Face)
    if (!occupied.has(voxelKey(x, y + 1, z))) {
      addQuad(
        [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0],
        [0, 1, 0],
        topC
      );
    }

    // -Y (Bottom Face)
    if (!occupied.has(voxelKey(x, y - 1, z))) {
      addQuad(
        [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1],
        [0, -1, 0],
        botC
      );
    }

    // +Z (Front Face)
    if (!occupied.has(voxelKey(x, y, z + 1))) {
      addQuad(
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        [0, 0, 1],
        sideC
      );
    }

    // -Z (Back Face)
    if (!occupied.has(voxelKey(x, y, z - 1))) {
      addQuad(
        [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
        [0, 0, -1],
        sideC
      );
    }

    // +X (Right Face)
    if (!occupied.has(voxelKey(x + 1, y, z))) {
      addQuad(
        [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
        [1, 0, 0],
        sideC
      );
    }

    // -X (Left Face)
    if (!occupied.has(voxelKey(x - 1, y, z))) {
      addQuad(
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
        [-1, 0, 0],
        sideC
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Procedural Voxel Block Pillar Generator with Voxel Neighbor Culling.
 * Creates a complete, seamless column + capital composed purely of standard 1x1x1 blocks
 * without internal coplanar polygons that cause Z-fighting shimmer.
 */
function createVoxelBlockPillar(biome: Biome, isTop: boolean): THREE.BufferGeometry {
  const voxels: VoxelBlock[] = [];
  const layers = 24; // 24 vertical blocks = 24 meters

  // Core 2x2 column of 1.0 x 1.0 x 1.0 blocks
  const coreCoords = [
    [-0.5, -0.5],
    [ 0.5, -0.5],
    [-0.5,  0.5],
    [ 0.5,  0.5],
  ];

  for (let i = 0; i < layers; i++) {
    // Bottom pillar: y goes from -0.5 down to -23.5 (facing up towards gap at -0.5)
    // Top pillar: y goes from +0.5 up to +23.5 (facing down towards gap at +0.5)
    const y = isTop ? (0.5 + i) : (-0.5 - i);

    const colors = biome.getPillarVoxelColors(i, isTop);
    const topC = colors.top;
    const sideC = colors.side;
    const botC = colors.bot;

    // Core 4 blocks for this layer
    for (const [bx, bz] of coreCoords) {
      voxels.push({ x: bx, y, z: bz, topC, sideC, botC });
    }

    // Overhang rim capital layer adjacent to the gap (i === 0)
    if (i === 0) {
      const rimCoords = [
        [-1.5, -0.5], [-1.5,  0.5],
        [ 1.5, -0.5], [ 1.5,  0.5],
        [-0.5, -1.5], [ 0.5, -1.5],
        [-0.5,  1.5], [ 0.5,  1.5],
      ];
      for (const [rx, rz] of rimCoords) {
        voxels.push({ x: rx, y, z: rz, topC, sideC, botC });
      }
    }
  }

  return buildVoxelGeometry(voxels);
}

/**
 * Procedural Voxel Block Foundation Generator with Neighbor & Column Core Culling.
 * Prevents overlapping coplanar faces against the column pillar at X = ±1, Z = ±1.
 */
function createVoxelBlockBase(biome: Biome): THREE.BufferGeometry {
  const voxels: VoxelBlock[] = [];
  const colors = biome.getBaseVoxelColors();
  const topC = colors.top;
  const sideC = colors.side;
  const botC = colors.bot;

  // Stepped 1-block perimeter around the 2x2 pillar base on the terrain
  const baseCoords = [
    [-1.5, -0.5], [-1.5,  0.5],
    [ 1.5, -0.5], [ 1.5,  0.5],
    [-0.5, -1.5], [ 0.5, -1.5],
    [-0.5,  1.5], [ 0.5,  1.5],
    [-1.5, -1.5], [ 1.5, -1.5],
    [-1.5,  1.5], [ 1.5,  1.5],
  ];

  for (const [bx, bz] of baseCoords) {
    // Upper ground level block
    voxels.push({ x: bx, y: 0.5, z: bz, topC, sideC, botC });
    // Sub-ground anchoring block
    voxels.push({ x: bx, y: -0.5, z: bz, topC, sideC, botC });
  }

  // Treat the interior 2x2 pillar column core as solid occupied space so base blocks do not emit
  // inward-facing faces that overlap with the pillar's outer surfaces at X = ±1, Z = ±1!
  const solidCoreMask = new Set<string>();
  const coreCoords = [
    [-0.5, -0.5], [0.5, -0.5],
    [-0.5,  0.5], [0.5,  0.5],
  ];
  for (const [cx, cz] of coreCoords) {
    solidCoreMask.add(voxelKey(cx, 0.5, cz));
    solidCoreMask.add(voxelKey(cx, -0.5, cz));
  }

  return buildVoxelGeometry(voxels, solidCoreMask);
}

export class EnvironmentManager {
  public scene: THREE.Scene;
  public obstacles: ObstacleData[] = [];
  public windGusts: WindGustPair[] = [];
  public activeBranchOffset: number = 0;
  public forkDecisions: Map<number, ForkDecision> = new Map();
  private currentColumnIndex: number = 0;
  private obstacleMeshesGroup: THREE.Group;
  private terrainGroup: THREE.Group;
  private canyonRiver: CanyonRiverManager;
  private chunks: TerrainChunk[] = [];
  private chunkGrid: TerrainChunk[][] = [];
  private readonly numChunksX: number = 5;
  private readonly numChunksZ: number = 5;
  private readonly chunkLength: number = 60.0;
  private readonly chunkWidth: number = 60.0;
  private readonly chunkWidthSegments: number = 30;
  private readonly chunkLengthSegments: number = 30;
  private lastBirdX: number = 0;
  private treesGroup: THREE.Group;
  private cloudSystem: CloudSystem;
  public featherManager: FeatherManager;
  private totemManager: TotemManager | null = null;

  public setTotemManager(totemManager: TotemManager) {
    this.totemManager = totemManager;
  }

  // Atmospheric lighting
  private hemiLight: THREE.HemisphereLight;
  private dirLight: THREE.DirectionalLight;

  // Architectural Voxel Pillar Assets (Bottom, Top, Base) keyed by Biome
  private bottomPillarGeos: Map<Biome, THREE.BufferGeometry> = new Map();
  private topPillarGeos: Map<Biome, THREE.BufferGeometry> = new Map();
  private baseGeos: Map<Biome, THREE.BufferGeometry> = new Map();

  // Floating Smooth Doughnut Ring Assets
  private ringGeo: THREE.BufferGeometry;
  private ringMat: THREE.MeshStandardMaterial;

  // Architectural Voxel Materials
  private voxelPillarMat: THREE.MeshStandardMaterial;
  private voxelBaseMat: THREE.MeshStandardMaterial;

  // Spacing parameters
  private nextObstacleDist: number = 38.0; // first obstacle distance
  private readonly obstacleInterval: number = 28.0; // distance between gates
  private obstacleIdCounter: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Atmospheric lighting & depth fog
    const skyColor = new THREE.Color(0xbfe3f7);
    scene.background = skyColor;

    // Linear Depth Fog: starts soft at 32m and becomes 100% opaque at 135m.
    scene.fog = new THREE.Fog(0xbfe3f7, 32, 135);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x4f772d, 0.75);
    scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffaed, 1.25);
    this.dirLight.position.set(40, 80, -20);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 250;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    const d = 50;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    scene.add(this.dirLight);

    // Groups
    this.obstacleMeshesGroup = new THREE.Group();
    scene.add(this.obstacleMeshesGroup);

    this.treesGroup = new THREE.Group();
    scene.add(this.treesGroup);

    this.cloudSystem = new CloudSystem();
    scene.add(this.cloudSystem.group);

    // =======================================================
    // ARCHITECTURAL VOXEL PILLAR & GATEWAY MATERIALS
    // =======================================================
    this.voxelPillarMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });

    // Smooth golden doughnut ring material
    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0xffb703, // Radiant warm gold
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0xff8800,
      emissiveIntensity: 0.35,
    });

    this.voxelBaseMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    // =======================================================
    // PROCEDURAL VOXEL PILLAR ASSETS (ALL REGISTERED BIOMES)
    // =======================================================
    // 1. Bottom & Top Pillar Geometries (24m columns made of standard 1x1x1 blocks)
    for (const biome of biomeRegistry.getAll()) {
      this.bottomPillarGeos.set(biome, createVoxelBlockPillar(biome, false));
      this.topPillarGeos.set(biome, createVoxelBlockPillar(biome, true));
      this.baseGeos.set(biome, createVoxelBlockBase(biome));
    }

    // 2. Floating Smooth Golden Doughnut Rings (Torus)
    this.ringGeo = new THREE.TorusGeometry(1.7, 0.18, 16, 48);

    // =======================================================
    // WORLD-FIXED TERRAIN CHUNK TILES
    // 5 continuous streaming chunks (60m each = 300m total span)
    // Terrain vertices stay fixed in world space while visible,
    // moving naturally with the columns and trees!
    // =======================================================
    this.terrainGroup = new THREE.Group();
    scene.add(this.terrainGroup);

    // Canyon River with Whitewater Rapids Manager
    this.canyonRiver = new CanyonRiverManager(scene);

    const terrainMat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      vertexColors: true,
    });

    for (let ix = 0; ix < this.numChunksX; ix++) {
      this.chunkGrid[ix] = [];
      for (let iz = 0; iz < this.numChunksZ; iz++) {
        const geo = new THREE.PlaneGeometry(
          this.chunkWidth,
          this.chunkLength,
          this.chunkWidthSegments,
          this.chunkLengthSegments
        );
        geo.rotateX(-Math.PI / 2);

        const vertexCount = geo.attributes.position.count;
        const vertexColors = new Float32Array(vertexCount * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));

        const mesh = new THREE.Mesh(geo, terrainMat);
        mesh.receiveShadow = true;
        this.terrainGroup.add(mesh);

        const chunk: TerrainChunk = {
          mesh,
          geometry: geo,
          posAttr: geo.attributes.position as THREE.BufferAttribute,
          colorAttr: geo.attributes.color as THREE.BufferAttribute,
          centerX: 0,
          centerZ: 0,
          gridX: 0,
          gridZ: 0,
        };
        this.chunkGrid[ix][iz] = chunk;
        this.chunks.push(chunk);
      }
    }

    // Populate initial chunks around start
    this.resetChunks(0, 0);

    // Populate initial clouds and trees
    this.createTrees();

    // Visual Prior Crashes Feather System
    this.featherManager = new FeatherManager(scene);
    this.featherManager.updateTerrainFeathers(0);
  }

  private createTrees() {
    // Voxel Oak & Spruce Trees: cubic wood trunks and stepped block leaf canopies
    const trunkGeo = new THREE.BoxGeometry(0.65, 2.2, 0.65);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c2b, roughness: 0.9, flatShading: true });

    const foliageBaseGeo = new THREE.BoxGeometry(2.4, 1.6, 2.4);
    const foliageTopGeo = new THREE.BoxGeometry(1.4, 1.0, 1.4);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3d7326, roughness: 0.85, flatShading: true });

    // 55 stylized alpine trees distributed from -60 to +240m
    for (let i = 0; i < 55; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);

      const foliageBase = new THREE.Mesh(foliageBaseGeo, foliageMat);
      foliageBase.position.y = 2.4;
      foliageBase.castShadow = true;
      foliageBase.receiveShadow = true;
      tree.add(foliageBase);

      const foliageTop = new THREE.Mesh(foliageTopGeo, foliageMat);
      foliageTop.position.y = 3.4;
      foliageTop.castShadow = true;
      foliageTop.receiveShadow = true;
      tree.add(foliageTop);

      const z = -60 + (i / 55) * 300;
      const pathPt = flightPath.getPoint(z);
      const tempWeights = flightPath.getBiomeWeights(pathPt.x, z);

      // In deep canyon / river slots, ensure trees stay on the high mesa rim rather than inside the flight channel
      const isRiverOrCanyon = tempWeights.primaryBiome ? tempWeights.primaryBiome.hasRiver() : false;
      const minOffset = isRiverOrCanyon ? 24.0 : 14.0;
      const side = Math.random() > 0.5 ? 1 : -1;
      const offsetX = side * (minOffset + Math.random() * 34);

      const x = pathPt.x + offsetX;
      const y = flightPath.getTerrainHeight(x, z);

      tree.position.set(x, y, z);
      const s = 0.7 + Math.random() * 0.6;
      tree.scale.set(s, s, s);
      this.treesGroup.add(tree);
    }
  }

  public repositionTreesAndClouds(startZ: number = 0, startX: number = 0) {
    const treeCount = this.treesGroup.children.length;
    this.treesGroup.children.forEach((tree, idx) => {
      const z = startZ - 60 + (idx / treeCount) * 300;
      const pathPt = flightPath.getPoint(z);
      const tempWeights = flightPath.getBiomeWeights(pathPt.x, z);
      const isRiverOrCanyon = tempWeights.primaryBiome ? tempWeights.primaryBiome.hasRiver() : false;
      const minOffset = isRiverOrCanyon ? 24.0 : 14.0;
      const side = Math.random() > 0.5 ? 1 : -1;
      const offsetX = side * (minOffset + Math.random() * 34);
      const x = pathPt.x + offsetX;
      tree.position.set(x, flightPath.getTerrainHeight(x, z), z);
    });

    this.cloudSystem.reposition(startZ, startX);
  }

  private lastBirdZ: number = 0;

  private mod(n: number, m: number): number {
    return ((n % m) + m) % m;
  }

  public resetChunks(startZ: number, startX: number = 0) {
    const centerGridX = Math.round(startX / this.chunkWidth);
    const minGridX = centerGridX - 2;
    const minGridZ = Math.floor((startZ - 45.0) / this.chunkLength);

    for (let ix = 0; ix < this.numChunksX; ix++) {
      const gx = minGridX + ix;
      const modX = this.mod(gx, this.numChunksX);
      for (let iz = 0; iz < this.numChunksZ; iz++) {
        const gz = minGridZ + iz;
        const modZ = this.mod(gz, this.numChunksZ);

        const chunk = this.chunkGrid[modX][modZ];
        chunk.gridX = gx;
        chunk.gridZ = gz;
        chunk.centerX = gx * this.chunkWidth;
        chunk.centerZ = gz * this.chunkLength;
        chunk.mesh.position.set(chunk.centerX, 0, chunk.centerZ);
        this.populateChunk(chunk);
      }
    }

    // Refresh river chunks across the 5 active Z slices
    for (let iz = 0; iz < this.numChunksZ; iz++) {
      const gz = minGridZ + iz;
      const riverCenterZ = gz * this.chunkLength;
      const riverSlot = this.mod(gz, 5);
      this.canyonRiver.populateRiverChunk(riverSlot, riverCenterZ, this.chunkLength);
    }
  }

  public populateChunk(chunk: TerrainChunk) {
    const posAttr = chunk.posAttr;
    const colorAttr = chunk.colorAttr;
    const posArray = posAttr.array as Float32Array;
    const colorArray = colorAttr.array as Float32Array;

    const cols = this.chunkWidthSegments + 1; // 31
    const rows = this.chunkLengthSegments + 1; // 31
    const meshX = chunk.centerX;
    const meshZ = chunk.centerZ;

    for (let r = 0; r < rows; r++) {
      const rowStart = r * cols;
      const rowSampleZ = posArray[rowStart * 3 + 2];
      const worldZ = rowSampleZ + meshZ;

      // Evaluate active branches once per grid row
      const branches = flightPath.getActiveBranchesAt(worldZ);

      for (let c = 0; c < cols; c++) {
        const idx = (rowStart + c) * 3;
        const worldX = posArray[idx] + meshX;
        const vertexWeights = flightPath.getBiomeWeights(worldX, worldZ);
        const h = flightPath.getTerrainHeight(worldX, worldZ, vertexWeights, branches);
        posArray[idx + 1] = h;

        // Distance to closest active branch (where pillars are located)
        let distToBranch = Math.abs(worldX - branches[0].point.x);
        if (branches.length > 1) {
          for (let b = 1; b < branches.length; b++) {
            distToBranch = Math.min(distToBranch, Math.abs(worldX - branches[b].point.x));
          }
        }

        // Discrete block grid coordinate noise (pixelated block texture variation)
        const bx = Math.floor(worldX);
        const bz = Math.floor(worldZ);
        const blockHash = Math.abs(Math.sin(bx * 12.9898 + bz * 78.233) * 43758.5453);
        const blockNoise = ((blockHash - Math.floor(blockHash)) - 0.5) * 0.08;

        // Compute vertex color across registered biomes
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let totalWeight = 0;

        if (vertexWeights.biomeWeights) {
          for (const [biome, w] of vertexWeights.biomeWeights.entries()) {
            if (w > 0.0001) {
              const [cr, cg, cb] = biome.getVertexColor({
                x: worldX,
                z: worldZ,
                h,
                distToBranch,
                blockNoise,
                bx,
                bz,
              });
              totalR += w * cr;
              totalG += w * cg;
              totalB += w * cb;
              totalWeight += w;
            }
          }
        }

        if (totalWeight > 0.0001) {
          colorArray[idx] = totalR / totalWeight;
          colorArray[idx + 1] = totalG / totalWeight;
          colorArray[idx + 2] = totalB / totalWeight;
        } else {
          colorArray[idx] = 0.35;
          colorArray[idx + 1] = 0.58;
          colorArray[idx + 2] = 0.18;
        }
      }
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    chunk.geometry.computeBoundingBox();
    chunk.geometry.computeBoundingSphere();
  }

  public updateTerrain(birdZ: number, force: boolean = false, delta: number = 0.016, birdX?: number) {
    this.lastBirdZ = birdZ;
    const targetBirdX = (birdX !== undefined) ? birdX : (flightPath.getPoint(birdZ)?.x ?? 0);
    this.lastBirdX = targetBirdX;

    // =======================================================
    // DYNAMIC ATMOSPHERE, SKY & FOG ACCORDING TO ACTIVE BIOME
    // (Lightweight scalar interpolation - smooth every frame)
    // =======================================================
    const birdBiome = flightPath.getBiomeWeights(targetBirdX, birdZ);
    this.cloudSystem.update(delta, birdZ, birdBiome, targetBirdX);
    const targetSky = new THREE.Color();
    const targetFog = new THREE.Color();
    const targetGround = new THREE.Color();

    let skyR = 0, skyG = 0, skyB = 0;
    let fogR = 0, fogG = 0, fogB = 0;
    let gndR = 0, gndG = 0, gndB = 0;
    let totalWeight = 0;

    if (birdBiome.biomeWeights) {
      for (const [biome, w] of birdBiome.biomeWeights.entries()) {
        if (w > 0.0001) {
          const atm = biome.getAtmosphereColors();
          skyR += w * atm.sky.r;
          skyG += w * atm.sky.g;
          skyB += w * atm.sky.b;

          fogR += w * atm.fog.r;
          fogG += w * atm.fog.g;
          fogB += w * atm.fog.b;

          gndR += w * atm.ground.r;
          gndG += w * atm.ground.g;
          gndB += w * atm.ground.b;

          totalWeight += w;
        }
      }
    }

    if (totalWeight > 0.0001) {
      targetSky.setRGB(skyR / totalWeight, skyG / totalWeight, skyB / totalWeight);
      targetFog.setRGB(fogR / totalWeight, fogG / totalWeight, fogB / totalWeight);
      targetGround.setRGB(gndR / totalWeight, gndG / totalWeight, gndB / totalWeight);
    } else {
      targetSky.setHex(0xbfe3f7);
      targetFog.setHex(0xbfe3f7);
      targetGround.setHex(0x4f772d);
    }

    this.scene.background = targetSky;
    if (this.scene.fog && (this.scene.fog as THREE.Fog).isFog) {
      (this.scene.fog as THREE.Fog).color.copy(targetFog);
    }
    this.hemiLight.groundColor.copy(targetGround);

    // Keep directional light and shadows centered over the active flight region
    this.dirLight.position.set(targetBirdX + 40, 80, birdZ - 20);
    this.dirLight.target.position.set(targetBirdX, 0, birdZ + 25);
    this.dirLight.target.updateMatrixWorld();

    // Trees are recycled behind camera directly into far distance (>165m)
    this.treesGroup.children.forEach((tree) => {
      if (tree.position.z < birdZ - 65) {
        const newZ = birdZ + 165 + Math.random() * 75;
        const pathPt = flightPath.getPoint(newZ);
        const weights = flightPath.getBiomeWeights(pathPt.x, newZ);
        const isRiverOrCanyon = weights.primaryBiome ? weights.primaryBiome.hasRiver() : false;
        const minOffset = isRiverOrCanyon ? 24.0 : 14.0;
        const side = Math.random() > 0.5 ? 1 : -1;
        const offsetX = side * (minOffset + Math.random() * 34);
        const newX = pathPt.x + offsetX;
        tree.position.set(newX, flightPath.getTerrainHeight(newX, newZ), newZ);
      }
    });

    // Desired 2D ring buffer bounds:
    const centerGridX = Math.round(targetBirdX / this.chunkWidth);
    const minGridX = centerGridX - 2;
    const maxGridX = minGridX + 4;

    const minGridZ = Math.floor((birdZ - 45.0) / this.chunkLength);
    const maxGridZ = minGridZ + 4;

    // When force update is requested (e.g. branch selection or reset), refresh visible chunks ahead
    if (force) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        const modX = this.mod(gx, this.numChunksX);
        for (let gz = minGridZ; gz <= maxGridZ; gz++) {
          const modZ = this.mod(gz, this.numChunksZ);
          const chunk = this.chunkGrid[modX][modZ];
          chunk.gridX = gx;
          chunk.gridZ = gz;
          chunk.centerX = gx * this.chunkWidth;
          chunk.centerZ = gz * this.chunkLength;
          chunk.mesh.position.set(chunk.centerX, 0, chunk.centerZ);
          this.populateChunk(chunk);
        }
      }
      for (let iz = 0; iz < this.numChunksZ; iz++) {
        const gz = minGridZ + iz;
        const riverCenterZ = gz * this.chunkLength;
        const riverSlot = this.mod(gz, 5);
        this.canyonRiver.populateRiverChunk(riverSlot, riverCenterZ, this.chunkLength);
      }
      // Update all tree heights so they rest accurately on updated or restored terrain
      this.treesGroup.children.forEach((tree) => {
        tree.position.y = flightPath.getTerrainHeight(tree.position.x, tree.position.z);
      });
      return;
    }

    // =======================================================
    // 2D CONVEYOR-BELT RING BUFFER (5x5 GRID: 300m x 300m)
    // Continuous 5 slices wide (X) and 5 slices deep (Z).
    // Chunks remain stationary in world space.
    // As player drifts laterally or advances longitudinally,
    // slices cycling out of range are repurposed to the perimeter.
    // =======================================================
    const updatedRiverRows = new Set<number>();

    for (let gx = minGridX; gx <= maxGridX; gx++) {
      const modX = this.mod(gx, this.numChunksX);
      for (let gz = minGridZ; gz <= maxGridZ; gz++) {
        const modZ = this.mod(gz, this.numChunksZ);
        const chunk = this.chunkGrid[modX][modZ];

        if (chunk.gridX !== gx || chunk.gridZ !== gz) {
          chunk.gridX = gx;
          chunk.gridZ = gz;
          chunk.centerX = gx * this.chunkWidth;
          chunk.centerZ = gz * this.chunkLength;
          chunk.mesh.position.set(chunk.centerX, 0, chunk.centerZ);
          this.populateChunk(chunk);

          if (!updatedRiverRows.has(gz)) {
            updatedRiverRows.add(gz);
            const riverSlot = this.mod(gz, 5);
            this.canyonRiver.populateRiverChunk(riverSlot, chunk.centerZ, this.chunkLength);
          }
        }
      }
    }
  }

  private applyGateTransform(
    obs: ObstacleData,
    distance: number,
    branch: 'SINGLE' | 'LEFT' | 'RIGHT'
  ) {
    if (!obs.gateGroup) return;

    const frame = flightPath.getFrame(distance, branch);
    obs.gateGroup.position.copy(frame.position);
    obs.lateralOffset = frame.position.x;

    const m = new THREE.Matrix4();
    m.makeBasis(frame.right, frame.up, frame.tangent);
    obs.gateGroup.setRotationFromMatrix(m);

    // Position the voxel base mesh directly at the stepped terrain floor beneath the pillar
    if (obs.baseMesh) {
      const pos = obs.gateGroup.position;
      const terrainH = flightPath.getTerrainHeight(pos.x, pos.z);
      obs.baseMesh.position.y = terrainH - pos.y;
    }
  }

  private createGateInstance(
    distance: number,
    branch: 'SINGLE' | 'LEFT' | 'RIGHT',
    columnIndex: number,
    tier: number
  ): ObstacleData {
    const gatePoint = flightPath.getPathPoint(distance, branch);
    const weights = flightPath.getBiomeWeights(gatePoint.x, distance);

    // Dynamic gap center relative to path: in rugged mountains, columns follow dramatic elevation sweeps
    const gapCenterY = flightPath.getColumnGapCenterY(distance, weights.mountain, gatePoint.x);
    const gapHeight = flightPath.columnGapHeight; // Generous clearance opening for 3D navigation

    // Select biome-specific architectural voxel assets from registered biomes
    const primaryBiome = weights.primaryBiome || biomeRegistry.getByChar('H') || biomeRegistry.getAll()[0];
    const defaultGeo = this.bottomPillarGeos.values().next().value!;
    const defaultTopGeo = this.topPillarGeos.values().next().value!;
    const defaultBaseGeo = this.baseGeos.values().next().value!;

    const bottomPillarGeo = this.bottomPillarGeos.get(primaryBiome) || defaultGeo;
    const topPillarGeo = this.topPillarGeos.get(primaryBiome) || defaultTopGeo;
    const baseGeo = this.baseGeos.get(primaryBiome) || defaultBaseGeo;

    // Create obstacle group aligned with the path tangent
    const gateGroup = new THREE.Group();

    // 1. Bottom Voxel Pillar: complete 24m column composed of standard 1x1x1 blocks
    const bottomMesh = new THREE.Mesh(bottomPillarGeo, this.voxelPillarMat);
    bottomMesh.position.y = gapCenterY - gapHeight / 2;
    bottomMesh.castShadow = true;
    bottomMesh.receiveShadow = true;
    gateGroup.add(bottomMesh);

    // 2. Voxel Block Foundation surrounding the pillar base
    const baseMesh = new THREE.Mesh(baseGeo, this.voxelBaseMat);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    gateGroup.add(baseMesh);

    // 3. Top Voxel Pillar: complete 24m column composed of standard 1x1x1 blocks
    const topMesh = new THREE.Mesh(topPillarGeo, this.voxelPillarMat);
    topMesh.position.y = gapCenterY + gapHeight / 2;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    gateGroup.add(topMesh);

    // 4. Floating Smooth Golden Doughnut Ring in center of gap
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.y = gapCenterY;
    ring.castShadow = true;
    gateGroup.add(ring);

    this.obstacleMeshesGroup.add(gateGroup);

    const obstacle: ObstacleData = {
      id: ++this.obstacleIdCounter,
      columnIndex,
      pathDistance: distance,
      gapCenterY,
      gapHeight,
      passed: false,
      branch,
      lateralOffset: 0,
      tier,
      topPipeMesh: topMesh,
      bottomPipeMesh: bottomMesh,
      ringMesh: ring,
      gateGroup,
      baseMesh,
    };

    this.applyGateTransform(obstacle, distance, branch);

    // Attach any prior crash feathers recorded on this pillar
    this.featherManager.attachFeathersToObstacle(obstacle);

    (gateGroup as any)._obstacleData = obstacle;
    this.obstacles.push(obstacle);
    if (this.totemManager) {
      this.totemManager.checkAndSpawnTotem(obstacle, this.obstacles);
    }
    return obstacle;
  }

  public onBranchSelected(
    chosenBranch: 'LEFT' | 'RIGHT',
    forkDistanceOrTier: number,
    _baseOffset?: number,
    tierParam?: number
  ) {
    const tier = tierParam ?? (forkDistanceOrTier > 10 ? Math.max(1, Math.round((forkDistanceOrTier - 17.0) / 294.0)) : forkDistanceOrTier);
    this.activeBranchOffset = chosenBranch === 'LEFT' ? 50 : -50;
    flightPath.onBranchSelected(tier, chosenBranch);
    // Both Left and Right flight paths and terrain corridors are pre-built in fixed world space.
    // No forced terrain regeneration is needed, preventing animation frame hitches.
  }

  public spawnObstaclesAtDistance(distance: number) {
    this.currentColumnIndex++;
    const colIndex = this.currentColumnIndex;
    const tier = Math.floor((colIndex - 1) / 10);

    // Level 0 (columns 1..10): single trunk path exactly straight ahead of start
    if (tier === 0) {
      this.createGateInstance(distance, 'SINGLE', colIndex, 0);

      // At column 10: spawn Wind Gust Pair for Level 0 decision point
      if (colIndex === 10) {
        const nextForced = flightPath.getForcedBoundaryBranch(1);
        if (!nextForced) {
          const gustDist = flightPath.getDecisionPointDistance(0);
          const windGust = new WindGustPair(this.scene, gustDist, 'SINGLE', 1);
          this.windGusts.push(windGust);
        }
      }
    } else {
      // Level >= 1: decision point branches into Left (-2 tiles = -50m) and Right (+2 tiles = +50m)
      const forced = flightPath.getForcedBoundaryBranch(tier);
      if (forced === 'RIGHT') {
        this.createGateInstance(distance, 'RIGHT', colIndex, tier);
      } else if (forced === 'LEFT') {
        this.createGateInstance(distance, 'LEFT', colIndex, tier);
      } else {
        this.createGateInstance(distance, 'LEFT', colIndex, tier);
        this.createGateInstance(distance, 'RIGHT', colIndex, tier);
      }

      // At column 10 of this level (col 20, 30, 40...):
      // If the upcoming level is forced by reaching 3 tiles to the left or right, suppress the gusts!
      if (colIndex % 10 === 0) {
        const nextTier = tier + 1;
        const nextForced = flightPath.getForcedBoundaryBranch(nextTier);
        if (!nextForced) {
          const gustDist = flightPath.getDecisionPointDistance(tier);
          const activeBranch = flightPath.getLevelBranch(tier);
          const windGust = new WindGustPair(this.scene, gustDist, activeBranch, nextTier);
          this.windGusts.push(windGust);
        }
      }
    }
  }

  public setActiveBranchOffset(offset: number) {
    this.activeBranchOffset = offset;
    flightPath.setActiveBranchOffset(offset);
  }

  public update(
    birdDistance: number,
    birdRelativeY: number,
    delta: number,
    birdX?: number,
    birdBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE'
  ): WindGustTriggerResult | null {
    // Generate new obstacles ahead based on exact 10-column per level distances
    while (flightPath.getColumnDistance(this.currentColumnIndex + 1) < birdDistance + 165.0) {
      const nextCol = this.currentColumnIndex + 1;
      const nextDist = flightPath.getColumnDistance(nextCol);
      this.spawnObstaclesAtDistance(nextDist);
    }

    // Spin signature rings
    this.obstacles.forEach((obs) => {
      if (obs.ringMesh) {
        obs.ringMesh.rotation.y += delta * 2.8;
      }
    });

    // Update all Wind Gust Pairs and check for triggers
    let triggeredGust: WindGustTriggerResult | null = null;
    for (const gust of this.windGusts) {
      const res = gust.update(delta, birdDistance, birdRelativeY, birdBranch);
      if (res.triggered) {
        triggeredGust = res;
      }
    }

    // Prune old wind gusts far behind the camera
    for (let i = this.windGusts.length - 1; i >= 0; i--) {
      const gust = this.windGusts[i];
      if (gust.pathDistance < birdDistance - 80) {
        gust.dispose(this.scene);
        this.windGusts.splice(i, 1);
      }
    }

    // Prune old obstacles far behind the camera
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const zPos = obs.gateGroup ? obs.gateGroup.position.z : obs.pathDistance;
      if (zPos < birdDistance - 60) {
        if (obs.gateGroup) {
          this.obstacleMeshesGroup.remove(obs.gateGroup);
        }
        this.obstacles.splice(i, 1);
      }
    }

    if (this.totemManager) {
      this.totemManager.pruneTotems(birdDistance);
    }

    // Update terrain mesh elevation and vertex colors ahead of bird
    this.updateTerrain(birdDistance, false, delta, birdX);

    // Update Canyon River flow & Rapids churning animation
    this.canyonRiver.update(delta);

    // Stream and render prior crash feathers in the terrain
    this.featherManager.updateTerrainFeathers(birdDistance);

    return triggeredGust;
  }

  public spawnInitialObstacles(birdDistance: number = 0) {
    while (flightPath.getColumnDistance(this.currentColumnIndex + 1) < birdDistance + 165.0) {
      const nextCol = this.currentColumnIndex + 1;
      const nextDist = flightPath.getColumnDistance(nextCol);
      this.spawnObstaclesAtDistance(nextDist);
    }
  }

  public reset(startZ: number = 0, customStartX?: number) {
    // Clear obstacles
    this.obstacles.forEach((obs) => {
      if (obs.gateGroup) {
        this.obstacleMeshesGroup.remove(obs.gateGroup);
      }
    });
    this.obstacles = [];

    // Clear wind gusts
    this.windGusts.forEach((g) => g.dispose(this.scene));
    this.windGusts = [];

    this.forkDecisions.clear();
    const startLevel = Math.max(0, Math.floor(startZ / LEVEL_LENGTH));
    this.currentColumnIndex = startLevel * 10;
    this.nextObstacleDist = startZ + 38.0;
    this.activeBranchOffset = customStartX !== undefined ? customStartX : 0;
    if (startLevel === 0) {
      flightPath.resetBranches();
    }

    if (this.totemManager) {
      this.totemManager.reset();
    }

    const startPt = flightPath.getPoint(startZ);
    const startX = customStartX !== undefined ? customStartX : (startPt ? startPt.x : 0);

    this.repositionTreesAndClouds(startZ, startX);
    this.resetChunks(startZ, startX);
    this.featherManager.reset(startZ);
    this.setUnchartedLighting(0);
    this.updateTerrain(startZ, true, 0.016, startX);
    this.spawnInitialObstacles(startZ);
  }

  /**
   * Smoothly adjusts world lighting & atmospheric fog when flying in uncharted territory
   */
  public setUnchartedLighting(ratio: number) {
    const baseDir = new THREE.Color(0xfffaed);
    const goldDir = new THREE.Color(0xffd166);
    this.dirLight.color.copy(baseDir).lerp(goldDir, ratio);
    this.dirLight.intensity = THREE.MathUtils.lerp(1.25, 1.45, ratio);

    const baseSky = new THREE.Color(0xbfe3f7);
    const goldSky = new THREE.Color(0xfddaa0);
    const skyCol = baseSky.clone().lerp(goldSky, ratio * 0.65);
    this.scene.background = skyCol;
    if (this.scene.fog) {
      this.scene.fog.color.copy(skyCol);
    }
  }
}
