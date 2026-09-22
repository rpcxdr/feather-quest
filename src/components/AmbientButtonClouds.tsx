import React, { useEffect, useRef } from 'react';
import { createPuffCanvas } from './CloudDissolve';

interface AmbientButtonCloudsProps {
  isDissolving: boolean;
}

interface AmbientPuff {
  offsetX: number;
  offsetY: number;
  baseScale: number;
  rotSpeed: number;
  rotation: number;
  type: 'crest' | 'core' | 'wisp';
  alpha: number;
  phase: number;
  orbitRadius: number;
  orbitSpeed: number;
}

export const AmbientButtonClouds: React.FC<AmbientButtonCloudsProps> = ({ isDissolving }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const texturesRef = useRef<{
    crest: HTMLCanvasElement;
    core: HTMLCanvasElement;
    wisp: HTMLCanvasElement;
  } | null>(null);

  const puffsRef = useRef<AmbientPuff[]>([
    // Top-center pure white puff
    {
      offsetX: 0,
      offsetY: -38,
      baseScale: 1.65,
      rotSpeed: 0.16,
      rotation: 0.4,
      type: 'core',
      alpha: 0.9,
      phase: 0.2,
      orbitRadius: 9,
      orbitSpeed: 0.35,
    },
    // Top-left pure white puff
    {
      offsetX: -95,
      offsetY: -32,
      baseScale: 1.55,
      rotSpeed: -0.2,
      rotation: 1.8,
      type: 'core',
      alpha: 0.88,
      phase: 1.4,
      orbitRadius: 11,
      orbitSpeed: -0.32,
    },
    // Top-right pure white puff
    {
      offsetX: 100,
      offsetY: -30,
      baseScale: 1.58,
      rotSpeed: 0.18,
      rotation: 2.7,
      type: 'core',
      alpha: 0.88,
      phase: 2.8,
      orbitRadius: 10,
      orbitSpeed: 0.28,
    },
    // Left dense white core puff
    {
      offsetX: -135,
      offsetY: 6,
      baseScale: 1.75,
      rotSpeed: 0.14,
      rotation: 0.9,
      type: 'core',
      alpha: 0.92,
      phase: 3.5,
      orbitRadius: 12,
      orbitSpeed: 0.25,
    },
    // Right dense white core puff
    {
      offsetX: 140,
      offsetY: 8,
      baseScale: 1.78,
      rotSpeed: -0.15,
      rotation: 4.1,
      type: 'core',
      alpha: 0.92,
      phase: 4.6,
      orbitRadius: 12,
      orbitSpeed: -0.27,
    },
    // Bottom-center pure white puff
    {
      offsetX: 20,
      offsetY: 42,
      baseScale: 1.6,
      rotSpeed: 0.22,
      rotation: 1.2,
      type: 'core',
      alpha: 0.88,
      phase: 5.1,
      orbitRadius: 10,
      orbitSpeed: 0.3,
    },
    // Bottom-left pure white puff
    {
      offsetX: -85,
      offsetY: 36,
      baseScale: 1.48,
      rotSpeed: -0.18,
      rotation: 3.3,
      type: 'core',
      alpha: 0.86,
      phase: 0.9,
      orbitRadius: 9,
      orbitSpeed: -0.35,
    },
  ]);

  const dissolveProgressRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    // Generate procedural textures once
    if (!texturesRef.current) {
      texturesRef.current = {
        crest: createPuffCanvas(128, 'crest'),
        core: createPuffCanvas(128, 'core'),
        wisp: createPuffCanvas(128, 'wisp'),
      };
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseWidth = 560;
    const baseHeight = 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = baseWidth * dpr;
    canvas.height = baseHeight * dpr;

    let lastTime = performance.now();
    let totalTime = 0;

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      totalTime += dt;

      if (isDissolving) {
        dissolveProgressRef.current = Math.min(1, dissolveProgressRef.current + dt * 3.5);
      } else {
        dissolveProgressRef.current = 0;
      }

      const fadeAlpha = 1 - dissolveProgressRef.current;
      const expandScale = 1 + dissolveProgressRef.current * 0.45;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const cx = baseWidth / 2;
      const cy = baseHeight / 2;
      const textures = texturesRef.current!;

      const puffs = puffsRef.current;
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];

        // Smooth continuous rotation
        p.rotation += p.rotSpeed * dt;

        // Subtle organic orbital sway
        const orbitAngle = totalTime * p.orbitSpeed + p.phase;
        const px = cx + p.offsetX + Math.cos(orbitAngle) * p.orbitRadius;
        const py = cy + p.offsetY + Math.sin(orbitAngle) * (p.orbitRadius * 0.6);

        // Breathing scale pulsation
        const breath = 1 + Math.sin(totalTime * 0.9 + p.phase) * 0.06;
        const currentScale = p.baseScale * breath * expandScale;

        const puffTex = textures[p.type];
        const drawSize = 128 * currentScale;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha * fadeAlpha));
        ctx.drawImage(puffTex, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isDissolving]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-0 select-none"
      style={{
        width: 560,
        height: 300,
        maxWidth: '150vw',
      }}
      aria-hidden="true"
    />
  );
};
