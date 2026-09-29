import * as THREE from 'three';
import { flightPath, PathFrame } from './pathGenerator';
import { CameraAngle, ObstacleData } from '../types';
import { WATER_LEVEL } from '../biomes';

export interface CameraShotConfig {
  name: string;
  angleType: CameraAngle;
  forwardOffset: number; // along -tangent
  upOffset: number;      // along up
  rightOffset: number;   // along right (negative = left, positive = right)
  lookAhead: number;     // how far ahead of bird to aim
  lookUp: number;
  fov: number;
}

const SHOT_PRESETS: CameraShotConfig[] = [
  {
    name: 'Cinematic Rear Chase',
    angleType: 'CHASE',
    forwardOffset: -5.2,
    upOffset: 1.35,
    rightOffset: 0.0,
    lookAhead: 5.2,
    lookUp: 0.2,
    fov: 62,
  },
  {
    name: 'Left Wing Tracking Shot',
    angleType: 'LEFT_TRACK',
    forwardOffset: -6.4,
    upOffset: 1.55,
    rightOffset: -5.2,
    lookAhead: 6.8,
    lookUp: 0.28,
    fov: 66,
  },
  {
    name: 'Right Profile Cinematic',
    angleType: 'RIGHT_TRACK',
    forwardOffset: -6.4,
    upOffset: 1.55,
    rightOffset: 5.2,
    lookAhead: 6.8,
    lookUp: 0.28,
    fov: 66,
  },
  {
    name: 'High Ridge Drone Shot',
    angleType: 'HIGH_DRONE',
    forwardOffset: -6.6,
    upOffset: 3.2,
    rightOffset: 4.2,
    lookAhead: 5.8,
    lookUp: -0.15,
    fov: 67,
  },
  {
    name: 'Low Banking Flyby',
    angleType: 'LOW_BANK',
    forwardOffset: -5.8,
    upOffset: 1.05,
    rightOffset: -4.6,
    lookAhead: 6.2,
    lookUp: 0.32,
    fov: 66,
  },
];

export class CinematicCameraDirector {
  public camera: THREE.PerspectiveCamera;
  private currentPos: THREE.Vector3 = new THREE.Vector3();
  private currentLookAt: THREE.Vector3 = new THREE.Vector3();

  // Shot rotation logic
  private currentShotIndex: number = 0;
  private targetShotIndex: number = 0;
  private shotTimer: number = 0;
  private shotDuration: number = 7.5; // seconds per cinematic angle
  private transitionAlpha: number = 1.0;
  private isAutoDrift: boolean = true;

  // Camera breathing / handheld movement
  private noiseTimer: number = 0;

  // Split approach pull-back factor (0 = normal, 1 = full pull-back at fork)
  private currentSplitFactor: number = 0;

  // Breakthrough FOV punch on piercing the record horizon
  private breakthroughFovPunch: number = 0;

  // Ring collection impact juice (snappy FOV punch and tactile micro-shake)
  private ringFovPunch: number = 0;
  private ringShakeTimer: number = 0;
  private ringShakeIntensity: number = 0;

  // Orbit angle for game over state
  private gameOverOrbitAngle: number = 0;

  // First Person Camera State
  private isFirstPerson: boolean = false;

  constructor(fov = 64, aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.3, 300);
    this.currentShotIndex = 0;
    this.targetShotIndex = 0;
  }

  public setFirstPerson(enabled: boolean) {
    this.isFirstPerson = enabled;
    if (!enabled) {
      this.transitionAlpha = 0.0;
    }
  }

  public getIsFirstPerson(): boolean {
    return this.isFirstPerson;
  }

  public toggleFirstPerson(): boolean {
    this.setFirstPerson(!this.isFirstPerson);
    return this.isFirstPerson;
  }

  public setAutoDrift(enabled: boolean) {
    this.isAutoDrift = enabled;
  }

  public getIsAutoDrift(): boolean {
    return this.isAutoDrift;
  }

  public getCurrentShotName(): string {
    if (this.isFirstPerson) {
      return 'First Person (Cockpit)';
    }
    return SHOT_PRESETS[this.currentShotIndex].name;
  }

  public getCurrentAngleType(): CameraAngle {
    if (this.isFirstPerson) {
      return 'FIRST_PERSON';
    }
    return SHOT_PRESETS[this.currentShotIndex].angleType;
  }

  public forceShot(index: number) {
    this.targetShotIndex = index % SHOT_PRESETS.length;
    this.transitionAlpha = 0.0;
  }

  public triggerBreakthroughPunch(punch: number = 7.5) {
    this.breakthroughFovPunch = punch;
  }

  /**
   * Snappy camera punch and tactile micro-impact shake on ring collection
   */
  public triggerRingPunch(intensity: number = 1.0) {
    this.ringFovPunch = -2.5 * intensity; // Crisp micro-zoom on impact
    this.ringShakeTimer = 0.15;
    this.ringShakeIntensity = 0.065 * intensity;
  }

  public cycleNextShot() {
    this.targetShotIndex = (this.currentShotIndex + 1) % SHOT_PRESETS.length;
    this.transitionAlpha = 0.0;
  }

  public reset(
    birdPos: THREE.Vector3,
    frame: PathFrame,
    pathDistance: number = 0,
    birdQuat?: THREE.Quaternion,
    obstacles?: ObstacleData[],
    activeBranch?: 'SINGLE' | 'LEFT' | 'RIGHT'
  ) {
    this.currentShotIndex = 0;
    this.targetShotIndex = 0;
    this.shotTimer = 0;
    this.transitionAlpha = 1.0;
    this.gameOverOrbitAngle = 0;
    this.ringFovPunch = 0;
    this.ringShakeTimer = 0;
    this.ringShakeIntensity = 0;
    this.currentSplitFactor = this.calculateSplitApproachFactor(pathDistance);

    if (this.isFirstPerson) {
      const quat = birdQuat || new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
      const eyeOffset = new THREE.Vector3(0, 0.28, 0.48).applyQuaternion(quat);

      this.currentPos.copy(birdPos).add(eyeOffset);

      // Stabilized pitch: use the path angle (not the terrain) below the bird to set camera pitch
      const birdForward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      const birdYaw = Math.atan2(birdForward.x, birdForward.z);
      const pathPitch = Math.asin(THREE.MathUtils.clamp(frame.tangent.y, -1.0, 1.0));
      const cosPitch = Math.cos(pathPitch);
      const aimDir = new THREE.Vector3(
        Math.sin(birdYaw) * cosPitch,
        Math.sin(pathPitch),
        Math.cos(birdYaw) * cosPitch
      ).normalize();

      this.currentLookAt.copy(this.currentPos).addScaledVector(aimDir, 30.0);
      this.camera.up.copy(up);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      this.camera.fov = 78;
      this.camera.updateProjectionMatrix();
      return;
    }

    const shot = SHOT_PRESETS[0];
    const initialCamPos = this.calculateShotPosition(birdPos, frame, shot, this.currentSplitFactor);
    const initialLookAt = this.calculateShotLookAt(birdPos, frame, shot, this.currentSplitFactor);

    this.currentPos.copy(initialCamPos);
    this.currentLookAt.copy(initialLookAt);
    this.applyTerrainAvoidance(this.currentPos, frame);
    this.enforceAbsoluteTerrainClearance(this.currentPos, frame);

    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    const narrow = this.getNarrowScreenFactor();
    const sideIntensity = Math.min(1.0, Math.abs(shot.rightOffset) / 4.8);
    const sideFovBoost = (3.5 + narrow * 8.5) * sideIntensity;
    const splitFovBoost = this.currentSplitFactor * 5.0;
    this.camera.fov = shot.fov + sideFovBoost + splitFovBoost;
    this.camera.updateProjectionMatrix();
  }

  public getNarrowScreenFactor(): number {
    const aspect = this.camera.aspect || (16 / 9);
    // Standard widescreen is >= 1.38.
    // Portrait smartphones are typically 0.46 to 0.58, tablets in portrait are ~0.75.
    return THREE.MathUtils.clamp((1.38 - aspect) / 0.85, 0.0, 1.0);
  }

  /**
   * Calculates how close the bird is to an upcoming split/fork in the path (0 to 1).
   * Decision points occur at 250m, 500m, 750m, etc. (level * LEVEL_LENGTH).
   * As the bird approaches within 48m of the fork, this smoothly ramps up to 1.0,
   * stays at 1.0 through the decision point and initial divergence, then smoothly returns to 0.0
   * after the choice is resolved.
   */
  public calculateSplitApproachFactor(pathDistance: number): number {
    if (pathDistance < 100.0) {
      return 0.0;
    }
    const level = Math.max(0, Math.floor((pathDistance + 50.0) / 250.0) - 1);
    const forkDist = flightPath.getDecisionPointDistance(level);
    const deltaDist = pathDistance - forkDist;

    // If approaching a boundary junction with no split/gusts, maintain standard flight view
    if (flightPath.getForcedBoundaryBranch(level + 1)) {
      return 0.0;
    }

    // Approach window: from 48m before the fork to 38m after the fork
    if (deltaDist < -48.0 || deltaDist > 38.0) {
      return 0.0;
    }

    // Ramps up smoothly as bird approaches between -48m and -12m before the fork
    if (deltaDist < -12.0) {
      const t = (deltaDist + 48.0) / 36.0;
      return t * t * (3 - 2 * t);
    }

    // Sustained full wide view during the fork decision and initial divergence (-12m to +14m)
    if (deltaDist <= 14.0) {
      return 1.0;
    }

    // Smoothly returns to normal after the choice is resolved (+14m to +38m)
    const t = (38.0 - deltaDist) / 24.0;
    return t * t * (3 - 2 * t);
  }

  private calculateShotPosition(
    birdPos: THREE.Vector3,
    frame: PathFrame,
    shot: CameraShotConfig,
    splitFactor: number = 0
  ): THREE.Vector3 {
    const narrow = this.getNarrowScreenFactor();
    const sideIntensity = Math.min(1.0, Math.abs(shot.rightOffset) / 4.8);

    // Whenever the camera is positioned to the side (left or right wing / profile / banking),
    // pull back significantly along -tangent so the upcoming obstacle column and flight corridor
    // remain completely in view ahead of the bird.
    const baseSidePullBack = sideIntensity * 3.8;
    const narrowSidePullBack = narrow * sideIntensity * 4.2;
    const totalSidePullBack = baseSidePullBack + narrowSidePullBack;

    // Preserve wide lateral swing, dampening slightly only on very narrow mobile portrait displays
    const lateralDamping = 1.0 - narrow * 0.16 * sideIntensity;
    // Extra upward elevation to ensure sweeping panoramic sightline over terrain
    const extraUpOffset = sideIntensity * (0.35 + narrow * 0.4);

    // Dynamic curve swing: when the path turns or banks, the camera smoothly swings outward with centrifugal motion
    const curveSwing = THREE.MathUtils.clamp(-frame.curvature * 14.0, -2.2, 2.2);

    // Split approach pull-back:
    // When approaching a split in the path, pull the camera back even further behind the bird,
    // giving a clear, wide view of both diverging paths.
    const splitPullBack = splitFactor * 5.4;
    const splitUpOffset = splitFactor * 1.3;
    const splitLateralDamping = 1.0 - splitFactor * 0.15;

    const totalForwardOffset = shot.forwardOffset - totalSidePullBack - splitPullBack;
    const totalUpOffset = shot.upOffset + extraUpOffset + splitUpOffset;
    const totalRightOffset = (shot.rightOffset * lateralDamping + curveSwing) * splitLateralDamping;

    const pos = birdPos.clone();
    pos.addScaledVector(frame.tangent, totalForwardOffset);
    pos.addScaledVector(frame.up, totalUpOffset);
    pos.addScaledVector(frame.right, totalRightOffset);
    return pos;
  }

  private calculateShotLookAt(
    birdPos: THREE.Vector3,
    frame: PathFrame,
    shot: CameraShotConfig,
    splitFactor: number = 0
  ): THREE.Vector3 {
    const narrow = this.getNarrowScreenFactor();
    const sideIntensity = Math.min(1.0, Math.abs(shot.rightOffset) / 4.8);

    // When on the side, aim further ahead along the path tangent directly towards
    // where the upcoming obstacle column is located, preventing columns from being clipped
    const baseSideLookAhead = sideIntensity * 4.2;
    const narrowSideLookAhead = narrow * sideIntensity * 3.8;
    const totalSideLookAhead = baseSideLookAhead + narrowSideLookAhead;

    // When approaching a split, look ahead down the corridor towards the divergence point
    const splitLookAhead = splitFactor * 3.2;
    const splitLookUp = splitFactor * 0.15;

    const look = birdPos.clone();
    look.addScaledVector(frame.tangent, shot.lookAhead + totalSideLookAhead + splitLookAhead);
    look.addScaledVector(frame.up, shot.lookUp + splitLookUp);
    return look;
  }

  /**
   * Calculates a gentle vertical adjustment for the camera when approaching an obstacle column,
   * so that it passes the column at the height of the gap (gapCenterY).
   * This ensures the column's upper or lower structure won't obscure the view of the bird.
   */
  public calculateColumnGapAdjustment(
    camTargetPos: THREE.Vector3,
    frame: PathFrame,
    pathDistance: number,
    obstacles?: ObstacleData[],
    activeBranch?: 'SINGLE' | 'LEFT' | 'RIGHT'
  ): { upAdjustment: number; weight: number } {
    if (!obstacles || obstacles.length === 0) {
      return { upAdjustment: 0, weight: 0 };
    }

    // Measure the camera's longitudinal offset along the flight path
    // frame.position is at pathDistance along the spline.
    const camForwardOffset = camTargetPos.clone().sub(frame.position).dot(frame.tangent);
    const camDistance = pathDistance + camForwardOffset;

    // Influence window:
    // Start gently adjusting 15.0m before the column, reach full gap height alignment
    // at the moment the camera passes the column (0m), and smoothly return to standard
    // framing 5.0m past the column.
    const approachDist = 15.0;
    const departureDist = 5.0;

    let targetObstacle: ObstacleData | null = null;
    let minAbsDist = Infinity;

    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.branch !== 'SINGLE' && activeBranch && obs.branch !== activeBranch) {
        continue;
      }
      const dist = obs.pathDistance - camDistance;
      if (dist >= -departureDist && dist <= approachDist) {
        const absD = Math.abs(dist);
        if (absD < minAbsDist) {
          minAbsDist = absD;
          targetObstacle = obs;
        }
      }
    }

    if (!targetObstacle) {
      return { upAdjustment: 0, weight: 0 };
    }

    const dist = targetObstacle.pathDistance - camDistance;
    let weight = 0;
    if (dist >= 0) {
      // Approaching: smooth ease-in from approachDist down to 0
      const u = 1.0 - (dist / approachDist);
      weight = u * u * (3.0 - 2.0 * u);
    } else {
      // Departing: smooth ease-out from 0 down to -departureDist
      const u = 1.0 - (-dist / departureDist);
      weight = u * u * (3.0 - 2.0 * u);
    }

    // Camera height along frame.up relative to path center
    const currentCamUp = camTargetPos.clone().sub(frame.position).dot(frame.up);
    const heightDiff = targetObstacle.gapCenterY - currentCamUp;

    return {
      upAdjustment: heightDiff * weight,
      weight,
    };
  }

  /**
   * Proactively avoids camera collision with the terrain (ground, stepped terraces, and rising canyon/mountain walls),
   * ensuring the camera never passes through the terrain while swinging wide to the left or right.
   */
  public applyTerrainAvoidance(pos: THREE.Vector3, frame: PathFrame): void {
    // 1. Proactive ground & terrace clearance check
    // Probe terrain height at center and 4 cardinal offset points around camera
    const probeRadius = 1.35;
    const hCenter = flightPath.getTerrainHeight(pos.x, pos.z);
    const hX1 = flightPath.getTerrainHeight(pos.x + probeRadius, pos.z);
    const hX2 = flightPath.getTerrainHeight(pos.x - probeRadius, pos.z);
    const hZ1 = flightPath.getTerrainHeight(pos.x, pos.z + probeRadius);
    const hZ2 = flightPath.getTerrainHeight(pos.x, pos.z - probeRadius);
    let maxLocalTerrainH = Math.max(hCenter, hX1, hX2, hZ1, hZ2);
    const weightsCenter = flightPath.getBiomeWeights(pos.x, pos.z);
    if (hCenter < WATER_LEVEL || weightsCenter.primary === 'SHALLOW_WATERS' || weightsCenter.primary === 'DEEP_WATERS') {
      maxLocalTerrainH = Math.max(maxLocalTerrainH, WATER_LEVEL);
    }

    const minClearance = 1.5; // Minimum clearance above terrain surface in meters
    const softCushion = 1.2;  // Soft upward repulsion cushion zone
    const safeY = maxLocalTerrainH + minClearance;

    // If within cushion zone or penetrating, apply smooth upward lift
    if (pos.y < safeY + softCushion) {
      if (pos.y <= safeY) {
        pos.y = safeY;
      } else {
        const t = 1.0 - (pos.y - safeY) / softCushion;
        const cushionLift = t * t * (3.0 - 2.0 * t) * softCushion;
        pos.y += cushionLift;
      }
    }

    // 2. Lateral wall / rising slope avoidance
    // When swung out wide to the left or right, check if rising canyon/mountain slopes encroach
    const lateralOffset = (pos.x - frame.position.x) * frame.right.x + (pos.z - frame.position.z) * frame.right.z;
    const absLateral = Math.abs(lateralOffset);

    if (absLateral > 1.2) {
      const sideSign = Math.sign(lateralOffset);
      const probeOutwardDist = 1.6;
      const probeX = pos.x + frame.right.x * sideSign * probeOutwardDist;
      const probeZ = pos.z + frame.right.z * sideSign * probeOutwardDist;
      const hWall = flightPath.getTerrainHeight(probeX, probeZ);

      // If the terrain in the outward direction rises up close to or above camera height
      const encroachment = hWall - (pos.y - 1.2);
      if (encroachment > 0) {
        // Smoothly tuck the lateral offset inward away from the rising wall
        const tuckFactor = Math.min(absLateral - 1.0, encroachment * 0.85);
        if (tuckFactor > 0) {
          pos.addScaledVector(frame.right, -sideSign * tuckFactor);
        }
        // Also gently ride up along the slope if needed
        const slopeRide = Math.min(2.0, encroachment * 0.45);
        pos.y += slopeRide;
      }
    }
  }

  /**
   * Final absolute hard safety clamp to guarantee the camera never penetrates terrain,
   * applied directly to the camera's actual interpolated position.
   */
  public enforceAbsoluteTerrainClearance(pos: THREE.Vector3, frame?: PathFrame): void {
    const probeRadius = 1.0;
    const hCenter = flightPath.getTerrainHeight(pos.x, pos.z);
    const hX1 = flightPath.getTerrainHeight(pos.x + probeRadius, pos.z);
    const hX2 = flightPath.getTerrainHeight(pos.x - probeRadius, pos.z);
    const hZ1 = flightPath.getTerrainHeight(pos.x, pos.z + probeRadius);
    const hZ2 = flightPath.getTerrainHeight(pos.x, pos.z - probeRadius);
    let maxLocalTerrainH = Math.max(hCenter, hX1, hX2, hZ1, hZ2);
    const weightsCenter = flightPath.getBiomeWeights(pos.x, pos.z);
    if (hCenter < WATER_LEVEL || weightsCenter.primary === 'SHALLOW_WATERS' || weightsCenter.primary === 'DEEP_WATERS') {
      maxLocalTerrainH = Math.max(maxLocalTerrainH, WATER_LEVEL);
    }

    const absoluteMinY = maxLocalTerrainH + 1.2;
    if (pos.y < absoluteMinY) {
      pos.y = absoluteMinY;
    }
  }

  public update(
    delta: number,
    birdPos: THREE.Vector3,
    frame: PathFrame,
    verticalVel: number,
    isAlive: boolean,
    pathDistance: number = 0,
    obstacles?: ObstacleData[],
    activeBranch?: 'SINGLE' | 'LEFT' | 'RIGHT',
    birdQuat?: THREE.Quaternion
  ) {
    this.noiseTimer += delta * 1.5;

    if (isAlive) {
      if (this.isFirstPerson) {
        const quat = birdQuat || new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

        // Position camera right at eye height looking forward along beak
        const eyeOffset = new THREE.Vector3(0, 0.28, 0.48).applyQuaternion(quat);
        const targetPos = birdPos.clone().add(eyeOffset);

        // Stabilized pitch: use the path angle (not the terrain) below the bird to set camera pitch
        const birdForward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
        const birdYaw = Math.atan2(birdForward.x, birdForward.z);
        const pathPitch = Math.asin(THREE.MathUtils.clamp(frame.tangent.y, -1.0, 1.0));
        const cosPitch = Math.cos(pathPitch);
        const aimDir = new THREE.Vector3(
          Math.sin(birdYaw) * cosPitch,
          Math.sin(pathPitch),
          Math.cos(birdYaw) * cosPitch
        ).normalize();
        const targetLook = targetPos.clone().addScaledVector(aimDir, 30.0);

        // FOV calculations for First Person (immersive 78° base + speed/punch dynamics)
        this.breakthroughFovPunch = THREE.MathUtils.lerp(this.breakthroughFovPunch, 0, delta * 3.8);
        this.ringFovPunch = THREE.MathUtils.lerp(this.ringFovPunch, 0, delta * 8.5);
        const baseFov = 78.0;
        const targetFov = baseFov - verticalVel * 0.25 + this.breakthroughFovPunch + this.ringFovPunch;
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, THREE.MathUtils.clamp(targetFov, 65, 95), delta * 8.0);
        this.camera.updateProjectionMatrix();

        // Lock camera rigidly to bird head/eye to eliminate position contention and vertical jitter
        this.currentPos.copy(targetPos);
        this.currentLookAt.copy(targetLook);

        // Tactile micro-shake on ring impact
        if (this.ringShakeTimer > 0) {
          this.ringShakeTimer -= delta;
          const shakeProgress = Math.max(0, this.ringShakeTimer / 0.15);
          const shakeAmount = Math.sin(this.ringShakeTimer * 65.0) * this.ringShakeIntensity * shakeProgress;
          this.currentPos.addScaledVector(right, shakeAmount * 0.5);
          this.currentPos.addScaledVector(up, shakeAmount * 0.35);
        }

        // Camera up matches bird's aerodynamic banking orientation
        this.camera.up.copy(up);

        this.camera.position.copy(this.currentPos);
        this.camera.lookAt(this.currentLookAt);
        return;
      }

      // Restoring camera.up for Third Person
      this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 1.0 - Math.exp(-12.0 * delta));

      // 1. Organic cinematic shot drifting
      if (this.isAutoDrift) {
        this.shotTimer += delta;
        if (this.shotTimer >= this.shotDuration) {
          this.shotTimer = 0;
          // Randomize next shot or cycle through varied perspectives (left, right, chase, high drone)
          let nextIndex = (this.currentShotIndex + 1) % SHOT_PRESETS.length;
          // Vary shot duration slightly between 6.5s and 9.5s
          this.shotDuration = 6.5 + Math.random() * 3.0;
          this.targetShotIndex = nextIndex;
          this.transitionAlpha = 0.0;
        }
      }

      // Smooth transition between shots
      if (this.transitionAlpha < 1.0) {
        this.transitionAlpha += delta * 0.85; // smooth ~1.2s transition
        if (this.transitionAlpha >= 1.0) {
          this.transitionAlpha = 1.0;
          this.currentShotIndex = this.targetShotIndex;
        }
      }

      // Smooth split approach factor transition
      const targetSplitFactor = this.calculateSplitApproachFactor(pathDistance);
      this.currentSplitFactor = THREE.MathUtils.lerp(
        this.currentSplitFactor,
        targetSplitFactor,
        1.0 - Math.exp(-4.5 * delta)
      );

      const shotA = SHOT_PRESETS[this.currentShotIndex];
      const shotB = SHOT_PRESETS[this.targetShotIndex];

      const posA = this.calculateShotPosition(birdPos, frame, shotA, this.currentSplitFactor);
      const posB = this.calculateShotPosition(birdPos, frame, shotB, this.currentSplitFactor);
      const targetPos = new THREE.Vector3().lerpVectors(posA, posB, this.transitionAlpha);

      const lookA = this.calculateShotLookAt(birdPos, frame, shotA, this.currentSplitFactor);
      const lookB = this.calculateShotLookAt(birdPos, frame, shotB, this.currentSplitFactor);
      const targetLook = new THREE.Vector3().lerpVectors(lookA, lookB, this.transitionAlpha);

      // Gentle column gap height adjustment:
      // When approaching an obstacle column, gently move the camera up or down as needed
      // so that it passes the column at the height of the gap (gapCenterY),
      // preventing the column from obscuring the view of the bird.
      const gapAdjustment = this.calculateColumnGapAdjustment(
        targetPos,
        frame,
        pathDistance,
        obstacles,
        activeBranch
      );
      targetPos.addScaledVector(frame.up, gapAdjustment.upAdjustment);

      // Subtle organic handheld camera float (gently stabilized when threading through column gap)
      const swayDamping = 1.0 - Math.min(1.0, gapAdjustment.weight * 0.6);
      const swayX = Math.sin(this.noiseTimer * 0.7) * 0.09 * swayDamping;
      const swayY = Math.cos(this.noiseTimer * 0.9) * 0.07 * swayDamping;
      targetPos.addScaledVector(frame.right, swayX);
      targetPos.addScaledVector(frame.up, swayY);

      // Terrain collision avoidance: prevent camera from penetrating ground, terraces, or rising canyon/mountain walls
      this.applyTerrainAvoidance(targetPos, frame);

      // Dynamic FOV compensation for side shots, narrow screens, vertical dive/climb, and split approach
      const narrow = this.getNarrowScreenFactor();
      const currentSideIntensity = Math.min(
        1.0,
        (Math.abs(shotA.rightOffset) * (1 - this.transitionAlpha) + Math.abs(shotB.rightOffset) * this.transitionAlpha) / 4.8
      );
      const sideFovBoost = (3.5 + narrow * 8.5) * currentSideIntensity;
      const splitFovBoost = this.currentSplitFactor * 5.0;

      const baseFov = THREE.MathUtils.lerp(shotA.fov, shotB.fov, this.transitionAlpha) + sideFovBoost + splitFovBoost;
      this.breakthroughFovPunch = THREE.MathUtils.lerp(this.breakthroughFovPunch, 0, delta * 3.8);
      this.ringFovPunch = THREE.MathUtils.lerp(this.ringFovPunch, 0, delta * 8.5);
      const targetFov = baseFov - verticalVel * 0.25 + this.breakthroughFovPunch + this.ringFovPunch;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, THREE.MathUtils.clamp(targetFov, 55, 92), delta * 5);
      this.camera.updateProjectionMatrix();

      // Damped smooth camera follow
      const followDamp = 1.0 - Math.exp(-6.0 * delta);
      this.currentPos.lerp(targetPos, followDamp);
      this.currentLookAt.lerp(targetLook, followDamp);

      // Tactile micro-shake on ring impact
      if (this.ringShakeTimer > 0) {
        this.ringShakeTimer -= delta;
        const shakeProgress = Math.max(0, this.ringShakeTimer / 0.15);
        const shakeAmount = Math.sin(this.ringShakeTimer * 65.0) * this.ringShakeIntensity * shakeProgress;
        this.currentPos.addScaledVector(frame.right, shakeAmount);
        this.currentPos.addScaledVector(frame.up, shakeAmount * 0.55);
      }

      // Enforce absolute clearance on currentPos so it never clips terrain during fast moves
      this.enforceAbsoluteTerrainClearance(this.currentPos, frame);
    } else {
      // Restore camera.up to world vertical
      this.camera.up.set(0, 1, 0);

      // Cinematic Game Over slow drift / orbit around fallen bird
      this.gameOverOrbitAngle += delta * 0.45;
      const orbitDist = 4.2;
      const orbitHeight = 1.6;

      const orbitPos = birdPos.clone().add(
        new THREE.Vector3(
          Math.sin(this.gameOverOrbitAngle) * orbitDist,
          orbitHeight,
          Math.cos(this.gameOverOrbitAngle) * orbitDist
        )
      );

      // If bird is submerged below water level, keep camera comfortably above the water surface looking down
      if (birdPos.y < WATER_LEVEL) {
        orbitPos.y = Math.max(orbitPos.y, WATER_LEVEL + 2.2);
      }

      const orbitLook = birdPos.clone().add(new THREE.Vector3(0, 0.3, 0));

      this.currentPos.lerp(orbitPos, delta * 2.5);
      this.currentLookAt.lerp(orbitLook, delta * 3.5);

      // Enforce absolute clearance during game-over orbit as well
      this.enforceAbsoluteTerrainClearance(this.currentPos, frame);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}
