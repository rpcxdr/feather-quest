import * as THREE from 'three';
import { flightPath, PathFrame } from './pathGenerator';

export interface WindGustTriggerResult {
  triggered: boolean;
  direction: 'LEFT' | 'RIGHT';
  targetBranchOffset: number;
  pathDistance: number;
  baseOffset: number;
  tier: number;
}

interface WindParticle {
  x: number;
  yOffset: number;
  zOffset: number;
  speed: number;
  baseSize: number;
  phase: number;
}

export class WindGustPair {
  public group: THREE.Group;
  public pathDistance: number;
  public baseOffset: number;
  public tier: number;
  public branch: 'SINGLE' | 'LEFT' | 'RIGHT';
  public triggered: boolean = false;
  public chosenDirection: 'LEFT' | 'RIGHT' | null = null;

  // Soft atmospheric mist auras
  private rightAuraMesh: THREE.Mesh;
  private leftAuraMesh: THREE.Mesh;

  // Particle systems (Right stream and Left stream)
  private rightParticles: THREE.Points;
  private leftParticles: THREE.Points;
  private rightParticleData: WindParticle[] = [];
  private leftParticleData: WindParticle[] = [];
  private rightPositionsBuf: Float32Array;
  private leftPositionsBuf: Float32Array;
  private readonly particleCount: number = 64;
  private readonly streamSpan: number = 10.0;

  // Center Y elevations for the two gusts
  private readonly rightCenterY: number = 2.2;
  private readonly leftCenterY: number = -2.2;

  // Trigger pulse burst rings
  private rightBurstRing: THREE.Mesh;
  private leftBurstRing: THREE.Mesh;
  private burstAlphaRight: number = 0;
  private burstAlphaLeft: number = 0;
  private burstScaleRight: number = 1.0;
  private burstScaleLeft: number = 1.0;

  // Animation timer
  private animTime: number = 0;

  constructor(
    scene: THREE.Scene,
    pathDistance: number,
    branch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE',
    tier: number = 1
  ) {
    this.pathDistance = pathDistance;
    this.branch = branch;
    this.tier = tier;
    this.group = new THREE.Group();

    // Align pair with flight path frame at this distance on this branch
    const frame: PathFrame = flightPath.getFrame(pathDistance, branch);
    this.group.position.copy(frame.position);
    this.baseOffset = frame.position.x;

    const m = new THREE.Matrix4();
    m.makeBasis(frame.right, frame.up, frame.tangent);
    this.group.setRotationFromMatrix(m);

    // ==========================================
    // 1. SOFT ATMOSPHERIC BREEZE AURAS
    // ==========================================
    const auraGeo = new THREE.SphereGeometry(1.0, 16, 12);

    // Right Gust Aura (Sky Cyan / Airflow Blue)
    const rightAuraMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rightAuraMesh = new THREE.Mesh(auraGeo, rightAuraMat);
    this.rightAuraMesh.position.set(0, this.rightCenterY, 0);
    this.rightAuraMesh.scale.set(5.2, 1.3, 1.6);
    this.group.add(this.rightAuraMesh);

    // Left Gust Aura (Seafoam Mint / Emerald)
    const leftAuraMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.leftAuraMesh = new THREE.Mesh(auraGeo, leftAuraMat);
    this.leftAuraMesh.position.set(0, this.leftCenterY, 0);
    this.leftAuraMesh.scale.set(5.2, 1.3, 1.6);
    this.group.add(this.leftAuraMesh);

    // ==========================================
    // 2. WIND PARTICLE STREAMS (CLEAN PARTICLES ONLY)
    // ==========================================
    this.rightPositionsBuf = new Float32Array(this.particleCount * 3);
    this.leftPositionsBuf = new Float32Array(this.particleCount * 3);

    const halfSpan = this.streamSpan / 2;

    // Initialize Right stream particles (streaming towards +X / Right)
    for (let i = 0; i < this.particleCount; i++) {
      const x = (Math.random() - 0.5) * this.streamSpan;
      const yOffset = (Math.random() - 0.5) * 1.5;
      const zOffset = (Math.random() - 0.5) * 1.2;
      const speed = 12.0 + Math.random() * 8.0;
      const baseSize = 0.22 + Math.random() * 0.12;
      const phase = Math.random() * Math.PI * 2;

      this.rightParticleData.push({ x, yOffset, zOffset, speed, baseSize, phase });
      this.rightPositionsBuf[i * 3] = x;
      this.rightPositionsBuf[i * 3 + 1] = this.rightCenterY + yOffset;
      this.rightPositionsBuf[i * 3 + 2] = zOffset;
    }

    const rightPartGeo = new THREE.BufferGeometry();
    rightPartGeo.setAttribute('position', new THREE.BufferAttribute(this.rightPositionsBuf, 3));
    this.rightParticles = new THREE.Points(
      rightPartGeo,
      new THREE.PointsMaterial({
        color: 0xe0f2fe,
        size: 0.26,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.rightParticles);

    // Initialize Left stream particles (streaming towards -X / Left)
    for (let i = 0; i < this.particleCount; i++) {
      const x = (Math.random() - 0.5) * this.streamSpan;
      const yOffset = (Math.random() - 0.5) * 1.5;
      const zOffset = (Math.random() - 0.5) * 1.2;
      const speed = 12.0 + Math.random() * 8.0;
      const baseSize = 0.22 + Math.random() * 0.12;
      const phase = Math.random() * Math.PI * 2;

      this.leftParticleData.push({ x, yOffset, zOffset, speed, baseSize, phase });
      this.leftPositionsBuf[i * 3] = x;
      this.leftPositionsBuf[i * 3 + 1] = this.leftCenterY + yOffset;
      this.leftPositionsBuf[i * 3 + 2] = zOffset;
    }

    const leftPartGeo = new THREE.BufferGeometry();
    leftPartGeo.setAttribute('position', new THREE.BufferAttribute(this.leftPositionsBuf, 3));
    this.leftParticles = new THREE.Points(
      leftPartGeo,
      new THREE.PointsMaterial({
        color: 0xd1fae5,
        size: 0.26,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.group.add(this.leftParticles);

    // ==========================================
    // 3. ORGANIC TRIGGER BURST RINGS
    // ==========================================
    const burstGeo = new THREE.TorusGeometry(1.5, 0.07, 8, 28);
    this.rightBurstRing = new THREE.Mesh(
      burstGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.rightBurstRing.position.set(0, this.rightCenterY, 0);
    this.rightBurstRing.rotation.y = Math.PI / 2;
    this.group.add(this.rightBurstRing);

    this.leftBurstRing = new THREE.Mesh(
      burstGeo,
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.leftBurstRing.position.set(0, this.leftCenterY, 0);
    this.leftBurstRing.rotation.y = Math.PI / 2;
    this.group.add(this.leftBurstRing);

    scene.add(this.group);
  }

  public update(
    delta: number,
    birdDistance: number,
    birdRelativeY: number,
    birdBranch: 'SINGLE' | 'LEFT' | 'RIGHT' = 'SINGLE'
  ): WindGustTriggerResult {
    this.animTime += delta;
    const halfSpan = this.streamSpan / 2;

    // 1. Gently breathe atmospheric mist auras
    const auraPulse = 0.11 + Math.sin(this.animTime * 3.2) * 0.035;
    (this.rightAuraMesh.material as THREE.MeshBasicMaterial).opacity = auraPulse;
    (this.leftAuraMesh.material as THREE.MeshBasicMaterial).opacity = auraPulse;

    // 2. Update Right Wind Stream Particles (streams towards screen right: -X)
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.rightParticleData[i];
      p.x -= p.speed * delta;
      if (p.x < -halfSpan) {
        p.x = halfSpan;
        p.yOffset = (Math.random() - 0.5) * 1.5;
        p.zOffset = (Math.random() - 0.5) * 1.2;
      }
      const verticalWave = Math.sin(this.animTime * 4.0 + p.phase) * 0.2;
      this.rightPositionsBuf[i * 3] = p.x;
      this.rightPositionsBuf[i * 3 + 1] = this.rightCenterY + p.yOffset + verticalWave;
      this.rightPositionsBuf[i * 3 + 2] = p.zOffset;
    }
    (this.rightParticles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // 3. Update Left Wind Stream Particles (streams towards screen left: +X)
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.leftParticleData[i];
      p.x += p.speed * delta;
      if (p.x > halfSpan) {
        p.x = -halfSpan;
        p.yOffset = (Math.random() - 0.5) * 1.5;
        p.zOffset = (Math.random() - 0.5) * 1.2;
      }
      const verticalWave = Math.sin(this.animTime * 4.0 + p.phase) * 0.2;
      this.leftPositionsBuf[i * 3] = p.x;
      this.leftPositionsBuf[i * 3 + 1] = this.leftCenterY + p.yOffset + verticalWave;
      this.leftPositionsBuf[i * 3 + 2] = p.zOffset;
    }
    (this.leftParticles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // 4. Update Breakthrough Pulse Rings
    if (this.burstAlphaRight > 0) {
      this.burstAlphaRight = Math.max(0, this.burstAlphaRight - delta * 2.2);
      this.burstScaleRight += delta * 4.5;
      (this.rightBurstRing.material as THREE.MeshBasicMaterial).opacity = this.burstAlphaRight;
      this.rightBurstRing.scale.set(this.burstScaleRight, this.burstScaleRight, this.burstScaleRight);
    }
    if (this.burstAlphaLeft > 0) {
      this.burstAlphaLeft = Math.max(0, this.burstAlphaLeft - delta * 2.2);
      this.burstScaleLeft += delta * 4.5;
      (this.leftBurstRing.material as THREE.MeshBasicMaterial).opacity = this.burstAlphaLeft;
      this.leftBurstRing.scale.set(this.burstScaleLeft, this.burstScaleLeft, this.burstScaleLeft);
    }

    // 5. Check Trigger Zone Collision with Bird
    if (!this.triggered) {
      const branchMatches = this.branch === 'SINGLE' || birdBranch === this.branch;
      if (branchMatches) {
        const distDiff = birdDistance - this.pathDistance;
        // Hit trigger zone: bird passes directly through the gust center plane [-0.5m, +4.5m]
        if (distDiff >= -0.5 && distDiff <= 4.5) {
          this.triggered = true;

          // Upper gust (relativeY >= 0) blows RIGHT (towards screen right: -X)
          // Lower gust (relativeY < 0) blows LEFT (towards screen left: +X)
          const hitRight = birdRelativeY >= 0.0;
          const direction: 'LEFT' | 'RIGHT' = hitRight ? 'RIGHT' : 'LEFT';
          this.chosenDirection = direction;

          const targetBranchOffset = direction === 'LEFT' ? 50.0 : -50.0;

          if (direction === 'RIGHT') {
            this.burstAlphaRight = 0.9;
            this.burstScaleRight = 1.0;
            (this.rightBurstRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
          } else {
            this.burstAlphaLeft = 0.9;
            this.burstScaleLeft = 1.0;
            (this.leftBurstRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
          }

          return {
            triggered: true,
            direction,
            targetBranchOffset,
            pathDistance: this.pathDistance,
            baseOffset: this.baseOffset,
            tier: this.tier,
          };
        }
      }
    }

    return {
      triggered: false,
      direction: this.chosenDirection || 'RIGHT',
      targetBranchOffset: this.baseOffset,
      pathDistance: this.pathDistance,
      baseOffset: this.baseOffset,
      tier: this.tier,
    };
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.group);

    // Dispose auras
    this.rightAuraMesh.geometry.dispose();
    (this.rightAuraMesh.material as THREE.Material).dispose();
    this.leftAuraMesh.geometry.dispose();
    (this.leftAuraMesh.material as THREE.Material).dispose();

    // Dispose particles
    this.rightParticles.geometry.dispose();
    (this.rightParticles.material as THREE.Material).dispose();
    this.leftParticles.geometry.dispose();
    (this.leftParticles.material as THREE.Material).dispose();

    // Dispose burst rings
    this.rightBurstRing.geometry.dispose();
    (this.rightBurstRing.material as THREE.Material).dispose();
    this.leftBurstRing.geometry.dispose();
    (this.leftBurstRing.material as THREE.Material).dispose();
  }
}
