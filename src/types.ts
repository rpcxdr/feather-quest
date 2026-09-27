export type GameState = 'READY' | 'PLAYING' | 'GAMEOVER';

export type CameraAngle = 'CHASE' | 'LEFT_TRACK' | 'RIGHT_TRACK' | 'HIGH_DRONE' | 'LOW_BANK' | 'FIRST_PERSON';

export type CameraMode = 'THIRD_PERSON' | 'FIRST_PERSON';

export interface ActiveBuffs {
  speed: number;    // seconds remaining (0 if inactive)
  immunity: number; // seconds remaining (0 if inactive)
}

export type TotemType = 'SPEED' | 'IMMUNITY';

export interface TotemData {
  id: number;
  type: TotemType;
  pathDistance: number;
  lateralOffset: number;
  branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  relativeY: number;
  collected: boolean;
  group?: any;
  floatGroup?: any;
  orbitRing?: any;
  colA?: ObstacleData;
  colB?: ObstacleData;
}

export interface MapTileCoord {
  tileX: number;
  tileZ: number;
}

export interface BirdPositionCoord {
  x: number;
  y: number;
  z: number;
}

export interface GameStats {
  score: number;
  highScore: number;
  distance: number;
  flapsCount: number;
  airTime: number;
  isNewHigh: boolean;
  crashCount?: number;
  recordDistance?: number;
  isApproachingRecord?: boolean;
  distanceToRecord?: number;
  isBeyondRecord?: boolean;
  metersBeyondRecord?: number;
  isNewRecordBreach?: boolean;
  activeBuffs?: ActiveBuffs;
  mapTile?: MapTileCoord;
  birdPosition?: BirdPositionCoord;
  startLevel?: number;
  startCol?: number;
  cameraMode?: CameraMode;
}

export interface ObstacleData {
  id: number;
  columnIndex: number; // 1, 2, 3...
  pathDistance: number; // distance along the spline curve
  gapCenterY: number;   // vertical center offset relative to the path
  gapHeight: number;    // opening clearance
  passed: boolean;
  branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  lateralOffset: number; // lateral offset in meters from base spine
  tier: number;         // 0 for cols 1-10, 1 for cols 11-20, etc.
  hasColumn?: boolean;  // False if column pillar was omitted due to steep pitch (> 30 deg)
  topPipeMesh?: any;
  bottomPipeMesh?: any;
  ringMesh?: any;
  gateGroup?: any;
  baseMesh?: any;
  featherMeshes?: any[];
}

export type CrashType = 'TERRAIN' | 'PILLAR';

export type PillarCrashZone =
  | 'TOP_SURFACE'    // Bottom rim of top pipe (ceiling of the gap)
  | 'BOTTOM_SURFACE' // Top rim of bottom pipe (floor of the gap)
  | 'OVER_GAP'       // High on the top pipe cylinder above the gap
  | 'UNDER_GAP';     // Low on the bottom pipe cylinder below the gap

export interface CrashRecord {
  id: string;
  timestamp: number;
  type: CrashType;
  distance: number;
  branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  lateralOffset: number;
  
  // Terrain crash coordinates
  terrainX?: number;
  terrainY?: number;
  terrainZ?: number;

  // Pillar crash details
  pillarIndex?: number;    // columnIndex (1, 2, 3...)
  pillarZone?: PillarCrashZone;
  relativeYToGap?: number; // Y offset from gap center
  hitAngle?: number;       // Angle around pillar where bird struck
  localHitX?: number;      // Exact local strike contact X on obstacle
  localHitY?: number;      // Exact local strike contact Y on obstacle
  localHitZ?: number;      // Exact local strike contact Z on obstacle

  // Visual orientation & variation angles
  randomPitch: number;     // Tilt from vertical/surface
  randomYaw: number;       // Rotation around axis
  randomRoll: number;      // Subtle spin along quill
  randomJitterX: number;   // Small positional offset
  randomJitterZ: number;
  featherScale: number;    // Size variation
  colorVariant?: number;   // 0 = golden canary, 1 = sunset amber, 2 = fiery orange
}

export interface CrashInfo {
  type: CrashType;
  distance: number;
  branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  lateralOffset: number;
  worldPos: { x: number; y: number; z: number };
  pillarIndex?: number;
  pillarZone?: PillarCrashZone;
  relativeYToGap?: number;
  hitObstacle?: ObstacleData;
  hitAngle?: number;
}
