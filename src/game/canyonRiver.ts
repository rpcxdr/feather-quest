import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { flightPath } from './pathGenerator';
import { biomeRegistry, Biome } from '../biomes';
import { WATER_LEVEL } from '../biomes/WaterBiome';

interface RiverChunkData {
  group: THREE.Group;
  waterMesh: THREE.Mesh;
  bouldersGroup: THREE.Group;
  foamCollars: THREE.Mesh[];
  centerZ: number;
}

export class CanyonRiverManager {
  public group: THREE.Group;
  private riverTexture: THREE.CanvasTexture;
  private riverMaterial: THREE.MeshStandardMaterial;
  private boulderGeos: THREE.BufferGeometry[] = [];
  private boulderMaterials: THREE.MeshStandardMaterial[] = [];
  private foamGeo: THREE.RingGeometry;
  private foamMaterial: THREE.MeshBasicMaterial;

  private riverChunks: RiverChunkData[] = [];
  private readonly numChunks: number = 5;
  private animTime: number = 0;
  private arcLengthCache: Map<string, { z: number; s: number }[]> = new Map();

  /**
   * Evaluates continuous cumulative distance (arc length) along the curving river centerline.
   * This ensures UV texture coordinates follow the exact curving trajectory of the river and flight path.
   */
  public getRiverArcLength(z: number, branch: 'SINGLE' | 'LEFT' | 'RIGHT'): number {
    if (z <= 0) return z;
    let list = this.arcLengthCache.get(branch);
    if (!list) {
      list = [{ z: 0, s: 0 }];
      this.arcLengthCache.set(branch, list);
    }

    const step = 1.0;
    let last = list[list.length - 1];

    while (last.z < z) {
      const nextZ = Math.min(z, last.z + step);
      const pA = flightPath.getPoint(last.z, branch);
      const pB = flightPath.getPoint(nextZ, branch);
      const ds = Math.hypot(pB.x - pA.x, nextZ - last.z);
      last = { z: nextZ, s: last.s + ds };
      list.push(last);
    }

    // Binary search to find segment for z
    let low = 0;
    let high = list.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (list[mid].z <= z) low = mid + 1;
      else high = mid - 1;
    }
    const idx = Math.max(0, high);
    const a = list[idx];
    if (!a) return z;
    if (Math.abs(a.z - z) < 0.001) return a.s;
    const b = list[idx + 1];
    if (!b) return a.s;
    const frac = (z - a.z) / (b.z - a.z);
    return a.s + frac * (b.s - a.s);
  }

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // 1. Procedural Flowing River Texture with Whitewater Rapids Chutes
    this.riverTexture = this.createRiverTexture();

    // 2. Translucent Glistening River Surface Material
    this.riverMaterial = new THREE.MeshStandardMaterial({
      map: this.riverTexture,
      roughness: 0.14,
      metalness: 0.22,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    // 3. 3D River Rapids Boulders: Natural river rock shapes (deformed angular polyhedra with flat facets)
    this.boulderGeos = this.createBoulderGeometries();

    // Palette of natural wet riverbed rocks: mineral basalt, weathered slate grey, and warm canyon river granite
    this.boulderMaterials = [
      new THREE.MeshStandardMaterial({
        color: 0x475569, // Wet slate grey
        roughness: 0.82,
        metalness: 0.08,
        flatShading: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x57534e, // Weathered river stone / warm sedimentary grey
        roughness: 0.78,
        metalness: 0.05,
        flatShading: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x334155, // Dark river granite / basalt
        roughness: 0.85,
        metalness: 0.10,
        flatShading: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x78716c, // Sun-bleached canyon sandstone boulder
        roughness: 0.90,
        metalness: 0.04,
        flatShading: true,
      }),
    ];

    this.foamGeo = new THREE.RingGeometry(0.65, 1.55, 12);
    this.foamGeo.rotateX(-Math.PI / 2);
    this.foamMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Initialize river chunks matching terrain chunks
    for (let i = 0; i < this.numChunks; i++) {
      const chunkGroup = new THREE.Group();
      this.group.add(chunkGroup);

      // Pre-allocate dynamic river water buffer geometry
      const maxVertices = 900;
      const maxIndices = 2700;
      const geo = new THREE.BufferGeometry();
      const posArray = new Float32Array(maxVertices * 3);
      const uvArray = new Float32Array(maxVertices * 2);
      const indexArray = new Uint16Array(maxIndices);

      geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
      geo.setIndex(new THREE.BufferAttribute(indexArray, 1));

      const waterMesh = new THREE.Mesh(geo, this.riverMaterial);
      waterMesh.receiveShadow = true;
      chunkGroup.add(waterMesh);

      const bouldersGroup = new THREE.Group();
      chunkGroup.add(bouldersGroup);

      this.riverChunks.push({
        group: chunkGroup,
        waterMesh,
        bouldersGroup,
        foamCollars: [],
        centerZ: 0,
      });
    }
  }

  // Generates multiple distinct sculpted rock shapes with strictly manifold, closed 2-manifold surfaces
  private createBoulderGeometries(): THREE.BufferGeometry[] {
    const geos: THREE.BufferGeometry[] = [];

    // Helper pseudo-random function for deterministic point distribution
    const pseudoRandom = (seed: number) => {
      const x = Math.sin(seed) * 43758.5453;
      return x - Math.floor(x);
    };

    // Preset 1: Angular river crag (blocky eroded polyhedron with flat bottom)
    {
      const points: THREE.Vector3[] = [];
      const count = 26;
      for (let i = 0; i < count; i++) {
        const u = pseudoRandom(i * 12.9898 + 43.123);
        const v = pseudoRandom(i * 78.233 + 19.456);
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);

        let rx = Math.sin(phi) * Math.cos(theta);
        let ry = Math.cos(phi);
        let rz = Math.sin(phi) * Math.sin(theta);

        const r = 0.75 + pseudoRandom(i * 5.71 + 1.2) * 0.35;
        rx *= r * 1.15;
        // Compress lower hemisphere to form a stable resting base on the riverbed
        ry = ry < 0 ? ry * r * 0.55 : ry * r * 0.85;
        rz *= r * 0.95;

        points.push(new THREE.Vector3(rx, ry, rz));
      }
      const geo = new ConvexGeometry(points);
      geo.computeVertexNormals();
      geos.push(geo);
    }

    // Preset 2: Weathered river stone slab (wide, low, angled cleavage planes)
    {
      const points: THREE.Vector3[] = [];
      const count = 26;
      for (let i = 0; i < count; i++) {
        const u = pseudoRandom(i * 17.31 + 84.1);
        const v = pseudoRandom(i * 91.73 + 37.9);
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);

        let rx = Math.sin(phi) * Math.cos(theta);
        let ry = Math.cos(phi);
        let rz = Math.sin(phi) * Math.sin(theta);

        const r = 0.8 + pseudoRandom(i * 8.33 + 2.7) * 0.3;
        // Elongate along X and Z while flattening Y into a river stepping stone
        rx *= r * 1.35;
        ry *= r * 0.48;
        rz *= r * 1.18;

        points.push(new THREE.Vector3(rx, ry, rz));
      }
      const geo = new ConvexGeometry(points);
      geo.computeVertexNormals();
      geos.push(geo);
    }

    // Preset 3: Pointed water-cut keel boulder (streamlined wedge facing the rapids)
    {
      const points: THREE.Vector3[] = [];
      const count = 26;
      for (let i = 0; i < count; i++) {
        const u = pseudoRandom(i * 23.45 + 11.6);
        const v = pseudoRandom(i * 64.82 + 52.3);
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);

        let rx = Math.sin(phi) * Math.cos(theta);
        let ry = Math.cos(phi);
        let rz = Math.sin(phi) * Math.sin(theta);

        const r = 0.72 + pseudoRandom(i * 3.19 + 4.8) * 0.38;
        rx *= r * 0.92;
        ry *= r * 0.75;
        // Asymmetric wedge pointing upstream
        rz = (rz + 0.28) * r * 1.22;

        points.push(new THREE.Vector3(rx, ry, rz));
      }
      const geo = new ConvexGeometry(points);
      geo.computeVertexNormals();
      geos.push(geo);
    }

    return geos;
  }

  // Generates a high-resolution canvas texture featuring deep turquoise currents and frothing whitewater rapids
  private createRiverTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    // A. Deep Alpine/Canyon Riverbed Gradient
    const baseGrad = ctx.createLinearGradient(0, 0, 512, 0);
    baseGrad.addColorStop(0.0, '#0e7490'); // cyan 700 (shoreline shallows)
    baseGrad.addColorStop(0.2, '#0284c7'); // sky 600
    baseGrad.addColorStop(0.5, '#0369a1'); // deep central gorge channel
    baseGrad.addColorStop(0.8, '#0284c7');
    baseGrad.addColorStop(1.0, '#0e7490');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, 512, 1024);

    // B. Longitudinal Water Current Flow Lines
    ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 1024;
      const w = 2 + Math.random() * 4;
      const h = 40 + Math.random() * 110;
      ctx.fillRect(x, y, w, h);
    }

    // C. Whitewater Rapids Chutes (Periodic turbulent boiling rapids)
    const rapidZones = [
      { startY: 100, endY: 420 },
      { startY: 600, endY: 920 },
    ];

    for (const zone of rapidZones) {
      const zh = zone.endY - zone.startY;

      // Soft frothing whitewater background wash
      const frothGrad = ctx.createLinearGradient(0, zone.startY, 0, zone.endY);
      frothGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
      frothGrad.addColorStop(0.12, 'rgba(224, 242, 254, 0.55)');
      frothGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.94)');
      frothGrad.addColorStop(0.80, 'rgba(224, 242, 254, 0.70)');
      frothGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

      ctx.fillStyle = frothGrad;
      ctx.beginPath();
      ctx.moveTo(80, zone.startY);
      ctx.lineTo(432, zone.startY);
      ctx.lineTo(465, zone.startY + zh * 0.45);
      ctx.lineTo(432, zone.endY);
      ctx.lineTo(80, zone.endY);
      ctx.lineTo(47, zone.startY + zh * 0.45);
      ctx.closePath();
      ctx.fill();

      // Turbulent standing wave V-wakes (chevron rapid waves & rooster-tail crests)
      ctx.lineWidth = 4.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.lineCap = 'round';

      for (let y = zone.startY + 22; y < zone.endY - 22; y += 18) {
        const spread = 75 + Math.sin(y * 0.05) * 45;
        ctx.beginPath();
        ctx.moveTo(256 - spread, y - 10);
        ctx.quadraticCurveTo(256, y + 10, 256 + spread, y - 10);
        ctx.stroke();

        // Secondary cross-current froth ripple
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = 'rgba(240, 249, 255, 0.85)';
        ctx.beginPath();
        ctx.moveTo(256 - spread * 0.55, y - 14);
        ctx.lineTo(256 + spread * 0.55, y - 14);
        ctx.stroke();
      }

      // Dense bubbling froth eddies & rapid splash speckles
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      for (let j = 0; j < 380; j++) {
        const rx = 80 + Math.random() * 352;
        const ry = zone.startY + 15 + Math.random() * (zh - 30);
        const rad = 1.4 + Math.random() * 3.4;
        ctx.beginPath();
        ctx.arc(rx, ry, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 2.8);
    return texture;
  }

  /**
   * Evaluates if world point (x, z) is in canyon terrain.
   * River ribbons and whitewater rapids boulders are strictly confined to canyon terrain.
   */
  private isCanyonTerrainAt(x: number, z: number): boolean {
    const weights = flightPath.getBiomeWeights(x, z);
    const totalCanyon = (weights.canyon || 0) + (weights.canyonLow || 0);
    const isCanyonBiome =
      weights.primary === 'DEEP_CANYON_SLOTS' ||
      weights.primaryBiome?.category === 'CANYON' ||
      (weights.primaryBiome ? weights.primaryBiome.hasRiver() : false);
    return isCanyonBiome || totalCanyon >= 0.25;
  }

  // Populate/refresh a river chunk matching the terrain chunk's world span
  public populateRiverChunk(chunkIndex: number, centerZ: number, chunkLength: number) {
    const chunk = this.riverChunks[chunkIndex];
    if (!chunk) return;

    chunk.centerZ = centerZ;
    const startZ = centerZ - chunkLength / 2;
    const endZ = centerZ + chunkLength / 2;

    // Clear existing rapids boulders & foam rings
    while (chunk.bouldersGroup.children.length > 0) {
      chunk.bouldersGroup.remove(chunk.bouldersGroup.children[0]);
    }
    chunk.foamCollars = [];

    // Collect all active branches across this chunk without in-place pointer mutation
    const rawBranchNames: ('SINGLE' | 'LEFT' | 'RIGHT')[] = [];
    const seen = new Set<string>();
    const checkBranch = (b: { branch: 'SINGLE' | 'LEFT' | 'RIGHT' }) => {
      if (!seen.has(b.branch)) {
        seen.add(b.branch);
        rawBranchNames.push(b.branch);
      }
    };
    for (const b of flightPath.getActiveBranchesAt(startZ)) checkBranch(b);
    for (const b of flightPath.getActiveBranchesAt(centerZ)) checkBranch(b);
    for (const b of flightPath.getActiveBranchesAt(endZ)) checkBranch(b);
    if (rawBranchNames.length === 0) rawBranchNames.push('SINGLE');

    // If chunk contains decision fork branches ('LEFT' / 'RIGHT'),
    // both branches smoothly trace the trunk path before the decision point and fork outward at the junction.
    // Filtering out 'SINGLE' eliminates duplicate overlapping ribbons and eliminates gaps at the boundary.
    const hasForkBranches = rawBranchNames.includes('LEFT') || rawBranchNames.includes('RIGHT');
    const branchNames = hasForkBranches
      ? rawBranchNames.filter((b) => b !== 'SINGLE')
      : rawBranchNames;

    // Construct river ribbons along active branch paths
    const numZSteps = 24; // Samples along the 60m chunk (~2.5m per step)
    const numWSteps = 5;  // 6 vertices across the river width
    // 2.95m half-width (~5.9m wide) embeds seamlessly into the sharp V canyon bottom notch (canyon river notch 2.8m)
    const riverHalfWidth = 2.95;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (let bIdx = 0; bIdx < branchNames.length; bIdx++) {
      const branchName = branchNames[bIdx];
      const stepInCanyon: boolean[] = [];
      const stepBranchPt: { x: number; y: number }[] = [];
      const stepZ: number[] = [];
      const stepTan: { x: number; z: number }[] = [];
      const stepNorm: { x: number; z: number }[] = [];

      for (let zi = 0; zi <= numZSteps; zi++) {
        const t = zi / numZSteps;
        const currentZ = startZ + t * chunkLength;
        // getPoint(currentZ, branchName) evaluates continuous, smooth flight path coordinates across decision points
        const pt = flightPath.getPoint(currentZ, branchName);
        const inCanyon = this.isCanyonTerrainAt(pt.x, currentZ);

        // Derivative along the flight path / river in X-Z horizontal plane
        const deriv = flightPath.getDerivative(currentZ, branchName);
        const hLen = Math.hypot(deriv.x, 1.0);
        const tanX = deriv.x / hLen;
        const tanZ = 1.0 / hLen;
        // Perpendicular horizontal normal (pointing to the right of travel in X-Z)
        const normX = tanZ;
        const normZ = -tanX;

        stepInCanyon.push(inCanyon);
        stepBranchPt.push({ x: pt.x, y: pt.y });
        stepZ.push(currentZ);
        stepTan.push({ x: tanX, z: tanZ });
        stepNorm.push({ x: normX, z: normZ });
      }

      const stepVertexStart: number[] = [];

      for (let zi = 0; zi <= numZSteps; zi++) {
        const isStepUsed =
          (zi > 0 && stepInCanyon[zi - 1] && stepInCanyon[zi]) ||
          (zi < numZSteps && stepInCanyon[zi] && stepInCanyon[zi + 1]);

        if (!isStepUsed) {
          stepVertexStart.push(-1);
          continue;
        }

        stepVertexStart.push(vertexOffset);
        const branchPt = stepBranchPt[zi];
        const currentZ = stepZ[zi];
        const norm = stepNorm[zi];
        const tan = stepTan[zi];
        const arcLength = this.getRiverArcLength(currentZ, branchName);
        const weights = flightPath.getBiomeWeights(branchPt.x, currentZ);

        // Compute blended water height across river biomes (just above sea level)
        let weightedWaterY = 0;
        let totalRiverWeight = 0;
        if (weights.biomeWeights) {
          for (const [biome, weight] of weights.biomeWeights.entries()) {
            if (biome.hasRiver() && weight > 0.0001) {
              weightedWaterY += weight * biome.getRiverWaterY(branchPt.y);
              totalRiverWeight += weight;
            }
          }
        }
        if (totalRiverWeight > 0.0001) {
          weightedWaterY /= totalRiverWeight;
        } else {
          weightedWaterY = WATER_LEVEL + 0.35;
        }

        // Smooth transition into sea level when canyon meets ocean / shallow water biomes
        const waterWeight = Math.min(1.0, (weights.waterShallow || 0) * 1.5 + (weights.waterDeep || 0) * 1.5);
        const blendedWaterY = THREE.MathUtils.lerp(weightedWaterY, WATER_LEVEL, waterWeight);

        // Strictly enforce sea level floor: river surface never renders below WATER_LEVEL
        const waterY = Math.max(WATER_LEVEL, blendedWaterY);

        for (let wi = 0; wi <= numWSteps; wi++) {
          const wRatio = wi / numWSteps; // 0 to 1
          const wOffset = (wRatio - 0.5) * (riverHalfWidth * 2.0);

          // Position vertex perpendicular to the curving river/flight path direction
          const vx = branchPt.x + norm.x * wOffset;
          // Slight upward meniscus curvature as river surface reaches the canyon cliff walls
          const vy = waterY + Math.pow(Math.abs(wOffset) / riverHalfWidth, 2) * 0.08;
          const vz = currentZ + norm.z * wOffset;

          positions.push(vx, vy, vz);
          // Texture coordinates follow continuous arc length along curving river trajectory
          uvs.push(wRatio, arcLength * 0.08);
          vertexOffset++;
        }

        // Add 3D Rapids Boulders and Whitewater Foam strictly in canyon rapid zones
        const cycleDist = ((currentZ % 28.0) + 28.0) % 28.0;
        if (zi % 4 === 0 && cycleDist > 8.0 && cycleDist < 19.0) {
          // Rapid zone boulder distributed across the narrower river perpendicular to flow
          const rockOffset = ((Math.sin(currentZ * 1.3 + bIdx) * 0.55) + (bIdx === 0 ? -0.25 : 0.25)) * 1.1;
          const rockX = branchPt.x + norm.x * rockOffset;
          const rockZ = currentZ + norm.z * rockOffset;

          // Pick geometry and material deterministically based on location
          const rockSeed = Math.abs(Math.sin(currentZ * 12.9898 + bIdx * 78.233));
          const geoIndex = Math.floor(rockSeed * this.boulderGeos.length) % this.boulderGeos.length;
          const matIndex = Math.floor(rockSeed * 3.7) % this.boulderMaterials.length;

          const chosenGeo = this.boulderGeos[geoIndex];
          const chosenMat = this.boulderMaterials[matIndex];

          const rock = new THREE.Mesh(chosenGeo, chosenMat);
          const scaleX = 0.75 + Math.abs(Math.sin(currentZ * 0.9)) * 0.45;
          const scaleY = 0.55 + Math.abs(Math.cos(currentZ * 0.7)) * 0.35;
          const scaleZ = 0.75 + Math.abs(Math.sin(currentZ * 0.4)) * 0.45;
          rock.scale.set(scaleX, scaleY, scaleZ);

          // Sits in the riverbed with rocky crest emerging into spray
          const rockY = waterY + scaleY * 0.35;
          rock.position.set(rockX, rockY, rockZ);

          // Natural rock orientation aligned with river flow yaw
          const riverYaw = Math.atan2(tan.x, tan.z);
          const yaw = riverYaw + (currentZ * 1.7 + bIdx * 2.3) % 0.8 - 0.4;
          const pitch = Math.sin(currentZ * 0.6) * 0.15;
          const roll = Math.cos(currentZ * 0.8) * 0.15;
          rock.rotation.set(pitch, yaw, roll);
          rock.castShadow = true;
          chunk.bouldersGroup.add(rock);

          // Foaming whitewater crest collar around boulder
          const foam = new THREE.Mesh(this.foamGeo, this.foamMaterial);
          foam.position.set(rockX, waterY + 0.06, rockZ);
          foam.rotation.set(0, riverYaw, 0);
          chunk.bouldersGroup.add(foam);
          chunk.foamCollars.push(foam);
        }
      }

      // Generate triangle indices only for segments where both endpoints are in canyon terrain
      for (let zi = 0; zi < numZSteps; zi++) {
        if (stepInCanyon[zi] && stepInCanyon[zi + 1]) {
          const v0 = stepVertexStart[zi];
          const v1 = stepVertexStart[zi + 1];
          for (let wi = 0; wi < numWSteps; wi++) {
            const i0 = v0 + wi;
            const i1 = i0 + 1;
            const i2 = v1 + wi;
            const i3 = i2 + 1;

            indices.push(i0, i1, i2);
            indices.push(i1, i3, i2);
          }
        }
      }
    }

    const geo = chunk.waterMesh.geometry;

    if (indices.length === 0) {
      chunk.group.visible = false;
      geo.setDrawRange(0, 0);
      geo.setIndex([]);
      return;
    }

    chunk.group.visible = true;

    // Update river buffer geometry
    let posAttr = geo.attributes.position as THREE.BufferAttribute;
    let uvAttr = geo.attributes.uv as THREE.BufferAttribute;

    if (!posAttr || posAttr.count < positions.length / 3) {
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    } else {
      const posArray = posAttr.array as Float32Array;
      const uvArray = uvAttr.array as Float32Array;

      for (let i = 0; i < positions.length; i++) {
        posArray[i] = positions[i];
      }
      for (let i = 0; i < uvs.length; i++) {
        uvArray[i] = uvs[i];
      }
      posAttr.needsUpdate = true;
      uvAttr.needsUpdate = true;
    }

    geo.setIndex(indices);
    geo.setDrawRange(0, indices.length);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }

  // Animation update: river flow velocity & whitewater rapids churning
  public update(delta: number) {
    this.animTime += delta;

    // Continuous downstream water & rapids rush following the curving river trajectory
    this.riverTexture.offset.y = (this.riverTexture.offset.y - delta * 1.5) % 1.0;

    // Whitewater foam collars churning oscillation around rapids boulders
    const pulse = 1.0 + Math.sin(this.animTime * 9.5) * 0.12;
    const pulseAlt = 1.0 + Math.cos(this.animTime * 8.0) * 0.14;

    for (const chunk of this.riverChunks) {
      if (!chunk.group.visible) continue;
      for (let i = 0; i < chunk.foamCollars.length; i++) {
        const s = i % 2 === 0 ? pulse : pulseAlt;
        chunk.foamCollars[i].scale.set(s, s, s);
      }
    }
  }

  // Reset all chunks around bird start position
  public reset(startZ: number, chunkLength: number) {
    this.arcLengthCache.clear();
    for (let i = 0; i < this.numChunks; i++) {
      const centerZ = startZ + i * chunkLength;
      this.populateRiverChunk(i, centerZ, chunkLength);
    }
  }
}
