import * as THREE from 'three';
import { ObstacleData } from '../types';
import { soundManager } from './audio';
import { CinematicCameraDirector } from './cameraDirector';
import { BirdCharacter } from './birdModel';

interface DissolvingRing {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseScale: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface ShockwaveHalo {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  startScale: number;
  maxScale: number;
  elapsed: number;
  duration: number;
}

interface GoldenSparkle {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  elapsed: number;
  lifespan: number;
  baseScale: number;
  material: THREE.MeshBasicMaterial;
}

interface SunburstStar {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  pos: THREE.Vector3;
  elapsed: number;
  duration: number;
  maxScale: number;
}

interface FloatingScorePopup {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  worldPos: THREE.Vector3;
  elapsed: number;
  duration: number;
  baseScale: number;
}

export class RingEffectManager {
  public group: THREE.Group;

  // Active ring collections
  private dissolvingRings: DissolvingRing[] = [];

  // Shockwave Halos Pool & Active
  private shockwaveHalos: ShockwaveHalo[] = [];
  private shockwaveGeo: THREE.TorusGeometry;
  private innerShockwaveGeo: THREE.RingGeometry;

  // Sparkles & Shards Pool & Active
  private sparkles: GoldenSparkle[] = [];
  private shardGeos: THREE.BufferGeometry[] = [];
  private sparkleColors: number[] = [0xffffff, 0xffe066, 0xffb703, 0xfbbf24, 0xf59e0b];

  // Center Sunburst Stars Pool & Active
  private sunburstStars: SunburstStar[] = [];
  private starGeo: THREE.BufferGeometry;

  // Floating "+1" 3D Popups Pool & Active
  private scorePopups: FloatingScorePopup[] = [];
  private scoreTexture: THREE.CanvasTexture | null = null;
  private unchartedScoreTexture: THREE.CanvasTexture | null = null;

  // Ring collection streak tracking for progressive harmonic pitch
  private streakCount: number = 0;
  private lastRingCollectTime: number = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Geometries
    this.shockwaveGeo = new THREE.TorusGeometry(1.7, 0.065, 12, 40);
    this.innerShockwaveGeo = new THREE.RingGeometry(0.2, 1.6, 32);

    // Sparkle diamond / shard geometries
    this.shardGeos.push(new THREE.OctahedronGeometry(0.09, 0));
    this.shardGeos.push(new THREE.TetrahedronGeometry(0.1, 0));
    this.shardGeos.push(new THREE.BoxGeometry(0.08, 0.08, 0.08));

    // 4-point radiant diamond sunburst geometry
    this.starGeo = this.createSunburstStarGeometry();

    // Pre-render "+1" and "UNCHARTED +1" canvas textures for crisp 3D floating popups
    this.scoreTexture = this.createScoreCanvasTexture('+1', false);
    this.unchartedScoreTexture = this.createScoreCanvasTexture('+1', true);
  }

  /**
   * Generates a luminous 4-point diamond sunburst star geometry
   */
  private createSunburstStarGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    // 4 diamond points: top, bottom, left, right, with center vertices
    const vertices = new Float32Array([
      // Vertical flare
      -0.08, 0.0, 0.0,  0.08, 0.0, 0.0,  0.0, 1.4, 0.0,
      -0.08, 0.0, 0.0,  0.0, -1.4, 0.0,  0.08, 0.0, 0.0,
      // Horizontal flare
      0.0, -0.08, 0.0,  1.4, 0.0, 0.0,  0.0, 0.08, 0.0,
      0.0, -0.08, 0.0,  0.0, 0.08, 0.0,  -1.4, 0.0, 0.0,
      // Center glow diamond
      -0.28, 0.0, 0.0,  0.0, -0.28, 0.0,  0.28, 0.0, 0.0,
      -0.28, 0.0, 0.0,  0.28, 0.0, 0.0,  0.0, 0.28, 0.0,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Generates a high-res canvas texture for the 3D in-game floating score popup
   */
  private createScoreCanvasTexture(text: string, isUncharted: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);

    ctx.clearRect(0, 0, 256, 128);

    // Glowing drop shadow
    ctx.shadowColor = isUncharted ? 'rgba(251, 191, 36, 0.95)' : 'rgba(234, 179, 8, 0.9)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.font = '900 68px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Outer dark stroke for maximum readability against bright desert or sky
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#1e1b4b';
    ctx.strokeText(text, 128, 64);

    // Inner vibrant border
    ctx.lineWidth = 5;
    ctx.strokeStyle = isUncharted ? '#f59e0b' : '#d97706';
    ctx.strokeText(text, 128, 64);

    // Rich metallic gradient fill
    const grad = ctx.createLinearGradient(0, 30, 0, 96);
    if (isUncharted) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#fef08a');
      grad.addColorStop(0.7, '#f59e0b');
      grad.addColorStop(1, '#ea580c');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, '#fef08a');
      grad.addColorStop(0.8, '#eab308');
      grad.addColorStop(1, '#ca8a04');
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    ctx.fillText(text, 128, 64);

    // Sparkling star accent
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(205, 42, 4.5, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Triggers the full juice package when touching or flying through a spinning ring!
   */
  public triggerRingTouch(
    obstacle: ObstacleData,
    birdPos: THREE.Vector3,
    cameraDirector: CinematicCameraDirector,
    bird: BirdCharacter,
    isUncharted: boolean = false
  ) {
    const now = performance.now() / 1000;
    if (now - this.lastRingCollectTime < 3.8) {
      this.streakCount++;
    } else {
      this.streakCount = 1;
    }
    this.lastRingCollectTime = now;

    // 1. Rich multi-layered audio chime
    soundManager.playRingCollect(isUncharted, this.streakCount);

    // 2. Camera screen juice: snappy FOV punch and micro-impact shake
    cameraDirector.triggerRingPunch(1.0);

    // 3. Bird model reaction: wingtip golden spark spray & aura surge
    bird.triggerRingCollectEffects();

    // 4. Retrieve world transform of the touched ring
    const ringWorldPos = new THREE.Vector3();
    const ringWorldQuat = new THREE.Quaternion();

    if (obstacle.ringMesh) {
      obstacle.ringMesh.getWorldPosition(ringWorldPos);
      obstacle.ringMesh.getWorldQuaternion(ringWorldQuat);

      // Start the animated ring dissolve & hyperspin expansion!
      this.spawnRingDissolveAnimation(obstacle.ringMesh);
    } else {
      ringWorldPos.copy(birdPos);
    }

    // 5. Spawn expanding golden shockwave halos
    this.spawnShockwaveHalos(ringWorldPos, ringWorldQuat, isUncharted);

    // 6. Spawn burst of 30 golden sparkle particles and gem shards
    this.spawnGoldenSparkles(ringWorldPos, ringWorldQuat, isUncharted);

    // 7. Spawn center radiant sunburst star flash
    this.spawnSunburstStar(ringWorldPos, isUncharted);

    // 8. Spawn floating in-world 3D "+1" score popup
    this.spawnFloatingScorePopup(ringWorldPos, isUncharted);
  }

  /**
   * Animates the collected ring itself:
   * Instead of vanishing instantly, it flashes bright white-gold, spins rapidly (24 rad/s),
   * expands elastically (1.0 -> 2.4x), and dissolves smoothly over 0.38s!
   */
  private spawnRingDissolveAnimation(ringMesh: THREE.Mesh) {
    // Clone its material so it can glow, bloom, and fade independently
    const origMat = ringMesh.material as THREE.MeshStandardMaterial;
    const animMat = origMat.clone();
    animMat.transparent = true;
    animMat.opacity = 1.0;
    animMat.emissive = new THREE.Color(0xfff0aa);
    animMat.emissiveIntensity = 3.8; // Instant bright golden impact flash!
    ringMesh.material = animMat;

    this.dissolvingRings.push({
      mesh: ringMesh,
      material: animMat,
      baseScale: ringMesh.scale.clone(),
      elapsed: 0,
      duration: 0.38,
    });
  }

  /**
   * Spawns radiant expanding shockwave halos aligned with the ring's orientation
   */
  private spawnShockwaveHalos(pos: THREE.Vector3, quat: THREE.Quaternion, isUncharted: boolean) {
    const haloColor = isUncharted ? 0xfde047 : 0xffcc00;

    // Outer Torus Shockwave (expands from 1.7m to 5.4m)
    const torusMat = new THREE.MeshBasicMaterial({
      color: haloColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const torusMesh = new THREE.Mesh(this.shockwaveGeo, torusMat);
    torusMesh.position.copy(pos);
    torusMesh.quaternion.copy(quat);
    this.group.add(torusMesh);

    this.shockwaveHalos.push({
      mesh: torusMesh,
      material: torusMat,
      pos: pos.clone(),
      quat: quat.clone(),
      startScale: 1.0,
      maxScale: 3.2,
      elapsed: 0,
      duration: 0.4,
    });

    // Inner Flat Glow Disc Ripple
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const discMesh = new THREE.Mesh(this.innerShockwaveGeo, discMat);
    discMesh.position.copy(pos);
    discMesh.quaternion.copy(quat);
    this.group.add(discMesh);

    this.shockwaveHalos.push({
      mesh: discMesh,
      material: discMat,
      pos: pos.clone(),
      quat: quat.clone(),
      startScale: 0.3,
      maxScale: 2.2,
      elapsed: 0,
      duration: 0.3,
    });
  }

  /**
   * Spawns a radial burst of sparkling golden particles and tumbling crystal shards
   */
  private spawnGoldenSparkles(centerPos: THREE.Vector3, quat: THREE.Quaternion, isUncharted: boolean) {
    const count = 32;
    const ringRadius = 1.7;

    for (let i = 0; i < count; i++) {
      // Angle around the ring perimeter
      const theta = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const localX = Math.cos(theta) * ringRadius;
      const localY = Math.sin(theta) * ringRadius;
      const localZ = (Math.random() - 0.5) * 0.2;

      // Transform point by ring orientation
      const spawnOffset = new THREE.Vector3(localX, localY, localZ).applyQuaternion(quat);
      const spawnPos = centerPos.clone().add(spawnOffset);

      // Radial outward blast direction
      const radialDir = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0).applyQuaternion(quat).normalize();

      // Velocity: outward dispersion (6 to 14 m/s) + forward flight rush (+Z 3 to 7 m/s)
      const speed = 6.5 + Math.random() * 8.0;
      const forwardPush = 3.5 + Math.random() * 4.5;
      const vel = radialDir.clone().multiplyScalar(speed);
      vel.z += forwardPush;
      vel.y += (Math.random() - 0.2) * 2.5;

      // Pick a faceted shard geometry & vibrant golden/white material
      const geo = this.shardGeos[i % this.shardGeos.length];
      const color = isUncharted
        ? (i % 3 === 0 ? 0xffffff : 0xfde047)
        : this.sparkleColors[i % this.sparkleColors.length];

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(spawnPos);
      const scale = 0.8 + Math.random() * 0.7;
      mesh.scale.setScalar(scale);
      this.group.add(mesh);

      this.sparkles.push({
        mesh,
        pos: spawnPos,
        vel,
        rotVel: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16
        ),
        elapsed: 0,
        lifespan: 0.5 + Math.random() * 0.35,
        baseScale: scale,
        material: mat,
      });
    }
  }

  /**
   * Spawns a center 4-point diamond star flare at the ring's opening
   */
  private spawnSunburstStar(pos: THREE.Vector3, isUncharted: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      color: isUncharted ? 0xffffff : 0xfffae0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.starGeo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.2);
    this.group.add(mesh);

    this.sunburstStars.push({
      mesh,
      material: mat,
      pos: pos.clone(),
      elapsed: 0,
      duration: 0.22,
      maxScale: 2.2,
    });
  }

  /**
   * Spawns an arcade in-world 3D floating "+1" sprite that pops upward with an elastic bounce
   */
  private spawnFloatingScorePopup(pos: THREE.Vector3, isUncharted: boolean) {
    const texture = isUncharted ? this.unchartedScoreTexture : this.scoreTexture;
    if (!texture) return;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(mat);
    // Position slightly above the ring center so it's fully visible above bird/ring
    const startPos = pos.clone().add(new THREE.Vector3(0, 0.65, 0));
    sprite.position.copy(startPos);
    sprite.scale.set(1.4, 0.7, 1.0);
    this.group.add(sprite);

    this.scorePopups.push({
      sprite,
      material: mat,
      worldPos: startPos,
      elapsed: 0,
      duration: 0.75,
      baseScale: 1.4,
    });
  }

  /**
   * Frame update: updates all active dissolving rings, shockwaves, particles, and popups.
   * Also manages approaching ring proximity glow anticipation!
   */
  public update(
    delta: number,
    birdDistance: number,
    camera: THREE.Camera,
    obstacles: ObstacleData[]
  ) {
    // ----------------------------------------------------
    // 1. Update Dissolving Rings (elastic expansion & hyperspin)
    // ----------------------------------------------------
    for (let i = this.dissolvingRings.length - 1; i >= 0; i--) {
      const ring = this.dissolvingRings[i];
      ring.elapsed += delta;
      const progress = Math.min(1.0, ring.elapsed / ring.duration);

      if (progress >= 1.0) {
        ring.mesh.visible = false;
        ring.material.dispose();
        this.dissolvingRings.splice(i, 1);
      } else {
        // Hyperspin: 24 rad/s spin as it disintegrates!
        ring.mesh.rotation.y += delta * 24.0;

        // Elastic expansion curve: 1.0 -> 2.4x
        const expansion = 1.0 + Math.pow(progress, 0.45) * 1.4;
        ring.mesh.scale.copy(ring.baseScale).multiplyScalar(expansion);

        // Flash & fade
        ring.material.emissiveIntensity = THREE.MathUtils.lerp(3.5, 0.0, progress);
        ring.material.opacity = Math.pow(1.0 - progress, 1.4);
      }
    }

    // ----------------------------------------------------
    // 2. Update Shockwave Halos (expanding energy rings)
    // ----------------------------------------------------
    for (let i = this.shockwaveHalos.length - 1; i >= 0; i--) {
      const halo = this.shockwaveHalos[i];
      halo.elapsed += delta;
      const progress = Math.min(1.0, halo.elapsed / halo.duration);

      if (progress >= 1.0) {
        this.group.remove(halo.mesh);
        halo.material.dispose();
        this.shockwaveHalos.splice(i, 1);
      } else {
        const easeOut = 1.0 - Math.pow(1.0 - progress, 2.5);
        const scale = THREE.MathUtils.lerp(halo.startScale, halo.maxScale, easeOut);
        halo.mesh.scale.set(scale, scale, 1.0);
        halo.material.opacity = (1.0 - progress) * 0.95;
      }
    }

    // ----------------------------------------------------
    // 3. Update Sparkles & Shards (physics & tumbling)
    // ----------------------------------------------------
    const drag = Math.pow(0.92, delta * 60.0);
    const gravity = -3.2 * delta;

    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const p = this.sparkles[i];
      p.elapsed += delta;
      const progress = p.elapsed / p.lifespan;

      if (progress >= 1.0) {
        this.group.remove(p.mesh);
        p.material.dispose();
        this.sparkles.splice(i, 1);
      } else {
        // Apply velocity, drag, and gravity
        p.vel.y += gravity;
        p.vel.multiplyScalar(drag);
        p.pos.addScaledVector(p.vel, delta);
        p.mesh.position.copy(p.pos);

        // 3D rotation
        p.mesh.rotation.x += p.rotVel.x * delta;
        p.mesh.rotation.y += p.rotVel.y * delta;
        p.mesh.rotation.z += p.rotVel.z * delta;

        // Twinkle scale & fade
        const scaleProgress = 1.0 - progress;
        p.mesh.scale.setScalar(p.baseScale * scaleProgress);
        p.material.opacity = Math.sin(scaleProgress * Math.PI * 0.5) * 0.95;
      }
    }

    // ----------------------------------------------------
    // 4. Update Sunburst Stars (rapid center pop & collapse)
    // ----------------------------------------------------
    for (let i = this.sunburstStars.length - 1; i >= 0; i--) {
      const star = this.sunburstStars[i];
      star.elapsed += delta;
      const progress = star.elapsed / star.duration;

      if (progress >= 1.0) {
        this.group.remove(star.mesh);
        star.material.dispose();
        this.sunburstStars.splice(i, 1);
      } else {
        // Billboard star to face camera
        star.mesh.quaternion.copy(camera.quaternion);

        // Snappy pop-in then fade-out
        let scale: number;
        if (progress < 0.25) {
          scale = (progress / 0.25) * star.maxScale;
        } else {
          scale = THREE.MathUtils.lerp(star.maxScale, 0.1, (progress - 0.25) / 0.75);
        }
        star.mesh.scale.setScalar(scale);
        star.material.opacity = (1.0 - progress);
      }
    }

    // ----------------------------------------------------
    // 5. Update Floating "+1" 3D Popups (arcade spring bounce)
    // ----------------------------------------------------
    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const popup = this.scorePopups[i];
      popup.elapsed += delta;
      const progress = popup.elapsed / popup.duration;

      if (progress >= 1.0) {
        this.group.remove(popup.sprite);
        popup.material.dispose();
        this.scorePopups.splice(i, 1);
      } else {
        // Float upward (+2.4m) and drift forward slightly (+Z)
        const rise = Math.pow(progress, 0.7) * 2.4;
        popup.sprite.position.set(
          popup.worldPos.x,
          popup.worldPos.y + rise,
          popup.worldPos.z + progress * 1.2
        );

        // Elastic overshoot bounce scale:
        // Quickly scales from 0.5 -> 1.35 in first 15%, then settles
        let scaleMultiplier: number;
        if (progress < 0.15) {
          scaleMultiplier = 0.5 + (progress / 0.15) * 0.85;
        } else if (progress < 0.3) {
          scaleMultiplier = 1.35 - ((progress - 0.15) / 0.15) * 0.25;
        } else {
          scaleMultiplier = 1.1 - (progress - 0.3) * 0.15;
        }

        popup.sprite.scale.set(
          popup.baseScale * scaleMultiplier,
          (popup.baseScale * 0.5) * scaleMultiplier,
          1.0
        );

        // Smooth fade out in second half
        if (progress > 0.5) {
          popup.material.opacity = 1.0 - ((progress - 0.5) / 0.5);
        } else {
          popup.material.opacity = 1.0;
        }
      }
    }

    // ----------------------------------------------------
    // 6. Upcoming Ring Magnetic Anticipation Glow
    // ----------------------------------------------------
    const nowMs = Date.now();
    for (const obs of obstacles) {
      if (!obs.passed && obs.ringMesh && obs.ringMesh.visible) {
        const distAhead = obs.pathDistance - birdDistance;
        if (distAhead > 0 && distAhead < 24.0) {
          // As bird approaches from 24m to 0m, ramp up emissive intensity
          const proximity = 1.0 - (distAhead / 24.0);
          const pulse = Math.sin(nowMs * 0.007 + obs.id) * 0.18;
          const mat = obs.ringMesh.material as THREE.MeshStandardMaterial;
          if (mat && mat.emissiveIntensity !== undefined) {
            mat.emissiveIntensity = 0.35 + proximity * 0.55 + pulse * proximity;
          }
        }
      }
    }
  }

  /**
   * Resets all active juice elements on game restart
   */
  public reset() {
    this.streakCount = 0;
    this.lastRingCollectTime = 0;

    // Clean up dissolving rings
    for (const ring of this.dissolvingRings) {
      ring.mesh.visible = false;
      ring.material.dispose();
    }
    this.dissolvingRings = [];

    // Clean up shockwaves
    for (const halo of this.shockwaveHalos) {
      this.group.remove(halo.mesh);
      halo.material.dispose();
    }
    this.shockwaveHalos = [];

    // Clean up sparkles
    for (const p of this.sparkles) {
      this.group.remove(p.mesh);
      p.material.dispose();
    }
    this.sparkles = [];

    // Clean up sunburst stars
    for (const star of this.sunburstStars) {
      this.group.remove(star.mesh);
      star.material.dispose();
    }
    this.sunburstStars = [];

    // Clean up score popups
    for (const popup of this.scorePopups) {
      this.group.remove(popup.sprite);
      popup.material.dispose();
    }
    this.scorePopups = [];
  }
}
