import * as THREE from 'three';
import { BiomeWeights, flightPath, FlightPathGenerator, ForkDecision, LEVEL_LENGTH } from './pathGenerator';
import { ObstacleData } from '../types';
import { WindGustPair, WindGustTriggerResult } from './windGust';
import { CanyonRiverManager } from './canyonRiver';
import { CloudSystem } from './cloudSystem';
import { FeatherManager } from './featherManager';
import { TotemManager } from './totemManager';
import { Biome, biomeRegistry, WATER_LEVEL } from '../biomes';

export type { ForkDecision };

interface TerrainChunk {
  mesh: THREE.Mesh;
  waterMesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  posAttr: THREE.BufferAttribute;
  colorAttr: THREE.BufferAttribute;
  waterGeometry: THREE.BufferGeometry;
  waterIndexAttr: THREE.BufferAttribute;
  waterIndices: Uint16Array;
  waterUvAttr: THREE.BufferAttribute;
  waterBeachWeightAttr: THREE.BufferAttribute;
  waterDepthAttr: THREE.BufferAttribute;
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
 * The bottom pillar / base extends 3 times lower (72 blocks = 72 meters)
 * so columns stay grounded and never appear like they are floating.
 */
function createVoxelBlockPillar(biome: Biome, isTop: boolean): THREE.BufferGeometry {
  const voxels: VoxelBlock[] = [];
  const layers = isTop ? 24 : 72; // Base of column extends 3x lower (72m vs 24m)

  // Core 2x2 column of 1.0 x 1.0 x 1.0 blocks
  const coreCoords = [
    [-0.5, -0.5],
    [ 0.5, -0.5],
    [-0.5,  0.5],
    [ 0.5,  0.5],
  ];

  for (let i = 0; i < layers; i++) {
    // Bottom pillar: y goes from -0.5 down to -71.5 (facing up towards gap at -0.5)
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
 * Sub-ground anchoring blocks extend 3 times deeper to embed firmly into uneven/sloped terrain.
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
    // Sub-ground anchoring blocks extending 3x deeper into terrain (-0.5, -1.5, -2.5)
    for (let depth = 0; depth < 3; depth++) {
      voxels.push({ x: bx, y: -0.5 - depth, z: bz, topC, sideC, botC });
    }
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
    for (let depth = 0; depth < 3; depth++) {
      solidCoreMask.add(voxelKey(cx, -0.5 - depth, cz));
    }
  }

  return buildVoxelGeometry(voxels, solidCoreMask);
}

/**
 * Shared geometries and materials for the 4 biome tree variants:
 * - "h" and "H": classic oak/deciduous hills trees
 * - "w": tropical sparse palm trees
 * - "m": conical evergreen pine trees
 * - "M": snow-covered alpine pine trees
 */
interface TreeSharedAssets {
  // Hills ("h", "H")
  hillsTrunkGeo: THREE.BoxGeometry;
  hillsFoliageBaseGeo: THREE.BoxGeometry;
  hillsFoliageTopGeo: THREE.BoxGeometry;
  hillsTrunkMat: THREE.MeshStandardMaterial;
  hillsFoliageMat: THREE.MeshStandardMaterial;

  // Palm ("w")
  palmTrunkBaseGeo: THREE.BoxGeometry;
  palmTrunkMidGeo: THREE.BoxGeometry;
  palmTrunkTopGeo: THREE.BoxGeometry;
  palmCoconutGeo: THREE.BoxGeometry;
  palmCrownGeo: THREE.BoxGeometry;
  palmFrondInXGeo: THREE.BoxGeometry;
  palmFrondOutXGeo: THREE.BoxGeometry;
  palmFrondInZGeo: THREE.BoxGeometry;
  palmFrondOutZGeo: THREE.BoxGeometry;
  palmFrondDiagGeo: THREE.BoxGeometry;
  palmTrunkMat: THREE.MeshStandardMaterial;
  palmCoconutMat: THREE.MeshStandardMaterial;
  palmCrownMat: THREE.MeshStandardMaterial;
  palmFrondInMat: THREE.MeshStandardMaterial;
  palmFrondOutMat: THREE.MeshStandardMaterial;

  // Pine ("m")
  pineTrunkGeo: THREE.BoxGeometry;
  pineTier1Geo: THREE.BoxGeometry;
  pineTier2Geo: THREE.BoxGeometry;
  pineTier3Geo: THREE.BoxGeometry;
  pineSpireGeo: THREE.BoxGeometry;
  pineTrunkMat: THREE.MeshStandardMaterial;
  pineFoliageMat: THREE.MeshStandardMaterial;

  // Snow Pine ("M")
  snowPineTrunkGeo: THREE.BoxGeometry;
  snowTier1BaseGeo: THREE.BoxGeometry;
  snowTier1CapGeo: THREE.BoxGeometry;
  snowTier2BaseGeo: THREE.BoxGeometry;
  snowTier2CapGeo: THREE.BoxGeometry;
  snowTier3BaseGeo: THREE.BoxGeometry;
  snowTier3CapGeo: THREE.BoxGeometry;
  snowSpireGeo: THREE.BoxGeometry;
  snowPineTrunkMat: THREE.MeshStandardMaterial;
  snowPineFoliageMat: THREE.MeshStandardMaterial;
  snowCapMat: THREE.MeshStandardMaterial;
  snowSpireMat: THREE.MeshStandardMaterial;
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
  private waterGroup: THREE.Group;
  private waterTexture: THREE.CanvasTexture;
  private waterMaterial: THREE.MeshStandardMaterial;
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
  private waterTime: number = 0;
  private treesGroup: THREE.Group;
  private treeAssets: TreeSharedAssets;
  private cloudSystem: CloudSystem;
  public featherManager: FeatherManager;
  private totemManager: TotemManager | null = null;

  public setTotemManager(totemManager: TotemManager) {
    this.totemManager = totemManager;
  }

  // Camera reference to follow for loaded terrain tile elements
  private camera: THREE.Camera | null = null;

  public setCamera(camera: THREE.Camera) {
    this.camera = camera;
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

    this.treeAssets = this.createTreeSharedAssets();

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

    // Flat bluish water sheet surface filling water basins at sea level
    this.waterGroup = new THREE.Group();
    scene.add(this.waterGroup);

    this.waterTexture = this.createWaterTexture();
    this.waterMaterial = new THREE.MeshStandardMaterial({
      map: this.waterTexture,
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.18,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Beach Wave Shader Hook: zero extra draw calls, GPU-driven shoreline wave swells & frothy foam
    this.waterMaterial.customProgramCacheKey = () => 'beach_waves_water_v1';
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.waterMaterial.userData.shader = shader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
attribute float aBeachWave;
attribute float aWaterDepth;
varying vec3 vBeachWorldPos;
varying float vBeachWave;
varying float vWaterDepth;
uniform float uTime;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vBeachWave = aBeachWave;
vWaterDepth = aWaterDepth;
vec4 bWorldPos = modelMatrix * vec4(transformed, 1.0);
vBeachWorldPos = bWorldPos.xyz;

if (aBeachWave > 0.0) {
  // Gentle rhythmic swell rolling toward the beach (2.5s period)
  float wavePhase = uTime * 2.5 + bWorldPos.x * 0.35 + bWorldPos.z * 0.25;
  float waveSwell = sin(wavePhase);
  // Swell upward and forward onto the sand by up to 0.12m
  transformed.y += max(0.0, waveSwell) * 0.12 * aBeachWave;
}`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vBeachWorldPos;
varying float vBeachWave;
varying float vWaterDepth;
uniform float uTime;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
if (vBeachWave > 0.02) {
  float wavePhase = uTime * 2.5 + vBeachWorldPos.x * 0.35 + vBeachWorldPos.z * 0.25;
  float waveCycle = sin(wavePhase);

  // 1. Radiant tropical turquoise shallows near the coast
  vec3 shallowsColor = vec3(0.14, 0.82, 0.90);
  float shallowFactor = smoothstep(1.2, 0.05, vWaterDepth) * vBeachWave;
  diffuseColor.rgb = mix(diffuseColor.rgb, shallowsColor, shallowFactor * 0.42);

  // 2. Breaking wave crest surging toward the shore
  float crest = smoothstep(0.35, 0.96, waveCycle);

  // 3. Frothy shoreline foam where the water meets the beach sand
  float shoreLine = smoothstep(0.40, 0.02, abs(vWaterDepth - 0.02 - max(0.0, waveCycle) * 0.07));

  // 4. Cellular bubbling sea-foam texture detail
  vec2 foamUV = vBeachWorldPos.xz * 3.8;
  float bubbleNoise = fract(sin(dot(floor(foamUV), vec2(12.9898, 78.233))) * 43758.5453);
  float bubbleDetail = smoothstep(0.2, 0.8, bubbleNoise);

  // 5. Total foam intensity
  float foamFactor = clamp(
    (crest * 0.65 + shoreLine * 0.85 + (crest * shoreLine) * 0.5) * (0.8 + 0.3 * bubbleDetail) * vBeachWave,
    0.0,
    1.0
  );

  // 6. Blend bright white frothy surf into water diffuse
  vec3 foamColor = vec3(0.96, 0.99, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, foamColor, foamFactor * 0.94);
  diffuseColor.a = max(diffuseColor.a, foamFactor * 0.96);
}`
      );
    };

    // Canyon River with Whitewater Rapids Manager
    this.canyonRiver = new CanyonRiverManager(scene);

    const terrainMat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      vertexColors: true,
    });

    const cols = this.chunkWidthSegments + 1;
    const rows = this.chunkLengthSegments + 1;
    const maxWaterIndices = (cols - 1) * (rows - 1) * 6; // 30 * 30 * 6 = 5400

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

        // Per-chunk dynamic water geometry matching the terrain grid resolution
        const waterGeo = new THREE.BufferGeometry();
        const waterPositions = new Float32Array(vertexCount * 3);
        const waterUvs = new Float32Array(vertexCount * 2);
        const waterNormals = new Float32Array(vertexCount * 3);
        const waterBeachWeights = new Float32Array(vertexCount);
        const waterDepths = new Float32Array(vertexCount);

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const vIdx = r * cols + c;
            const lx = ((c / (cols - 1)) - 0.5) * this.chunkWidth;
            const lz = ((r / (rows - 1)) - 0.5) * this.chunkLength;

            waterPositions[vIdx * 3] = lx;
            waterPositions[vIdx * 3 + 1] = WATER_LEVEL;
            waterPositions[vIdx * 3 + 2] = lz;

            waterNormals[vIdx * 3] = 0;
            waterNormals[vIdx * 3 + 1] = 1;
            waterNormals[vIdx * 3 + 2] = 0;

            waterUvs[vIdx * 2] = (c / (cols - 1)) * 4;
            waterUvs[vIdx * 2 + 1] = (r / (rows - 1)) * 4;
          }
        }

        const waterIndices = new Uint16Array(maxWaterIndices);
        const waterIndexAttr = new THREE.BufferAttribute(waterIndices, 1);
        const waterPosAttr = new THREE.BufferAttribute(waterPositions, 3);
        const waterUvAttr = new THREE.BufferAttribute(waterUvs, 2);
        const waterNormalAttr = new THREE.BufferAttribute(waterNormals, 3);
        const waterBeachWeightAttr = new THREE.BufferAttribute(waterBeachWeights, 1);
        const waterDepthAttr = new THREE.BufferAttribute(waterDepths, 1);

        waterGeo.setAttribute('position', waterPosAttr);
        waterGeo.setAttribute('uv', waterUvAttr);
        waterGeo.setAttribute('normal', waterNormalAttr);
        waterGeo.setAttribute('aBeachWave', waterBeachWeightAttr);
        waterGeo.setAttribute('aWaterDepth', waterDepthAttr);
        waterGeo.setIndex(waterIndexAttr);
        waterGeo.setDrawRange(0, 0);

        const waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
        waterMesh.receiveShadow = true;
        this.waterGroup.add(waterMesh);

        const chunk: TerrainChunk = {
          mesh,
          waterMesh,
          geometry: geo,
          posAttr: geo.attributes.position as THREE.BufferAttribute,
          colorAttr: geo.attributes.color as THREE.BufferAttribute,
          waterGeometry: waterGeo,
          waterIndexAttr,
          waterIndices,
          waterUvAttr,
          waterBeachWeightAttr,
          waterDepthAttr,
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

  /**
   * Procedural aquatic water surface texture with caustic networks, gentle wave crests,
   * and sunlit specular micro-glints.
   */
  private createWaterTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    // 1. Deep ocean to tropical azure water gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 512, 512);
    bgGrad.addColorStop(0.0, '#0284c7'); // Rich azure blue
    bgGrad.addColorStop(0.35, '#0ea5e9'); // Tropical cerulean
    bgGrad.addColorStop(0.7, '#0284c7'); // Ocean blue
    bgGrad.addColorStop(1.0, '#0369a1'); // Deep sea blue
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 512);

    // 2. Translucent interconnected caustic rings
    const drawCausticRing = (cx: number, cy: number, r: number, alpha: number) => {
      ctx.strokeStyle = `rgba(224, 242, 254, ${alpha})`;
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const points = 8;
      for (let p = 0; p <= points; p++) {
        const angle = (p / points) * Math.PI * 2;
        const dist = r * (0.82 + 0.36 * Math.sin(angle * 3 + cx * 0.04));
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    const gridSize = 56;
    for (let gx = 0; gx <= 512; gx += gridSize) {
      for (let gy = 0; gy <= 512; gy += gridSize) {
        const jx = ((Math.sin(gx * 11.3 + gy * 7.7) * 0.5 + 0.5) - 0.5) * 24;
        const jy = ((Math.cos(gx * 8.3 + gy * 13.9) * 0.5 + 0.5) - 0.5) * 24;
        const radius = 22 + Math.sin(gx * 0.04 + gy * 0.03) * 6;
        drawCausticRing(gx + jx, gy + jy, radius, 0.42);
      }
    }

    // 3. Flowing undulating surface wave ribbons
    for (let i = 0; i < 22; i++) {
      const y = (i / 22) * 512;
      ctx.beginPath();
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.38)' : 'rgba(186, 230, 253, 0.32)';
      ctx.lineWidth = 2.0;
      for (let x = 0; x <= 512; x += 16) {
        const waveY = y + Math.sin(x * 0.06 + i * 1.4) * 5.5 + Math.cos(x * 0.02) * 2.5;
        if (x === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }

    // 4. Subtle sunlight sparkles (specular sun glints on the waves)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (let s = 0; s < 50; s++) {
      const sx = Math.abs(Math.sin(s * 17.13 + 3.7)) * 512;
      const sy = Math.abs(Math.cos(s * 29.41 + 1.2)) * 512;
      const size = 1.4 + Math.sin(s) * 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  private createTreeSharedAssets(): TreeSharedAssets {
    // 1. Hills ("h", "H"): classic oak / deciduous hills trees
    const hillsTrunkGeo = new THREE.BoxGeometry(0.65, 2.2, 0.65);
    const hillsFoliageBaseGeo = new THREE.BoxGeometry(2.4, 1.6, 2.4);
    const hillsFoliageTopGeo = new THREE.BoxGeometry(1.4, 1.0, 1.4);
    const hillsTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c2b, roughness: 0.9, flatShading: true });
    const hillsFoliageMat = new THREE.MeshStandardMaterial({ color: 0x3d7326, roughness: 0.85, flatShading: true });

    // 2. Palm ("w"): tropical sparse palm trees with curved trunk, coconuts & drooping fronds
    const palmTrunkBaseGeo = new THREE.BoxGeometry(0.45, 1.4, 0.45);
    const palmTrunkMidGeo = new THREE.BoxGeometry(0.42, 1.4, 0.42);
    const palmTrunkTopGeo = new THREE.BoxGeometry(0.38, 1.3, 0.38);
    const palmCoconutGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const palmCrownGeo = new THREE.BoxGeometry(0.7, 0.4, 0.7);
    const palmFrondInXGeo = new THREE.BoxGeometry(1.4, 0.22, 0.65);
    const palmFrondOutXGeo = new THREE.BoxGeometry(1.0, 0.18, 0.5);
    const palmFrondInZGeo = new THREE.BoxGeometry(0.65, 0.22, 1.4);
    const palmFrondOutZGeo = new THREE.BoxGeometry(0.5, 0.18, 1.0);
    const palmFrondDiagGeo = new THREE.BoxGeometry(0.55, 0.18, 0.55);
    const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8c6239, roughness: 0.9, flatShading: true });
    const palmCoconutMat = new THREE.MeshStandardMaterial({ color: 0x3b200b, roughness: 0.9, flatShading: true });
    const palmCrownMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.85, flatShading: true });
    const palmFrondInMat = new THREE.MeshStandardMaterial({ color: 0x38a169, roughness: 0.85, flatShading: true });
    const palmFrondOutMat = new THREE.MeshStandardMaterial({ color: 0x277a45, roughness: 0.85, flatShading: true });

    // 3. Pine ("m"): conical evergreen pine trees with tiered canopy
    const pineTrunkGeo = new THREE.BoxGeometry(0.55, 2.2, 0.55);
    const pineTier1Geo = new THREE.BoxGeometry(2.8, 1.1, 2.8);
    const pineTier2Geo = new THREE.BoxGeometry(2.0, 1.0, 2.0);
    const pineTier3Geo = new THREE.BoxGeometry(1.3, 0.9, 1.3);
    const pineSpireGeo = new THREE.BoxGeometry(0.65, 0.9, 0.65);
    const pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x48321d, roughness: 0.9, flatShading: true });
    const pineFoliageMat = new THREE.MeshStandardMaterial({ color: 0x1e4f2b, roughness: 0.85, flatShading: true });

    // 4. Snow Pine ("M"): snow-covered alpine pine trees with crisp snow caps
    const snowPineTrunkGeo = new THREE.BoxGeometry(0.55, 2.2, 0.55);
    const snowTier1BaseGeo = new THREE.BoxGeometry(2.8, 0.75, 2.8);
    const snowTier1CapGeo = new THREE.BoxGeometry(2.85, 0.35, 2.85);
    const snowTier2BaseGeo = new THREE.BoxGeometry(2.0, 0.65, 2.0);
    const snowTier2CapGeo = new THREE.BoxGeometry(2.05, 0.35, 2.05);
    const snowTier3BaseGeo = new THREE.BoxGeometry(1.3, 0.55, 1.3);
    const snowTier3CapGeo = new THREE.BoxGeometry(1.35, 0.35, 1.35);
    const snowSpireGeo = new THREE.BoxGeometry(0.7, 0.8, 0.7);
    const snowPineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x383028, roughness: 0.9, flatShading: true });
    const snowPineFoliageMat = new THREE.MeshStandardMaterial({ color: 0x184424, roughness: 0.85, flatShading: true });
    const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.75, flatShading: true });
    const snowSpireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, flatShading: true });

    return {
      hillsTrunkGeo,
      hillsFoliageBaseGeo,
      hillsFoliageTopGeo,
      hillsTrunkMat,
      hillsFoliageMat,
      palmTrunkBaseGeo,
      palmTrunkMidGeo,
      palmTrunkTopGeo,
      palmCoconutGeo,
      palmCrownGeo,
      palmFrondInXGeo,
      palmFrondOutXGeo,
      palmFrondInZGeo,
      palmFrondOutZGeo,
      palmFrondDiagGeo,
      palmTrunkMat,
      palmCoconutMat,
      palmCrownMat,
      palmFrondInMat,
      palmFrondOutMat,
      pineTrunkGeo,
      pineTier1Geo,
      pineTier2Geo,
      pineTier3Geo,
      pineSpireGeo,
      pineTrunkMat,
      pineFoliageMat,
      snowPineTrunkGeo,
      snowTier1BaseGeo,
      snowTier1CapGeo,
      snowTier2BaseGeo,
      snowTier2CapGeo,
      snowTier3BaseGeo,
      snowTier3CapGeo,
      snowSpireGeo,
      snowPineTrunkMat,
      snowPineFoliageMat,
      snowCapMat,
      snowSpireMat,
    };
  }

  private createTreeObject(): THREE.Group {
    const tree = new THREE.Group();
    const assets = this.treeAssets;

    // 1. Hills Tree Group ("h" and "H")
    const hillsGroup = new THREE.Group();
    const hTrunk = new THREE.Mesh(assets.hillsTrunkGeo, assets.hillsTrunkMat);
    hTrunk.position.y = 1.1;
    hTrunk.castShadow = true;
    hTrunk.receiveShadow = true;
    hillsGroup.add(hTrunk);
    const hBase = new THREE.Mesh(assets.hillsFoliageBaseGeo, assets.hillsFoliageMat);
    hBase.position.y = 2.4;
    hBase.castShadow = true;
    hBase.receiveShadow = true;
    hillsGroup.add(hBase);
    const hTop = new THREE.Mesh(assets.hillsFoliageTopGeo, assets.hillsFoliageMat);
    hTop.position.y = 3.4;
    hTop.castShadow = true;
    hTop.receiveShadow = true;
    hillsGroup.add(hTop);
    tree.add(hillsGroup);

    // 2. Palm Tree Group ("w")
    const palmGroup = new THREE.Group();
    const pTrunk1 = new THREE.Mesh(assets.palmTrunkBaseGeo, assets.palmTrunkMat);
    pTrunk1.position.set(0, 0.7, 0);
    pTrunk1.castShadow = true;
    palmGroup.add(pTrunk1);
    const pTrunk2 = new THREE.Mesh(assets.palmTrunkMidGeo, assets.palmTrunkMat);
    pTrunk2.position.set(0.22, 1.85, 0.08);
    pTrunk2.castShadow = true;
    palmGroup.add(pTrunk2);
    const pTrunk3 = new THREE.Mesh(assets.palmTrunkTopGeo, assets.palmTrunkMat);
    pTrunk3.position.set(0.44, 2.95, 0.16);
    pTrunk3.castShadow = true;
    palmGroup.add(pTrunk3);
    const pC1 = new THREE.Mesh(assets.palmCoconutGeo, assets.palmCoconutMat);
    pC1.position.set(0.35, 3.35, 0.3);
    palmGroup.add(pC1);
    const pC2 = new THREE.Mesh(assets.palmCoconutGeo, assets.palmCoconutMat);
    pC2.position.set(0.55, 3.35, 0.02);
    palmGroup.add(pC2);
    const pCrown = new THREE.Mesh(assets.palmCrownGeo, assets.palmCrownMat);
    pCrown.position.set(0.44, 3.65, 0.16);
    pCrown.castShadow = true;
    palmGroup.add(pCrown);

    const fInX1 = new THREE.Mesh(assets.palmFrondInXGeo, assets.palmFrondInMat);
    fInX1.position.set(1.25, 3.75, 0.16);
    fInX1.castShadow = true;
    palmGroup.add(fInX1);
    const fOutX1 = new THREE.Mesh(assets.palmFrondOutXGeo, assets.palmFrondOutMat);
    fOutX1.position.set(2.25, 3.4, 0.16);
    fOutX1.castShadow = true;
    palmGroup.add(fOutX1);

    const fInX2 = new THREE.Mesh(assets.palmFrondInXGeo, assets.palmFrondInMat);
    fInX2.position.set(-0.37, 3.75, 0.16);
    fInX2.castShadow = true;
    palmGroup.add(fInX2);
    const fOutX2 = new THREE.Mesh(assets.palmFrondOutXGeo, assets.palmFrondOutMat);
    fOutX2.position.set(-1.37, 3.4, 0.16);
    fOutX2.castShadow = true;
    palmGroup.add(fOutX2);

    const fInZ1 = new THREE.Mesh(assets.palmFrondInZGeo, assets.palmFrondInMat);
    fInZ1.position.set(0.44, 3.75, 0.97);
    fInZ1.castShadow = true;
    palmGroup.add(fInZ1);
    const fOutZ1 = new THREE.Mesh(assets.palmFrondOutZGeo, assets.palmFrondOutMat);
    fOutZ1.position.set(0.44, 3.4, 1.97);
    fOutZ1.castShadow = true;
    palmGroup.add(fOutZ1);

    const fInZ2 = new THREE.Mesh(assets.palmFrondInZGeo, assets.palmFrondInMat);
    fInZ2.position.set(0.44, 3.75, -0.65);
    fInZ2.castShadow = true;
    palmGroup.add(fInZ2);
    const fOutZ2 = new THREE.Mesh(assets.palmFrondOutZGeo, assets.palmFrondOutMat);
    fOutZ2.position.set(0.44, 3.4, -1.65);
    fOutZ2.castShadow = true;
    palmGroup.add(fOutZ2);

    const d1 = new THREE.Mesh(assets.palmFrondDiagGeo, assets.palmCrownMat);
    d1.position.set(1.0, 3.55, 0.72);
    palmGroup.add(d1);
    const d2 = new THREE.Mesh(assets.palmFrondDiagGeo, assets.palmCrownMat);
    d2.position.set(-0.12, 3.55, 0.72);
    palmGroup.add(d2);
    const d3 = new THREE.Mesh(assets.palmFrondDiagGeo, assets.palmCrownMat);
    d3.position.set(1.0, 3.55, -0.4);
    palmGroup.add(d3);
    const d4 = new THREE.Mesh(assets.palmFrondDiagGeo, assets.palmCrownMat);
    d4.position.set(-0.12, 3.55, -0.4);
    palmGroup.add(d4);
    tree.add(palmGroup);

    // 3. Pine Tree Group ("m")
    const pineGroup = new THREE.Group();
    const pTrunk = new THREE.Mesh(assets.pineTrunkGeo, assets.pineTrunkMat);
    pTrunk.position.y = 1.1;
    pTrunk.castShadow = true;
    pTrunk.receiveShadow = true;
    pineGroup.add(pTrunk);
    const pTier1 = new THREE.Mesh(assets.pineTier1Geo, assets.pineFoliageMat);
    pTier1.position.y = 1.95;
    pTier1.castShadow = true;
    pTier1.receiveShadow = true;
    pineGroup.add(pTier1);
    const pTier2 = new THREE.Mesh(assets.pineTier2Geo, assets.pineFoliageMat);
    pTier2.position.y = 2.8;
    pTier2.castShadow = true;
    pTier2.receiveShadow = true;
    pineGroup.add(pTier2);
    const pTier3 = new THREE.Mesh(assets.pineTier3Geo, assets.pineFoliageMat);
    pTier3.position.y = 3.55;
    pTier3.castShadow = true;
    pTier3.receiveShadow = true;
    pineGroup.add(pTier3);
    const pSpire = new THREE.Mesh(assets.pineSpireGeo, assets.pineFoliageMat);
    pSpire.position.y = 4.25;
    pSpire.castShadow = true;
    pSpire.receiveShadow = true;
    pineGroup.add(pSpire);
    tree.add(pineGroup);

    // 4. Snow Covered Pine Tree Group ("M")
    const snowPineGroup = new THREE.Group();
    const spTrunk = new THREE.Mesh(assets.snowPineTrunkGeo, assets.snowPineTrunkMat);
    spTrunk.position.y = 1.1;
    spTrunk.castShadow = true;
    spTrunk.receiveShadow = true;
    snowPineGroup.add(spTrunk);
    const spT1Base = new THREE.Mesh(assets.snowTier1BaseGeo, assets.snowPineFoliageMat);
    spT1Base.position.y = 1.78;
    spT1Base.castShadow = true;
    spT1Base.receiveShadow = true;
    snowPineGroup.add(spT1Base);
    const spT1Cap = new THREE.Mesh(assets.snowTier1CapGeo, assets.snowCapMat);
    spT1Cap.position.y = 2.2;
    spT1Cap.castShadow = true;
    spT1Cap.receiveShadow = true;
    snowPineGroup.add(spT1Cap);

    const spT2Base = new THREE.Mesh(assets.snowTier2BaseGeo, assets.snowPineFoliageMat);
    spT2Base.position.y = 2.62;
    spT2Base.castShadow = true;
    spT2Base.receiveShadow = true;
    snowPineGroup.add(spT2Base);
    const spT2Cap = new THREE.Mesh(assets.snowTier2CapGeo, assets.snowCapMat);
    spT2Cap.position.y = 3.02;
    spT2Cap.castShadow = true;
    spT2Cap.receiveShadow = true;
    snowPineGroup.add(spT2Cap);

    const spT3Base = new THREE.Mesh(assets.snowTier3BaseGeo, assets.snowPineFoliageMat);
    spT3Base.position.y = 3.42;
    spT3Base.castShadow = true;
    spT3Base.receiveShadow = true;
    snowPineGroup.add(spT3Base);
    const spT3Cap = new THREE.Mesh(assets.snowTier3CapGeo, assets.snowCapMat);
    spT3Cap.position.y = 3.77;
    spT3Cap.castShadow = true;
    spT3Cap.receiveShadow = true;
    snowPineGroup.add(spT3Cap);

    const spSpire = new THREE.Mesh(assets.snowSpireGeo, assets.snowSpireMat);
    spSpire.position.y = 4.25;
    spSpire.castShadow = true;
    spSpire.receiveShadow = true;
    snowPineGroup.add(spSpire);
    tree.add(snowPineGroup);

    tree.userData.hillsGroup = hillsGroup;
    tree.userData.palmGroup = palmGroup;
    tree.userData.pineGroup = pineGroup;
    tree.userData.snowPineGroup = snowPineGroup;

    return tree;
  }

  private setTreeVariant(
    tree: THREE.Group,
    variant: 'HILLS' | 'PALM' | 'PINE' | 'SNOW_PINE'
  ) {
    tree.userData.variant = variant;
    const hillsGroup = tree.userData.hillsGroup as THREE.Group | undefined;
    const palmGroup = tree.userData.palmGroup as THREE.Group | undefined;
    const pineGroup = tree.userData.pineGroup as THREE.Group | undefined;
    const snowPineGroup = tree.userData.snowPineGroup as THREE.Group | undefined;

    if (hillsGroup) hillsGroup.visible = variant === 'HILLS';
    if (palmGroup) palmGroup.visible = variant === 'PALM';
    if (pineGroup) pineGroup.visible = variant === 'PINE';
    if (snowPineGroup) snowPineGroup.visible = variant === 'SNOW_PINE';
  }

  private determineTreeVariant(
    weights: BiomeWeights,
    x: number,
    z: number,
    y?: number
  ): 'NONE' | 'PALM' | 'PINE' | 'SNOW_PINE' | 'HILLS' {
    const char = weights.primaryBiome?.char;
    const isClouds =
      char === 's' ||
      (weights.clouds || 0) > 0.001 ||
      weights.primary === 'HIGH_CLOUDS';

    const terrainY = y !== undefined ? y : flightPath.getTerrainHeight(x, z, weights);

    // "s" sky terrain: remove all trees from high elevations (> 24.0m near mountain peaks / snowy summits).
    // Lower elevation foothills and valleys (<= 24.0m) feature alpine pine trees.
    if (isClouds) {
      if (terrainY > 24.0) {
        return 'NONE';
      }
      return terrainY > 18.0 ? 'SNOW_PINE' : 'PINE';
    }

    // High alpine peaks in rugged mountain terrain above the tree line (> 28.0m)
    if (terrainY > 28.0 && (char === 'M' || char === 'm' || (weights.mountain || 0) > 0.25)) {
      return 'NONE';
    }

    // "W" deep water: no trees
    if (char === 'W' || (weights.waterDeep || 0) > 0.001 || weights.primary === 'DEEP_WATERS') {
      return 'NONE';
    }

    // "w" shallow water: sparse palm trees
    if (char === 'w' || (weights.waterShallow || 0) > 0.2 || weights.primary === 'SHALLOW_WATERS') {
      return 'PALM';
    }

    // Canyon terrain: arid pinyon pines on flat mesa tops
    if (char === 'C' || char === 'c' || (weights.canyon || 0) > 0.2 || (weights.canyonLow || 0) > 0.2 || weights.primaryBiome?.category === 'CANYON') {
      return 'PINE';
    }

    // "m" rugged mountain (low): pine trees
    if (char === 'm' || ((weights.mountainLow || 0) > 0.3 && (weights.mountainLow || 0) >= (weights.mountain || 0))) {
      return 'PINE';
    }

    // "M" rugged mountain (high): snow covered pine trees
    if (char === 'M' || (weights.mountain || 0) > 0.3) {
      return 'SNOW_PINE';
    }

    // "h" and "H" hills: same trees that they have now
    return 'HILLS';
  }

  /**
   * Positions a single tree ensuring biome-specific tree types and dry ground placement:
   * - "w" shallow waters: sparse palm trees on coastal beach sand
   * - "h" and "H" hills: classic deciduous oak trees
   * - "m" mountain (low): coniferous evergreen pine trees
   * - "M" mountain (high): snow-covered pine trees
   * - "s" sky / clouds: trees strictly removed from high elevations (> 24m)
   */
  private positionSingleTree(tree: THREE.Object3D, z: number) {
    const activeBranches = flightPath.getActiveBranchesAt(z);
    let bestBranch = activeBranches[0];
    let bestDist = Infinity;
    const refX = this.lastBirdX !== undefined ? this.lastBirdX : this.activeBranchOffset;
    for (const b of activeBranches) {
      const d = Math.abs(b.point.x - refX);
      if (d < bestDist) {
        bestDist = d;
        bestBranch = b;
      }
    }
    const pathPt = bestBranch ? bestBranch.point : flightPath.getPoint(z);

    const weights = flightPath.getBiomeWeights(pathPt.x, z);
    const isRiverOrCanyon = weights.primaryBiome ? weights.primaryBiome.hasRiver() : false;
    const pathIsClouds =
      (weights.clouds || 0) > 0.001 ||
      weights.primary === 'HIGH_CLOUDS' ||
      weights.primaryBiome?.char === 's';

    const isDeepWater =
      (weights.waterDeep || 0) > 0.001 ||
      weights.primary === 'DEEP_WATERS' ||
      weights.primaryBiome?.char === 'W';

    if (isDeepWater) {
      tree.position.set(pathPt.x + 18.0, WATER_LEVEL - 50, z);
      tree.visible = false;
      return;
    }

    const isShallowWater =
      (weights.waterShallow || 0) > 0.001 ||
      weights.primary === 'SHALLOW_WATERS' ||
      weights.primaryBiome?.char === 'w';

    const minOffset = isRiverOrCanyon ? 24.0 : 14.0;

    let bestX = pathPt.x + 18.0;
    let bestY = -999;
    let foundDryLand = false;
    let chosenVariant: 'HILLS' | 'PALM' | 'PINE' | 'SNOW_PINE' = 'HILLS';

    // Probe lateral candidate offsets to find dry ground above water level
    for (let attempt = 0; attempt < 14; attempt++) {
      const side = attempt % 2 === 0 ? 1 : -1;
      const spread = minOffset + Math.random() * (isShallowWater ? 44.0 : 34.0);
      const candX = pathPt.x + side * spread;
      const candWeights = flightPath.getBiomeWeights(candX, z);
      const candY = flightPath.getTerrainHeight(candX, z, candWeights);

      // (1) Don't put trees on steep canyon slopes
      const isCanyon =
        (candWeights.canyon || 0) + (candWeights.canyonLow || 0) > 0.05 ||
        candWeights.primaryBiome?.category === 'CANYON';

      if (isCanyon) {
        // Measure terrain gradient (slope) at candidate location
        const step = 0.6;
        const yX1 = flightPath.getTerrainHeight(candX + step, z, candWeights);
        const yX0 = flightPath.getTerrainHeight(candX - step, z, candWeights);
        const yZ1 = flightPath.getTerrainHeight(candX, z + step, candWeights);
        const yZ0 = flightPath.getTerrainHeight(candX, z - step, candWeights);
        const slopeX = (yX1 - yX0) / (2 * step);
        const slopeZ = (yZ1 - yZ0) / (2 * step);
        const slope = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

        // Canyon slopes and cliff walls have high gradients (slope > 0.28).
        // Mesa tops and valley floors are flat (slope <= 0.28).
        if (slope > 0.28) {
          continue; // Strictly reject placing trees on steep canyon slopes/cliffs
        }
      }

      // In "s" sky terrain (either along corridor or at candidate location):
      // Strictly remove all trees from high elevations (> 24.0m near mountain peaks)
      const candIsClouds =
        pathIsClouds ||
        (candWeights.clouds || 0) > 0.001 ||
        candWeights.primary === 'HIGH_CLOUDS' ||
        candWeights.primaryBiome?.char === 's';

      if (candIsClouds && candY > 24.0) {
        continue;
      }

      const variant = this.determineTreeVariant(candWeights, candX, z, candY);
      if (variant === 'NONE') {
        continue;
      }

      // Sparse check for palm trees in "w" shallow waters:
      // Only ~35% of candidate positions on beach sand spawn a palm tree
      if (variant === 'PALM') {
        const palmSparseHash = Math.abs(Math.sin(candX * 12.9898 + z * 78.233) * 43758.5453);
        const isSparsePalm = (palmSparseHash - Math.floor(palmSparseHash)) < 0.35;
        if (!isSparsePalm) {
          continue; // Leave sandy shorelines open and delightfully sparse
        }
      }

      const minDryHeight = variant === 'PALM' ? (WATER_LEVEL + 0.35) : (WATER_LEVEL + 0.6);

      // Must be safely above sea level (WATER_LEVEL) - never submerged in water!
      if (candY > minDryHeight) {
        bestX = candX;
        bestY = candY;
        chosenVariant = variant;
        foundDryLand = true;
        break;
      } else if (candY > bestY) {
        bestX = candX;
        bestY = candY;
        chosenVariant = variant;
      }
    }

    if (foundDryLand) {
      this.setTreeVariant(tree as THREE.Group, chosenVariant);
      tree.position.set(bestX, bestY, z);
      tree.visible = true;
    } else {
      // Entire basin/area is submerged beneath sea level or in treeless high elevation zone
      tree.position.set(bestX, WATER_LEVEL - 50, z);
      tree.visible = false;
    }
  }

  private createTrees() {
    // 65 stylized biome-specific trees distributed across active conveyor span (-60 to +240m)
    for (let i = 0; i < 65; i++) {
      const tree = this.createTreeObject();
      const z = -60 + (i / 65) * 300;
      this.positionSingleTree(tree, z);
      const s = 0.75 + Math.random() * 0.5;
      tree.scale.set(s, s, s);
      this.treesGroup.add(tree);
    }
  }

  public repositionTreesAndClouds(startZ: number = 0, startX: number = 0) {
    const treeCount = this.treesGroup.children.length;
    this.treesGroup.children.forEach((tree, idx) => {
      const z = startZ - 60 + (idx / treeCount) * 300;
      this.positionSingleTree(tree, z);
    });

    this.cloudSystem.reposition(startZ, startX);
  }

  private lastBirdZ: number = 0;

  private mod(n: number, m: number): number {
    return ((n % m) + m) % m;
  }

  public resetChunks(startZ: number, startX: number = 0, cameraX?: number, cameraZ?: number) {
    const camX = cameraX ?? this.camera?.position.x ?? startX;
    const camZ = cameraZ ?? this.camera?.position.z ?? startZ;

    const centerGridX = Math.round(camX / this.chunkWidth);
    const minGridX = centerGridX - 2;
    const centerGridZ = Math.round(camZ / this.chunkLength);
    const minGridZ = centerGridZ - 2;

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
        chunk.waterMesh.position.set(chunk.centerX, 0, chunk.centerZ);
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
    let minH = Infinity;

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
        if (h < minH) minH = h;

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

    // 1. Update world-space continuous UV coordinates for the water surface
    const waterUvArray = chunk.waterUvAttr.array as Float32Array;
    const beachWeights = chunk.waterBeachWeightAttr.array as Float32Array;
    const depths = chunk.waterDepthAttr.array as Float32Array;
    beachWeights.fill(0);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vIdx = r * cols + c;
        const wx = ((c / (cols - 1)) - 0.5) * this.chunkWidth + meshX;
        const wz = ((r / (rows - 1)) - 0.5) * this.chunkLength + meshZ;
        waterUvArray[vIdx * 2] = wx * 0.1;
        waterUvArray[vIdx * 2 + 1] = wz * 0.1;

        const h = posArray[vIdx * 3 + 1];
        depths[vIdx] = Math.max(0, WATER_LEVEL - h);
      }
    }
    chunk.waterUvAttr.needsUpdate = true;

    // 2. Reconstruct water index buffer:
    // Check if the chunk has water biomes or submerged terrain
    const centerWeights = flightPath.getBiomeWeights(chunk.centerX, chunk.centerZ);
    const hasWaterBiome =
      (centerWeights.waterDeep || 0) > 0.001 ||
      (centerWeights.waterShallow || 0) > 0.001 ||
      centerWeights.primary === 'SHALLOW_WATERS' ||
      centerWeights.primary === 'DEEP_WATERS';
    const isPureCanyon = centerWeights.primaryBiome?.hasRiver() && !hasWaterBiome;
    const chunkHasWater = hasWaterBiome || ((minH <= WATER_LEVEL + 0.1) && !isPureCanyon);

    const waterIndices = chunk.waterIndices;
    let waterIndexCount = 0;
    const COPLANAR_TOLERANCE = 0.05;

    if (chunkHasWater) {
      for (let r = 0; r < rows - 1; r++) {
        const rowA = r * cols;
        const rowB = (r + 1) * cols;
        for (let c = 0; c < cols - 1; c++) {
          const iA = rowA + c;
          const iB = rowB + c;
          const iC = rowB + (c + 1);
          const iD = rowA + (c + 1);

          const hA = posArray[iA * 3 + 1];
          const hB = posArray[iB * 3 + 1];
          const hC = posArray[iC * 3 + 1];
          const hD = posArray[iD * 3 + 1];

          // Triangle 1: (iA, iB, iD)
          // If co-planar with water surface, render only the terrain polys.
          // If emerging at/above sea level or submerged, continue to generate water face.
          const isCoplanar1 =
            Math.abs(hA - WATER_LEVEL) < COPLANAR_TOLERANCE &&
            Math.abs(hB - WATER_LEVEL) < COPLANAR_TOLERANCE &&
            Math.abs(hD - WATER_LEVEL) < COPLANAR_TOLERANCE;

          if (!isCoplanar1) {
            waterIndices[waterIndexCount++] = iA;
            waterIndices[waterIndexCount++] = iB;
            waterIndices[waterIndexCount++] = iD;

            // Beach wave emergence: terrain face emerges from below to at/above sea level
            const minH1 = Math.min(hA, hB, hD);
            const maxH1 = Math.max(hA, hB, hD);
            if (minH1 < WATER_LEVEL && maxH1 >= WATER_LEVEL - 0.04) {
              beachWeights[iA] = 1.0;
              beachWeights[iB] = 1.0;
              beachWeights[iD] = 1.0;
            }
          }

          // Triangle 2: (iB, iC, iD)
          // If co-planar with water surface, render only the terrain polys.
          // If emerging at/above sea level or submerged, continue to generate water face.
          const isCoplanar2 =
            Math.abs(hB - WATER_LEVEL) < COPLANAR_TOLERANCE &&
            Math.abs(hC - WATER_LEVEL) < COPLANAR_TOLERANCE &&
            Math.abs(hD - WATER_LEVEL) < COPLANAR_TOLERANCE;

          if (!isCoplanar2) {
            waterIndices[waterIndexCount++] = iB;
            waterIndices[waterIndexCount++] = iC;
            waterIndices[waterIndexCount++] = iD;

            // Beach wave emergence: terrain face emerges from below to at/above sea level
            const minH2 = Math.min(hB, hC, hD);
            const maxH2 = Math.max(hB, hC, hD);
            if (minH2 < WATER_LEVEL && maxH2 >= WATER_LEVEL - 0.04) {
              beachWeights[iB] = 1.0;
              beachWeights[iC] = 1.0;
              beachWeights[iD] = 1.0;
            }
          }
        }
      }
    }

    chunk.waterBeachWeightAttr.needsUpdate = true;
    chunk.waterDepthAttr.needsUpdate = true;
    chunk.waterGeometry.setDrawRange(0, waterIndexCount);
    chunk.waterIndexAttr.needsUpdate = true;
    chunk.waterGeometry.computeBoundingBox();
    chunk.waterGeometry.computeBoundingSphere();
    chunk.waterMesh.visible = waterIndexCount > 0;
  }

  public updateTerrain(
    birdZ: number,
    force: boolean = false,
    delta: number = 0.016,
    birdX?: number,
    birdY?: number,
    cameraX?: number,
    cameraZ?: number
  ) {
    this.lastBirdZ = birdZ;
    const targetBirdX = (birdX !== undefined) ? birdX : (flightPath.getPoint(birdZ)?.x ?? 0);
    this.lastBirdX = targetBirdX;

    // Follow the (x, z) position of the camera for loaded terrain tile elements
    const camX = cameraX ?? this.camera?.position.x ?? targetBirdX;
    const camZ = cameraZ ?? this.camera?.position.z ?? birdZ;

    let camDirZ = 1.0;
    if (this.camera) {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      if (dir.lengthSq() > 0.01) {
        camDirZ = dir.z;
      }
    }

    // Advance water shader time uniform for beach waves & rhythmic shoreline surf
    this.waterTime += delta;
    if (this.waterMaterial.userData.shader?.uniforms?.uTime) {
      this.waterMaterial.userData.shader.uniforms.uTime.value = this.waterTime;
    }

    // Spin signature rings across all active obstacle columns
    for (const obs of this.obstacles) {
      if (obs.ringMesh) {
        obs.ringMesh.rotation.y += delta * 2.8;
      }
    }

    // Continuous downstream water flow & whitewater rapids churning in the canyon river
    this.canyonRiver.update(delta);

    // Continuous ocean swell drift across water surfaces
    if (this.waterTexture) {
      this.waterTexture.offset.x += delta * 0.015;
      this.waterTexture.offset.y += delta * 0.025;
    }

    // =======================================================
    // DYNAMIC ATMOSPHERE, SKY & FOG ACCORDING TO ACTIVE BIOME
    // (Lightweight scalar interpolation - smooth every frame)
    // =======================================================
    const birdBiome = flightPath.getBiomeWeights(camX, camZ);
    this.cloudSystem.update(delta, camZ, birdBiome, camX, flightPath, birdY);
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
      const fog = this.scene.fog as THREE.Fog;
      fog.color.copy(targetFog);
      const cloudsW = birdBiome.clouds || 0;
      const currentY = birdY !== undefined ? birdY : flightPath.getPathPoint(camZ).y;
      const altitudeFactor = THREE.MathUtils.clamp((currentY - 38.0) / (48.0 - 38.0), 0.0, 1.0);
      const effectiveCloudsW = cloudsW * (altitudeFactor * altitudeFactor * (3.0 - 2.0 * altitudeFactor));

      // Dynamic distance fog tailored per terrain:
      // Base (Hills/Canyons/Mountains/Water): near = 28m, far = 145m
      // In clouds ("s"): near = ~22m, far = ~115m once altitude reaches the mountain peaks (~38m to 48m)
      const targetNear = Math.max(18, 28 - effectiveCloudsW * 6);
      const targetFar = Math.max(95, 145 - effectiveCloudsW * 30);

      fog.near = targetNear;
      fog.far = targetFar;
    }
    this.hemiLight.groundColor.copy(targetGround);

    // Keep directional light and shadows centered over the camera's loaded terrain region
    this.dirLight.position.set(camX + 40, 80, camZ - 20);
    this.dirLight.target.position.set(camX, 0, camZ + 25);
    this.dirLight.target.updateMatrixWorld();

    // Desired 2D ring buffer bounds: follow x, z position of the camera, not the bird
    const centerGridX = Math.round(camX / this.chunkWidth);
    const minGridX = centerGridX - 2;
    const maxGridX = minGridX + 4;

    const centerGridZ = Math.round(camZ / this.chunkLength);
    const minGridZ = centerGridZ - 2;
    const maxGridZ = minGridZ + 4;

    // Trees are recycled to stay within active terrain bounds around camera
    const minTerrainZ = minGridZ * this.chunkLength;
    const maxTerrainZ = (maxGridZ + 1) * this.chunkLength;
    this.treesGroup.children.forEach((tree) => {
      if (tree.position.z < minTerrainZ - 15 || tree.position.z > maxTerrainZ + 15) {
        const newZ = minTerrainZ + Math.random() * (maxTerrainZ - minTerrainZ);
        this.positionSingleTree(tree, newZ);
      } else if (tree.visible) {
        const w = flightPath.getBiomeWeights(tree.position.x, tree.position.z);
        const isClouds =
          (w.clouds || 0) > 0.001 ||
          w.primary === 'HIGH_CLOUDS' ||
          w.primaryBiome?.char === 's';
        if (isClouds && tree.position.y > 24.0) {
          tree.visible = false;
        } else if (w.primaryBiome && !w.primaryBiome.hasTrees()) {
          tree.visible = false;
        }
      }
    });

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
          chunk.waterMesh.position.set(chunk.centerX, 0, chunk.centerZ);
          this.populateChunk(chunk);
        }
      }
      for (let iz = 0; iz < this.numChunksZ; iz++) {
        const gz = minGridZ + iz;
        const riverCenterZ = gz * this.chunkLength;
        const riverSlot = this.mod(gz, 5);
        this.canyonRiver.populateRiverChunk(riverSlot, riverCenterZ, this.chunkLength);
      }
      // Update all tree heights so they rest accurately on updated or restored terrain and set biome variants
      this.treesGroup.children.forEach((tree) => {
        const y = flightPath.getTerrainHeight(tree.position.x, tree.position.z);
        tree.position.y = y;
        const w = flightPath.getBiomeWeights(tree.position.x, tree.position.z);
        const variant = this.determineTreeVariant(w, tree.position.x, tree.position.z, y);
        const isClouds =
          (w.clouds || 0) > 0.001 ||
          w.primary === 'HIGH_CLOUDS' ||
          w.primaryBiome?.char === 's';
        if (variant === 'NONE' || (isClouds && y > 24.0)) {
          tree.visible = false;
        } else {
          const minDryHeight = variant === 'PALM' ? (WATER_LEVEL + 0.35) : (WATER_LEVEL + 0.6);
          tree.visible = y > minDryHeight;
          if (tree.visible) {
            this.setTreeVariant(tree as THREE.Group, variant);
          }
        }
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
          chunk.waterMesh.position.set(chunk.centerX, 0, chunk.centerZ);
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

    // Dynamic gap center relative to path: biomes define dramatic vertical opening sweeps
    const gapCenterY = flightPath.getColumnGapCenterY(distance, undefined, gatePoint.x);
    const gapHeight = flightPath.columnGapHeight; // Generous clearance opening for 3D navigation

    // Check flight path pitch angle at this column distance
    const frame = flightPath.getFrame(distance, branch);
    const pitchRad = Math.asin(THREE.MathUtils.clamp(frame.tangent.y, -1.0, 1.0));
    const pitchDeg = Math.abs(pitchRad) * (180.0 / Math.PI);
    // If the flight path pitch is greater than 30 degrees, omit placing the column as an obstacle
    const hasColumn = pitchDeg <= 20.0;

    // Create obstacle group aligned with the path tangent
    const gateGroup = new THREE.Group();

    let bottomMesh: THREE.Mesh | undefined;
    let baseMesh: THREE.Mesh | undefined;
    let topMesh: THREE.Mesh | undefined;

    if (hasColumn) {
      // Select biome-specific architectural voxel assets from registered biomes
      const primaryBiome = weights.primaryBiome || biomeRegistry.getByChar('H') || biomeRegistry.getAll()[0];
      const defaultGeo = this.bottomPillarGeos.values().next().value!;
      const defaultTopGeo = this.topPillarGeos.values().next().value!;
      const defaultBaseGeo = this.baseGeos.values().next().value!;

      const bottomPillarGeo = this.bottomPillarGeos.get(primaryBiome) || defaultGeo;
      const topPillarGeo = this.topPillarGeos.get(primaryBiome) || defaultTopGeo;
      const baseGeo = this.baseGeos.get(primaryBiome) || defaultBaseGeo;

      // 1. Bottom Voxel Pillar: complete 24m column composed of standard 1x1x1 blocks
      bottomMesh = new THREE.Mesh(bottomPillarGeo, this.voxelPillarMat);
      bottomMesh.position.y = gapCenterY - gapHeight / 2;
      bottomMesh.castShadow = true;
      bottomMesh.receiveShadow = true;
      gateGroup.add(bottomMesh);

      // 2. Voxel Block Foundation surrounding the pillar base
      baseMesh = new THREE.Mesh(baseGeo, this.voxelBaseMat);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      gateGroup.add(baseMesh);

      // 3. Top Voxel Pillar: complete 24m column composed of standard 1x1x1 blocks
      topMesh = new THREE.Mesh(topPillarGeo, this.voxelPillarMat);
      topMesh.position.y = gapCenterY + gapHeight / 2;
      topMesh.castShadow = true;
      topMesh.receiveShadow = true;
      gateGroup.add(topMesh);
    }

    // 4. Floating Smooth Golden Doughnut Ring in center of gap (always placed at the same location)
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
      hasColumn,
      topPipeMesh: topMesh,
      bottomPipeMesh: bottomMesh,
      ringMesh: ring,
      gateGroup,
      baseMesh,
    };

    this.applyGateTransform(obstacle, distance, branch);

    if (hasColumn) {
      // Attach any prior crash feathers recorded on this pillar
      this.featherManager.attachFeathersToObstacle(obstacle);
    }

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
    birdBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE',
    birdY?: number,
    cameraX?: number,
    cameraZ?: number
  ): WindGustTriggerResult | null {
    // Generate new obstacles ahead based on exact 10-column per level distances
    while (flightPath.getColumnDistance(this.currentColumnIndex + 1) < birdDistance + 165.0) {
      const nextCol = this.currentColumnIndex + 1;
      const nextDist = flightPath.getColumnDistance(nextCol);
      this.spawnObstaclesAtDistance(nextDist);
    }

    // Update all Wind Gust Pairs and check for triggers
    let triggeredGust: WindGustTriggerResult | null = null;
    for (const gust of this.windGusts) {
      const res = gust.update(delta, birdDistance, birdRelativeY, birdBranch);
      if (res.triggered) {
        triggeredGust = res;
      }
    }

    // Prune old wind gusts far behind the camera
    const effectiveCamZ = cameraZ ?? this.camera?.position.z ?? birdDistance;
    for (let i = this.windGusts.length - 1; i >= 0; i--) {
      const gust = this.windGusts[i];
      if (gust.pathDistance < effectiveCamZ - 80) {
        gust.dispose(this.scene);
        this.windGusts.splice(i, 1);
      }
    }

    // Prune old obstacles far behind the camera
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const zPos = obs.gateGroup ? obs.gateGroup.position.z : obs.pathDistance;
      if (zPos < effectiveCamZ - 60) {
        if (obs.gateGroup) {
          this.obstacleMeshesGroup.remove(obs.gateGroup);
        }
        this.obstacles.splice(i, 1);
      }
    }

    if (this.totemManager) {
      this.totemManager.pruneTotems(effectiveCamZ);
    }

    // Update terrain mesh elevation and vertex colors following camera
    this.updateTerrain(birdDistance, false, delta, birdX, birdY, cameraX, cameraZ);

    // Stream and render prior crash feathers in the terrain
    this.featherManager.updateTerrainFeathers(effectiveCamZ);

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
