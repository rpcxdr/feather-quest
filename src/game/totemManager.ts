import * as THREE from 'three';
import { TotemType, TotemData, ObstacleData } from '../types';
import { soundManager } from './audio';

interface TotemBurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class TotemManager {
  public group: THREE.Group;
  public totems: TotemData[] = [];
  private burstGroup: THREE.Group;
  private burstParticles: TotemBurstParticle[] = [];
  private animTimer: number = 0;
  private onCollectCallback?: (type: TotemType) => void;
  private totemIdCounter: number = 0;

  // Scratch vector to avoid per-frame allocations
  private scratchPos: THREE.Vector3 = new THREE.Vector3();

  // Shared reusable geometries & materials
  private pedestalGeo: THREE.CylinderGeometry;
  private pedestalMat: THREE.MeshStandardMaterial;

  // Speed Totem Materials
  private speedCoreGeo: THREE.OctahedronGeometry;
  private speedCoreMat: THREE.MeshStandardMaterial;
  private speedWingGeo: THREE.BoxGeometry;
  private speedWingMat: THREE.MeshStandardMaterial;
  private speedRingGeo: THREE.TorusGeometry;
  private speedRingMat: THREE.MeshBasicMaterial;
  private chevronGeo: THREE.ConeGeometry;

  // Immunity Totem Materials
  private immunityCoreGeo: THREE.DodecahedronGeometry;
  private immunityCoreMat: THREE.MeshStandardMaterial;
  private immunityShieldGeo: THREE.BoxGeometry;
  private immunityShieldMat: THREE.MeshStandardMaterial;
  private immunityRingGeo: THREE.TorusGeometry;
  private immunityRingMat: THREE.MeshBasicMaterial;
  private crestGeo: THREE.DodecahedronGeometry;

  // Pre-allocated Burst Particle Pool Geometries & Materials
  private burstGeo: THREE.OctahedronGeometry;
  private burstSpeedMat: THREE.MeshBasicMaterial;
  private burstImmunityMat: THREE.MeshBasicMaterial;

  constructor(onCollect?: (type: TotemType) => void) {
    this.group = new THREE.Group();
    this.burstGroup = new THREE.Group();
    this.group.add(this.burstGroup);
    this.onCollectCallback = onCollect;

    // Pedestal
    this.pedestalGeo = new THREE.CylinderGeometry(0.32, 0.42, 0.35, 8);
    this.pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.4,
    });

    // Speed Totem (Cyan aerodynamic core + swept winglets + spinning halo)
    this.speedCoreGeo = new THREE.OctahedronGeometry(0.35, 0);
    this.speedCoreMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x22d3ee,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.6,
    });
    this.speedWingGeo = new THREE.BoxGeometry(0.08, 0.38, 0.22);
    this.speedWingMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      roughness: 0.3,
      metalness: 0.5,
    });
    this.speedRingGeo = new THREE.TorusGeometry(0.55, 0.035, 8, 20);
    this.speedRingMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.85,
    });
    this.chevronGeo = new THREE.ConeGeometry(0.14, 0.35, 4);

    // Immunity Totem (Golden Emerald aegis core + shield guards + radiant halo)
    this.immunityCoreGeo = new THREE.DodecahedronGeometry(0.32, 0);
    this.immunityCoreMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x34d399,
      emissiveIntensity: 1.25,
      roughness: 0.2,
      metalness: 0.7,
    });
    this.immunityShieldGeo = new THREE.BoxGeometry(0.1, 0.42, 0.28);
    this.immunityShieldMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.8,
    });
    this.immunityRingGeo = new THREE.TorusGeometry(0.55, 0.035, 8, 20);
    this.immunityRingMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.85,
    });
    this.crestGeo = new THREE.DodecahedronGeometry(0.16, 0);

    // Initialize Pre-allocated Burst Particle Pool (32 meshes, zero runtime allocations)
    this.burstGeo = new THREE.OctahedronGeometry(0.12, 0);
    this.burstSpeedMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 1.0,
    });
    this.burstImmunityMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 1.0,
    });

    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(this.burstGeo, this.burstSpeedMat);
      mesh.visible = false;
      this.burstGroup.add(mesh);
      this.burstParticles.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.65,
      });
    }
  }

  /**
   * Kept for backwards compatibility. Totems are dynamically spawned and aligned
   * between consecutive columns as obstacles are generated.
   */
  public spawnTotemsAlongTrack() {
    // Dynamic column-pairing system is active.
  }

  /**
   * Checks if a newly spawned obstacle forms an eligible consecutive pair (e.g. 1-2, 3-4, 5-6, 11-12, 13-14)
   * on the chosen or unchosen flight path, and if so, places a totem between them along their virtual flight line.
   */
  public checkAndSpawnTotem(newObs: ObstacleData, obstacles: ObstacleData[]) {
    // Totems are placed between consecutive pairs: column 1 & 2, 3 & 4, 5 & 6, 7 & 8, 9 & 10, 11 & 12, etc.
    if (newObs.columnIndex % 2 !== 0) return;

    const prevColIndex = newObs.columnIndex - 1;
    const obsA = obstacles.find(
      (o) => o.columnIndex === prevColIndex && o.branch === newObs.branch
    );
    if (!obsA) return;

    // Check if a totem already exists between these two columns
    const alreadyExists = this.totems.some(
      (t) => (t.colA === obsA && t.colB === newObs) || (t.colA === newObs && t.colB === obsA)
    );
    if (alreadyExists) return;

    // Determine alternating ability types for the pair
    const pairIndex = Math.floor(newObs.columnIndex / 2);
    let type: TotemType;
    if (newObs.branch === 'SINGLE') {
      type = pairIndex % 2 === 1 ? 'SPEED' : 'IMMUNITY';
    } else if (newObs.branch === 'LEFT') {
      type = pairIndex % 2 === 1 ? 'SPEED' : 'IMMUNITY';
    } else {
      // Complementary ability on RIGHT branch so players choose their powerup
      type = pairIndex % 2 === 1 ? 'IMMUNITY' : 'SPEED';
    }

    this.totemIdCounter++;
    this.createTotem(this.totemIdCounter, type, obsA, newObs, newObs.branch);
  }

  /**
   * Calculates the virtual line connecting the flight openings of Column A and Column B,
   * and positions/orients the totem directly between them, elevated slightly above that line.
   * This is called on creation and whenever the unchosen path moves/veers.
   */
  public updateTotemTransform(totem: TotemData): boolean {
    const obsA = totem.colA;
    const obsB = totem.colB;
    if (!obsA || !obsB || !obsA.gateGroup || !obsB.gateGroup || !totem.group) {
      return false;
    }

    // 1. Column A flight opening center in world space
    const upA = new THREE.Vector3(0, 1, 0).applyQuaternion(obsA.gateGroup.quaternion);
    const posA = obsA.gateGroup.position.clone().addScaledVector(upA, obsA.gapCenterY);

    // 2. Column B flight opening center in world space
    const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(obsB.gateGroup.quaternion);
    const posB = obsB.gateGroup.position.clone().addScaledVector(upB, obsB.gapCenterY);

    // 3. Virtual line connecting the two columns
    const segVector = posB.clone().sub(posA);
    const segLen = segVector.length();
    if (segLen < 0.001) return false;

    // Tangent pointing from Column A towards Column B along the flight path
    const tangent = segVector.clone().normalize();

    // Average up vector of the two gates
    const avgUp = upA.clone().add(upB).normalize();

    // Right vector perpendicular to flight tangent and up
    let right = new THREE.Vector3().crossVectors(avgUp, tangent).normalize();
    if (right.lengthSq() < 0.0001) {
      right = new THREE.Vector3(1, 0, 0);
    }
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();

    // 4. Place the totem on the virtual line halfway between Column A and Column B,
    // and elevated slightly above that line (0.5m) so it hovers gracefully in the flight path
    const midPoint = posA.clone().addScaledVector(segVector, 0.5);
    const hoverAboveLine = 0.5;
    const totemPos = midPoint.addScaledVector(up, hoverAboveLine);

    totem.group.position.copy(totemPos);

    // 5. Align totem's orientation with the virtual line flight path
    const rotMat = new THREE.Matrix4().makeBasis(right, up, tangent);
    totem.group.setRotationFromMatrix(rotMat);

    // Update distance metric for culling and collision
    totem.pathDistance = (obsA.pathDistance + obsB.pathDistance) * 0.5;
    totem.lateralOffset = totemPos.x;

    return true;
  }

  /**
   * Re-evaluates all totems along the path. When the player chooses a branch,
   * unchosen columns shift or veer 90 degrees; this ensures every totem on both
   * chosen and unchosen branches moves dynamically to remain strictly between its two columns.
   */
  public realignAllTotems(obstacles: ObstacleData[]) {
    for (let i = this.totems.length - 1; i >= 0; i--) {
      const totem = this.totems[i];
      const aExists = totem.colA && obstacles.includes(totem.colA) && totem.colA.gateGroup;
      const bExists = totem.colB && obstacles.includes(totem.colB) && totem.colB.gateGroup;

      if (!aExists || !bExists) {
        if (totem.group) {
          this.group.remove(totem.group);
        }
        this.totems.splice(i, 1);
        continue;
      }

      this.updateTotemTransform(totem);
    }
  }

  /**
   * Prunes totems that have passed far behind the player's view
   */
  public pruneTotems(birdDistance: number) {
    for (let i = this.totems.length - 1; i >= 0; i--) {
      const totem = this.totems[i];
      if (
        totem.pathDistance < birdDistance - 45.0 ||
        !totem.colA ||
        !totem.colB ||
        !totem.colA.gateGroup ||
        !totem.colB.gateGroup
      ) {
        if (totem.group) {
          this.group.remove(totem.group);
        }
        this.totems.splice(i, 1);
      }
    }
  }

  /**
   * Builds the 3D model for a single totem placed between two columns
   */
  private createTotem(
    id: number,
    type: TotemType,
    obsA: ObstacleData,
    obsB: ObstacleData,
    branch: 'SINGLE' | 'LEFT' | 'RIGHT'
  ): TotemData | null {
    if (!obsA.gateGroup || !obsB.gateGroup) return null;

    const totemGroup = new THREE.Group();

    // 1. Carved Runic Pedestal (compact floating rune base)
    const pedestal = new THREE.Mesh(this.pedestalGeo, this.pedestalMat);
    pedestal.position.y = -0.55;
    totemGroup.add(pedestal);

    // 2. Animated floating center container
    const floatGroup = new THREE.Group();
    floatGroup.name = 'floatGroup';
    totemGroup.add(floatGroup);

    if (type === 'SPEED') {
      // Speed Totem (Cyan aerodynamic core + swept winglets + spinning halo)
      const core = new THREE.Mesh(this.speedCoreGeo, this.speedCoreMat);
      floatGroup.add(core);

      const leftWing = new THREE.Mesh(this.speedWingGeo, this.speedWingMat);
      leftWing.position.set(-0.34, 0, 0);
      leftWing.rotation.z = -0.35;
      floatGroup.add(leftWing);

      const rightWing = new THREE.Mesh(this.speedWingGeo, this.speedWingMat);
      rightWing.position.set(0.34, 0, 0);
      rightWing.rotation.z = 0.35;
      floatGroup.add(rightWing);

      const ring = new THREE.Mesh(this.speedRingGeo, this.speedRingMat);
      ring.rotation.x = Math.PI / 3;
      ring.name = 'orbitRing';
      floatGroup.add(ring);

      const chevron = new THREE.Mesh(this.chevronGeo, this.speedCoreMat);
      chevron.position.y = 0.55;
      chevron.rotation.y = Math.PI / 4;
      floatGroup.add(chevron);
    } else {
      // Immunity Totem (Golden Emerald aegis core + shield guards + radiant halo)
      const core = new THREE.Mesh(this.immunityCoreGeo, this.immunityCoreMat);
      floatGroup.add(core);

      const leftShield = new THREE.Mesh(this.immunityShieldGeo, this.immunityShieldMat);
      leftShield.position.set(-0.36, 0, 0);
      leftShield.rotation.y = 0.4;
      floatGroup.add(leftShield);

      const rightShield = new THREE.Mesh(this.immunityShieldGeo, this.immunityShieldMat);
      rightShield.position.set(0.36, 0, 0);
      rightShield.rotation.y = -0.4;
      floatGroup.add(rightShield);

      const ring = new THREE.Mesh(this.immunityRingGeo, this.immunityRingMat);
      ring.rotation.x = -Math.PI / 3;
      ring.name = 'orbitRing';
      floatGroup.add(ring);

      const crest = new THREE.Mesh(this.crestGeo, this.immunityShieldMat);
      crest.position.y = 0.55;
      floatGroup.add(crest);
    }

    const data: TotemData = {
      id,
      type,
      pathDistance: (obsA.pathDistance + obsB.pathDistance) * 0.5,
      lateralOffset: (obsA.lateralOffset + obsB.lateralOffset) * 0.5,
      branch,
      relativeY: 0,
      collected: false,
      group: totemGroup,
      floatGroup,
      orbitRing: floatGroup.getObjectByName('orbitRing'),
      colA: obsA,
      colB: obsB,
    };

    // Calculate virtual line and position the totem above the line between the two columns
    this.updateTotemTransform(data);

    this.group.add(totemGroup);
    this.totems.push(data);
    return data;
  }

  /**
   * Main per-frame update: bobs/spins totems and tests collision with bird
   * Optimized with distance culling and zero garbage collection
   */
  public update(
    delta: number,
    pathDistance: number,
    birdPos: THREE.Vector3,
    activeBranch: 'SINGLE' | 'LEFT' | 'RIGHT'
  ) {
    this.animTimer += delta;

    // 1. Update Totem Visual Animations & Check Collisions (Culled to active viewport)
    for (const totem of this.totems) {
      if (totem.collected || !totem.group) continue;

      const distDiff = totem.pathDistance - pathDistance;
      // Distance culling: ignore totems far behind (>20m) or far ahead (>95m)
      if (distDiff < -20.0 || distDiff > 95.0) continue;

      // Animate floating inner group directly without DOM/tree traversal
      if (totem.floatGroup) {
        totem.floatGroup.position.y = Math.sin(this.animTimer * 3.0 + totem.id) * 0.16;
        totem.floatGroup.rotation.y += delta * 1.8;
      }
      if (totem.orbitRing) {
        totem.orbitRing.rotation.z += delta * 3.2;
      }

      // Check collision if within near proximity
      if (Math.abs(distDiff) < 4.0) {
        if (totem.branch !== 'SINGLE' && totem.branch !== activeBranch) {
          continue;
        }

        totem.group.getWorldPosition(this.scratchPos);
        this.scratchPos.y += 0.2;

        if (this.scratchPos.distanceTo(birdPos) < 1.6) {
          this.collectTotem(totem, this.scratchPos);
        }
      }
    }

    // 2. Update Pre-allocated Burst Particles
    for (const p of this.burstParticles) {
      if (p.mesh.visible) {
        p.life += delta;
        if (p.life >= p.maxLife) {
          p.mesh.visible = false;
        } else {
          const progress = p.life / p.maxLife;
          p.vel.y -= 4.5 * delta;
          p.mesh.position.addScaledVector(p.vel, delta);
          p.mesh.scale.setScalar((1.0 - progress) * 1.1);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 - progress;
        }
      }
    }
  }

  /**
   * Triggers collection of a totem
   */
  private collectTotem(totem: TotemData, worldPos: THREE.Vector3) {
    totem.collected = true;
    if (totem.group) {
      totem.group.visible = false;
    }

    // Audio chime
    if (totem.type === 'SPEED') {
      soundManager.playTotemSpeed();
    } else {
      soundManager.playTotemImmunity();
    }

    // Spawn pickup sparkle burst from pre-allocated pool
    this.spawnPickupBurst(worldPos, totem.type);

    if (this.onCollectCallback) {
      this.onCollectCallback(totem.type);
    }
  }

  /**
   * Spawns radiant sparkle motes from the pre-allocated pool with ZERO runtime allocations
   */
  private spawnPickupBurst(pos: THREE.Vector3, type: TotemType) {
    const mat = type === 'SPEED' ? this.burstSpeedMat : this.burstImmunityMat;
    let spawned = 0;

    for (const p of this.burstParticles) {
      if (!p.mesh.visible) {
        p.mesh.material = mat;
        p.mesh.position.copy(pos);
        p.mesh.visible = true;
        p.life = 0;
        p.maxLife = 0.5 + Math.random() * 0.25;

        const angle = (spawned / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = 3.5 + Math.random() * 4.0;
        p.vel.set(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed + 2.0,
          (Math.random() - 0.5) * 3.5
        );
        p.mesh.scale.setScalar(1.0);

        spawned++;
        if (spawned >= 16) break;
      }
    }
  }

  /**
   * Resets all totems for a new flight run
   */
  public reset() {
    this.clear();
    this.totemIdCounter = 0;
  }

  public clear() {
    for (const totem of this.totems) {
      if (totem.group) {
        this.group.remove(totem.group);
      }
    }
    this.totems = [];

    for (const p of this.burstParticles) {
      p.mesh.visible = false;
    }
  }
}
