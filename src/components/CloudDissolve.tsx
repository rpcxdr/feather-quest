import React, { useEffect, useRef, useCallback } from 'react';

interface CloudDissolveProps {
  active: boolean;
  onComplete?: () => void;
  buttonRect: DOMRect | null;
}

interface CloudParticle {
  r: number;
  theta: number;
  vr: number;
  omega: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  scale: number;
  targetScale: number;
  rotation: number;
  rotSpeed: number;
  life: number;
  maxLife: number;
  type: 'crest' | 'core' | 'wisp';
  initialAlpha: number;
}

/**
 * Creates an authentic procedural cloud puff canvas texture with multi-octave harmonic noise
 * and smooth cubic-ease radial falloff, identical to the sky's cumulus cloud system.
 */
export function createPuffCanvas(size: number, tint: 'crest' | 'core' | 'wisp'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  // Simple deterministic permutation table for 2D value noise
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = tint === 'crest' ? 101 : tint === 'wisp' ? 202 : 42;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const noise2D = (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = perm[X] + Y;
    const b = perm[X + 1] + Y;
    const v00 = (perm[a] % 100) / 100;
    const v10 = (perm[b] % 100) / 100;
    const v01 = (perm[a + 1] % 100) / 100;
    const v11 = (perm[b + 1] % 100) / 100;
    const x1 = v00 + u * (v10 - v00);
    const x2 = v01 + u * (v11 - v01);
    return x1 + v * (x2 - x1);
  };

  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const ny = (y - half) / (half * 0.88);
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / (half * 0.88);
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist >= 1.0) continue;

      // Multi-harmonic cumulus billow lobes
      const n =
        noise2D(nx * 3.2 + 8.0, ny * 3.2 + 8.0) * 0.55 +
        noise2D(nx * 6.5 + 16.0, ny * 6.5 + 16.0) * 0.30 +
        noise2D(nx * 13.0 + 24.0, ny * 13.0 + 24.0) * 0.15;

      const maxRadius = 0.72 + 0.38 * n;
      const normDist = dist / maxRadius;
      if (normDist >= 1.0) continue;

      const falloff = 1.0 - normDist;
      const ease = falloff * falloff * (3.0 - 2.0 * falloff);
      const alpha = Math.min(1.0, Math.pow(ease * (0.85 + 0.35 * n), 1.15));

      const idx = (y * size + x) * 4;
      if (tint === 'crest') {
        // Sunlit warm golden-white crest
        data[idx] = 255;
        data[idx + 1] = 252;
        data[idx + 2] = 240;
      } else if (tint === 'wisp') {
        // Ambient sky-tinted translucent wisp
        data[idx] = 224;
        data[idx + 1] = 238;
        data[idx + 2] = 250;
      } else {
        // Volumetric pure white body
        data[idx] = 248;
        data[idx + 1] = 250;
        data[idx + 2] = 252;
      }
      data[idx + 3] = Math.floor(alpha * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export const CloudDissolve: React.FC<CloudDissolveProps> = ({ active, onComplete, buttonRect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const texturesRef = useRef<{
    crest: HTMLCanvasElement;
    core: HTMLCanvasElement;
    wisp: HTMLCanvasElement;
  } | null>(null);

  const particlesRef = useRef<CloudParticle[]>([]);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Lazy-initialize the 3 procedural cloud puff canvas textures once
  const getTextures = useCallback(() => {
    if (!texturesRef.current) {
      texturesRef.current = {
        crest: createPuffCanvas(128, 'crest'),
        core: createPuffCanvas(128, 'core'),
        wisp: createPuffCanvas(128, 'wisp'),
      };
    }
    return texturesRef.current;
  }, []);

  useEffect(() => {
    if (!active) {
      particlesRef.current = [];
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to full viewport
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const textures = getTextures();

    // Determine spawn origin (center of the Fly button, or viewport center as fallback)
    const cx = buttonRect ? buttonRect.left + buttonRect.width / 2 : width / 2;
    const cy = buttonRect ? buttonRect.top + buttonRect.height / 2 : height / 2;
    const bWidth = buttonRect ? buttonRect.width : 280;
    const bHeight = buttonRect ? buttonRect.height : 90;

    // Pick consistent swirl direction (+1 clockwise, -1 counter-clockwise)
    const swirlDir = Math.random() > 0.5 ? 1 : -1;

    // Max distance to reach and surpass the farthest corner of the viewport
    const screenReach = Math.max(width, height) * 0.85;

    const particles: CloudParticle[] = [];

    // TIER 1: Core Dissolve Puffs (18 particles)
    // Instantly envelop the button and blossom outward
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const rx = (bWidth * 0.35) * (0.3 + Math.random() * 0.7);
      const ry = (bHeight * 0.35) * (0.3 + Math.random() * 0.7);
      const px = cx + Math.cos(angle) * rx;
      const py = cy + Math.sin(angle) * ry;

      const rInit = Math.hypot(px - cx, py - cy);
      const thetaInit = Math.atan2(py - cy, px - cx);

      particles.push({
        r: rInit,
        theta: thetaInit,
        vr: 180 + Math.random() * 220,
        omega: swirlDir * (2.2 + Math.random() * 1.2),
        x: px,
        y: py,
        driftX: 0,
        driftY: 0,
        scale: 0.7 + Math.random() * 0.3,
        targetScale: 2.8 + Math.random() * 1.5,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 1.2,
        life: 0,
        maxLife: 0.85 + Math.random() * 0.25,
        type: Math.random() > 0.4 ? 'core' : 'crest',
        initialAlpha: 0.95,
      });
    }

    // TIER 2: Mid-Field Swirling Cumulus Billows (28 particles)
    // Expanding vortex arms that bridge from the button to the outer screen
    for (let i = 0; i < 28; i++) {
      // 4 primary vortex spiral arm clusters
      const armBase = (Math.floor(i / 7) / 4) * Math.PI * 2;
      const angle = armBase + (Math.random() - 0.5) * 0.7;
      const rInit = 35 + Math.random() * (bWidth * 0.45);
      const px = cx + Math.cos(angle) * rInit;
      const py = cy + Math.sin(angle) * (rInit * 0.65);

      particles.push({
        r: rInit,
        theta: angle,
        vr: 380 + Math.random() * 320,
        omega: swirlDir * (2.6 + Math.random() * 1.4),
        x: px,
        y: py,
        driftX: 0,
        driftY: 0,
        scale: 0.6 + Math.random() * 0.4,
        targetScale: 4.5 + Math.random() * 2.2,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 1.5,
        life: 0,
        maxLife: 1.1 + Math.random() * 0.25,
        type: i % 2 === 0 ? 'crest' : 'wisp',
        initialAlpha: 0.92,
      });
    }

    // TIER 3: Grand Outer Swirling Clouds (32 particles)
    // High-speed expansive cumulus bank particles that swirl all the way to the screen sides and beyond
    for (let i = 0; i < 32; i++) {
      const armBase = ((i % 4) / 4) * Math.PI * 2;
      const angle = armBase + (Math.random() - 0.5) * 0.8;
      const rInit = 40 + Math.random() * 60;
      const px = cx + Math.cos(angle) * rInit;
      const py = cy + Math.sin(angle) * rInit;

      // High radial velocity designed to span the full screen radius
      const targetDist = screenReach * (0.8 + Math.random() * 0.45);
      const estLife = 1.25 + Math.random() * 0.3;
      const neededVr = targetDist / estLife;

      particles.push({
        r: rInit,
        theta: angle,
        vr: Math.max(550, neededVr),
        omega: swirlDir * (2.8 + Math.random() * 1.6),
        x: px,
        y: py,
        driftX: 0,
        driftY: 0,
        scale: 0.7 + Math.random() * 0.5,
        // Huge billowing cloud lobes (up to 800-1000px wide) sweeping across the screen edges
        targetScale: 6.5 + Math.random() * 3.2,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 1.8,
        life: 0,
        maxLife: estLife,
        type: i % 3 === 0 ? 'crest' : i % 3 === 1 ? 'core' : 'wisp',
        initialAlpha: 0.88,
      });
    }

    particlesRef.current = particles;
    startTimeRef.current = performance.now();

    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let aliveCount = 0;

      for (const p of particlesRef.current) {
        p.life += dt;
        if (p.life >= p.maxLife) continue;
        aliveCount++;

        const progress = p.life / p.maxLife;

        // Swirling vortex physics:
        // Angular speed decreases slightly with distance as vortex expands (conservation of angular momentum)
        const currentOmega = p.omega / Math.pow(1 + p.r / 250, 0.45);
        p.theta += currentOmega * dt;
        p.r += p.vr * dt;
        p.vr *= 0.985; // smooth deceleration while still sweeping all the way to the sides

        // Atmospheric buoyancy and wind drift
        p.driftY -= 20 * dt; // subtle thermal updraft
        p.rotation += p.rotSpeed * dt;

        p.x = cx + Math.cos(p.theta) * p.r + p.driftX;
        p.y = cy + Math.sin(p.theta) * p.r + p.driftY;

        // Non-linear cubic expansion so the cloud blooms rapidly then billows across the screen
        const expansionEase = 1 - Math.pow(1 - progress, 2.5);
        const currentScale = p.scale + (p.targetScale - p.scale) * expansionEase;

        // Alpha envelope:
        // Fast bloom in first 12% so the button is covered in white cloud vapor immediately
        // High opacity during mid-swirl across screen
        // Smooth dissipation as it reaches screen sides
        let alpha = p.initialAlpha;
        if (progress < 0.12) {
          alpha *= progress / 0.12;
        } else if (progress > 0.45) {
          const fadeProgress = (progress - 0.45) / 0.55;
          const fadeEase = Math.pow(1 - fadeProgress, 1.8);
          alpha *= fadeEase;
        }

        const puffTex = textures[p.type];
        const drawSize = 128 * currentScale;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.drawImage(puffTex, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
      }

      if (aliveCount > 0) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (onComplete) {
          onComplete();
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [active, buttonRect, getTextures, onComplete]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-40"
      style={{ touchAction: 'none' }}
    />
  );
};
