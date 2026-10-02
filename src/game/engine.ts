import * as THREE from 'three';
import { GameState, GameStats, ObstacleData, CrashInfo, TotemType, CameraMode } from '../types';
import { flightPath, PathFrame, LEVEL_LENGTH, LATERAL_OFFSET } from './pathGenerator';
import { BirdCharacter } from './birdModel';
import { CinematicCameraDirector } from './cameraDirector';
import { EnvironmentManager } from './terrainAndEnvironment';
import { soundManager } from './audio';
import { RecordHorizonManager } from './recordHorizonManager';
import { TotemManager } from './totemManager';
import { RingEffectManager } from './ringEffectManager';
import { TotemTimerBar } from './totemTimerBar';
import { getMapTileCoord } from './mapTile';
import { flightPathHistory, getEnteredStartTiles } from './flightPathHistory';
import { WATER_LEVEL } from '../biomes';

export interface GameEngineCallbacks {
  onStateChange: (state: GameState) => void;
  onScoreUpdate: (score: number, isNewHigh: boolean) => void;
  onStatsUpdate: (stats: GameStats) => void;
  onCameraChange?: (shotName: string) => void;
}

export class GameEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private cameraDirector: CinematicCameraDirector;
  private environment: EnvironmentManager;
  private bird: BirdCharacter;
  private recordHorizonManager: RecordHorizonManager;
  private totemManager: TotemManager;
  public ringEffectManager: RingEffectManager;
  private totemTimerBar: TotemTimerBar;

  // Powerup Buff Abilities (Speed & Immunity)
  private speedTimeRemaining: number = 0;
  private immunityTimeRemaining: number = 0;
  private statsNotifyTimer: number = 0;

  // Camera perspective mode
  private cameraMode: CameraMode = 'THIRD_PERSON';

  // Breakthrough juice & uncharted flight state
  private timeScale: number = 1.0;
  private timeDilationTimer: number = 0;
  private isNewRecordBreach: boolean = false;

  // Game state
  private state: GameState = 'READY';
  private score: number = 0;
  private highScore: number = 0;
  private isNewHighScoreRun: boolean = false;
  private flapsCount: number = 0;
  private timeSinceLastFlap: number = 999;
  private airTime: number = 0;
  private gameOverTime: number = 0;
  private readonly DEATH_INPUT_LOCKOUT_MS: number = 150; // Minimal debounce so the tap that caused death doesn't immediately dismiss

  // Fly-back death animation state
  private deathElapsed: number = 0;
  private deathInitialQuat: THREE.Quaternion = new THREE.Quaternion();
  private deathBackwardQuat: THREE.Quaternion = new THREE.Quaternion();
  private startBirdPos: THREE.Vector3 = new THREE.Vector3();
  private startBirdQuat: THREE.Quaternion = new THREE.Quaternion();
  private deathCrashPos: THREE.Vector3 = new THREE.Vector3();
  private deathCrashDistance: number = 0;
  private flybackStartPos: THREE.Vector3 = new THREE.Vector3();
  private flybackStartDist: number = 0;
  private hasFlybackStarted: boolean = false;
  private deathCamSideSign: number = 1.0;
  private hasReachedStartPos: boolean = false;
  private turnForwardElapsed: number = 0;

  // Physics & flight progress
  private pathDistance: number = 0;
  private forwardSpeed: number = 9.8;
  private verticalVelocity: number = 0;
  private relativeY: number = 0; // vertical offset relative to spline center line

  // Selected Start Level and Horizontal Position (Column 0..5, Level >= 0)
  public startLevel: number = 0;
  public startCol: number = 2; // default center column
  public startDistance: number = 0;
  public startX: number = 0;

  // Branching Flight Path & Lateral Wind Dynamics
  private activeBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE';
  private currentBranchOffset: number = 0;
  private targetBranchOffset: number = 0;
  private branchDriftVelocity: number = 0;
  private gustRollImpulse: number = 0; // Immediate wind roll banking when blown by gust

  private readonly gravity: number = 19.5;
  private readonly flapImpulse: number = 7.2;
  private readonly terminalVelocity: number = -12.5;

  // Game Over crash bounce physics
  private isPillarBounce: boolean = false;
  private pillarBounceDirection: number = 0; // -1 for backward, +1 for forward
  private pillarBounceDistanceTarget: number = 3.2; // clearance past 2x2 column + 4x4 base blocks
  private pillarBounceDistanceTraveled: number = 0;
  private pillarBounceVelocityZ: number = 0;
  private pillarBounceVelocityX: number = 0;
  private pillarBounceVelocityY: number = 0;
  private hitColumnCenter: { x: number; z: number } | null = null;
  private isBirdGrounded: boolean = false;

  // Callbacks
  private callbacks: GameEngineCallbacks;

  // Animation frame
  private animFrameId: number | null = null;
  private lastTime: number = 0;
  private isDestroyed: boolean = false;

  // Ready idle animation
  private idleTime: number = 0;

  // Boundary enforcement tracker for levels with forced return turns
  private lastEnforcedLevel: number = -1;

  constructor(container: HTMLElement, callbacks: GameEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // Load High Score
    try {
      const savedHigh = localStorage.getItem('feather3d_high_score');
      if (savedHigh) {
        this.highScore = parseInt(savedHigh, 10) || 0;
      }
    } catch {
      this.highScore = 0;
    }

    // Three.js Scene & Renderer
    this.scene = new THREE.Scene();
    const width = Math.max(320, container.clientWidth || window.innerWidth || 800);
    const height = Math.max(240, container.clientHeight || window.innerHeight || 600);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'default',
      });
    } catch {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
      });
    }

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Camera Director
    this.cameraDirector = new CinematicCameraDirector(64, width / height);

    // Environment (Pipes, Terrain, Clouds, Trees, Lights)
    this.environment = new EnvironmentManager(this.scene);
    this.environment.setCamera(this.cameraDirector.camera);

    // Bird Character
    this.bird = new BirdCharacter();
    this.scene.add(this.bird.group);

    // Record Horizon Manager (All-time high distance landmark, anticipation & breakthrough juice)
    this.recordHorizonManager = new RecordHorizonManager({
      onBreakthrough: () => {
        this.timeScale = 0.36;
        this.timeDilationTimer = 0.35;
        this.cameraDirector.triggerBreakthroughPunch(8.5);
        this.bird.setUnchartedMode(true);
        this.isNewRecordBreach = true;
      },
    });
    this.scene.add(this.recordHorizonManager.group);

    // Totem Manager (Speed & Immunity ability totems along course)
    this.totemManager = new TotemManager((type: TotemType) => {
      if (type === 'SPEED') {
        this.speedTimeRemaining = 5.0;
        this.cameraDirector.triggerBreakthroughPunch(1.5);
      } else if (type === 'IMMUNITY') {
        this.immunityTimeRemaining = 5.0;
        this.bird.triggerShieldDeflect();
      }
      this.notifyStats();
    });
    this.environment.setTotemManager(this.totemManager);
    this.scene.add(this.totemManager.group);

    // Flat billboard-aligned pill countdown bar hovering under the bird for active totems
    this.totemTimerBar = new TotemTimerBar();
    this.scene.add(this.totemTimerBar.group);

    // Ring Effect Manager (Juicy feedback on touching spinning rings: shockwaves, sparkles, floating +1, dissolve)
    this.ringEffectManager = new RingEffectManager(this.scene);

    // Initial setup
    this.resetGame(true);

    // Start loop
    this.lastTime = performance.now();
    this.animate = this.animate.bind(this);
    this.animFrameId = requestAnimationFrame(this.animate);
  }

  public flap() {
    if (this.state === 'READY') {
      this.startGame();
      return;
    }

    if (this.state === 'PLAYING') {
      this.verticalVelocity = this.flapImpulse;
      this.flapsCount++;
      this.timeSinceLastFlap = 0;
      soundManager.playFlap();
      this.bird.triggerFlapImpulse();

      // Flapping wings triggers Energetic Initial Flutter on any feathers in range.
      // If feathers are already in Soft Initial Flutter mode and the user taps, Energetic mode starts immediately!
      if (this.environment?.featherManager) {
        this.environment.featherManager.onBirdFlap(
          this.bird.group.position,
          this.environment.obstacles
        );
      }
    }
  }

  public startGame() {
    this.state = 'PLAYING';
    this.verticalVelocity = this.flapImpulse * 0.85;
    this.flapsCount = 1;
    this.timeSinceLastFlap = 0;
    this.airTime = 0;
    soundManager.playFlap();
    this.bird.triggerFlapImpulse();
    if (this.environment?.featherManager) {
      this.environment.featherManager.onBirdFlap(
        this.bird.group.position,
        this.environment.obstacles
      );
    }
    this.callbacks.onStateChange('PLAYING');
  }

  /**
   * Returns whether the player is allowed to restart after dying.
   * Enforces a 0.5s (500ms) emotional lockout after death so players can see the death and final score.
   */
  public canRestartAfterDeath(): boolean {
    if (this.state !== 'GAMEOVER') return true;
    return performance.now() - this.gameOverTime >= this.DEATH_INPUT_LOCKOUT_MS;
  }

  public resetGame(force: boolean = false): boolean {
    if (this.state === 'GAMEOVER' && !force) {
      if (!this.canRestartAfterDeath()) {
        return false;
      }
    }

    this.state = 'READY';
    this.score = 0;
    this.flapsCount = 0;
    this.timeSinceLastFlap = 999;
    this.airTime = 0;
    this.pathDistance = this.startDistance;
    this.relativeY = 0;
    this.verticalVelocity = 0;
    this.forwardSpeed = 9.8;
    let startBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE';
    if (this.startLevel > 0) {
      const mapCol = this.startCol + 1;
      const isEven = (this.startLevel + mapCol) % 2 === 0;
      startBranch = isEven ? 'LEFT' : 'RIGHT';
    }
    this.activeBranch = startBranch;
    this.currentBranchOffset = this.startX;
    this.targetBranchOffset = this.startX;
    this.branchDriftVelocity = 0;
    this.gustRollImpulse = 0;
    this.lastEnforcedLevel = -1;

    this.environment.reset(this.startDistance, this.startX);
    if (this.startLevel > 0) {
      flightPath.setStartLevel(this.startLevel, this.startX, this.startCol);
    }
    this.bird.reset();
    if (this.ringEffectManager) {
      this.ringEffectManager.reset();
    }
    this.speedTimeRemaining = 0;
    this.immunityTimeRemaining = 0;
    this.isPillarBounce = false;
    this.pillarBounceDirection = 0;
    this.pillarBounceDistanceTarget = 0;
    this.pillarBounceDistanceTraveled = 0;
    this.pillarBounceVelocityZ = 0;
    this.pillarBounceVelocityX = 0;
    this.pillarBounceVelocityY = 0;
    this.hitColumnCenter = null;
    this.isBirdGrounded = false;
    this.deathElapsed = 0;
    this.hasFlybackStarted = false;
    this.hasReachedStartPos = false;
    this.turnForwardElapsed = 0;
    this.isNewHighScoreRun = false;
    if (this.totemTimerBar) {
      this.totemTimerBar.reset();
    }
    if (this.totemManager) {
      this.totemManager.reset();
      this.totemManager.spawnTotemsAlongTrack();
    }
    this.isNewRecordBreach = false;
    this.timeScale = 1.0;
    this.timeDilationTimer = 0;
    if (this.recordHorizonManager) {
      this.recordHorizonManager.reset();
      this.recordHorizonManager.rebuildHorizonLandmark();
    }

    const frame = flightPath.getFrame(this.startDistance, this.activeBranch);
    const birdPos = frame.position.clone();
    this.bird.group.position.copy(birdPos);
    this.startBirdPos.copy(birdPos);

    // Orient bird along initial forward path
    const forwardDir = frame.tangent.clone();
    let basisRight = frame.right.clone();
    let basisUp = frame.up.clone();
    const m = new THREE.Matrix4();
    m.makeBasis(basisRight, basisUp, forwardDir);
    this.bird.group.quaternion.setFromRotationMatrix(m);
    this.startBirdQuat.copy(this.bird.group.quaternion);

    this.cameraDirector.reset(
      birdPos,
      frame,
      this.startDistance,
      this.bird.group.quaternion,
      this.environment?.obstacles,
      this.activeBranch
    );
    this.bird.setFirstPerson(this.cameraMode === 'FIRST_PERSON');
    this.environment.updateTerrain(
      this.startDistance,
      true,
      0.016,
      this.startX,
      birdPos.y,
      this.cameraDirector.camera.position.x,
      this.cameraDirector.camera.position.z
    );

    this.callbacks.onStateChange('READY');
    this.callbacks.onScoreUpdate(0, false);
    this.notifyStats();
    return true;
  }

  /**
   * Set start level and column position from the map.
   * Immediately moves bird to this spot and sets state to READY,
   * waiting for the player to click Fly to begin.
   */
  public setStartLevel(level: number, col: number = 2) {
    const safeLevel = Math.max(0, Math.floor(level));
    const safeCol = Math.max(0, Math.min(5, Math.floor(col)));

    if (safeLevel > 0) {
      const allFlights = flightPathHistory.getAllFlightPaths();
      const enteredTiles = getEnteredStartTiles(allFlights);
      if (!enteredTiles.has(`${safeLevel}-${safeCol}`)) {
        console.warn(`Tile L${safeLevel}-Col${safeCol + 1} has not been entered at its start yet.`);
        return;
      }
    }

    if (safeLevel === 0) {
      // Level 0 is the special ground origin: always starts at ground start position (startX = 0, startDistance = 0, col = 2)
      this.startLevel = 0;
      this.startCol = 2;
      this.startDistance = 0;
      this.startX = 0;
      this.activeBranch = 'SINGLE';
      flightPath.setStartLevel(0, 0, 2);
    } else {
      // Checkerboard rule for levels >= 1:
      // If (mapLevel + mapCol) is even: path travels from lower right to upper left ('LEFT')
      //   -> starts at bottom-right corner of cell: gx = safeCol + 1, startX = (2 - safeCol) * LATERAL_OFFSET
      // If (mapLevel + mapCol) is odd: path travels from lower left to upper right ('RIGHT')
      //   -> starts at bottom-left corner of cell: gx = safeCol, startX = (3 - safeCol) * LATERAL_OFFSET
      const mapLevel = safeLevel;
      const mapCol = safeCol + 1;
      const isEven = (mapLevel + mapCol) % 2 === 0;
      const startX = isEven
        ? (2 - safeCol) * LATERAL_OFFSET
        : (3 - safeCol) * LATERAL_OFFSET;
      const initialBranch: 'LEFT' | 'RIGHT' = isEven ? 'LEFT' : 'RIGHT';

      this.startLevel = safeLevel;
      this.startCol = safeCol;
      this.startDistance = safeLevel * LEVEL_LENGTH;
      this.startX = startX;
      this.activeBranch = initialBranch;

      flightPath.setStartLevel(safeLevel, startX, safeCol);
    }

    this.resetGame(true);
  }

  public getStartLevel(): { level: number; col: number; distance: number; startX: number } {
    return {
      level: this.startLevel,
      col: this.startCol,
      distance: this.startDistance,
      startX: this.startX,
    };
  }

  public getState(): GameState {
    return this.state;
  }

  public toggleCameraAutoDrift(): boolean {
    const current = this.cameraDirector.getIsAutoDrift();
    this.cameraDirector.setAutoDrift(!current);
    return !current;
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    const isFP = mode === 'FIRST_PERSON';
    this.cameraDirector.setFirstPerson(isFP);
    this.bird.setFirstPerson(isFP);
    this.callbacks.onCameraChange?.(this.cameraDirector.getCurrentShotName());
    this.notifyStats();
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  public toggleCameraMode(): CameraMode {
    const nextMode: CameraMode = this.cameraMode === 'FIRST_PERSON' ? 'THIRD_PERSON' : 'FIRST_PERSON';
    this.setCameraMode(nextMode);
    return nextMode;
  }

  public cycleCameraShot() {
    this.cameraDirector.cycleNextShot();
  }

  public handleResize() {
    if (!this.container || this.isDestroyed) return;
    const width = Math.max(320, this.container.clientWidth || window.innerWidth || 800);
    const height = Math.max(240, this.container.clientHeight || window.innerHeight || 600);

    this.cameraDirector.camera.aspect = width / height;
    this.cameraDirector.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private notifyStats() {
    const isNewHigh = this.score > 0 && (this.isNewHighScoreRun || (this.highScore > 0 ? this.score > this.highScore : true));
    const birdPos = this.bird?.group?.position;
    const mapTile = birdPos ? getMapTileCoord(birdPos.x, birdPos.z) : { tileX: 0, tileZ: 0 };
    const birdPosition = birdPos
      ? { x: birdPos.x, y: birdPos.y, z: birdPos.z }
      : { x: 0, y: 0, z: 0 };

    this.callbacks.onStatsUpdate({
      score: this.score,
      highScore: this.state === 'GAMEOVER' ? Math.max(this.score, this.highScore) : this.highScore,
      distance: Math.max(0, Math.floor(this.pathDistance - this.startDistance)),
      flapsCount: this.flapsCount,
      airTime: Math.floor(this.airTime),
      isNewHigh,
      crashCount: this.environment?.featherManager ? this.environment.featherManager.getCrashCount() : 0,
      recordDistance: this.recordHorizonManager ? this.recordHorizonManager.recordDistance : 136,
      isApproachingRecord: this.recordHorizonManager ? this.recordHorizonManager.isApproaching : false,
      distanceToRecord: this.recordHorizonManager ? this.recordHorizonManager.distanceToRecord : 0,
      isBeyondRecord: this.recordHorizonManager ? this.recordHorizonManager.isBeyondRecord : false,
      metersBeyondRecord: this.recordHorizonManager ? this.recordHorizonManager.metersBeyondRecord : 0,
      isNewRecordBreach: this.isNewRecordBreach,
      activeBuffs: {
        speed: Math.max(0, this.speedTimeRemaining),
        immunity: Math.max(0, this.immunityTimeRemaining),
      },
      mapTile,
      birdPosition,
      startLevel: this.startLevel,
      startCol: this.startCol,
      cameraMode: this.cameraMode,
    });
  }

  private triggerGameOver(crashInfo?: CrashInfo) {
    if (this.state === 'GAMEOVER') return;
    this.state = 'GAMEOVER';
    this.gameOverTime = performance.now();
    this.deathElapsed = 0;
    this.deathCrashDistance = this.pathDistance;
    this.deathCrashPos.copy(this.bird.group.position);
    this.hasFlybackStarted = false;
    this.hasReachedStartPos = false;
    this.turnForwardElapsed = 0;
    this.speedTimeRemaining = 0;
    this.immunityTimeRemaining = 0;
    if (this.totemTimerBar) {
      this.totemTimerBar.hide();
    }
    this.bird.setBuffEffects(false, false);

    const frame = flightPath.getFrame(this.pathDistance, this.activeBranch);
    this.deathInitialQuat.copy(this.bird.group.quaternion);

    // Calculate target orientation facing backwards along path (-frame.tangent) and upright
    const backwardDir = frame.tangent.clone().negate().normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const turnRight = new THREE.Vector3().crossVectors(worldUp, backwardDir).normalize();
    const turnUp = new THREE.Vector3().crossVectors(backwardDir, turnRight).normalize();
    const mTurn = new THREE.Matrix4().makeBasis(turnRight, turnUp, backwardDir);
    this.deathBackwardQuat.setFromRotationMatrix(mTurn);

    // Trigger death camera: pull backwards and up 10m and hold position pointed at bird
    this.cameraDirector.triggerDeathCamera(this.bird.group.position, frame);
    const camToPath = this.cameraDirector.camera.position.clone().sub(frame.position);
    const lateralDot = camToPath.dot(frame.right);
    this.deathCamSideSign = lateralDot >= -0.2 ? 1.0 : -1.0;
    this.bird.setFirstPerson(false);

    // Pillar collision bounce heuristic:
    // Compare the z position of the bird when it hits and the z position of the base of the column.
    // If bird z <= column base z: bounce backward a couple meters before it falls.
    // If bird z > column base z: bounce forward.
    this.isBirdGrounded = false;
    if (crashInfo?.type === 'PILLAR' && crashInfo.hitObstacle) {
      const birdPos = this.bird.group.position;
      const obs = crashInfo.hitObstacle;
      const colX = obs.gateGroup ? obs.gateGroup.position.x : birdPos.x;
      let colZ = obs.gateGroup ? obs.gateGroup.position.z : obs.pathDistance;
      let columnBaseZ = colZ;
      if (obs.baseMesh) {
        const worldPos = new THREE.Vector3();
        obs.baseMesh.getWorldPosition(worldPos);
        columnBaseZ = worldPos.z;
        colZ = worldPos.z;
      }

      this.hitColumnCenter = { x: colX, z: colZ };
      this.isPillarBounce = true;
      this.pillarBounceDirection = birdPos.z <= columnBaseZ ? -1 : 1;

      // Ensure clearance target places bird at least 3.2m away from the column center
      const targetZ = colZ + this.pillarBounceDirection * 3.2;
      this.pillarBounceDistanceTarget = Math.max(2.8, Math.abs(targetZ - birdPos.z));
      this.pillarBounceDistanceTraveled = 0;
      this.pillarBounceVelocityZ = this.pillarBounceDirection * 9.5;

      const dx = birdPos.x - colX;
      this.pillarBounceVelocityX = Math.abs(dx) > 0.1 ? Math.sign(dx) * 1.8 : 0;
      this.pillarBounceVelocityY = 3.8;
    } else {
      this.hitColumnCenter = null;
      this.isPillarBounce = false;
      this.pillarBounceDirection = 0;
      this.pillarBounceDistanceTarget = 0;
      this.pillarBounceDistanceTraveled = 0;
      this.pillarBounceVelocityZ = 0;
      this.pillarBounceVelocityX = 0;
      this.pillarBounceVelocityY = 0;
    }

    // Check if player set a new all-time flight record
    if (this.recordHorizonManager) {
      const beatRecord = this.recordHorizonManager.saveRecordIfBeaten(this.pathDistance);
      if (beatRecord) {
        this.isNewRecordBreach = true;
      }
    }
    this.bird.setUnchartedMode(false);

    // Record prior score crash feather in terrain or on pillar
    if (crashInfo) {
      this.environment.featherManager.recordCrash(crashInfo);
    } else {
      const birdPos = this.bird.group.position;
      const terrainH = flightPath.getTerrainHeight(birdPos.x, birdPos.z);
      const weights = flightPath.getBiomeWeights(birdPos.x, birdPos.z);
      const isWater =
        (weights.waterDeep || 0) > 0.001 ||
        (weights.waterShallow || 0) > 0.001 ||
        weights.primary === 'SHALLOW_WATERS' ||
        weights.primary === 'DEEP_WATERS' ||
        terrainH < WATER_LEVEL;
      const surfaceH = isWater ? Math.max(terrainH, WATER_LEVEL) : terrainH;
      this.environment.featherManager.recordCrash({
        type: 'TERRAIN',
        distance: this.pathDistance,
        branch: this.activeBranch,
        lateralOffset: this.currentBranchOffset,
        worldPos: { x: birdPos.x, y: surfaceH, z: birdPos.z },
      });
    }

    soundManager.playHit();
    this.bird.triggerFeatherExplosion();

    // Dying within range triggers Energetic Initial Flutter on all nearby feathers
    if (this.environment?.featherManager) {
      this.environment.featherManager.onBirdDied(
        this.bird.group.position,
        this.environment.obstacles
      );
    }

    let isNewHigh = false;
    if (this.score > 0 && (this.score > this.highScore || this.isNewHighScoreRun)) {
      this.highScore = Math.max(this.highScore, this.score);
      this.isNewHighScoreRun = true;
      isNewHigh = true;
      try {
        localStorage.setItem('feather3d_high_score', String(this.highScore));
      } catch {
        // Ignore storage errors
      }
      soundManager.playHighScore();
    }

    // Record the flight path actually taken (only recording branches for levels reached)
    const flownDist = Math.max(1, Math.floor(this.pathDistance - this.startDistance));
    const branchesObj: Record<number, 'LEFT' | 'RIGHT'> = {};
    flightPath.chosenBranches.forEach((val, key) => {
      if (key <= this.startLevel || this.pathDistance >= key * LEVEL_LENGTH - 0.5) {
        branchesObj[key] = val;
      }
    });
    flightPathHistory.recordFlight({
      score: this.score,
      distance: flownDist,
      maxLevel: Math.max(this.startLevel, Math.floor(this.pathDistance / LEVEL_LENGTH)),
      branches: branchesObj,
      flapsCount: this.flapsCount,
      durationSeconds: Math.floor(this.airTime),
      startDistance: this.startDistance,
      startX: this.startX,
      startLevel: this.startLevel,
      startCol: this.startCol,
    });

    this.callbacks.onStateChange('GAMEOVER');
    this.notifyStats();
  }

  private animate(now: number) {
    if (this.isDestroyed) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    const rawDelta = Math.min((now - this.lastTime) / 1000, 0.05); // cap at 50ms to prevent huge jumps
    this.lastTime = now;

    // Breakthrough slow-motion hitstop easing
    if (this.timeDilationTimer > 0) {
      this.timeDilationTimer -= rawDelta;
      this.timeScale = THREE.MathUtils.lerp(this.timeScale, 1.0, rawDelta * 3.8);
    } else {
      this.timeScale = 1.0;
    }
    const delta = Math.min(rawDelta * this.timeScale, 0.05);

    // 1. Ready State: gentle cinematic idle bobbing
    if (this.state === 'READY') {
      this.idleTime += delta;
      this.pathDistance = this.startDistance;
      this.relativeY = Math.sin(this.idleTime * 3.5) * 0.35;

      const frame = flightPath.getFrame(this.startDistance, this.activeBranch);
      const birdPos = frame.position.clone().addScaledVector(frame.up, this.relativeY);
      this.bird.group.position.copy(birdPos);

      // Point beak directly along initial path
      const forwardDir = frame.tangent.clone();
      let basisRight = frame.right.clone();
      let basisUp = frame.up.clone();
      const m = new THREE.Matrix4();
      m.makeBasis(basisRight, basisUp, forwardDir);
      this.bird.group.quaternion.setFromRotationMatrix(m);

      this.bird.update(delta, 0, true);
      this.cameraDirector.update(
        delta,
        birdPos,
        frame,
        0,
        true,
        this.startDistance,
        this.environment.obstacles,
        this.activeBranch,
        this.bird.group.quaternion
      );
      this.environment.updateTerrain(
        this.startDistance,
        false,
        delta,
        this.startX,
        birdPos.y,
        this.cameraDirector.camera.position.x,
        this.cameraDirector.camera.position.z
      );
      if (this.environment?.featherManager) {
        this.environment.featherManager.update(
          delta,
          birdPos,
          this.environment.obstacles
        );
      }

      this.statsNotifyTimer += delta;
      if (this.statsNotifyTimer >= 0.1) {
        this.statsNotifyTimer = 0;
        this.notifyStats();
      }

      this.renderer.render(this.scene, this.cameraDirector.camera);
      return;
    }

    // 2. Active Playing Physics Loop
    if (this.state === 'PLAYING') {
      this.airTime += delta;
      this.timeSinceLastFlap += delta;

      // Update active abilities timers
      const hadSpeed = this.speedTimeRemaining > 0;
      const hadImmunity = this.immunityTimeRemaining > 0;

      if (this.speedTimeRemaining > 0) {
        this.speedTimeRemaining = Math.max(0, this.speedTimeRemaining - delta);
      }
      if (this.immunityTimeRemaining > 0) {
        this.immunityTimeRemaining = Math.max(0, this.immunityTimeRemaining - delta);
      }
      this.bird.setBuffEffects(this.speedTimeRemaining > 0, this.immunityTimeRemaining > 0);

      // If a buff expired, notify immediately so HUD clears promptly
      if ((hadSpeed && this.speedTimeRemaining === 0) || (hadImmunity && this.immunityTimeRemaining === 0)) {
        this.notifyStats();
      }

      // Dynamic forward speed: base speed increases with score + 55% speed boost when Speed Totem is active!
      const baseSpeed = 9.8 + Math.min(this.score * 0.15, 3.5);
      this.forwardSpeed = this.speedTimeRemaining > 0 ? baseSpeed * 1.55 : baseSpeed;
      this.pathDistance += this.forwardSpeed * delta;

      // Vertical flight physics
      this.verticalVelocity -= this.gravity * delta;
      if (this.verticalVelocity < this.terminalVelocity) {
        this.verticalVelocity = this.terminalVelocity;
      }
      this.relativeY += this.verticalVelocity * delta;

      // Ceiling soft limiter
      if (this.relativeY > 12.0) {
        this.relativeY = 12.0;
        this.verticalVelocity = -0.5;
      }

      // Boundary check: If entering a level forced by the 3-tile limit (no decision point gusts),
      // ensure the environment and flightPath record the forced turn back toward the middle.
      const currentLevel = Math.max(0, Math.floor(this.pathDistance / LEVEL_LENGTH));
      if (currentLevel > 0 && currentLevel !== this.lastEnforcedLevel) {
        const forced = flightPath.getForcedBoundaryBranch(currentLevel);
        if (forced) {
          this.lastEnforcedLevel = currentLevel;
          this.environment.onBranchSelected(
            forced,
            currentLevel * LEVEL_LENGTH,
            undefined,
            currentLevel
          );
          if (this.recordHorizonManager && !this.recordHorizonManager.hasCrossed) {
            this.recordHorizonManager.rebuildHorizonLandmark();
          }
        }
      }

      // Current level and branch at bird's longitudinal distance
      let birdBranch = flightPath.getBranchAtDistance(this.pathDistance);
      this.activeBranch = birdBranch;
      this.currentBranchOffset = flightPath.getLateralX(this.pathDistance, birdBranch);

      // Update Environment (spawning, culling, terrain streaming, wind gusts)
      const triggeredGust = this.environment.update(
        this.pathDistance,
        this.relativeY,
        delta,
        this.bird.group.position.x,
        birdBranch,
        this.bird.group.position.y,
        this.cameraDirector.camera.position.x,
        this.cameraDirector.camera.position.z
      );
      if (triggeredGust) {
        this.environment.onBranchSelected(
          triggeredGust.direction,
          triggeredGust.pathDistance,
          triggeredGust.baseOffset,
          triggeredGust.tier
        );
        soundManager.playWindGust(triggeredGust.direction);
        this.cameraDirector.triggerBreakthroughPunch(4.0);

        // Tactile wind gust impulse: physically roll the bird into the turn immediately
        this.gustRollImpulse = triggeredGust.direction === 'RIGHT' ? 0.48 : -0.48;

        // Immediately update active branch and branch offset for this frame so there is zero delay
        birdBranch = flightPath.getBranchAtDistance(this.pathDistance);
        this.activeBranch = birdBranch;
        this.currentBranchOffset = flightPath.getLateralX(this.pathDistance, birdBranch);

        // Refresh record barrier alignment for chosen branch path
        if (this.recordHorizonManager && !this.recordHorizonManager.hasCrossed) {
          this.recordHorizonManager.rebuildHorizonLandmark();
        }
      }

      // Check current frame along path for active branch
      const frame = flightPath.getFrame(this.pathDistance, birdBranch);
      const birdPos = frame.position.clone().addScaledVector(frame.up, this.relativeY);
      this.bird.group.position.copy(birdPos);

      // Forward lookahead orientation along flight path trajectory:
      // The bird faces forward along the curving 3D flight corridor ahead,
      // pitching dynamically with vertical climb/dive within natural avian bounds.
      const lookAheadDist = 1.8;
      const branchAhead = flightPath.getBranchAtDistance(this.pathDistance + lookAheadDist);
      const frameAhead = flightPath.getFrame(this.pathDistance + lookAheadDist, branchAhead);

      // Natural aerodynamic climb/dive pitch angle clamped within realistic avian bounds:
      // ~ +22° max climb when flapping, ~ -26° max dive when falling
      const climbRatio = (this.verticalVelocity / Math.max(4.0, this.forwardSpeed)) * 0.45;
      const pitchAngle = THREE.MathUtils.clamp(climbRatio, -0.45, 0.40);

      // Forward direction: path tangent heading ahead + natural climb/dive tilt along frameAhead.up
      const forwardDir = frameAhead.tangent.clone()
        .addScaledVector(frameAhead.up, pitchAngle)
        .normalize();

      // Orthonormal basis: local +Z is forwardDir (beak), local +Y is up, local +X is right
      let basisRight = new THREE.Vector3().crossVectors(frame.up, forwardDir).normalize();
      if (basisRight.lengthSq() < 0.0001) {
        basisRight = frame.right.clone();
      }
      let basisUp = new THREE.Vector3().crossVectors(forwardDir, basisRight).normalize();

      // Aerodynamic banking roll around the forward axis (wing banking into curves)
      this.gustRollImpulse = THREE.MathUtils.lerp(this.gustRollImpulse, 0, 1.0 - Math.exp(-5.5 * delta));
      const curvatureBanking = frame.curvature * 24.0;
      const baseRoll = -THREE.MathUtils.clamp(curvatureBanking, -0.65, 0.65);
      const totalRoll = THREE.MathUtils.clamp(baseRoll + this.gustRollImpulse, -0.75, 0.75);

      basisRight.applyAxisAngle(forwardDir, totalRoll);
      basisUp.applyAxisAngle(forwardDir, totalRoll);

      // Construct orientation matrix from basis and slerp smoothly so beak points directly along selected path
      const m = new THREE.Matrix4();
      m.makeBasis(basisRight, basisUp, forwardDir);
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
      this.bird.group.quaternion.slerp(targetQuat, 1.0 - Math.exp(-14.0 * delta));

      // Update Bird Animations (wings, eyes, tail)
      this.bird.update(delta, this.verticalVelocity, true);

      // Check Collisions
      this.checkCollisions(frame, birdPos);

      // Check Obstacle Passes and Scoring
      this.checkScoring();

      // Update Ring Effects (dissolve animations, shockwaves, sparkles, floating +1, proximity glow)
      if (this.ringEffectManager) {
        this.ringEffectManager.update(
          delta,
          this.pathDistance,
          this.cameraDirector.camera,
          this.environment.obstacles
        );
      }

      // Update Totems (rotation, bobbing, pickup checks)
      if (this.totemManager) {
        this.totemManager.update(delta, this.pathDistance, birdPos, this.activeBranch);
      }

      // Update Record Horizon Manager (anticipation, crossing detection, feather burst, motes)
      if (this.recordHorizonManager) {
        this.recordHorizonManager.update(delta, this.pathDistance, birdPos, true, this.activeBranch);

        // Warm world lighting as you venture deeper into uncharted skies
        if (this.recordHorizonManager.isBeyondRecord) {
          this.environment.setUnchartedLighting(
            Math.min(1.0, this.recordHorizonManager.metersBeyondRecord / 45.0)
          );
        }
      }

      // Update Death Feathers Flutter (aerodynamic wake flutter when bird passes close, anchored at root)
      if (this.environment?.featherManager) {
        this.environment.featherManager.update(
          delta,
          birdPos,
          this.environment.obstacles,
          this.forwardSpeed,
          this.timeSinceLastFlap < 0.40
        );
      }

      // Update Cinematic Camera Director (with path distance for split approach pull-back and column gap alignment)
      this.cameraDirector.update(
        delta,
        birdPos,
        frame,
        this.verticalVelocity,
        true,
        this.pathDistance,
        this.environment.obstacles,
        this.activeBranch,
        this.bird.group.quaternion
      );
      this.callbacks.onCameraChange?.(this.cameraDirector.getCurrentShotName());

      // Update flat billboard-aligned countdown bar under the bird
      if (this.totemTimerBar) {
        this.totemTimerBar.update(
          birdPos,
          this.cameraDirector.camera,
          this.speedTimeRemaining,
          this.immunityTimeRemaining,
          5.0,
          this.cameraMode === 'FIRST_PERSON'
        );
      }

      // Periodically notify UI stats at 10Hz (every 100ms) to prevent React DOM re-render flooding
      this.statsNotifyTimer += delta;
      if (this.statsNotifyTimer >= 0.1) {
        this.statsNotifyTimer = 0;
        this.notifyStats();
      }
    } else if (this.state === 'GAMEOVER') {
      this.deathElapsed += delta;
      const frame = flightPath.getFrame(this.pathDistance, this.activeBranch);

      // (1) Keep Pillar Bounce: recoil horizontally & laterally away from column
      if (this.isPillarBounce && this.pillarBounceDistanceTraveled < this.pillarBounceDistanceTarget) {
        const remainingDist = this.pillarBounceDistanceTarget - this.pillarBounceDistanceTraveled;
        const stepDist = Math.min(remainingDist, Math.abs(this.pillarBounceVelocityZ) * delta);
        const deltaZ = stepDist * this.pillarBounceDirection;
        this.bird.group.position.z += deltaZ;
        this.pillarBounceDistanceTraveled += stepDist;

        // Smoothly decay bounce horizontal velocity
        this.pillarBounceVelocityZ = THREE.MathUtils.lerp(this.pillarBounceVelocityZ, 0, 1.0 - Math.exp(-6.0 * delta));

        // Lateral bounce deflection
        if (Math.abs(this.pillarBounceVelocityX) > 0.01) {
          this.bird.group.position.x += this.pillarBounceVelocityX * delta;
          this.pillarBounceVelocityX = THREE.MathUtils.lerp(this.pillarBounceVelocityX, 0, 1.0 - Math.exp(-5.0 * delta));
        }

        // Slight upward bounce pop that decays into hover
        if (this.pillarBounceVelocityY > 0) {
          this.bird.group.position.y += this.pillarBounceVelocityY * delta;
          this.pillarBounceVelocityY -= 14.0 * delta;
        }
      }

      // Column Clearance Constraint: bird never penetrates pillar mesh during initial bounce
      if (this.hitColumnCenter && this.deathElapsed <= 0.5) {
        const dx = this.bird.group.position.x - this.hitColumnCenter.x;
        const dz = this.bird.group.position.z - this.hitColumnCenter.z;
        const distSq = dx * dx + dz * dz;
        const minClearance = 2.95;

        if (distSq < minClearance * minClearance) {
          if (this.pillarBounceDirection < 0) {
            this.bird.group.position.z = Math.min(this.bird.group.position.z, this.hitColumnCenter.z - minClearance);
          } else if (this.pillarBounceDirection > 0) {
            this.bird.group.position.z = Math.max(this.bird.group.position.z, this.hitColumnCenter.z + minClearance);
          } else {
            const dist = Math.sqrt(distSq) || 0.1;
            this.bird.group.position.x = this.hitColumnCenter.x + (dx / dist) * minClearance;
            this.bird.group.position.z = this.hitColumnCenter.z + (dz / dist) * minClearance;
          }
        }
      }

      const terrainH = flightPath.getTerrainHeight(this.bird.group.position.x, this.bird.group.position.z);
      const minSafeFloor = Math.max(terrainH, WATER_LEVEL) + 0.8;

      if (this.deathElapsed <= 0.5) {
        // (1) Have the bird hover and turn backwards 0.5 seconds
        const t = Math.min(1.0, this.deathElapsed / 0.5);
        const smoothT = t * t * (3 - 2 * t);
        this.bird.group.quaternion.copy(this.deathInitialQuat).slerp(this.deathBackwardQuat, smoothT);

        // Hover in place with gentle floating bob
        const hoverFloat = Math.sin(this.deathElapsed * 10.0) * 0.05;
        this.bird.group.position.y += hoverFloat * delta;
        if (this.bird.group.position.y < minSafeFloor) {
          this.bird.group.position.y = minSafeFloor;
        }

        // Active wing flapping during hover
        this.bird.update(delta, 0, true);
      } else if (!this.hasReachedStartPos && this.deathElapsed <= 0.85) {
        // (1) After 0.5s turn around, quick wing flutter takeoff preparation
        this.bird.group.quaternion.copy(this.deathBackwardQuat);
        this.bird.triggerQuickFlutter(34);

        // Takeoff working animation: small body crouch and upward lift
        const flutterProgress = (this.deathElapsed - 0.5) / 0.35;
        const takeoffCrouch = -Math.sin(flutterProgress * Math.PI * 2.0) * 0.12;
        this.bird.group.position.y += takeoffCrouch * delta;
        if (this.bird.group.position.y < minSafeFloor) {
          this.bird.group.position.y = minSafeFloor;
        }

        this.bird.update(delta * 1.5, 2.0, true);
      } else if (!this.hasReachedStartPos) {
        // Capture initial takeoff state on the very first frame of return flight
        if (!this.hasFlybackStarted) {
          this.hasFlybackStarted = true;
          this.flybackStartPos.copy(this.bird.group.position);
          this.flybackStartDist = Math.max(this.startDistance + 0.1, this.pathDistance);
        }

        const flybackSpeed = this.forwardSpeed; // Constant normal flight speed (9.8 m/s)
        this.pathDistance -= flybackSpeed * delta;

        const totalDist = Math.max(0.1, this.flybackStartDist - this.startDistance);
        const distFlownBack = Math.max(0, this.flybackStartDist - this.pathDistance);
        const distToStart = Math.max(0, this.pathDistance - this.startDistance);

        if (this.pathDistance <= this.startDistance) {
          this.pathDistance = this.startDistance;
          this.bird.group.position.copy(this.startBirdPos);
          this.hasReachedStartPos = true;
          this.turnForwardElapsed = 0;
          this.deathBackwardQuat.copy(this.bird.group.quaternion);
        } else {
          const curFrame = flightPath.getFrame(this.pathDistance, this.activeBranch);

          // 1. Vertical Profile (Y):
          // Cruise right under the cloud layer deck
          const terrainH = flightPath.getTerrainHeight(curFrame.position.x, curFrame.position.z);
          const surfaceH = Math.max(terrainH, WATER_LEVEL);
          const baseCloudUnderdeck = 26.5;
          const justUnderCloudLayer = Math.max(baseCloudUnderdeck, curFrame.position.y + 11.5, surfaceH + 6.5);

          // Ascent is 50% less steep: climb distance is ~115m (or proportional for short runs)
          const climbDist = Math.min(115.0, totalDist * 0.65);
          const climbT = climbDist > 0.01 ? THREE.MathUtils.clamp(distFlownBack / climbDist, 0.0, 1.0) : 1.0;
          const smoothClimb = climbT * climbT * (3.0 - 2.0 * climbT);
          const cruiseY = THREE.MathUtils.lerp(this.flybackStartPos.y, justUnderCloudLayer, smoothClimb);

          // Smooth final approach descent into startBirdPos.y
          const approachDist = Math.min(24.0, totalDist * 0.35);
          const approachT = approachDist > 0.01 ? THREE.MathUtils.clamp(distToStart / approachDist, 0.0, 1.0) : 0.0;
          const smoothApproach = approachT * approachT * (3.0 - 2.0 * approachT);
          const targetY = THREE.MathUtils.lerp(this.startBirdPos.y, cruiseY, smoothApproach);

          // 2. Horizontal Profile (X, Z):
          // Target an x offset of 4 meters toward the direction of the camera to clear all columns
          const camSide = this.deathCamSideSign >= 0 ? 1.0 : -1.0;
          const cruisingX = curFrame.position.x + 4.0 * camSide;

          // The 4-meter camera-side offset occurs within the first 10 meters of the return flight
          const lateralOffsetDist = Math.max(0.1, Math.min(10.0, totalDist * 0.5));
          const lateralT = THREE.MathUtils.clamp(distFlownBack / lateralOffsetDist, 0.0, 1.0);
          const smoothLateral = lateralT * lateralT * (3.0 - 2.0 * lateralT);
          const intermediateX = THREE.MathUtils.lerp(this.flybackStartPos.x, cruisingX, smoothLateral);

          // On final approach settling, smoothly ease back to start position X
          const targetX = THREE.MathUtils.lerp(this.startBirdPos.x, intermediateX, smoothApproach);

          // Smooth longitudinal transition from takeoff Z into flight corridor within the first 10 meters
          const zBlendDist = Math.max(1.0, Math.min(10.0, totalDist * 0.2));
          const zBlendT = THREE.MathUtils.clamp(distFlownBack / zBlendDist, 0.0, 1.0);
          const smoothZBlend = zBlendT * zBlendT * (3.0 - 2.0 * zBlendT);
          const targetZ = THREE.MathUtils.lerp(this.flybackStartPos.z, curFrame.position.z, smoothZBlend);

          // Continuous 3D positioning
          const prevPos = this.bird.group.position.clone();
          this.bird.group.position.set(targetX, targetY, targetZ);

          // 3. Continuous orientation aligned with backward flight velocity:
          const backwardDir = curFrame.tangent.clone().negate().normalize();
          const dy = targetY - prevPos.y;
          const climbSlope = THREE.MathUtils.clamp(dy / Math.max(0.001, flybackSpeed * delta), -0.35, 0.35);
          const flightDir = backwardDir.clone().add(new THREE.Vector3(0, climbSlope, 0)).normalize();

          const worldUp = new THREE.Vector3(0, 1, 0);
          const flightRight = new THREE.Vector3().crossVectors(worldUp, flightDir).normalize();
          const flightUp = new THREE.Vector3().crossVectors(flightDir, flightRight).normalize();
          const flightMatrix = new THREE.Matrix4().makeBasis(flightRight, flightUp, flightDir);
          const targetQuat = new THREE.Quaternion().setFromRotationMatrix(flightMatrix);

          // Smooth quaternion tracking with zero snapping
          this.bird.group.quaternion.slerp(targetQuat, 1.0 - Math.exp(-12.0 * delta));

          // Active wing flapping while flying back (flap twice normal rate as the bird ascends)
          const ascentWeight = 1.0 - smoothClimb;
          const flapSpeedMultiplier = THREE.MathUtils.lerp(1.0, 2.0, ascentWeight);
          this.bird.update(delta, climbSlope * 6.0, true, flapSpeedMultiplier);
        }
      } else {
        // (2) after reaching original position, have bird face forward again before returning to home screen
        this.bird.group.position.copy(this.startBirdPos);
        this.turnForwardElapsed += delta;
        const turnDuration = 0.35;
        const t = Math.min(1.0, this.turnForwardElapsed / turnDuration);
        const smoothT = t * t * (3 - 2 * t);
        this.bird.group.quaternion.copy(this.deathBackwardQuat).slerp(this.startBirdQuat, smoothT);
        this.bird.update(delta, 0, true);

        if (this.turnForwardElapsed >= turnDuration) {
          this.bird.group.quaternion.copy(this.startBirdQuat);
          this.resetGame();
          return;
        }
      }
      if (this.recordHorizonManager) {
        this.recordHorizonManager.update(delta, this.pathDistance, this.bird.group.position, false, this.activeBranch);
      }
      this.cameraDirector.update(
        delta,
        this.bird.group.position,
        frame,
        0,
        false,
        this.pathDistance,
        this.environment.obstacles,
        this.activeBranch,
        this.bird.group.quaternion
      );
      this.environment.updateTerrain(
        this.bird.group.position.z,
        false,
        delta,
        this.bird.group.position.x,
        this.bird.group.position.y,
        this.cameraDirector.camera.position.x,
        this.cameraDirector.camera.position.z
      );
      if (this.environment?.featherManager) {
        this.environment.featherManager.update(
          delta,
          this.bird.group.position,
          this.environment.obstacles
        );
      }
      // Ring acquisition animations continue smoothly during crash and return flight
      if (this.ringEffectManager) {
        this.ringEffectManager.update(
          delta,
          this.pathDistance,
          this.cameraDirector.camera,
          this.environment.obstacles
        );
      }
    }

    // Render 3D Scene
    this.renderer.render(this.scene, this.cameraDirector.camera);
  }

  private checkCollisions(frame: PathFrame, birdPos: THREE.Vector3) {
    const birdRadius = 0.52;
    const pipeRadius = 1.15; // cylinder + rim radius

    // 1. Obstacle Pipes Collision Check (filtered to active branch or single path)
    for (const obs of this.environment.obstacles) {
      // Only test obstacles on the active flight path branch
      if (obs.branch !== 'SINGLE' && obs.branch !== this.activeBranch) {
        continue;
      }

      // If the column was omitted as an obstacle (e.g. pitch > 30 degrees), skip pipe collision
      if (obs.hasColumn === false) {
        continue;
      }

      const distToGate = Math.abs(this.pathDistance - obs.pathDistance);
      if (distToGate < pipeRadius + birdRadius) {
        // We are within longitudinal range of this gate
        const gapHalf = obs.gapHeight / 2;
        const upperThreshold = obs.gapCenterY + gapHalf - birdRadius * 0.8;
        const lowerThreshold = obs.gapCenterY - gapHalf + birdRadius * 0.8;

        if (this.relativeY > upperThreshold) {
          // If immunity is active, deflect off the pipe instead of crashing!
          if (this.immunityTimeRemaining > 0) {
            soundManager.playShieldDeflect();
            this.bird.triggerShieldDeflect();
            this.bird.triggerFeatherExplosion();
            this.relativeY = upperThreshold - 0.25;
            this.verticalVelocity = Math.min(this.verticalVelocity, -3.5);
            return;
          }

          // Bird hit top pipe: top surface (bottom rim of top pipe) vs over gap (upper cylinder)
          const deltaFromGap = this.relativeY - (obs.gapCenterY + gapHalf);
          const pillarZone = deltaFromGap <= 0.85 ? 'TOP_SURFACE' : 'OVER_GAP';

          this.triggerGameOver({
            type: 'PILLAR',
            distance: this.pathDistance,
            branch: obs.branch,
            lateralOffset: obs.lateralOffset,
            worldPos: { x: birdPos.x, y: birdPos.y, z: birdPos.z },
            pillarIndex: obs.columnIndex,
            pillarZone,
            relativeYToGap: this.relativeY - obs.gapCenterY,
            hitObstacle: obs,
            hitAngle: (this.currentBranchOffset - obs.lateralOffset) * 0.15,
          });
          return;
        } else if (this.relativeY < lowerThreshold) {
          // If immunity is active, deflect off the pipe instead of crashing!
          if (this.immunityTimeRemaining > 0) {
            soundManager.playShieldDeflect();
            this.bird.triggerShieldDeflect();
            this.bird.triggerFeatherExplosion();
            this.relativeY = lowerThreshold + 0.25;
            this.verticalVelocity = Math.max(this.verticalVelocity, 5.0);
            return;
          }

          // Bird hit bottom pipe: bottom surface (top rim of bottom pipe) vs under gap (lower cylinder)
          const deltaFromGap = (obs.gapCenterY - gapHalf) - this.relativeY;
          const pillarZone = deltaFromGap <= 0.85 ? 'BOTTOM_SURFACE' : 'UNDER_GAP';

          this.triggerGameOver({
            type: 'PILLAR',
            distance: this.pathDistance,
            branch: obs.branch,
            lateralOffset: obs.lateralOffset,
            worldPos: { x: birdPos.x, y: birdPos.y, z: birdPos.z },
            pillarIndex: obs.columnIndex,
            pillarZone,
            relativeYToGap: this.relativeY - obs.gapCenterY,
            hitObstacle: obs,
            hitAngle: (this.currentBranchOffset - obs.lateralOffset) * 0.15,
          });
          return;
        }
      }
    }

    // 2. Terrain & Water Surface Collision Check
    const terrainH = flightPath.getTerrainHeight(birdPos.x, birdPos.z);
    const weights = flightPath.getBiomeWeights(birdPos.x, birdPos.z);
    const isWater =
      (weights.waterDeep || 0) > 0.001 ||
      (weights.waterShallow || 0) > 0.001 ||
      weights.primary === 'SHALLOW_WATERS' ||
      weights.primary === 'DEEP_WATERS' ||
      terrainH < WATER_LEVEL;
    const surfaceH = isWater ? Math.max(terrainH, WATER_LEVEL) : terrainH;

    if (birdPos.y <= surfaceH + 0.55) {
      // If immunity is active, cushion push upward safely!
      if (this.immunityTimeRemaining > 0) {
        soundManager.playShieldDeflect();
        this.bird.triggerShieldDeflect();
        this.bird.triggerFeatherExplosion();
        this.verticalVelocity = Math.max(this.verticalVelocity, 6.2);
        this.relativeY += 1.2;
        return;
      }

      this.triggerGameOver({
        type: 'TERRAIN',
        distance: this.pathDistance,
        branch: this.activeBranch,
        lateralOffset: this.currentBranchOffset,
        worldPos: { x: birdPos.x, y: surfaceH, z: birdPos.z },
      });
      return;
    }
  }

  private checkScoring() {
    // Check slightly before the pillar center (-0.18m) so ring touch is synchronized with the bird's beak entering the ring
    for (const obs of this.environment.obstacles) {
      if (!obs.passed && this.pathDistance >= obs.pathDistance - 0.18) {
        obs.passed = true;

        // If on active branch or single trunk, increment score
        if (obs.branch === 'SINGLE' || obs.branch === this.activeBranch) {
          this.score++;
          const isBeyond = !!(this.recordHorizonManager && this.recordHorizonManager.isBeyondRecord);

          // Trigger full juicy ring touch feedback!
          if (this.ringEffectManager) {
            this.ringEffectManager.triggerRingTouch(
              obs,
              this.bird.group.position,
              this.cameraDirector,
              this.bird,
              isBeyond
            );
          } else {
            if (isBeyond) {
              soundManager.playUnchartedScore();
            } else {
              soundManager.playScore();
            }
            if (obs.ringMesh) {
              obs.ringMesh.visible = false;
            }
          }

          const isNewHigh = this.score > this.highScore;
          this.callbacks.onScoreUpdate(this.score, isNewHigh);
          this.notifyStats();
        } else {
          // Obstacle on unchosen branch simply becomes inactive without score
          if (obs.ringMesh) {
            obs.ringMesh.visible = false;
          }
        }
      }
    }
  }

  public getFeatherManager() {
    return this.environment.featherManager;
  }

  /**
   * Resets the player's high score, clears all prior crash feathers,
   * resets the record horizon distance, and refreshes the game state.
   */
  public resetAllRecords() {
    this.highScore = 0;
    try {
      localStorage.removeItem('feather3d_high_score');
    } catch {
      // Ignore
    }

    if (this.environment && this.environment.featherManager) {
      this.environment.featherManager.clearAllCrashes();
    }

    if (this.recordHorizonManager) {
      this.recordHorizonManager.clearRecord();
    }

    this.startLevel = 0;
    this.startCol = 2;
    this.startDistance = 0;
    this.startX = 0;
    flightPath.resetStartLevel();
    flightPathHistory.clearAll();

    this.resetGame(true);
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.totemTimerBar) {
      this.totemTimerBar.dispose();
    }
    this.renderer.dispose();
  }
}
