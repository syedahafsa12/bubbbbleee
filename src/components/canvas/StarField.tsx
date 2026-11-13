
"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  depth: number;
  radius: number;
  alpha: number;
  twinklePhase: number;
  twinkleSpeed: number;
  color: string;
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

const STAR_COLORS = [
  "rgba(255,255,255,",
  "rgba(255,255,255,",
  "rgba(255,255,255,",
  "rgba(190,211,255,",
  "rgba(255,224,190,",
];

export default function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) return;

    const mediaQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    let reducedMotion = mediaQuery.matches;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let elapsed = 0;
    let lastFrame = 0;
    let lastShootingStar = 0;

    let pointerX = 0;
    let pointerY = 0;
    let targetPointerX = 0;
    let targetPointerY = 0;

    let stars: Star[] = [];
    let shootingStars: ShootingStar[] = [];

    const random = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    const createStars = () => {
      const area = width * height;
      const count = Math.min(420, Math.max(90, Math.floor(area / 4200)));

      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        depth: random(0.15, 1),
        radius: random(0.35, 1.45),
        alpha: random(0.25, 0.85),
        twinklePhase: random(0, Math.PI * 2),
        twinkleSpeed: random(0.4, 1.6),
        color: STAR_COLORS[
          Math.floor(Math.random() * STAR_COLORS.length)
        ],
      }));
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      createStars();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (reducedMotion) return;

      targetPointerX = (event.clientX / Math.max(width, 1) - 0.5) * 2;
      targetPointerY = (event.clientY / Math.max(height, 1) - 0.5) * 2;
    };

    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;

      if (reducedMotion) {
        shootingStars = [];
        pointerX = 0;
        pointerY = 0;
        targetPointerX = 0;
        targetPointerY = 0;
      }
    };

    const spawnShootingStar = () => {
      const startX = random(width * 0.35, width * 1.05);
      const startY = random(-height * 0.1, height * 0.45);
      const speed = random(5, 9);

      shootingStars.push({
        x: startX,
        y: startY,
        vx: -speed,
        vy: speed * random(0.25, 0.55),
        life: 0,
        maxLife: random(35, 65),
      });
    };

    const drawStar = (star: Star, time: number) => {
      const parallaxX = reducedMotion
        ? 0
        : pointerX * star.depth * 7;
      const parallaxY = reducedMotion
        ? 0
        : pointerY * star.depth * 7;

      const drift = reducedMotion
        ? 0
        : Math.sin(time * 0.00008 + star.twinklePhase) *
          star.depth *
          1.4;

      const x = star.x + parallaxX + drift;
      const y = star.y + parallaxY;

      const twinkle = reducedMotion
        ? 1
        : 0.72 +
          Math.sin(time * 0.001 * star.twinkleSpeed + star.twinklePhase) *
            0.28;

      const alpha = Math.max(0.08, Math.min(1, star.alpha * twinkle));

      context!.beginPath();
      context!.fillStyle = `${star.color}${alpha})`;
      context!.arc(x, y, star.radius, 0, Math.PI * 2);
      context!.fill();

      if (star.radius > 1.1) {
        const glow = context!.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          star.radius * 4
        );

        glow.addColorStop(0, `${star.color}${alpha * 0.2})`);
        glow.addColorStop(1, `${star.color}0)`);

        context!.beginPath();
        context!.fillStyle = glow;
        context!.arc(x, y, star.radius * 4, 0, Math.PI * 2);
        context!.fill();
      }
    };

    const drawShootingStars = () => {
      shootingStars = shootingStars.filter(
        (star) => star.life < star.maxLife
      );

      shootingStars.forEach((star) => {
        const progress = star.life / star.maxLife;
        const opacity = Math.sin(progress * Math.PI);

        const tailX = star.x - star.vx * 5;
        const tailY = star.y - star.vy * 5;

        const gradient = context!.createLinearGradient(
          star.x,
          star.y,
          tailX,
          tailY
        );

        gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");

        context!.beginPath();
        context!.strokeStyle = gradient;
        context!.lineWidth = 1.2;
        context!.moveTo(star.x, star.y);
        context!.lineTo(tailX, tailY);
        context!.stroke();

        star.x += star.vx;
        star.y += star.vy;
        star.life += 1;
      });
    };

    const render = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(render);

      const delta = lastFrame ? timestamp - lastFrame : 16;
      lastFrame = timestamp;
      elapsed += Math.min(delta, 40);

      context!.clearRect(0, 0, width, height);

      if (!reducedMotion) {
        pointerX += (targetPointerX - pointerX) * 0.025;
        pointerY += (targetPointerY - pointerY) * 0.025;

        if (timestamp - lastShootingStar > random(7000, 13000)) {
          spawnShootingStar();
          lastShootingStar = timestamp;
        }
      }

      stars.forEach((star) => drawStar(star, elapsed));

      if (!reducedMotion) {
        drawShootingStars();
      }
    };

    resize();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    mediaQuery.addEventListener("change", handleMotionPreference);

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      mediaQuery.removeEventListener("change", handleMotionPreference);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
