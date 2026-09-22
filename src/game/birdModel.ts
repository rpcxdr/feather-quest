import * as THREE from 'three';

interface FeatherParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotSpeed: THREE.Vector3;
}

interface StardustParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
}

export class BirdCharacter {
  public group: THREE.Group;
  private bodyMesh: THREE.Mesh;
  private leftWingPivot: THREE.Group;
  private rightWingPivot: THREE.Group;
  private leftWingTipGroup: THREE.Group;
  private rightWingTipGroup: THREE.Group;
  private tailPivot: THREE.Group;
  private headGroup: THREE.Group;
  private crestPivot: THREE.Group;
  private leftPupil: THREE.Mesh;
  private rightPupil: THREE.Mesh;

  // Feather particles on crash
  private featherParticlesGroup: THREE.Group;
  private featherParticles: FeatherParticle[] = [];

  // Uncharted pioneer golden stardust wingtip vortex trail
  private isUncharted: boolean = false;
  private stardustGroup: THREE.Group;
  private stardustParticles: StardustParticle[] = [];
  private stardustSpawnTimer: number = 0;

  // Powerup Buff Effects: Immunity Shield & Speed Trail
  private isImmunityActive: boolean = false;
  private isSpeedActive: boolean = false;
  private immunityShieldGroup: THREE.Group;
  private shieldSphereMesh: THREE.Mesh;
  private shieldRingMesh: THREE.Mesh;
  private shieldDeflectPulse: number = 0;

  private speedTrailGroup: THREE.Group;
  private speedParticles: StardustParticle[] = [];
  private speedSpawnTimer: number = 0;
  private nextSpeedParticleIndex: number = 0;
  private scratchTipPos: THREE.Vector3 = new THREE.Vector3();

  // Animation states
  private flapPhase: number = 0;
  private flapSpeed: number = 8;
  private blinkTimer: number = 0;
  private isBlinking: boolean = false;

  constructor() {
    this.group = new THREE.Group();

    // ----------------------------------------------------
    // 1. SMOOTH SCULPTED MATERIALS
    // ----------------------------------------------------
    // Scarlet Macaw primary red (silky plumage)
    const scarletMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.42,
      metalness: 0.05,
    });

    // Breast & belly plumage (slightly softer warm scarlet-coral)
    const bellyMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.45,
      metalness: 0.02,
    });

    // Golden yellow plumage (shoulder wing coverts & crest highlights)
    const goldenYellowMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.4,
      metalness: 0.05,
    });

    // Royal cobalt blue plumage (mid & primary wing feathers)
    const royalBlueMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.4,
      metalness: 0.05,
    });

    // Deep sapphire blue plumage (wingtips & upper tail)
    const deepBlueMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.42,
      metalness: 0.05,
    });

    // Bare white facial skin patch characteristic of Macaws
    const facePatchMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.55,
      metalness: 0.02,
    });

    // Smooth horn beak (dark slate charcoal with subtle satin sheen)
    const beakMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.08,
    });

    // Glossy bird eye
    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.05,
    });

    const pupilMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
    });

    const glintMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });

    // Claws / feet
    const clawMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
      metalness: 0.1,
    });

    // ----------------------------------------------------
    // 2. SMOOTH SCULPTED TORSO & BODY
    // ----------------------------------------------------
    // Main aerodynamic body capsule/egg
    const bodyGeo = new THREE.SphereGeometry(0.5, 32, 24);
    bodyGeo.scale(0.85, 0.92, 1.25);
    this.bodyMesh = new THREE.Mesh(bodyGeo, scarletMat);
    this.bodyMesh.position.set(0, 0, 0);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.group.add(this.bodyMesh);

    // Smooth underbelly curve
    const bellyGeo = new THREE.SphereGeometry(0.44, 28, 20);
    bellyGeo.scale(0.78, 0.82, 1.15);
    const bellyMesh = new THREE.Mesh(bellyGeo, bellyMat);
    bellyMesh.position.set(0, -0.06, 0.06);
    this.group.add(bellyMesh);

    // Golden feather patches on side shoulders
    const shoulderPatchGeo = new THREE.SphereGeometry(0.24, 20, 16);
    shoulderPatchGeo.scale(0.4, 0.8, 1.1);

    const leftShoulder = new THREE.Mesh(shoulderPatchGeo, goldenYellowMat);
    leftShoulder.position.set(-0.33, 0.08, 0.05);
    leftShoulder.rotation.z = -0.15;
    this.group.add(leftShoulder);

    const rightShoulder = new THREE.Mesh(shoulderPatchGeo, goldenYellowMat);
    rightShoulder.position.set(0.33, 0.08, 0.05);
    rightShoulder.rotation.z = 0.15;
    this.group.add(rightShoulder);

    // ----------------------------------------------------
    // 3. SMOOTH SCULPTED PARROT HEAD & FACE
    // ----------------------------------------------------
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.26, 0.44);

    // Smooth skull
    const headGeo = new THREE.SphereGeometry(0.38, 30, 24);
    headGeo.scale(0.92, 0.98, 1.0);
    const headMesh = new THREE.Mesh(headGeo, scarletMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.headGroup.add(headMesh);

    // Macaw bare white facial skin patches on both cheeks
    const cheekPatchGeo = new THREE.SphereGeometry(0.22, 22, 18);
    cheekPatchGeo.scale(0.18, 0.85, 0.95);

    const leftCheek = new THREE.Mesh(cheekPatchGeo, facePatchMat);
    leftCheek.position.set(-0.27, 0.02, 0.08);
    leftCheek.rotation.y = -0.15;
    this.headGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(cheekPatchGeo, facePatchMat);
    rightCheek.position.set(0.27, 0.02, 0.08);
    rightCheek.rotation.y = 0.15;
    this.headGroup.add(rightCheek);

    // Eyes: set into the white facial patches
    const eyeGeo = new THREE.SphereGeometry(0.095, 18, 14);
    const pupilGeo = new THREE.SphereGeometry(0.065, 16, 12);
    const glintGeo = new THREE.SphereGeometry(0.024, 10, 8);

    // Left Eye
    const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEye.position.set(-0.28, 0.04, 0.12);
    this.leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    this.leftPupil.position.set(-0.04, 0.01, 0.04);
    const leftGlint = new THREE.Mesh(glintGeo, glintMat);
    leftGlint.position.set(-0.02, 0.025, 0.04);
    this.leftPupil.add(leftGlint);
    leftEye.add(this.leftPupil);
    this.headGroup.add(leftEye);

    // Right Eye
    const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEye.position.set(0.28, 0.04, 0.12);
    this.rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    this.rightPupil.position.set(0.04, 0.01, 0.04);
    const rightGlint = new THREE.Mesh(glintGeo, glintMat);
    rightGlint.position.set(0.02, 0.025, 0.04);
    this.rightPupil.add(rightGlint);
    rightEye.add(this.rightPupil);
    this.headGroup.add(rightEye);

    // Sculpted Hooked Beak (Characteristic downward curved macaw bill)
    const upperBeakGroup = new THREE.Group();
    upperBeakGroup.position.set(0, -0.02, 0.32);

    // Beak base cone
    const beakBaseGeo = new THREE.ConeGeometry(0.16, 0.32, 20);
    beakBaseGeo.scale(0.85, 1.0, 1.25);
    const beakBaseMesh = new THREE.Mesh(beakBaseGeo, beakMat);
    beakBaseMesh.rotation.x = Math.PI / 2.3;
    beakBaseMesh.castShadow = true;
    upperBeakGroup.add(beakBaseMesh);

    // Hooked tip curvature
    const beakTipGeo = new THREE.ConeGeometry(0.11, 0.24, 18);
    beakTipGeo.scale(0.75, 1.0, 0.9);
    const beakTipMesh = new THREE.Mesh(beakTipGeo, beakMat);
    beakTipMesh.position.set(0, -0.15, 0.16);
    beakTipMesh.rotation.x = Math.PI / 1.6;
    beakTipMesh.castShadow = true;
    upperBeakGroup.add(beakTipMesh);

    // Lower Mandible
    const lowerBeakGeo = new THREE.ConeGeometry(0.12, 0.18, 16);
    lowerBeakGeo.scale(0.9, 0.8, 1.1);
    const lowerBeakMesh = new THREE.Mesh(lowerBeakGeo, beakMat);
    lowerBeakMesh.position.set(0, -0.16, 0.22);
    lowerBeakMesh.rotation.x = Math.PI / 2.7;
    upperBeakGroup.add(lowerBeakMesh);

    this.headGroup.add(upperBeakGroup);

    // Sleek Crest Feathers (Streamlined, gently swept back with yellow accents)
    this.crestPivot = new THREE.Group();
    this.crestPivot.position.set(0, 0.32, -0.06);

    // Main red crest feather
    const crestFeatherShape = new THREE.Shape();
    crestFeatherShape.moveTo(0, 0);
    crestFeatherShape.quadraticCurveTo(-0.06, 0.18, -0.02, 0.36);
    crestFeatherShape.quadraticCurveTo(0.04, 0.24, 0.05, 0);
    crestFeatherShape.closePath();

    const crestExtrudeSettings = {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    };
    const mainCrestGeo = new THREE.ExtrudeGeometry(crestFeatherShape, crestExtrudeSettings);
    mainCrestGeo.center();

    const mainCrestMesh = new THREE.Mesh(mainCrestGeo, scarletMat);
    mainCrestMesh.position.set(0, 0.14, -0.02);
    mainCrestMesh.rotation.x = -0.42;
    mainCrestMesh.castShadow = true;
    this.crestPivot.add(mainCrestMesh);

    // Golden crest highlight tuft
    const smallCrestGeo = new THREE.ConeGeometry(0.06, 0.22, 14);
    const smallCrestMesh = new THREE.Mesh(smallCrestGeo, goldenYellowMat);
    smallCrestMesh.position.set(0, 0.24, -0.08);
    smallCrestMesh.rotation.x = -0.65;
    smallCrestMesh.castShadow = true;
    this.crestPivot.add(smallCrestMesh);

    this.headGroup.add(this.crestPivot);
    this.group.add(this.headGroup);

    // ----------------------------------------------------
    // 4. SMOOTH SCULPTED ARTICULATED WINGS
    // ----------------------------------------------------
    // Create wing shape curves with smooth Bezier splines
    // Shoulder / Yellow Coverts
    const upperWingShape = new THREE.Shape();
    upperWingShape.moveTo(0, 0);
    upperWingShape.quadraticCurveTo(-0.35, 0.28, -0.65, 0.08);
    upperWingShape.quadraticCurveTo(-0.45, -0.22, 0, -0.16);
    upperWingShape.closePath();

    const upperWingGeo = new THREE.ExtrudeGeometry(upperWingShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.02,
      bevelThickness: 0.02,
    });

    // Flight Feathers / Blue Wing Extension
    const tipWingShape = new THREE.Shape();
    tipWingShape.moveTo(0, 0);
    tipWingShape.quadraticCurveTo(-0.38, 0.18, -0.72, -0.12);
    tipWingShape.quadraticCurveTo(-0.45, -0.32, 0, -0.18);
    tipWingShape.closePath();

    const tipWingGeo = new THREE.ExtrudeGeometry(tipWingShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    });

    // LEFT WING
    this.leftWingPivot = new THREE.Group();
    this.leftWingPivot.position.set(-0.32, 0.10, 0.12);

    // Upper golden coverts
    const leftUpperWing = new THREE.Mesh(upperWingGeo, goldenYellowMat);
    leftUpperWing.castShadow = true;
    this.leftWingPivot.add(leftUpperWing);

    // Intermediate royal blue layer
    const leftMidWing = new THREE.Mesh(upperWingGeo, royalBlueMat);
    leftMidWing.scale.set(0.92, 0.95, 0.85);
    leftMidWing.position.set(-0.12, -0.03, -0.06);
    leftMidWing.castShadow = true;
    this.leftWingPivot.add(leftMidWing);

    // Distal wing tip pivot (allows natural wing flexion during flap cycle)
    this.leftWingTipGroup = new THREE.Group();
    this.leftWingTipGroup.position.set(-0.58, 0.04, -0.02);
    const leftTipWing = new THREE.Mesh(tipWingGeo, deepBlueMat);
    leftTipWing.castShadow = true;
    this.leftWingTipGroup.add(leftTipWing);
    this.leftWingPivot.add(this.leftWingTipGroup);

    this.group.add(this.leftWingPivot);

    // RIGHT WING
    this.rightWingPivot = new THREE.Group();
    this.rightWingPivot.position.set(0.32, 0.10, 0.12);

    // Mirrored shape for right wing
    const rightUpperWingShape = new THREE.Shape();
    rightUpperWingShape.moveTo(0, 0);
    rightUpperWingShape.quadraticCurveTo(0.35, 0.28, 0.65, 0.08);
    rightUpperWingShape.quadraticCurveTo(0.45, -0.22, 0, -0.16);
    rightUpperWingShape.closePath();

    const rightUpperWingGeo = new THREE.ExtrudeGeometry(rightUpperWingShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.02,
      bevelThickness: 0.02,
    });

    const rightUpperWing = new THREE.Mesh(rightUpperWingGeo, goldenYellowMat);
    rightUpperWing.castShadow = true;
    this.rightWingPivot.add(rightUpperWing);

    const rightMidWing = new THREE.Mesh(rightUpperWingGeo, royalBlueMat);
    rightMidWing.scale.set(0.92, 0.95, 0.85);
    rightMidWing.position.set(0.12, -0.03, -0.06);
    rightMidWing.castShadow = true;
    this.rightWingPivot.add(rightMidWing);

    const rightTipWingShape = new THREE.Shape();
    rightTipWingShape.moveTo(0, 0);
    rightTipWingShape.quadraticCurveTo(0.38, 0.18, 0.72, -0.12);
    rightTipWingShape.quadraticCurveTo(0.45, -0.32, 0, -0.18);
    rightTipWingShape.closePath();

    const rightTipWingGeo = new THREE.ExtrudeGeometry(rightTipWingShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    });

    this.rightWingTipGroup = new THREE.Group();
    this.rightWingTipGroup.position.set(0.58, 0.04, -0.02);
    const rightTipWing = new THREE.Mesh(rightTipWingGeo, deepBlueMat);
    rightTipWing.castShadow = true;
    this.rightWingTipGroup.add(rightTipWing);
    this.rightWingPivot.add(this.rightWingTipGroup);

    this.group.add(this.rightWingPivot);

    // ----------------------------------------------------
    // 5. LONG FLOWING SCULPTED MACAW TAIL
    // ----------------------------------------------------
    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, -0.02, -0.52);

    // Upper tail coverts (Cobalt Blue)
    const upperTailGeo = new THREE.ConeGeometry(0.18, 0.65, 16);
    upperTailGeo.scale(1.4, 0.28, 1.0);
    const upperTailMesh = new THREE.Mesh(upperTailGeo, royalBlueMat);
    upperTailMesh.position.set(0, 0.02, -0.25);
    upperTailMesh.rotation.x = -Math.PI / 2 + 0.15;
    upperTailMesh.castShadow = true;
    this.tailPivot.add(upperTailMesh);

    // Central long graduated tail streamers (Iconic scarlet red streamers with blue bases)
    const streamerGeo = new THREE.ConeGeometry(0.12, 1.15, 14);
    streamerGeo.scale(1.2, 0.22, 1.0);
    const streamerMesh = new THREE.Mesh(streamerGeo, scarletMat);
    streamerMesh.position.set(0, 0, -0.62);
    streamerMesh.rotation.x = -Math.PI / 2 + 0.18;
    streamerMesh.castShadow = true;
    this.tailPivot.add(streamerMesh);

    // Side tapered tail feathers
    const leftStreamer = new THREE.Mesh(streamerGeo, deepBlueMat);
    leftStreamer.scale.set(0.75, 0.75, 0.75);
    leftStreamer.position.set(-0.09, -0.02, -0.48);
    leftStreamer.rotation.x = -Math.PI / 2 + 0.2;
    leftStreamer.rotation.z = -0.12;
    leftStreamer.castShadow = true;
    this.tailPivot.add(leftStreamer);

    const rightStreamer = new THREE.Mesh(streamerGeo, deepBlueMat);
    rightStreamer.scale.set(0.75, 0.75, 0.75);
    rightStreamer.position.set(0.09, -0.02, -0.48);
    rightStreamer.rotation.x = -Math.PI / 2 + 0.2;
    rightStreamer.rotation.z = 0.12;
    rightStreamer.castShadow = true;
    this.tailPivot.add(rightStreamer);

    this.group.add(this.tailPivot);

    // ----------------------------------------------------
    // 6. SMOOTH SCULPTED FEET / CLAWS
    // ----------------------------------------------------
    const legGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.2, 12);
    const clawToeGeo = new THREE.ConeGeometry(0.03, 0.14, 10);

    // Left Foot
    const leftFootGroup = new THREE.Group();
    leftFootGroup.position.set(-0.14, -0.32, -0.08);
    leftFootGroup.rotation.x = 0.55; // Aerodynamically tucked back

    const leftLeg = new THREE.Mesh(legGeo, clawMat);
    leftLeg.position.set(0, -0.08, 0);
    leftFootGroup.add(leftLeg);

    const leftToe1 = new THREE.Mesh(clawToeGeo, clawMat);
    leftToe1.position.set(0, -0.17, 0.06);
    leftToe1.rotation.x = Math.PI / 3;
    leftFootGroup.add(leftToe1);

    const leftToe2 = new THREE.Mesh(clawToeGeo, clawMat);
    leftToe2.position.set(-0.04, -0.17, 0.05);
    leftToe2.rotation.x = Math.PI / 3;
    leftToe2.rotation.z = -0.2;
    leftFootGroup.add(leftToe2);

    this.group.add(leftFootGroup);

    // Right Foot
    const rightFootGroup = new THREE.Group();
    rightFootGroup.position.set(0.14, -0.32, -0.08);
    rightFootGroup.rotation.x = 0.55;

    const rightLeg = new THREE.Mesh(legGeo, clawMat);
    rightLeg.position.set(0, -0.08, 0);
    rightFootGroup.add(rightLeg);

    const rightToe1 = new THREE.Mesh(clawToeGeo, clawMat);
    rightToe1.position.set(0, -0.17, 0.06);
    rightToe1.rotation.x = Math.PI / 3;
    rightFootGroup.add(rightToe1);

    const rightToe2 = new THREE.Mesh(clawToeGeo, clawMat);
    rightToe2.position.set(0.04, -0.17, 0.05);
    rightToe2.rotation.x = Math.PI / 3;
    rightToe2.rotation.z = 0.2;
    rightFootGroup.add(rightToe2);

    this.group.add(rightFootGroup);

    // ----------------------------------------------------
    // 7. SMOOTH DRIFTING FEATHER PARTICLES (Crash FX)
    // ----------------------------------------------------
    this.featherParticlesGroup = new THREE.Group();
    this.group.add(this.featherParticlesGroup);
    this.setupFeatherParticles();
  }

  private setupFeatherParticles() {
    const count = 36;
    const featherColors = [
      0xef4444, // Vibrant Scarlet Red
      0xf97316, // Sunset Orange
      0xfacc15, // Canary Gold
      0x10b981, // Emerald Green
      0x06b6d4, // Cyan Turquoise
      0x2563eb, // Cobalt Blue
      0x7c3aed, // Royal Violet
      0xec4899, // Bright Orchid Pink
      0xf43f5e, // Crimson Rose
      0x14b8a6, // Teal Mint
      0xffd166, // Goldenrod
      0x06d6a0, // Radiant Aquamarine
    ];

    // Smooth curved feather leaf shape
    const featherShape = new THREE.Shape();
    featherShape.moveTo(0, 0);
    featherShape.quadraticCurveTo(-0.06, 0.16, 0, 0.32);
    featherShape.quadraticCurveTo(0.06, 0.16, 0, 0);
    featherShape.closePath();

    const featherGeo = new THREE.ShapeGeometry(featherShape, 6);
    featherGeo.center();

    for (let i = 0; i < count; i++) {
      const color = featherColors[i % featherColors.length];
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(featherGeo, mat);
      mesh.visible = false;
      this.featherParticlesGroup.add(mesh);

      this.featherParticles.push({
        mesh,
        vel: new THREE.Vector3(),
        rotSpeed: new THREE.Vector3(),
      });
    }

    // ----------------------------------------------------
    // 6. UNCHARTED GOLDEN STARDUST VORTEX PARTICLES
    // ----------------------------------------------------
    this.stardustGroup = new THREE.Group();
    this.group.add(this.stardustGroup);

    const stardustGeo = new THREE.DodecahedronGeometry(0.065, 0);
    const stardustColors = [0xfacc15, 0xfde047, 0xf59e0b, 0x38bdf8];

    for (let i = 0; i < 32; i++) {
      const col = stardustColors[i % stardustColors.length];
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(stardustGeo, mat);
      mesh.visible = false;
      this.stardustGroup.add(mesh);

      this.stardustParticles.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.65,
        startScale: 0.065,
      });
    }

    // ----------------------------------------------------
    // Immunity Aegis Shield Mesh & Rotating Rings
    // ----------------------------------------------------
    this.immunityShieldGroup = new THREE.Group();
    this.immunityShieldGroup.visible = false;

    const shieldGeo = new THREE.SphereGeometry(0.95, 18, 14);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shieldSphereMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.immunityShieldGroup.add(this.shieldSphereMesh);

    const shieldRingGeo = new THREE.TorusGeometry(0.98, 0.028, 8, 36);
    const shieldRingMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    this.shieldRingMesh = new THREE.Mesh(shieldRingGeo, shieldRingMat);
    this.shieldRingMesh.rotation.x = Math.PI / 4;
    this.immunityShieldGroup.add(this.shieldRingMesh);

    // Inner wireframe sphere for energy lattice look
    const wireGeo = new THREE.IcosahedronGeometry(0.92, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    this.immunityShieldGroup.add(wireMesh);

    this.group.add(this.immunityShieldGroup);

    // ----------------------------------------------------
    // Speed Boost Wingtip Wind Trail Particles
    // ----------------------------------------------------
    this.speedTrailGroup = new THREE.Group();
    this.group.add(this.speedTrailGroup);

    const speedGeo = new THREE.BoxGeometry(0.05, 0.05, 0.35);
    const speedMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(speedGeo, speedMat.clone());
      mesh.visible = false;
      this.speedTrailGroup.add(mesh);
      this.speedParticles.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
        startScale: 1.0,
      });
    }
  }

  public setBuffEffects(speedActive: boolean, immunityActive: boolean) {
    this.isSpeedActive = speedActive;
    this.isImmunityActive = immunityActive;
    this.immunityShieldGroup.visible = immunityActive;
  }

  public triggerShieldDeflect() {
    this.shieldDeflectPulse = 1.0;
  }

  public setUnchartedMode(active: boolean) {
    this.isUncharted = active;
  }

  public getIsUncharted(): boolean {
    return this.isUncharted;
  }

  public triggerFeatherExplosion() {
    for (const p of this.featherParticles) {
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 1.0;
      p.mesh.position.set(
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.35
      );
      p.vel.set(
        (Math.random() - 0.5) * 6.5,
        Math.random() * 4.5 + 1.2,
        (Math.random() - 0.5) * 6.5
      );
      p.rotSpeed.set(
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 12.0
      );
    }
  }

  public triggerFlapImpulse() {
    this.flapPhase = 0;
    this.flapSpeed = 22; // rapid, energetic downstroke
  }

  /**
   * Energetic golden sparkle burst from both wingtips when touching a spinning ring
   */
  public triggerRingCollectEffects() {
    const emitBurst = (tipGroup: THREE.Group) => {
      const tipWorld = new THREE.Vector3();
      tipGroup.getWorldPosition(tipWorld);
      const localPos = new THREE.Vector3();
      this.stardustGroup.worldToLocal(localPos.copy(tipWorld));

      let spawned = 0;
      for (const p of this.stardustParticles) {
        if (!p.mesh.visible && spawned < 6) {
          p.mesh.visible = true;
          p.life = 0;
          p.maxLife = 0.55 + Math.random() * 0.25;
          p.mesh.position.copy(localPos);
          p.mesh.position.x += (Math.random() - 0.5) * 0.15;
          p.mesh.position.y += (Math.random() - 0.5) * 0.15;
          p.mesh.position.z += (Math.random() - 0.5) * 0.15;
          p.vel.set(
            (Math.random() - 0.5) * 2.8,
            (Math.random() - 0.5) * 2.2 + 0.6,
            -3.5 - Math.random() * 2.5
          );
          const mat = p.mesh.material as THREE.MeshBasicMaterial;
          mat.color.setHex(Math.random() > 0.4 ? 0xfacc15 : 0xffffff);
          mat.opacity = 1.0;
          p.mesh.scale.setScalar(1.35);
          spawned++;
        }
      }
    };

    emitBurst(this.leftWingTipGroup);
    emitBurst(this.rightWingTipGroup);
  }

  public update(delta: number, verticalVel: number, isAlive: boolean) {
    if (isAlive) {
      // Natural flap speed decaying toward a calm cruise glide
      this.flapSpeed = THREE.MathUtils.lerp(this.flapSpeed, 7.2, delta * 3.2);
      this.flapPhase += this.flapSpeed * delta;

      const sinWave = Math.sin(this.flapPhase);
      const cosWave = Math.cos(this.flapPhase);

      // Smooth organic wing flapping
      const mainWingAngle = sinWave * 0.72; // ~41° primary shoulder stroke
      this.leftWingPivot.rotation.z = -mainWingAngle;
      this.rightWingPivot.rotation.z = mainWingAngle;

      // Aerodynamic trailing wingtip flexion
      const tipFlex = -cosWave * 0.32;
      this.leftWingTipGroup.rotation.z = -tipFlex;
      this.rightWingTipGroup.rotation.z = tipFlex;

      // Slight wing sweep during downstroke
      this.leftWingPivot.rotation.y = -Math.abs(sinWave) * 0.20;
      this.rightWingPivot.rotation.y = Math.abs(sinWave) * 0.20;

      // Gentle crest feather breathing/fluttering
      this.crestPivot.rotation.x = -0.05 + Math.sin(this.flapPhase * 1.2) * 0.12;

      // Long macaw tail streamlines and gently undulates with pitch velocity
      this.tailPivot.rotation.x = 0.12 + Math.sin(this.flapPhase * 0.5) * 0.14 - verticalVel * 0.022;
      this.tailPivot.rotation.y = Math.sin(this.flapPhase * 0.25) * 0.05;

      // Smooth rhythmic head bobbing
      this.headGroup.position.y = 0.26 + Math.sin(this.flapPhase) * 0.02;
    } else {
      // Crash state: wings gracefully droop limp
      this.leftWingPivot.rotation.z = THREE.MathUtils.lerp(this.leftWingPivot.rotation.z, 0.75, delta * 7);
      this.rightWingPivot.rotation.z = THREE.MathUtils.lerp(this.rightWingPivot.rotation.z, -0.75, delta * 7);
      this.leftWingTipGroup.rotation.z = THREE.MathUtils.lerp(this.leftWingTipGroup.rotation.z, 0.4, delta * 7);
      this.rightWingTipGroup.rotation.z = THREE.MathUtils.lerp(this.rightWingTipGroup.rotation.z, -0.4, delta * 7);
    }

    // Eye blinking timer
    this.blinkTimer += delta;
    if (this.blinkTimer > 3.2) {
      this.isBlinking = true;
      this.leftPupil.scale.y = 0.1;
      this.rightPupil.scale.y = 0.1;
      if (this.blinkTimer > 3.35) {
        this.blinkTimer = 0;
        this.isBlinking = false;
        this.leftPupil.scale.y = 1.0;
        this.rightPupil.scale.y = 1.0;
      }
    }

    // Feather particles drifting and tumbling with air drag
    for (const p of this.featherParticles) {
      if (p.mesh.visible) {
        const mat = p.mesh.material as THREE.MeshStandardMaterial;
        if (mat.opacity > 0.02) {
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0, delta * 1.4);
          p.vel.y -= 7.5 * delta; // Soft feather float gravity
          p.vel.x *= 0.95; // Feather air drag
          p.vel.z *= 0.95;

          p.mesh.position.addScaledVector(p.vel, delta);
          p.mesh.rotation.x += p.rotSpeed.x * delta;
          p.mesh.rotation.y += p.rotSpeed.y * delta;
          p.mesh.rotation.z += p.rotSpeed.z * delta;
        } else {
          p.mesh.visible = false;
        }
      }
    }

    // ----------------------------------------------------
    // Uncharted Pioneer Stardust Wingtip Emission
    // ----------------------------------------------------
    if (this.isUncharted && isAlive) {
      this.stardustSpawnTimer += delta;
      if (this.stardustSpawnTimer >= 0.035) {
        this.stardustSpawnTimer = 0;

        // Emit from left and right wingtips
        const emitWingtip = (wingTipGroup: THREE.Group) => {
          const p = this.stardustParticles.find((item) => !item.mesh.visible);
          if (p) {
            p.mesh.visible = true;
            p.life = 0;
            p.maxLife = 0.55 + Math.random() * 0.25;

            // Get local position of wingtip
            const tipPos = new THREE.Vector3();
            wingTipGroup.getWorldPosition(tipPos);
            this.stardustGroup.worldToLocal(tipPos);

            p.mesh.position.copy(tipPos);
            p.mesh.position.x += (Math.random() - 0.5) * 0.12;
            p.mesh.position.y += (Math.random() - 0.5) * 0.12;
            p.mesh.position.z += (Math.random() - 0.5) * 0.12;

            p.vel.set(
              (Math.random() - 0.5) * 0.8,
              (Math.random() - 0.5) * 0.6,
              -2.2 - Math.random() * 1.5 // Stream backward in the wake
            );
            (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
            p.mesh.scale.setScalar(1.0);
          }
        };

        emitWingtip(this.leftWingTipGroup);
        emitWingtip(this.rightWingTipGroup);
      }
    }

    // Update stardust particles
    for (const p of this.stardustParticles) {
      if (p.mesh.visible) {
        p.life += delta;
        const progress = p.life / p.maxLife;
        if (progress >= 1.0) {
          p.mesh.visible = false;
        } else {
          const mat = p.mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = (1.0 - progress) * 0.9;
          const scale = (1.0 - progress * 0.6);
          p.mesh.scale.setScalar(scale);
          p.mesh.position.addScaledVector(p.vel, delta);
          p.vel.z *= 0.96;
        }
      }
    }

    // ----------------------------------------------------
    // Update Immunity Shield Animation
    // ----------------------------------------------------
    if (this.isImmunityActive && isAlive) {
      this.shieldRingMesh.rotation.z += delta * 4.0;
      this.shieldRingMesh.rotation.y += delta * 2.5;

      // Pulse on deflect
      if (this.shieldDeflectPulse > 0) {
        this.shieldDeflectPulse = Math.max(0, this.shieldDeflectPulse - delta * 3.5);
        const scale = 1.0 + this.shieldDeflectPulse * 0.25;
        this.immunityShieldGroup.scale.setScalar(scale);
        (this.shieldSphereMesh.material as THREE.MeshBasicMaterial).opacity = 0.38 + this.shieldDeflectPulse * 0.5;
      } else {
        const breathing = Math.sin(this.flapPhase * 2.0) * 0.04;
        this.immunityShieldGroup.scale.setScalar(1.0 + breathing);
        (this.shieldSphereMesh.material as THREE.MeshBasicMaterial).opacity = 0.38 + breathing * 1.5;
      }
    }

    // ----------------------------------------------------
    // Update Speed Boost Wind Stream Trails
    // ----------------------------------------------------
    if (this.isSpeedActive && isAlive) {
      this.speedSpawnTimer += delta;
      if (this.speedSpawnTimer >= 0.03) {
        this.speedSpawnTimer = 0;

        const emitSpeedTrail = (wingTipGroup: THREE.Group) => {
          const p = this.speedParticles[this.nextSpeedParticleIndex];
          this.nextSpeedParticleIndex = (this.nextSpeedParticleIndex + 1) % this.speedParticles.length;

          p.mesh.visible = true;
          p.life = 0;
          p.maxLife = 0.28 + Math.random() * 0.15;

          wingTipGroup.getWorldPosition(this.scratchTipPos);
          this.speedTrailGroup.worldToLocal(this.scratchTipPos);

          p.mesh.position.copy(this.scratchTipPos);
          p.vel.set(
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
            -4.5 - Math.random() * 2.0
          );
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
          p.mesh.scale.setScalar(1.0);
        };

        emitSpeedTrail(this.leftWingTipGroup);
        emitSpeedTrail(this.rightWingTipGroup);
      }
    }

    // Update speed particles
    for (const p of this.speedParticles) {
      if (p.mesh.visible) {
        p.life += delta;
        const progress = p.life / p.maxLife;
        if (progress >= 1.0) {
          p.mesh.visible = false;
        } else {
          const mat = p.mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = (1.0 - progress) * 0.9;
          p.mesh.position.addScaledVector(p.vel, delta);
          p.vel.z *= 0.94;
        }
      }
    }
  }

  public reset() {
    this.flapPhase = 0;
    this.flapSpeed = 8;
    this.isUncharted = false;
    this.isImmunityActive = false;
    this.isSpeedActive = false;
    this.shieldDeflectPulse = 0;
    if (this.immunityShieldGroup) {
      this.immunityShieldGroup.visible = false;
    }
    for (const p of this.featherParticles) {
      p.mesh.visible = false;
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0;
    }
    for (const p of this.stardustParticles) {
      p.mesh.visible = false;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    for (const p of this.speedParticles) {
      p.mesh.visible = false;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }
}


