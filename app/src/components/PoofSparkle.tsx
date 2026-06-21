import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface SparkleProps {
  active?: boolean;
  count?: number;
  className?: string;
  onComplete?: () => void;
}

/**
 * PoofSparkle — Gold + Lavender sparkle burst (theatrical "poof" effect)
 * Lightweight canvas particles. Trigger with active=true or call burst().
 * Perfect for success states, Poof button, balance reveals.
 */
export default function PoofSparkle({ active = false, count = 18, className = "", onComplete }: SparkleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<any[]>([]);
  const rafRef = useRef<number | null>(null);

  const colors = ["#E8D5A3", "#A78BFA", "#E85A9E", "#D4B36E"];

  function createParticles(x: number, y: number, n: number) {
    const p: any[] = [];
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.8;
      const speed = 1.6 + Math.random() * 2.4;
      p.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8, // upward bias
        life: 38 + Math.random() * 18,
        size: 1.6 + Math.random() * 2.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.85 + Math.random() * 0.15,
      });
    }
    return p;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particlesRef.current = particlesRef.current.filter((p) => p.life > 0);

    for (const p of particlesRef.current) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.045; // gravity-ish
      p.life -= 1;
      p.alpha = Math.max(0.02, p.life / 55);

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // tiny sparkle cross
      if (Math.random() > 0.6) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
      }
      ctx.restore();
    }

    if (particlesRef.current.length > 0) {
      rafRef.current = requestAnimationFrame(draw);
    } else {
      if (onComplete) onComplete();
    }
  }

  function burst(cx?: number, cy?: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = cx ?? rect.width / 2;
    const y = cy ?? rect.height / 2;

    particlesRef.current = particlesRef.current.concat(createParticles(x, y, count));
    if (!rafRef.current) draw();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (active) {
      // delay a tiny bit so the element is positioned
      setTimeout(() => burst(), 30);
    }
  }, [active]);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ mixBlendMode: "screen" }}
      />
      {/* Optional wrapper motion for extra flourish */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={active ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.1 }}
      />
    </div>
  );
}
