import * as THREE from 'three';
import { flightPath, PathFrame } from './pathGenerator';
import { soundManager } from './audio';

const STORAGE_KEY_RECORD_DIST = 'feather3d_furthest_flight_dist';
const INITIAL_DEFAULT_RECORD_DIST = 136.0;

interface GlassShard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface CelestialMote {
  mesh: THREE.Mesh;
  trackDist: number;      // Distance along the flight path
  lateralOffset: number;  // Offset from stable path centerline
  heightOffset: number;   // Height above stable path / terrain
  phase: number;
  spinSpeed: number;
}

export class RecordHorizonManager {
  public group: THREE.Group;
  public recordDistance: number;
  public isApproaching: boolean = false;
  public hasCrossed: boolean = false;
  public isBeyondRecord: boolean = false;
  public distanceToRecord: number = 999;
  public metersBeyondRecord: number = 0;

  // Translucent Flat Barrier Meshes
  private barrierGroups: THREE.Group[] = [];
  private flatBarrierPlanes: THREE.Mesh[] = [];
  private barrierVisualMeshes: THREE.Object3D[] = [];
  private shockwaveRings: THREE.Mesh[] = [];

  // Shattered glass shards on breakthrough
  private shardsGroup: THREE.Group;
  private shards: GlassShard[] = [];
  private isExploding: boolean = false;
  private shockwaveScale: number = 1.0;
  private shockwaveAlpha: number = 0.0;

  // Stable Celestial Ambient Motes (linked to stable terrain)
  private celestialMotesGroup: THREE.Group;
  private celestialMotes: CelestialMote[] = [];

  // Audio / Tension timers
  private approachPingTimer: number = 0;
  private nextMilestoneDistance: number = 50;
  private animTimer: number = 0;

  // Callbacks for breakthrough & uncharted milestones
  private onBreakthroughCallback?: (recordDist: number) => void;
  private onMilestoneCallback?: (metersBeyond: number) => void;

  constructor(callbacks?: {
    onBreakthrough?: (recordDist: number) => void;
    onMilestone?: (metersBeyond: number) => void;
  }) {
    this.group = new THREE.Group();
    this.onBreakthroughCallback = callbacks?.onBreakthrough;
    this.onMilestoneCallback = callbacks?.onMilestone;

    this.shardsGroup = new THREE.Group();
    this.celestialMotesGroup = new THREE.Group();

    this.group.add(this.shardsGroup);
    this.group.add(this.celestialMotesGroup);

    // Load or calculate all-time record distance
    this.recordDistance = this.loadAllTimeRecord();

    this.initCelestialMotes();
    this.rebuildHorizonLandmark();
  }

  /**
   * Loads the all-time furthest flight record from persistent storage or history
   */
  private loadAllTimeRecord(): number {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RECORD_DIST);
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val > 30) {
          return Math.round(val);
        }
      }

      // Check prior crash history
      const crashData = localStorage.getItem('feather3d_prior_crashes');
      if (crashData) {
        const crashes = JSON.parse(crashData);
        if (Array.isArray(crashes) && crashes.length > 0) {
          const maxCrashDist = Math.max(...crashes.map((c: { distance?: number }) => c.distance || 0));
          if (maxCrashDist > 40) {
            return Math.round(maxCrashDist);
          }
        }
      }

      // Check high score
      const hs = localStorage.getItem('feather3d_high_score');
      if (hs) {
        const score = parseInt(hs, 10);
        if (score > 0) {
          return Math.round(score * 28.0 + 38.0);
        }
      }
    } catch {
      // Storage access fallback
    }

    return INITIAL_DEFAULT_RECORD_DIST;
  }

  /**
   * Updates and saves the all-time furthest record if current flight exceeded it
   */
  public saveRecordIfBeaten(currentDistance: number): boolean {
    if (currentDistance > this.recordDistance) {
      this.recordDistance = Math.round(currentDistance);
      try {
        localStorage.setItem(STORAGE_KEY_RECORD_DIST, String(this.recordDistance));
      } catch {
        // Ignore storage errors
      }
      return true;
    }
    return false;
  }

  /**
   * Clears the stored all-time furthest record and resets the horizon barrier to default
   */
  public clearRecord() {
    try {
      localStorage.removeItem(STORAGE_KEY_RECORD_DIST);
    } catch {
      // Ignore
    }
    this.recordDistance = INITIAL_DEFAULT_RECORD_DIST;
    this.reset();
    this.rebuildHorizonLandmark();
  }

  /**
   * Initializes floating celestial motes for uncharted airspace.
   * Their orientation is strictly linked to the stable terrain / world,
   * completely decoupled from the bird's pitch, yaw, or roll.
   */
  private initCelestialMotes() {
    const moteGeo = new THREE.OctahedronGeometry(0.09, 0);
    const moteColors = [0x38bdf8, 0xfacc15, 0x67e8f9, 0xa78bfa, 0x34d399];

    for (let i = 0; i < 42; i++) {
      const col = moteColors[i % moteColors.length];
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0,
        wireframe: i % 3 === 0,
      });
      const mesh = new THREE.Mesh(moteGeo, mat);
      mesh.visible = false;
      this.celestialMotesGroup.add(mesh);

      // Stagger initial distribution ahead of the record mark
      const trackDist = this.recordDistance + (i / 42) * 60;
      const lateralOffset = (Math.random() - 0.5) * 14.0;
      const heightOffset = (Math.random() - 0.5) * 6.0;

      this.celestialMotes.push({
        mesh,
        trackDist,
        lateralOffset,
        heightOffset,
        phase: Math.random() * Math.PI * 2,
        spinSpeed: 0.6 + Math.random() * 1.2,
      });
    }
  }

  /**
   * Rebuilds the flat translucent barrier across the flight corridor at the current record distance
   */
  public rebuildHorizonLandmark() {
    // Clear existing barrier meshes
    for (const b of this.barrierGroups) {
      this.group.remove(b);
    }
    this.barrierGroups = [];
    this.flatBarrierPlanes = [];
    this.barrierVisualMeshes = [];
    this.shockwaveRings = [];

    // Clear shards
    while (this.shardsGroup.children.length > 0) {
      this.shardsGroup.remove(this.shardsGroup.children[0]);
    }
    this.shards = [];

    // Determine active flight branches at the record distance
    const branches = flightPath.getActiveBranchesAt(this.recordDistance);
    const activeBranches = branches.length > 0 ? branches : [{ branch: 'SINGLE' as const, offset: 0, point: new THREE.Vector3(), isVeering: false }];

    for (const branchInfo of activeBranches) {
      const bGroup = this.createFlatBarrierForBranch(this.recordDistance, branchInfo.branch);
      this.barrierGroups.push(bGroup);
      this.group.add(bGroup);
    }

    // Reset mote positions to start from the new record distance
    for (let i = 0; i < this.celestialMotes.length; i++) {
      const mote = this.celestialMotes[i];
      mote.trackDist = this.recordDistance + (i / this.celestialMotes.length) * 60;
    }
  }

  /**
   * Creates a sleek translucent flat barrier spanning the corridor at the specified distance.
   * Extends down seamlessly to well below the terrain with no floating gap.
   */
  private createFlatBarrierForBranch(dist: number, branch: 'SINGLE' | 'LEFT' | 'RIGHT'): THREE.Group {
    const barrierGroup = new THREE.Group();
    const frame = flightPath.getFrame(dist, branch);
    const centerPos = frame.position.clone();

    // Position barrier centered on the flight path
    barrierGroup.position.copy(centerPos);

    // Orientation alignment with flight path tangent and normal (flat perpendicular wall)
    const rotMat = new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
    barrierGroup.setRotationFromMatrix(rotMat);

    const barrierWidth = 16.0;

    // Sample terrain across the corridor width at this cross-section to find lowest terrain elevation
    let minTerrainY = flightPath.getTerrainHeight(centerPos.x, centerPos.z);
    for (let offset = -barrierWidth * 0.5; offset <= barrierWidth * 0.5; offset += 2.0) {
      const worldSamplePt = centerPos.clone().addScaledVector(frame.right, offset);
      const sampleTerrainH = flightPath.getTerrainHeight(worldSamplePt.x, worldSamplePt.z);
      if (sampleTerrainH < minTerrainY) {
        minTerrainY = sampleTerrainH;
      }
    }

    // Extend the panel all the way down to well below the terrain
    const topLocalY = 13.0; // Spans high above the flight corridor
    const targetBottomWorldY = Math.min(minTerrainY - 12.0, -15.0);
    const bottomLocalY = Math.min(-30.0, (targetBottomWorldY - centerPos.y) / Math.max(0.5, frame.up.y));
    const barrierHeight = topLocalY - bottomLocalY;
    const centerY = (topLocalY + bottomLocalY) * 0.5;

    // 1. Translucent Flat Energy Barrier Plane extending from high sky to below the terrain
    const planeGeo = new THREE.PlaneGeometry(barrierWidth, barrierHeight, 1, 1);
    const planeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const flatBarrier = new THREE.Mesh(planeGeo, planeMat);
    flatBarrier.position.set(0, centerY, 0); // Spans from above corridor to below terrain
    barrierGroup.add(flatBarrier);
    this.flatBarrierPlanes.push(flatBarrier);
    this.barrierVisualMeshes.push(flatBarrier);

    // 2. Sleek perimeter border frame around the barrier
    const frameBorderMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.85,
    });

    const borderThickness = 0.12;
    // Top bar
    const topBarGeo = new THREE.BoxGeometry(barrierWidth + borderThickness * 2, borderThickness, 0.15);
    const topBar = new THREE.Mesh(topBarGeo, frameBorderMat);
    topBar.position.set(0, topLocalY, 0);
    barrierGroup.add(topBar);
    this.barrierVisualMeshes.push(topBar);

    // Bottom bar (buried subterranean below terrain)
    const botBar = new THREE.Mesh(topBarGeo, frameBorderMat);
    botBar.position.set(0, bottomLocalY, 0);
    barrierGroup.add(botBar);
    this.barrierVisualMeshes.push(botBar);

    // Left & Right side bars extending the full height from top to below terrain
    const sideBarGeo = new THREE.BoxGeometry(borderThickness, barrierHeight, 0.15);
    const leftBar = new THREE.Mesh(sideBarGeo, frameBorderMat);
    leftBar.position.set(-barrierWidth / 2, centerY, 0);
    barrierGroup.add(leftBar);
    this.barrierVisualMeshes.push(leftBar);

    const rightBar = new THREE.Mesh(sideBarGeo, frameBorderMat);
    rightBar.position.set(barrierWidth / 2, centerY, 0);
    barrierGroup.add(rightBar);
    this.barrierVisualMeshes.push(rightBar);

    // Subtle horizontal glowing energy grid lines across the barrier
    const gridLineMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
    });
    for (let y = Math.ceil(bottomLocalY / 3) * 3; y <= topLocalY - 1; y += 3) {
      const lineGeo = new THREE.BoxGeometry(barrierWidth - 0.4, 0.04, 0.02);
      const lineMesh = new THREE.Mesh(lineGeo, gridLineMat);
      lineMesh.position.set(0, y, 0.01);
      barrierGroup.add(lineMesh);
      this.barrierVisualMeshes.push(lineMesh);
    }

    // 3. Soft ambient point light radiating from the barrier
    const barrierLight = new THREE.PointLight(0x38bdf8, 1.8, 22);
    barrierLight.position.set(0, 5.0, 0);
    barrierGroup.add(barrierLight);

    // 4. Planar Shockwave Ring (triggered on breakthrough)
    const shockGeo = new THREE.RingGeometry(1.0, 1.45, 36);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockMesh = new THREE.Mesh(shockGeo, shockMat);
    shockMesh.position.set(0, 5.0, 0.02);
    shockMesh.visible = false;
    barrierGroup.add(shockMesh);
    this.shockwaveRings.push(shockMesh);

    return barrierGroup;
  }

  /**
   * Triggers the breakthrough glass shattering explosion when player crosses the record
   */
  private triggerBreakthrough(birdPos: THREE.Vector3, birdBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE') {
    this.hasCrossed = true;
    this.isBeyondRecord = true;
    this.isExploding = true;
    this.shockwaveScale = 1.0;
    this.shockwaveAlpha = 1.0;

    // Disappear all flat barrier planes and frame/grid visual meshes
    for (const m of this.barrierVisualMeshes) {
      m.visible = false;
    }

    // Play sounds: realistic glass shattering crack + triumphant fanfare
    soundManager.playGlassBreak();
    soundManager.playRecordBreakthrough();

    // Spawn 32 translucent triangular glass shards bursting forward
    while (this.shardsGroup.children.length > 0) {
      this.shardsGroup.remove(this.shardsGroup.children[0]);
    }
    this.shards = [];

    const frame = flightPath.getFrame(this.recordDistance, birdBranch);
    const forwardDir = frame.tangent.clone().normalize();

    // Pre-create sharp triangular shard geometry
    const shardGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, 0, 0,
      0.4, 0.8, 0,
      -0.3, 0.7, 0,
    ]);
    shardGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    shardGeo.computeVertexNormals();

    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x0284c7,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(shardGeo, shardMat.clone());

      // Start near the bird's breach position
      mesh.position.copy(birdPos);
      mesh.position.x += (Math.random() - 0.5) * 3.5;
      mesh.position.y += (Math.random() - 0.5) * 3.5;
      mesh.position.z += (Math.random() - 0.5) * 1.0;

      const scale = 0.6 + Math.random() * 1.0;
      mesh.scale.setScalar(scale);

      // Radial outward blast + forward momentum along flight path
      const angle = (i / 32) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const radialSpeed = 4.0 + Math.random() * 6.5;
      const forwardSpeed = 8.0 + Math.random() * 9.0;

      const vel = forwardDir.clone().multiplyScalar(forwardSpeed);
      vel.addScaledVector(frame.right, Math.cos(angle) * radialSpeed);
      vel.addScaledVector(frame.up, Math.sin(angle) * radialSpeed * 0.8 + 2.0);

      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0
      );

      this.shardsGroup.add(mesh);
      this.shards.push({
        mesh,
        vel,
        rotVel,
        life: 0,
        maxLife: 1.6 + Math.random() * 0.8,
      });
    }

    if (this.onBreakthroughCallback) {
      this.onBreakthroughCallback(this.recordDistance);
    }
  }

  /**
   * Main per-frame update loop
   */
  public update(
    delta: number,
    pathDistance: number,
    birdPos: THREE.Vector3,
    isAlive: boolean,
    birdBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE'
  ) {
    this.animTimer += delta;

    // 1. Check Anticipation (Approaching within 60 meters)
    const distToRecord = this.recordDistance - pathDistance;
    this.distanceToRecord = Math.max(0, Math.floor(distToRecord));

    if (!this.hasCrossed && isAlive) {
      if (distToRecord <= 60 && distToRecord > 0) {
        this.isApproaching = true;
        const tensionRatio = Math.max(0, Math.min(1, 1.0 - distToRecord / 60));

        // Tension audio ping interval narrows from 1.1s down to 0.35s
        const pingInterval = 1.1 - tensionRatio * 0.75;
        this.approachPingTimer += delta;
        if (this.approachPingTimer >= pingInterval) {
          this.approachPingTimer = 0;
          soundManager.playRecordApproach(tensionRatio);
        }

        // Barrier shimmering pulse as player draws near
        for (const plane of this.flatBarrierPlanes) {
          const mat = plane.material as THREE.MeshStandardMaterial;
          mat.opacity = 0.42 + Math.sin(this.animTimer * 5.0) * 0.12 + tensionRatio * 0.18;
        }
      } else {
        this.isApproaching = false;
        this.approachPingTimer = 0;
      }

      // 2. Check Breakthrough (Crossing the threshold line)
      if (pathDistance >= this.recordDistance) {
        this.triggerBreakthrough(birdPos, birdBranch);
      }
    }

    // 3. Update Breakthrough Glass Shards & Expanding Shockwave Ring
    if (this.isExploding) {
      this.shockwaveScale += delta * 18.0;
      this.shockwaveAlpha = Math.max(0, this.shockwaveAlpha - delta * 1.6);

      for (const ring of this.shockwaveRings) {
        ring.visible = true;
        ring.scale.setScalar(this.shockwaveScale);
        (ring.material as THREE.MeshBasicMaterial).opacity = this.shockwaveAlpha;
      }

      for (const s of this.shards) {
        if (s.mesh.visible) {
          s.life += delta;
          if (s.life >= s.maxLife) {
            s.mesh.visible = false;
          } else {
            const progress = s.life / s.maxLife;
            s.vel.y -= 9.8 * delta; // Gravity
            s.vel.x *= 0.97;        // Drag
            s.vel.z *= 0.97;
            s.mesh.position.addScaledVector(s.vel, delta);
            s.mesh.rotation.x += s.rotVel.x * delta;
            s.mesh.rotation.y += s.rotVel.y * delta;
            s.mesh.rotation.z += s.rotVel.z * delta;

            (s.mesh.material as THREE.MeshStandardMaterial).opacity = (1.0 - progress) * 0.85;
          }
        }
      }

      if (this.shockwaveAlpha <= 0 && this.shards.every((s) => !s.mesh.visible)) {
        this.isExploding = false;
      }
    }

    // 4. Flying Beyond in Uncharted Airspace:
    // Update Celestial Ambient Motes.
    // Their orientation and positions are strictly linked to the stable terrain / flight path,
    // completely decoupled from the bird's pitch, yaw, roll, or vertical hops.
    if (this.isBeyondRecord && isAlive) {
      const beyond = Math.max(0, Math.floor(pathDistance - this.recordDistance));
      this.metersBeyondRecord = beyond;

      // Check +50m milestones
      if (beyond >= this.nextMilestoneDistance) {
        soundManager.playUnchartedMilestone();
        if (this.onMilestoneCallback) {
          this.onMilestoneCallback(beyond);
        }
        this.nextMilestoneDistance += 50;
      }

      // Populate motes along the stable terrain / path corridor ahead and around
      for (let i = 0; i < this.celestialMotes.length; i++) {
        const mote = this.celestialMotes[i];

        // If mote has fallen too far behind player, advance it smoothly ahead
        if (mote.trackDist < pathDistance - 15) {
          mote.trackDist = pathDistance + 35 + (i / this.celestialMotes.length) * 25;
          mote.lateralOffset = (Math.random() - 0.5) * 13.0;
          mote.heightOffset = (Math.random() - 0.5) * 5.5;
        }

        // Sample stable point along flight path centerline (stable terrain frame)
        const frame = flightPath.getFrame(mote.trackDist, birdBranch, mote.lateralOffset);
        const stableCenter = frame.position.clone();

        // Add stable height above terrain
        const terrainH = flightPath.getTerrainHeight(stableCenter.x, stableCenter.z);
        const targetY = Math.max(stableCenter.y + mote.heightOffset, terrainH + 2.0);

        // Gentle ambient vertical drift over time
        const driftY = Math.sin(this.animTimer * 1.5 + mote.phase) * 0.45;
        mote.mesh.position.set(stableCenter.x, targetY + driftY, stableCenter.z);

        // ORIENTATION: Strictly linked to the stable terrain (World Y axis up)
        // Zero pitch, zero roll, zero bird banking influence!
        mote.mesh.rotation.x = 0;
        mote.mesh.rotation.z = 0;
        mote.mesh.rotation.y = this.animTimer * mote.spinSpeed + mote.phase;

        mote.mesh.visible = true;
        const mat = mote.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.55 + Math.sin(this.animTimer * 2.0 + mote.phase) * 0.3;
      }
    } else {
      for (const mote of this.celestialMotes) {
        mote.mesh.visible = false;
      }
    }
  }

  /**
   * Resets session state for a fresh flight
   */
  public reset() {
    this.hasCrossed = false;
    this.isBeyondRecord = false;
    this.isApproaching = false;
    this.distanceToRecord = 999;
    this.metersBeyondRecord = 0;
    this.nextMilestoneDistance = 50;
    this.approachPingTimer = 0;
    this.isExploding = false;

    // Reset flat barrier visibility
    for (const m of this.barrierVisualMeshes) {
      m.visible = true;
    }
    for (const plane of this.flatBarrierPlanes) {
      (plane.material as THREE.MeshStandardMaterial).opacity = 0.45;
    }

    for (const ring of this.shockwaveRings) {
      ring.visible = false;
    }

    for (const s of this.shards) {
      s.mesh.visible = false;
    }

    for (const mote of this.celestialMotes) {
      mote.mesh.visible = false;
    }
  }
}
