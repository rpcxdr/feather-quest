import * as THREE from 'three';

interface BarTheme {
  trackBg: string;
  trackBorder: string;
  fillColorStart: string;
  fillColorEnd: string;
  glowColor: string;
}

const SPEED_THEME: BarTheme = {
  trackBg: 'rgba(8, 47, 73, 0.82)',
  trackBorder: 'rgba(34, 211, 238, 0.9)',
  fillColorStart: '#06b6d4',
  fillColorEnd: '#22d3ee',
  glowColor: 'rgba(6, 182, 212, 0.85)',
};

const IMMUNITY_THEME: BarTheme = {
  trackBg: 'rgba(6, 78, 59, 0.82)',
  trackBorder: 'rgba(52, 211, 153, 0.9)',
  fillColorStart: '#059669',
  fillColorEnd: '#34d399',
  glowColor: 'rgba(16, 185, 129, 0.85)',
};

export class TotemTimerBar {
  public group: THREE.Group;

  private speedCanvas: HTMLCanvasElement;
  private speedCtx: CanvasRenderingContext2D;
  private speedTexture: THREE.CanvasTexture;
  private speedMesh: THREE.Mesh;

  private immunityCanvas: HTMLCanvasElement;
  private immunityCtx: CanvasRenderingContext2D;
  private immunityTexture: THREE.CanvasTexture;
  private immunityMesh: THREE.Mesh;

  private readonly canvasWidth = 512;
  private readonly canvasHeight = 96;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    // Shared plane geometry (wide pill aspect ratio)
    const planeGeo = new THREE.PlaneGeometry(1.5, 0.28);

    // 1. Speed bar setup
    this.speedCanvas = document.createElement('canvas');
    this.speedCanvas.width = this.canvasWidth;
    this.speedCanvas.height = this.canvasHeight;
    this.speedCtx = this.speedCanvas.getContext('2d')!;

    this.speedTexture = new THREE.CanvasTexture(this.speedCanvas);
    this.speedTexture.minFilter = THREE.LinearFilter;
    this.speedTexture.magFilter = THREE.LinearFilter;

    const speedMat = new THREE.MeshBasicMaterial({
      map: this.speedTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.speedMesh = new THREE.Mesh(planeGeo, speedMat);
    this.speedMesh.renderOrder = 999;
    this.speedMesh.visible = false;
    this.group.add(this.speedMesh);

    // 2. Immunity bar setup
    this.immunityCanvas = document.createElement('canvas');
    this.immunityCanvas.width = this.canvasWidth;
    this.immunityCanvas.height = this.canvasHeight;
    this.immunityCtx = this.immunityCanvas.getContext('2d')!;

    this.immunityTexture = new THREE.CanvasTexture(this.immunityCanvas);
    this.immunityTexture.minFilter = THREE.LinearFilter;
    this.immunityTexture.magFilter = THREE.LinearFilter;

    const immunityMat = new THREE.MeshBasicMaterial({
      map: this.immunityTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.immunityMesh = new THREE.Mesh(planeGeo, immunityMat);
    this.immunityMesh.renderOrder = 999;
    this.immunityMesh.visible = false;
    this.group.add(this.immunityMesh);
  }

  /**
   * Draws a flat, wide pill-shaped progress bar on the target canvas.
   * Progress is 1.0 (100% full) down to 0.0 (0% empty).
   */
  private renderBar(
    ctx: CanvasRenderingContext2D,
    progress: number,
    theme: BarTheme
  ) {
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    ctx.clearRect(0, 0, width, height);

    const padX = 12;
    const padY = 12;
    const pillW = width - padX * 2;
    const pillH = height - padY * 2;
    const pillRadius = pillH / 2;

    // Outer glow & track background
    ctx.save();
    ctx.shadowColor = theme.glowColor;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = theme.trackBorder;
    ctx.lineWidth = 4;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(padX, padY, pillW, pillH, pillRadius);
    } else {
      ctx.arc(padX + pillRadius, padY + pillRadius, pillRadius, Math.PI / 2, (Math.PI * 3) / 2);
      ctx.arc(padX + pillW - pillRadius, padY + pillRadius, pillRadius, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
    }
    ctx.fillStyle = theme.trackBg;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Fill bar clipped to inner pill track
    const clampedProgress = Math.min(1.0, Math.max(0.0, progress));
    if (clampedProgress > 0.001) {
      ctx.save();
      const inset = 4;
      const innerW = pillW - inset * 2;
      const innerH = pillH - inset * 2;
      const innerR = Math.max(0, pillRadius - inset);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(padX + inset, padY + inset, innerW, innerH, innerR);
      } else {
        ctx.arc(padX + inset + innerR, padY + inset + innerR, innerR, Math.PI / 2, (Math.PI * 3) / 2);
        ctx.arc(padX + inset + innerW - innerR, padY + inset + innerR, innerR, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
      }
      ctx.clip();

      const fillWidth = innerW * clampedProgress;
      const grad = ctx.createLinearGradient(padX + inset, 0, padX + inset + innerW, 0);
      grad.addColorStop(0, theme.fillColorStart);
      grad.addColorStop(1, theme.fillColorEnd);
      ctx.fillStyle = grad;
      ctx.fillRect(padX + inset, padY + inset, fillWidth, innerH);

      // Subtle translucent gloss sheen on top half
      const glossGrad = ctx.createLinearGradient(0, padY + inset, 0, padY + inset + innerH * 0.5);
      glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = glossGrad;
      ctx.fillRect(padX + inset, padY + inset, fillWidth, innerH * 0.5);

      ctx.restore();
    }
  }

  /**
   * Main per-frame update: positions under the bird, copies camera quaternion
   * for perfect billboard alignment, and updates fill progress.
   */
  public update(
    birdPos: THREE.Vector3,
    camera: THREE.Camera,
    speedTime: number,
    immunityTime: number,
    maxDuration: number = 5.0,
    isFirstPerson: boolean = false
  ) {
    const hasSpeed = speedTime > 0.02;
    const hasImmunity = immunityTime > 0.02;

    if (!hasSpeed && !hasImmunity) {
      if (this.group.visible) {
        this.group.visible = false;
        this.speedMesh.visible = false;
        this.immunityMesh.visible = false;
      }
      return;
    }

    this.group.visible = true;

    if (isFirstPerson) {
      // In first-person cockpit, float HUD timer bar in front of camera at bottom edge
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      this.group.position.copy(camera.position).addScaledVector(camForward, 2.4).addScaledVector(camUp, -0.75);
      this.group.quaternion.copy(camera.quaternion);
      this.group.scale.set(0.68, 0.68, 0.68);
    } else {
      this.group.position.copy(birdPos);
      this.group.quaternion.copy(camera.quaternion);
      this.group.scale.set(1.0, 1.0, 1.0);
    }

    if (hasSpeed && hasImmunity) {
      // Both active: neatly stack speed on top, immunity below, sitting directly under the shield sphere (radius ~0.98 - 1.22)
      this.speedMesh.visible = true;
      this.immunityMesh.visible = true;
      this.speedMesh.position.set(0, -1.30, 0);
      this.immunityMesh.position.set(0, -1.62, 0);

      const speedProgress = speedTime / maxDuration;
      this.renderBar(this.speedCtx, speedProgress, SPEED_THEME);
      this.speedTexture.needsUpdate = true;

      const immunityProgress = immunityTime / maxDuration;
      this.renderBar(this.immunityCtx, immunityProgress, IMMUNITY_THEME);
      this.immunityTexture.needsUpdate = true;
    } else if (hasSpeed) {
      this.speedMesh.visible = true;
      this.immunityMesh.visible = false;
      this.speedMesh.position.set(0, -1.35, 0);

      const speedProgress = speedTime / maxDuration;
      this.renderBar(this.speedCtx, speedProgress, SPEED_THEME);
      this.speedTexture.needsUpdate = true;
    } else {
      this.speedMesh.visible = false;
      this.immunityMesh.visible = true;
      this.immunityMesh.position.set(0, -1.35, 0);

      const immunityProgress = immunityTime / maxDuration;
      this.renderBar(this.immunityCtx, immunityProgress, IMMUNITY_THEME);
      this.immunityTexture.needsUpdate = true;
    }
  }

  public hide() {
    this.group.visible = false;
    this.speedMesh.visible = false;
    this.immunityMesh.visible = false;
  }

  public reset() {
    this.hide();
  }

  public dispose() {
    this.speedTexture.dispose();
    this.immunityTexture.dispose();
    (this.speedMesh.material as THREE.Material).dispose();
    (this.immunityMesh.material as THREE.Material).dispose();
    this.speedMesh.geometry.dispose();
    this.immunityMesh.geometry.dispose();
  }
}
