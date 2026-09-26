import * as THREE from 'three';
import { CrashRecord, CrashType, PillarCrashZone, CrashInfo, ObstacleData } from '../types';
import { flightPath } from './pathGenerator';
import { WATER_LEVEL } from '../biomes';

const STORAGE_KEY = 'feather3d_prior_crashes';
const MAX_STORED_CRASHES = 120;

export type FlutterMode = 'ENERGETIC' | 'SOFT';

export interface FeatherFlutterData {
  time: number;
  baseFreq: number;
  phase: number;
  pitchScale: number;
  rollScale: number;
  yawScale: number;
  isFluttering: boolean;
  mode: FlutterMode;
  duration: number;
  elapsed: number;
  hasTriggeredInProximity: boolean;
}

/**
 * Creates a stylized, high-visibility 3D avian feather mesh.
 * Consists of an ivory quill shaft, two-tone contoured vanes with barb slits,
 * and soft base down tufts.
 */
export function createLargeFeatherMesh(options?: {
  scale?: number;
  colorVariant?: number;
}): THREE.Group {
  const group = new THREE.Group();
  const scale = options?.scale ?? 1.0;
  const variant = options?.colorVariant ?? 0;

  // Dedicated flutter pivot group centered strictly at (0, 0, 0) (the feather quill root).
  // All feather geometry components are children of flutterGroup.
  // Rotations applied to flutterGroup pivot mathematically around (0,0,0),
  // guaranteeing that the root anchor remains 100% stationary with zero translation!
  const flutterGroup = new THREE.Group();
  flutterGroup.name = 'featherFlutter';
  group.add(flutterGroup);

  // Store flutter state & pivot reference for proximity aerodynamic wake animations
  group.userData.flutterGroup = flutterGroup;
  const flutterData: FeatherFlutterData = {
    time: Math.random() * 20.0,
    baseFreq: 30.0 + Math.random() * 8.0, // 30-38 Hz lively feather flutter oscillation
    phase: Math.random() * Math.PI * 2,
    pitchScale: 0.30 + Math.random() * 0.08, // ~17° to 22° pitch deflection (lively flutter at first)
    rollScale: 0.24 + Math.random() * 0.06,  // ~14° to 17° roll deflection
    yawScale: 0.12 + Math.random() * 0.03,   // ~7° to 9° axial twist
    isFluttering: false,
    mode: 'ENERGETIC',
    duration: 2.0 + Math.random() * 2.0,     // Random 2.0 to 4.0 seconds duration
    elapsed: 0.0,
    hasTriggeredInProximity: false,
  };
  group.userData.flutter = flutterData;

  // 1. Central Quill Shaft (Rachis): tapered ivory rod
  const shaftGeo = new THREE.CylinderGeometry(0.014, 0.036, 1.75, 8);
  shaftGeo.translate(0, 0.875, 0); // Origin at quill base (calamus)
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xfffbeb,
    roughness: 0.35,
    metalness: 0.05,
  });
  const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  flutterGroup.add(shaftMesh);

  // 2. Feather Vane Geometry (Plume): custom BufferGeometry with natural curvature
  // Steps along the quill spine from 0.28m to 1.72m
  const steps = 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Color palettes based on variant - tuned to nearly maximum saturation for high visibility across terrain and obstacles
  // 0: Classic Scarlet Macaw Spectrum (Vivid Scarlet -> Pure Canary Gold -> Electric Cobalt Blue)
  // 1: Fiery Vermilion & Coral (Blazing Vermilion -> Intense Flame Orange -> Saturated Amber Gold)
  // 2: Brilliant Canary Gold & Tangerine (Vivid Tangerine -> Max Laser Yellow -> Bright Red-Orange)
  // 3: Electric Peacock Turquoise (Pure Electric Blue -> Neon Cyan -> Max Saturation Chartreuse)
  // 4: Tropical Amazon Emerald & Chartreuse (Vibrant Jade -> Pure Electric Emerald -> Neon Spring Chartreuse)
  // 5: Sunset Orchid & Royal Magenta (Hot Neon Magenta -> Vivid Electric Violet -> Deep Saturated Indigo)
  // 6: Electric Azure Opal & Radiant Gold (Electric Cyan Azure -> Saturated Royal Sky -> Pure Brilliant Gold)
  // 7: Solar Flare & Sunset Amber (Solar Crimson -> Rich Solar Amber -> Electric Canary Yellow)
  // 8: Neon Aurora Mint & Violet (Electric Indigo -> Neon Aqua -> Fluorescent Mint)
  // 9: Royal Phoenix Crimson & Indigo (Pure Phoenix Ruby -> Intense Flame Orange -> Electric Sapphire Blue)
  const v = Math.abs(variant % 10);
  let baseColor: [number, number, number] = [1.00, 0.00, 0.05]; // Pure Vivid Scarlet
  let midColor: [number, number, number] = [1.00, 0.95, 0.00];  // Max Saturation Canary Gold
  let tipColor: [number, number, number] = [0.00, 0.30, 1.00];  // Electric Cobalt Blue

  if (v === 1) {
    // Fiery Vermilion & Coral
    baseColor = [1.00, 0.02, 0.00]; // Blazing Vermilion
    midColor = [1.00, 0.35, 0.00];  // Intense Flame Orange
    tipColor = [1.00, 0.70, 0.00];  // Saturated Amber Gold
  } else if (v === 2) {
    // Brilliant Canary Gold & Tangerine
    baseColor = [1.00, 0.50, 0.00]; // Vivid Tangerine
    midColor = [1.00, 0.98, 0.00];  // Max Laser Yellow
    tipColor = [1.00, 0.20, 0.00];  // Bright Red-Orange
  } else if (v === 3) {
    // Electric Peacock Turquoise
    baseColor = [0.00, 0.10, 1.00]; // Pure Electric Blue
    midColor = [0.00, 0.98, 1.00];  // Neon Cyan
    tipColor = [0.10, 1.00, 0.05];  // Max Saturation Chartreuse
  } else if (v === 4) {
    // Tropical Amazon Emerald & Chartreuse
    baseColor = [0.00, 0.85, 0.20]; // Vibrant Jade
    midColor = [0.00, 1.00, 0.35];  // Pure Electric Emerald
    tipColor = [0.60, 1.00, 0.00];  // Neon Spring Chartreuse
  } else if (v === 5) {
    // Sunset Orchid & Royal Magenta
    baseColor = [1.00, 0.00, 0.65]; // Hot Neon Magenta
    midColor = [0.85, 0.00, 1.00];  // Vivid Electric Violet
    tipColor = [0.40, 0.00, 1.00];  // Deep Saturated Indigo
  } else if (v === 6) {
    // Electric Azure Opal & Radiant Gold
    baseColor = [0.00, 0.85, 1.00]; // Electric Cyan Azure
    midColor = [0.25, 0.40, 1.00];  // Saturated Royal Sky
    tipColor = [1.00, 0.88, 0.00];  // Pure Brilliant Gold
  } else if (v === 7) {
    // Solar Flare & Sunset Amber
    baseColor = [1.00, 0.05, 0.00]; // Solar Crimson
    midColor = [1.00, 0.55, 0.00];  // Rich Solar Amber
    tipColor = [1.00, 0.98, 0.00];  // Electric Canary Yellow
  } else if (v === 8) {
    // Neon Aurora Mint & Violet
    baseColor = [0.55, 0.00, 1.00]; // Electric Indigo
    midColor = [0.00, 1.00, 0.90];  // Neon Aqua
    tipColor = [0.00, 1.00, 0.40];  // Fluorescent Mint
  } else if (v === 9) {
    // Royal Phoenix Crimson & Indigo
    baseColor = [1.00, 0.00, 0.20]; // Pure Phoenix Ruby
    midColor = [1.00, 0.40, 0.00];  // Intense Flame Orange
    tipColor = [0.00, 0.25, 1.00];  // Electric Sapphire Blue
  }

  const minY = 0.28;
  const maxY = 1.72;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = minY + t * (maxY - minY);

    // Natural teardrop/feather silhouette width
    const baseEnvelope = Math.sin(t * Math.PI);
    const widthFactor = Math.pow(baseEnvelope, 0.65) * 0.32;
    const leftWidth = widthFactor * 0.95;
    const rightWidth = widthFactor * 1.15; // Natural subtle asymmetry

    // Aerodynamic arch along -Z (feather curve)
    const zArch = -Math.sin(t * Math.PI) * 0.14;

    // Left vane edge (with subtle barb notches)
    const leftNotch = (i % 4 === 0 && t > 0.3 && t < 0.85) ? 0.82 : 1.0;
    const lx = -leftWidth * leftNotch;
    const ly = y - 0.04;
    const lz = zArch + 0.035; // Slight V dihedral angle

    // Center spine point
    const cx = 0;
    const cy = y;
    const cz = zArch;

    // Right vane edge
    const rightNotch = (i % 3 === 0 && t > 0.35 && t < 0.9) ? 0.85 : 1.0;
    const rx = rightWidth * rightNotch;
    const ry = y - 0.04;
    const rz = zArch + 0.035;

    // Rich 3-stop gradient along the feather spine (Base -> Mid -> Tip) with dynamic micro-shimmer
    let rCol = 0, gCol = 0, bCol = 0;
    if (t < 0.45) {
      const u = t / 0.45;
      rCol = THREE.MathUtils.lerp(baseColor[0], midColor[0], u);
      gCol = THREE.MathUtils.lerp(baseColor[1], midColor[1], u);
      bCol = THREE.MathUtils.lerp(baseColor[2], midColor[2], u);
    } else {
      const u = (t - 0.45) / 0.55;
      rCol = THREE.MathUtils.lerp(midColor[0], tipColor[0], u);
      gCol = THREE.MathUtils.lerp(midColor[1], tipColor[1], u);
      bCol = THREE.MathUtils.lerp(midColor[2], tipColor[2], u);
    }

    // Subtle barb iridescence across steps
    const barbMod = (i % 2 === 0) ? 1.04 : 0.96;
    rCol = Math.min(1.0, rCol * barbMod);
    gCol = Math.min(1.0, gCol * barbMod);
    bCol = Math.min(1.0, bCol * barbMod);

    // Spine vertex maintains full color saturation with crisp edge contrast
    const spineR = Math.min(1.0, rCol * 1.05);
    const spineG = Math.min(1.0, gCol * 1.05);
    const spineB = Math.min(1.0, bCol * 1.05);

    // Subtle edge luminescence for outer barb definition
    const leftR = Math.min(1.0, rCol * 1.08);
    const leftG = Math.min(1.0, gCol * 1.08);
    const leftB = Math.min(1.0, bCol * 1.08);

    const rightR = Math.min(1.0, rCol * 0.98);
    const rightG = Math.min(1.0, gCol * 0.98);
    const rightB = Math.min(1.0, bCol * 0.98);

    // Left vertex
    positions.push(lx, ly, lz);
    normals.push(0, 0, 1);
    colors.push(leftR, leftG, leftB);

    // Center vertex
    positions.push(cx, cy, cz);
    normals.push(0, 0, 1);
    colors.push(spineR, spineG, spineB);

    // Right vertex
    positions.push(rx, ry, rz);
    normals.push(0, 0, 1);
    colors.push(rightR, rightG, rightB);

    if (i < steps) {
      const row = i * 3;
      const nextRow = (i + 1) * 3;

      // Left vane quad (2 triangles)
      indices.push(row, nextRow, row + 1);
      indices.push(row + 1, nextRow, nextRow + 1);

      // Right vane quad (2 triangles)
      indices.push(row + 1, nextRow + 1, row + 2);
      indices.push(row + 2, nextRow + 1, nextRow + 2);
    }
  }

  const vaneGeo = new THREE.BufferGeometry();
  vaneGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  vaneGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  vaneGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  vaneGeo.setIndex(indices);
  vaneGeo.computeVertexNormals();

  const vaneMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.24,
    metalness: 0.15,
    flatShading: false,
    emissive: new THREE.Color(midColor[0] * 0.35, midColor[1] * 0.35, midColor[2] * 0.35),
  });

  const vaneMesh = new THREE.Mesh(vaneGeo, vaneMat);
  vaneMesh.castShadow = true;
  vaneMesh.receiveShadow = true;
  flutterGroup.add(vaneMesh);

  // 3. Fluffy Down Tufts at base: two soft downy tufts matching the saturated base plumage color
  const tuftColor = new THREE.Color(baseColor[0], baseColor[1], baseColor[2]);
  const tuftMat = new THREE.MeshStandardMaterial({
    color: tuftColor,
    roughness: 0.45,
    emissive: new THREE.Color(baseColor[0] * 0.30, baseColor[1] * 0.30, baseColor[2] * 0.30),
    flatShading: true,
  });
  const tuftGeo = new THREE.ConeGeometry(0.09, 0.22, 5);
  tuftGeo.rotateZ(0.4);
  const tuft1 = new THREE.Mesh(tuftGeo, tuftMat);
  tuft1.position.set(-0.06, 0.32, 0.02);
  flutterGroup.add(tuft1);

  const tuft2 = tuft1.clone();
  tuft2.rotation.z = -0.4;
  tuft2.position.set(0.06, 0.34, 0.02);
  flutterGroup.add(tuft2);

  group.scale.set(scale, scale, scale);
  return group;
}

export class FeatherManager {
  private scene: THREE.Scene;
  private crashes: CrashRecord[] = [];
  private terrainFeatherMeshes: Map<string, THREE.Group> = new THREE.Group() as any; // maps crash.id -> THREE.Group
  private terrainFeathersGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.terrainFeatherMeshes = new Map();
    this.terrainFeathersGroup = new THREE.Group();
    this.scene.add(this.terrainFeathersGroup);
    this.loadCrashes();
  }

  /**
   * Load prior recorded crashes from localStorage
   */
  public loadCrashes(): CrashRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.crashes = parsed;
          return this.crashes;
        }
      }
    } catch {
      // Storage unavailable or parsing error
    }
    this.crashes = [];
    return this.crashes;
  }

  /**
   * Save crash to memory and localStorage (limited to MAX_STORED_CRASHES)
   */
  public saveCrash(record: CrashRecord) {
    this.crashes.push(record);
    if (this.crashes.length > MAX_STORED_CRASHES) {
      this.crashes.splice(0, this.crashes.length - MAX_STORED_CRASHES);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.crashes));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Record a new crash event from the game engine.
   * Keeps the base of the feather fixed at (0,0,0) at the point of impact,
   * adding +- 30 degrees of randomness to pitch, yaw, and roll.
   */
  public recordCrash(info: CrashInfo): CrashRecord {
    // 30 degrees in radians
    const DEG_30 = (30 * Math.PI) / 180; // ~0.5236 rad (30 degrees)

    // +- 30 degrees of randomness to pitch, yaw, and roll
    // Constrained so tilt never leans in the same direction as the path:
    // Pitch (tilt along path) is strictly 0 to +30 deg against path (never forward with path)
    const randomPitch = Math.random() * DEG_30; // [0°, +30°] tilt against path direction
    const randomYaw = (Math.random() - 0.5) * 2 * DEG_30;   // [-30°, +30°]
    const randomRoll = (Math.random() - 0.5) * 2 * DEG_30;  // [-30°, +30°]

    // Minor lateral jitter along column/ground width (strictly clamped within face width, ZERO height randomness)
    const shiftDir = Math.random() < 0.5 ? -1 : 1;
    const randomJitterX = shiftDir * 0.25;
    const randomJitterZ = 0;
    const featherScale = 1.05 + Math.random() * 0.25;
    const colorVariant = Math.floor(Math.random() * 10);

    let localHitX: number | undefined;
    let localHitY: number | undefined;
    let localHitZ: number | undefined;

    if (info.type === 'PILLAR' && info.hitObstacle?.gateGroup) {
      const worldHit = new THREE.Vector3(info.worldPos.x, info.worldPos.y, info.worldPos.z);
      const localV = info.hitObstacle.gateGroup.worldToLocal(worldHit.clone());
      localHitX = THREE.MathUtils.clamp(Math.round(localV.x * 1000) / 1000, -0.75, 0.75);

      const gapHalf = info.hitObstacle.gapHeight / 2;
      const gapCenterY = info.hitObstacle.gapCenterY;
      const isTop = info.pillarZone === 'TOP_SURFACE' || info.pillarZone === 'OVER_GAP' || localV.y >= gapCenterY;

      // Deterministic height with ZERO randomness: strictly anchored on pillar stone
      if (isTop) {
        if (info.pillarZone === 'TOP_SURFACE' || localV.y < gapCenterY + gapHalf + 1.0) {
          localHitY = Math.round((gapCenterY + gapHalf + 0.45) * 1000) / 1000;
        } else {
          localHitY = Math.round(Math.max(gapCenterY + gapHalf + 1.45, localV.y) * 1000) / 1000;
        }
      } else {
        if (info.pillarZone === 'BOTTOM_SURFACE' || localV.y > gapCenterY - gapHalf - 1.0) {
          localHitY = Math.round((gapCenterY - gapHalf - 0.45) * 1000) / 1000;
        } else {
          localHitY = Math.round(Math.min(gapCenterY - gapHalf - 1.45, localV.y) * 1000) / 1000;
        }
      }

      localHitZ = Math.round(localV.z * 1000) / 1000;
    }

    const record: CrashRecord = {
      id: `crash_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      timestamp: Date.now(),
      type: info.type,
      distance: Math.round(info.distance * 10) / 10,
      branch: info.branch,
      lateralOffset: Math.round(info.lateralOffset * 10) / 10,
      terrainX: info.type === 'TERRAIN' ? info.worldPos.x : undefined,
      terrainY: info.type === 'TERRAIN' ? info.worldPos.y : undefined,
      terrainZ: info.type === 'TERRAIN' ? info.worldPos.z : undefined,
      pillarIndex: info.pillarIndex,
      pillarZone: info.pillarZone,
      relativeYToGap: info.relativeYToGap !== undefined ? Math.round(info.relativeYToGap * 100) / 100 : undefined,
      hitAngle: info.hitAngle ?? (Math.random() - 0.5) * 0.9,
      localHitX,
      localHitY,
      localHitZ,
      randomPitch,
      randomYaw,
      randomRoll,
      randomJitterX,
      randomJitterZ,
      featherScale,
      colorVariant,
    };

    this.saveCrash(record);

    // If it hit an obstacle in the current run, attach immediately to that obstacle
    if (info.hitObstacle && info.hitObstacle.gateGroup) {
      const feather = this.attachSingleFeatherToObstacle(info.hitObstacle, record);
      if (feather) {
        this.triggerFeatherFlutter(feather);
      }
    } else if (info.type === 'TERRAIN') {
      // Spawn immediately in the terrain
      const feather = this.spawnTerrainFeather(record);
      if (feather) {
        this.triggerFeatherFlutter(feather);
      }
    }

    return record;
  }

  /**
   * Spawns a feather mesh embedded in the terrain floor
   * Keeps the base of the feather fixed at (0,0,0) at the strike point,
   * oriented predominantly upward with +- 30 degrees of pitch, yaw, and roll randomness.
   */
  private spawnTerrainFeather(record: CrashRecord): THREE.Group {
    const variant = record.colorVariant !== undefined
      ? record.colorVariant
      : Math.abs(Math.round((record.distance ?? 50) * 7)) % 10;

    const feather = createLargeFeatherMesh({
      scale: record.featherScale ?? 1.1,
      colorVariant: variant,
    });

    const posX = record.terrainX ?? 0;
    const posZ = record.terrainZ ?? 0;

    // Frame along flight path at impact location
    const frame = flightPath.getFrame(record.distance ?? 0, record.lateralOffset ?? 0);

    // Randomize the insertion point: add a random shift left or right by 0.4 meters (along frame.right)
    const lateralShift = record.randomJitterX !== undefined
      ? record.randomJitterX
      : (Math.random() < 0.5 ? -0.4 : 0.4);

    const shiftedPos = new THREE.Vector3(posX, 0, posZ).addScaledVector(frame.right, lateralShift);
    const rawGroundY = flightPath.getTerrainHeight(shiftedPos.x, shiftedPos.z);
    const groundY = Math.max(rawGroundY, WATER_LEVEL);

    // Embed quill base ~0.12m into the ground/water surface
    feather.position.set(shiftedPos.x, groundY - (rawGroundY < WATER_LEVEL ? 0.02 : 0.12), shiftedPos.z);

    const DEG_30 = (30 * Math.PI) / 180; // ~0.5236 rad (30 degrees)

    // Constrain tilt: feather must NEVER tilt in the same direction as the path (frame.tangent).
    // It can tilt upright or backward against the path direction by up to 30 degrees.
    const pitchVal = Math.abs(record.randomPitch ?? 0);
    const tiltAgainstPath = 0.08 + THREE.MathUtils.clamp(pitchVal, 0, DEG_30) * 0.75; // ~5° to 27° lean against path

    // Lateral roll (tilt left/right perpendicular to path): +- 30 degrees
    const roll = THREE.MathUtils.clamp(record.randomRoll ?? 0, -DEG_30, DEG_30);

    // Yaw around spine axis: +- 30 degrees
    const yaw = THREE.MathUtils.clamp(record.randomYaw ?? 0, -DEG_30, DEG_30);

    // Compute spine direction vector (local +Y of the feather)
    // frame.up points up from terrain
    // -frame.tangent points opposite to path (towards oncoming bird)
    // frame.right points lateral
    const spine = frame.up.clone()
      .addScaledVector(frame.tangent, -Math.tan(tiltAgainstPath))
      .addScaledVector(frame.right, Math.tan(roll))
      .normalize();

    // Absolute guarantee: dot product with path tangent must be negative (never tilting with the path)
    if (spine.dot(frame.tangent) > -0.02) {
      spine.addScaledVector(frame.tangent, -0.1).normalize();
    }

    // Build orthonormal coordinate system around spine
    const featherUp = spine;
    const targetForward = frame.tangent.clone().negate().normalize(); // broadside faces approaching player
    let featherRight = new THREE.Vector3().crossVectors(featherUp, targetForward).normalize();
    if (featherRight.lengthSq() < 0.001) {
      featherRight = frame.right.clone();
    }
    const featherForward = new THREE.Vector3().crossVectors(featherRight, featherUp).normalize();

    const m = new THREE.Matrix4();
    m.makeBasis(featherRight, featherUp, featherForward);
    feather.quaternion.setFromRotationMatrix(m);

    // Yaw rotation around the feather's own quill spine (+Y)
    // (Keeps the base of the feather fixed and does not change the spine tilt direction)
    feather.rotateY(yaw);

    this.terrainFeathersGroup.add(feather);
    this.terrainFeatherMeshes.set(record.id, feather);
    return feather;
  }

  /**
   * Attaches all recorded prior crash feathers for a given obstacle instance
   */
  public attachFeathersToObstacle(obs: ObstacleData) {
    if (!obs.gateGroup) return;

    // Filter all pillar crashes recorded for this column
    const matchingCrashes = this.crashes.filter(
      (c) =>
        c.type === 'PILLAR' &&
        c.pillarIndex === obs.columnIndex &&
        (obs.branch === 'SINGLE' || c.branch === obs.branch)
    );

    if (matchingCrashes.length === 0) return;

    for (const crash of matchingCrashes) {
      this.attachSingleFeatherToObstacle(obs, crash);
    }
  }

  /**
   * Instantiates and mounts a single feather onto the obstacle gateGroup
   * in the recorded collision zone (TOP_SURFACE, BOTTOM_SURFACE, OVER_GAP, or UNDER_GAP).
   * The feather orientation is roughly up and down (predominantly vertical),
   * with its quill base visibly embedded inside the column material.
   */
  private attachSingleFeatherToObstacle(obs: ObstacleData, crash: CrashRecord): THREE.Group | undefined {
    if (!obs.gateGroup) return undefined;

    const variant = crash.colorVariant !== undefined
      ? crash.colorVariant
      : Math.abs((crash.pillarIndex ?? 1) * 3 + Math.round((crash.relativeYToGap ?? 0) * 10)) % 10;

    const feather = createLargeFeatherMesh({
      scale: crash.featherScale ?? 1.15,
      colorVariant: variant,
    });

    const gapHalf = obs.gapHeight / 2; // e.g. 2.6m
    const gapCenterY = obs.gapCenterY;

    // Determine whether this collision occurred on the top or bottom pillar
    const isTop = crash.pillarZone === 'TOP_SURFACE' || crash.pillarZone === 'OVER_GAP'
      || (crash.localHitY !== undefined ? crash.localHitY >= gapCenterY : (crash.relativeYToGap ?? 0) >= 0);

    // Front face blocks span from x = -1.0 to +1.0.
    // Clamping strictly to [-0.75, 0.75] ensures feather root never slips off column sides into air!
    const rawX = crash.localHitX ?? 0;
    const lateralShift = THREE.MathUtils.clamp(crash.randomJitterX ?? 0, -0.25, 0.25);
    const posX = THREE.MathUtils.clamp(rawX + lateralShift, -0.75, 0.75);

    let posY: number;
    let posZ: number;

    // Determine if collision is at/near the opening rim capital (layer 0) or further along the shaft
    const isNearRim = crash.pillarZone === 'TOP_SURFACE' || crash.pillarZone === 'BOTTOM_SURFACE'
      || crash.localHitY === undefined
      || (isTop && crash.localHitY <= gapCenterY + gapHalf + 1.1)
      || (!isTop && crash.localHitY >= gapCenterY - gapHalf - 1.1);

    if (isNearRim) {
      // 1. Opening Rim Capital: 1-block thick overhang adjacent to the gap
      // Rim block extends from z = -2.0 to -1.0. Front face is at z = -2.0.
      // We embed quill root ~0.15m inside front stone face at z = -1.85.
      posZ = -1.85;

      // Completely deterministic height with ZERO randomness:
      // Fixed cleanly in the center of the rim block on the column!
      if (isTop) {
        posY = gapCenterY + gapHalf + 0.45; // Firmly in top rim block [gapCenterY + gapHalf, gapCenterY + gapHalf + 1.0]
      } else {
        posY = gapCenterY - gapHalf - 0.45; // Firmly in bottom rim block [gapCenterY - gapHalf - 1.0, gapCenterY - gapHalf]
      }
    } else {
      // 2. Pillar Shaft (layers 1..23): 2x2 blocks extending upwards or downwards
      // Shaft block extends from z = -1.0 to 0.0. Front face is at z = -1.0.
      // We embed quill root ~0.15m inside front stone face at z = -0.85.
      posZ = -0.85;

      // Completely deterministic height with ZERO randomness:
      // Clamped strictly to the pillar shaft stone blocks!
      if (isTop) {
        const rawY = crash.localHitY ?? (gapCenterY + (crash.relativeYToGap ?? (gapHalf + 2.0)));
        posY = Math.max(gapCenterY + gapHalf + 1.45, rawY);
      } else {
        const rawY = crash.localHitY ?? (gapCenterY + (crash.relativeYToGap ?? (-gapHalf - 2.0)));
        posY = Math.min(gapCenterY - gapHalf - 1.45, rawY);
      }
    }

    // Normal facing outward from column front face into -Z (towards approaching bird)
    const normal = new THREE.Vector3(0, 0, -1);

    // Anchor the feather's base (0,0,0) firmly inside the column stone face (never in the gap or outside the column)
    feather.position.set(posX, posY, posZ);

    // ORIENTATION: ROUGHLY UP AND DOWN, CONSTRAINED AGAINST PATH DIRECTION
    // In gate coordinates:
    // local X: lateral (right)
    // local Y: up
    // local Z: path direction (forward flight is in +Z)
    // normal is roughly (0, 0, -1), pointing outward from column front face into -Z (against path)
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const lateralAxis = right.lengthSq() > 0.001 ? right : new THREE.Vector3(1, 0, 0);

    const DEG_30 = (30 * Math.PI) / 180; // ~0.5236 rad (30 degrees)

    // Constrain tilt: feather must NEVER tilt in the same direction as the path (+Z).
    // It tilts slightly outward from the column face into -Z (against path) by up to 30 degrees.
    const pitchVal = Math.abs(crash.randomPitch ?? 0);
    const outwardLean = 0.14 + THREE.MathUtils.clamp(pitchVal, 0, DEG_30) * 0.65; // ~8° to 25° outward lean into -Z

    // Lateral roll (tilt left/right across column face): +- 30 degrees
    const roll = THREE.MathUtils.clamp(crash.randomRoll ?? 0, -DEG_30, DEG_30);

    // Yaw around spine axis: +- 30 degrees
    const yaw = THREE.MathUtils.clamp(crash.randomYaw ?? 0, -DEG_30, DEG_30);

    // Compute spine direction vector (local +Y of feather)
    const spine = up.clone()
      .addScaledVector(normal, Math.tan(outwardLean))
      .addScaledVector(lateralAxis, Math.tan(roll))
      .normalize();

    // Absolute guarantee: feather must never tilt in the same direction as the path (+Z)
    // So spine.z must be strictly negative (pointing into -Z, against path)
    if (spine.z > -0.02) {
      spine.z = -Math.max(0.08, Math.abs(spine.z));
      spine.normalize();
    }

    // Build orthonormal coordinate system around spine
    const featherUp = spine;
    const targetForward = normal.clone(); // Broadside faces approaching player (-Z)
    let featherRight = new THREE.Vector3().crossVectors(featherUp, targetForward).normalize();
    if (featherRight.lengthSq() < 0.001) {
      featherRight = lateralAxis.clone();
    }
    const featherForward = new THREE.Vector3().crossVectors(featherRight, featherUp).normalize();

    const m = new THREE.Matrix4();
    m.makeBasis(featherRight, featherUp, featherForward);
    feather.quaternion.setFromRotationMatrix(m);

    // Yaw rotation around the feather's own quill spine (+Y)
    // (Keeps the base of the feather fixed and does not change the spine tilt direction)
    feather.rotateY(yaw);

    obs.gateGroup.add(feather);
    if (!obs.featherMeshes) obs.featherMeshes = [];
    obs.featherMeshes.push(feather);
    return feather;
  }

  /**
   * Syncs terrain crash feathers dynamically around the bird's streaming window
   * Spawns feathers entering visible range and culls those far behind.
   */
  public updateTerrainFeathers(birdZ: number) {
    const minZ = birdZ - 65.0;
    const maxZ = birdZ + 185.0;

    const terrainCrashes = this.crashes.filter((c) => c.type === 'TERRAIN');

    for (const crash of terrainCrashes) {
      const cz = crash.terrainZ ?? crash.distance;
      const inRange = cz >= minZ && cz <= maxZ;
      const isSpawned = this.terrainFeatherMeshes.has(crash.id);

      if (inRange && !isSpawned) {
        this.spawnTerrainFeather(crash);
      } else if (!inRange && isSpawned) {
        const mesh = this.terrainFeatherMeshes.get(crash.id);
        if (mesh) {
          this.terrainFeathersGroup.remove(mesh);
          this.terrainFeatherMeshes.delete(crash.id);
        }
      }
    }
  }

  /**
   * Resets active visible meshes on game restart (preserves recorded crash history)
   */
  public reset(startZ: number = 0) {
    // Clear in-world terrain feather meshes
    while (this.terrainFeathersGroup.children.length > 0) {
      this.terrainFeathersGroup.remove(this.terrainFeathersGroup.children[0]);
    }
    this.terrainFeatherMeshes.clear();

    // Re-populate terrain feathers near start
    this.updateTerrainFeathers(startZ);
  }

  /**
   * Reusable vectors for proximity and position calculations to avoid garbage collection
   */
  private tempFeatherMidpoint = new THREE.Vector3();
  private tempFeatherRoot = new THREE.Vector3();

  /**
   * Checks whether a feather is located below the bird in world space.
   * Feathers below the bird have their root anchor or vane midpoint at or below the bird's vertical Y position.
   */
  public isFeatherBelowBird(feather: THREE.Group, birdPos: THREE.Vector3): boolean {
    feather.localToWorld(this.tempFeatherRoot.set(0, 0, 0));
    feather.localToWorld(this.tempFeatherMidpoint.set(0, 0.9, 0));
    return this.tempFeatherRoot.y <= birdPos.y || this.tempFeatherMidpoint.y <= birdPos.y;
  }

  /**
   * Updates aerodynamic flutter on all active death feathers (terrain and obstacle pillars).
   * Gliding into range triggers a Soft Initial Flutter (40% movement speed).
   * Flapping within range or dying within range triggers an Energetic Initial Flutter (100% movement speed).
   * Feathers smoothly slow down to a stop over a random 2 to 4 seconds span.
   */
  public update(
    delta: number,
    birdPos: THREE.Vector3,
    obstacles: ObstacleData[],
    birdSpeed?: number,
    isFlapping?: boolean
  ) {
    // 1. Terrain feathers
    const terrainChildren = this.terrainFeathersGroup.children;
    for (let i = 0; i < terrainChildren.length; i++) {
      const feather = terrainChildren[i] as THREE.Group;
      this.updateSingleFeatherFlutter(feather, birdPos, delta, birdSpeed, isFlapping);
    }

    // 2. Obstacle pillar feathers
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.featherMeshes && obs.featherMeshes.length > 0) {
        // Fast Z distance cull if obstacle is far away and feathers are completely at rest
        if (obs.gateGroup && Math.abs(obs.gateGroup.position.z - birdPos.z) > 28.0) {
          let hasActive = false;
          for (let j = 0; j < obs.featherMeshes.length; j++) {
            const f = obs.featherMeshes[j];
            if (f.userData.flutter && f.userData.flutter.isFluttering) {
              hasActive = true;
              break;
            }
          }
          if (!hasActive) continue;
        }

        for (let j = 0; j < obs.featherMeshes.length; j++) {
          const feather = obs.featherMeshes[j];
          this.updateSingleFeatherFlutter(feather, birdPos, delta, birdSpeed, isFlapping);
        }
      }
    }
  }

  /**
   * Triggers an aerodynamic flutter event on a feather.
   * - 'ENERGETIC': triggered by flapping wings, dying within range, or tapping while in Soft mode.
   * - 'SOFT': triggered by gliding into range (40% movement speed).
   * Both decelerate both deflection and oscillation frequency to a complete stop
   * over a random span of 2 to 4 seconds, even if the bird remains near.
   */
  public triggerFeatherFlutter(feather: THREE.Group, mode: FlutterMode = 'ENERGETIC') {
    const flutter = feather.userData.flutter as FeatherFlutterData | undefined;
    if (!flutter) return;
    flutter.isFluttering = true;
    flutter.mode = mode;
    flutter.duration = 2.0 + Math.random() * 2.0; // Random 2.0 to 4.0 seconds duration
    flutter.elapsed = 0.0;
    flutter.hasTriggeredInProximity = true;
  }

  /**
   * Called immediately whenever the player taps (flaps their wings).
   * For the Energetic Initial Flutter trigger zone: only feathers below the bird flutter.
   * If any feathers below the bird are currently in Soft Initial Flutter mode, Energetic mode starts immediately!
   * Any feathers below the bird within proximity that haven't triggered also start in Energetic mode.
   */
  public onBirdFlap(birdPos: THREE.Vector3, obstacles: ObstacleData[]) {
    const FLUTTER_RADIUS = 5.5;
    const FLUTTER_RADIUS_SQ = FLUTTER_RADIUS * FLUTTER_RADIUS;
    const EXTENDED_SOFT_RANGE_SQ = 7.5 * 7.5; // Catch feathers in Soft mode as bird is passing by

    // Check terrain feathers
    const terrainChildren = this.terrainFeathersGroup.children;
    for (let i = 0; i < terrainChildren.length; i++) {
      const feather = terrainChildren[i] as THREE.Group;
      const flutter = feather.userData.flutter as FeatherFlutterData | undefined;
      if (!flutter) continue;

      feather.updateWorldMatrix(true, false);
      // Energetic Initial Flutter trigger zone: only feathers below the bird
      if (!this.isFeatherBelowBird(feather, birdPos)) continue;

      const distSq = birdPos.distanceToSquared(this.tempFeatherMidpoint);

      if (flutter.isFluttering && flutter.mode === 'SOFT' && distSq < EXTENDED_SOFT_RANGE_SQ) {
        this.triggerFeatherFlutter(feather, 'ENERGETIC');
      } else if (!flutter.hasTriggeredInProximity && distSq < FLUTTER_RADIUS_SQ) {
        this.triggerFeatherFlutter(feather, 'ENERGETIC');
      }
    }

    // Check obstacle feathers
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (!obs.featherMeshes || obs.featherMeshes.length === 0) continue;
      if (obs.gateGroup && Math.abs(obs.gateGroup.position.z - birdPos.z) > 18.0) continue;

      for (let j = 0; j < obs.featherMeshes.length; j++) {
        const feather = obs.featherMeshes[j];
        const flutter = feather.userData.flutter as FeatherFlutterData | undefined;
        if (!flutter) continue;

        feather.updateWorldMatrix(true, false);
        // Energetic Initial Flutter trigger zone: only feathers below the bird
        if (!this.isFeatherBelowBird(feather, birdPos)) continue;

        const distSq = birdPos.distanceToSquared(this.tempFeatherMidpoint);

        if (flutter.isFluttering && flutter.mode === 'SOFT' && distSq < EXTENDED_SOFT_RANGE_SQ) {
          this.triggerFeatherFlutter(feather, 'ENERGETIC');
        } else if (!flutter.hasTriggeredInProximity && distSq < FLUTTER_RADIUS_SQ) {
          this.triggerFeatherFlutter(feather, 'ENERGETIC');
        }
      }
    }
  }

  /**
   * Called when bird crashes and dies.
   * Energetic Initial Flutter trigger zone: only feathers below the bird flutter.
   */
  public onBirdDied(birdPos: THREE.Vector3, obstacles: ObstacleData[]) {
    const FLUTTER_RADIUS = 5.5;
    const FLUTTER_RADIUS_SQ = FLUTTER_RADIUS * FLUTTER_RADIUS;

    // Check terrain feathers
    const terrainChildren = this.terrainFeathersGroup.children;
    for (let i = 0; i < terrainChildren.length; i++) {
      const feather = terrainChildren[i] as THREE.Group;
      feather.updateWorldMatrix(true, false);
      if (!this.isFeatherBelowBird(feather, birdPos)) continue;

      if (birdPos.distanceToSquared(this.tempFeatherMidpoint) < FLUTTER_RADIUS_SQ) {
        this.triggerFeatherFlutter(feather, 'ENERGETIC');
      }
    }

    // Check obstacle feathers
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (!obs.featherMeshes || obs.featherMeshes.length === 0) continue;
      if (obs.gateGroup && Math.abs(obs.gateGroup.position.z - birdPos.z) > 18.0) continue;

      for (let j = 0; j < obs.featherMeshes.length; j++) {
        const feather = obs.featherMeshes[j];
        feather.updateWorldMatrix(true, false);
        if (!this.isFeatherBelowBird(feather, birdPos)) continue;

        if (birdPos.distanceToSquared(this.tempFeatherMidpoint) < FLUTTER_RADIUS_SQ) {
          this.triggerFeatherFlutter(feather, 'ENERGETIC');
        }
      }
    }
  }

  /**
   * Evaluates proximity to the bird and animates flutter rotation around (0,0,0) root.
   * Soft mode moves at 40% speed; Energetic mode moves at 100% speed.
   * Energetic Initial Flutter trigger zone is strictly for feathers below the bird.
   * Both slow down to a stop over 2 to 4 seconds, even if the bird is still near.
   */
  private updateSingleFeatherFlutter(
    feather: THREE.Group,
    birdPos: THREE.Vector3,
    delta: number,
    _birdSpeed?: number,
    isFlapping?: boolean
  ) {
    const flutter = feather.userData.flutter as FeatherFlutterData | undefined;
    const flutterGroup = feather.userData.flutterGroup as THREE.Group | undefined;
    if (!flutter || !flutterGroup) return;

    // Ensure freshly updated world matrix for accurate proximity and vertical positioning
    feather.updateWorldMatrix(true, false);

    const isBelow = this.isFeatherBelowBird(feather, birdPos);
    // Measure distance from bird to the feather's midpoint (local 0, 0.9, 0 along quill)
    const distSq = birdPos.distanceToSquared(this.tempFeatherMidpoint);

    // Bird slipstream proximity threshold: 5.5 meters radius
    const FLUTTER_RADIUS = 5.5;
    const FLUTTER_RADIUS_SQ = FLUTTER_RADIUS * FLUTTER_RADIUS;

    if (distSq < FLUTTER_RADIUS_SQ) {
      if (!flutter.hasTriggeredInProximity) {
        // First entry into range:
        // Energetic Initial Flutter trigger zone: only feathers BELOW the bird!
        // Gliding into range (or passing near a feather above the bird) triggers Soft Initial Flutter (40% movement speed)
        const mode: FlutterMode = (isFlapping && isBelow) ? 'ENERGETIC' : 'SOFT';
        this.triggerFeatherFlutter(feather, mode);
      } else if (flutter.isFluttering && flutter.mode === 'SOFT' && isFlapping && isBelow) {
        // If already in Soft mode and bird flaps wings while feather is below the bird:
        // upgrade to Energetic Initial Flutter!
        this.triggerFeatherFlutter(feather, 'ENERGETIC');
      }
    } else if (distSq > FLUTTER_RADIUS_SQ * 1.5) {
      // Bird has flown far enough away (> 6.7m): reset flag so future passes can trigger flutter again
      flutter.hasTriggeredInProximity = false;
    }

    if (flutter.isFluttering) {
      flutter.elapsed += delta;
      const progress = Math.min(1.0, flutter.elapsed / flutter.duration);

      if (progress >= 1.0) {
        // Complete the 2-4 second flutter span: stop completely even if the bird is still near!
        flutter.isFluttering = false;
        flutter.elapsed = flutter.duration;
        flutterGroup.rotation.set(0, 0, 0);
      } else {
        const remaining = 1.0 - progress; // 1.0 down to 0.0

        // Soft Initial Flutter has 40% (0.40) of the movement speed
        const speedScale = flutter.mode === 'SOFT' ? 0.40 : 1.0;

        // 1. Flutter more at first: starts at peak amplitude, smoothly decelerates to zero
        const intensity = Math.pow(remaining, 1.7) * (0.95 + 0.35 * remaining) * speedScale;

        // 2. Slow down oscillation frequency over the course of the duration ("slow down to a stop")
        const freqRatio = (0.35 + 0.65 * remaining) * speedScale;
        flutter.time += delta * freqRatio;

        const t = flutter.time;
        const f = flutter.baseFreq;

        // Multi-harmonic aerodynamic oscillation simulating vane flutter in bird wake
        const wave1 = Math.sin(t * f + flutter.phase);
        const wave2 = Math.sin(t * f * 1.68 + flutter.phase * 1.35);
        const wave3 = Math.cos(t * f * 2.41 + flutter.phase * 0.7);

        // Rotations strictly centered on (0, 0, 0) root:
        // Pitch: flutter lean forward/back in the wake
        const pitch = intensity * flutter.pitchScale * (wave1 * 0.72 + wave2 * 0.28);
        // Roll: vane side-to-side shiver
        const roll = intensity * flutter.rollScale * (wave2 * 0.68 + wave3 * 0.32);
        // Yaw: light spine axial shudder
        const yaw = intensity * flutter.yawScale * wave3;

        // flutterGroup has position (0, 0, 0) relative to feather,
        // so this rotation pivots precisely around the quill root at (0, 0, 0)!
        flutterGroup.rotation.set(pitch, yaw, roll);
      }
    } else {
      flutterGroup.rotation.set(0, 0, 0);
    }
  }

  /**
   * Total number of recorded crashes
   */
  public getCrashCount(): number {
    return this.crashes.length;
  }

  /**
   * Clear all stored crashes if player wants a clean slate
   */
  public clearAllCrashes() {
    this.crashes = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    this.reset(0);
  }
}
