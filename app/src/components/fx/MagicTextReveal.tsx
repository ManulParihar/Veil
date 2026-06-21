"use client";
import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

interface Particle {
  x: number;
  y: number;
  originalX: number;
  originalY: number;
  color: string;
  opacity: number;
  originalAlpha: number;
  floatingSpeed: number;
  floatingAngle: number;
  targetOpacity: number;
  sparkleSpeed: number;
}

interface MagicTextRevealProps {
  text?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  spread?: number;
  speed?: number;
  density?: number;
  /** Reveal the solid text on hover and keep it; smoke disperses again on leave. */
  resetOnMouseLeave?: boolean;
  /** When false, no card background/border is drawn (use as a bare wordmark). */
  chrome?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * MagicTextReveal — text rendered as a drifting cloud of gold/lavender
 * particles that condense into solid letters on hover, then "poof" apart again.
 * On-brand for Poof: value that materialises and vanishes.
 */
export const MagicTextReveal: React.FC<MagicTextRevealProps> = ({
  text = "Poof",
  color = "rgba(232, 213, 163, 1)",
  fontSize = 70,
  fontFamily = "Inter, sans-serif",
  fontWeight = 700,
  spread = 40,
  speed = 0.5,
  density = 4,
  resetOnMouseLeave = true,
  chrome = false,
  className = "",
  style = {},
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const [isHovered, setIsHovered] = useState(false);
  const [showText, setShowText] = useState(false);
  const [hasBeenShown, setHasBeenShown] = useState(false);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });
  const [textDimensions, setTextDimensions] = useState({ width: 0, height: 0 });

  const transformedDensity = 6 - density;
  const globalDpr = useMemo(() => {
    if (typeof window !== "undefined")
      return Math.min(2, window.devicePixelRatio * 1.5 || 1);
    return 1;
  }, []);

  const measureText = useCallback(
    (t: string, fs: number, fw: number, ff: string) => {
      if (typeof window === "undefined") return { width: 200, height: 60 };
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return { width: 200, height: 60 };
      ctx.font = `${fw} ${fs}px ${ff}`;
      const metrics = ctx.measureText(t);
      return {
        width: Math.ceil(metrics.width + fs * 0.5),
        height: Math.ceil(fs * 1.4),
      };
    },
    []
  );

  useEffect(() => {
    setTextDimensions(measureText(text, fontSize, fontWeight, fontFamily));
  }, [text, fontSize, fontWeight, fontFamily, measureText]);

  const createParticles = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      canvas: HTMLCanvasElement,
      t: string,
      textX: number,
      textY: number,
      font: string,
      col: string,
      td: number
    ): Particle[] => {
      const particles: Particle[] = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = col;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.imageSmoothingEnabled = true;
      ctx.fillText(t, textX, textY);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const currentDPR = canvas.width / parseInt(canvas.style.width);
      const baseSampleRate = Math.max(2, Math.round(currentDPR));
      const sampleRate = baseSampleRate * td;

      let minX = canvas.width,
        maxX = 0,
        minY = canvas.height,
        maxY = 0;
      for (let y = 0; y < canvas.height; y += sampleRate) {
        for (let x = 0; x < canvas.width; x += sampleRate) {
          if (data[(y * canvas.width + x) * 4 + 3] > 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      const spreadRadius = Math.max(maxX - minX, maxY - minY) * 0.1;

      for (let y = 0; y < canvas.height; y += sampleRate) {
        for (let x = 0; x < canvas.width; x += sampleRate) {
          const index = (y * canvas.width + x) * 4;
          const alpha = data[index + 3];
          if (alpha > 0) {
            const originalAlpha = alpha / 255;
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spreadRadius;
            particles.push({
              x: x + Math.cos(angle) * distance,
              y: y + Math.sin(angle) * distance,
              originalX: x,
              originalY: y,
              color: `rgba(${data[index]}, ${data[index + 1]}, ${data[index + 2]}, ${originalAlpha})`,
              opacity: originalAlpha * 0.3,
              originalAlpha,
              floatingSpeed: Math.random() * 2 + 1,
              floatingAngle: Math.random() * Math.PI * 2,
              targetOpacity: Math.random() * originalAlpha * 0.5,
              sparkleSpeed: Math.random() * 2 + 1,
            });
          }
        }
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return particles;
    },
    []
  );

  const updateParticles = useCallback(
    (particles: Particle[], deltaTime: number, hovered: boolean, sp: number, spd: number) => {
      const FLOAT_RADIUS = sp;
      const RETURN_SPEED = 3;
      const TRANSITION_SPEED = 5 * spd;
      const NOISE_SCALE = 0.6;
      const CHAOS_FACTOR = 1.3;
      const FADE_SPEED = 13;

      particles.forEach((particle) => {
        if (hovered) {
          const dx = particle.originalX - particle.x;
          const dy = particle.originalY - particle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 0.1) {
            particle.x += (dx / distance) * RETURN_SPEED * deltaTime * 60;
            particle.y += (dy / distance) * RETURN_SPEED * deltaTime * 60;
          } else {
            particle.x = particle.originalX;
            particle.y = particle.originalY;
          }
          particle.opacity = Math.max(0, particle.opacity - FADE_SPEED * deltaTime);
        } else {
          particle.floatingAngle +=
            deltaTime * particle.floatingSpeed * (1 + Math.random() * CHAOS_FACTOR);
          const time = Date.now() * 0.001;
          const uniqueOffset = particle.floatingSpeed * 2000;
          const noiseX =
            (Math.sin(time * particle.floatingSpeed + particle.floatingAngle) * 1.2 +
              Math.sin((time + uniqueOffset) * 0.5) * 0.8 +
              (Math.random() - 0.5) * CHAOS_FACTOR) *
            NOISE_SCALE;
          const noiseY =
            (Math.cos(time * particle.floatingSpeed + particle.floatingAngle * 1.5) * 0.6 +
              Math.cos((time + uniqueOffset) * 0.5) * 0.4 +
              (Math.random() - 0.5) * CHAOS_FACTOR) *
            NOISE_SCALE;
          const targetX = particle.originalX + FLOAT_RADIUS * noiseX;
          const targetY = particle.originalY + FLOAT_RADIUS * noiseY;
          const dx = targetX - particle.x;
          const dy = targetY - particle.y;
          const jitterScale = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (FLOAT_RADIUS * 1.5));
          particle.x += dx * TRANSITION_SPEED * deltaTime + (Math.random() - 0.5) * spd * jitterScale;
          particle.y += dy * TRANSITION_SPEED * deltaTime + (Math.random() - 0.5) * spd * jitterScale;

          const distFromOrigin = Math.sqrt(
            Math.pow(particle.x - particle.originalX, 2) +
              Math.pow(particle.y - particle.originalY, 2)
          );
          if (distFromOrigin > FLOAT_RADIUS) {
            const a = Math.atan2(particle.y - particle.originalY, particle.x - particle.originalX);
            const pullBack = (distFromOrigin - FLOAT_RADIUS) * 0.1;
            particle.x -= Math.cos(a) * pullBack;
            particle.y -= Math.sin(a) * pullBack;
          }

          const opacityDiff = particle.targetOpacity - particle.opacity;
          particle.opacity += opacityDiff * particle.sparkleSpeed * deltaTime * 3;
          if (Math.abs(opacityDiff) < 0.01) {
            particle.targetOpacity =
              Math.random() < 0.5
                ? Math.random() * 0.1 * particle.originalAlpha
                : particle.originalAlpha * 3;
            particle.sparkleSpeed = Math.random() * 3 + 1;
          }
        }
      });

      setShowText(hovered);
    },
    []
  );

  const renderParticles = useCallback(
    (ctx: CanvasRenderingContext2D, particles: Particle[], dpr: number) => {
      ctx.save();
      ctx.scale(dpr, dpr);
      const byColor = new Map<string, Array<{ x: number; y: number }>>();
      particles.forEach((particle) => {
        if (particle.opacity <= 0) return;
        const c = particle.color.replace(/[\d.]+\)$/, `${particle.opacity})`);
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c)!.push({ x: particle.x / dpr, y: particle.y / dpr });
      });
      byColor.forEach((positions, c) => {
        ctx.fillStyle = c;
        positions.forEach(({ x, y }) => ctx.fillRect(x, y, 1, 1));
      });
      ctx.restore();
    },
    []
  );

  const renderCanvas = useCallback(() => {
    if (!wrapperRef.current || !canvasRef.current || !wrapperSize.width || !wrapperSize.height)
      return;
    const canvas = canvasRef.current;
    const { width, height } = wrapperSize;
    canvas.width = width * globalDpr;
    canvas.height = height * globalDpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const font = `${fontWeight} ${fontSize * globalDpr}px ${fontFamily}`;
    particlesRef.current = createParticles(
      ctx,
      canvas,
      text,
      canvas.width / 2,
      canvas.height / 2,
      font,
      color,
      transformedDensity
    );
    renderParticles(ctx, particlesRef.current, globalDpr);
  }, [
    wrapperSize,
    globalDpr,
    text,
    fontSize,
    fontFamily,
    fontWeight,
    color,
    transformedDensity,
    createParticles,
    renderParticles,
  ]);

  useEffect(() => {
    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !particlesRef.current.length) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      updateParticles(particlesRef.current, deltaTime, isHovered, spread, speed);
      renderParticles(ctx, particlesRef.current, globalDpr);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isHovered, spread, speed, globalDpr, updateParticles, renderParticles]);

  useEffect(() => {
    const handleResize = () => {
      if (!wrapperRef.current || !textDimensions.width || !textDimensions.height) return;
      const isMobile = window.innerWidth < 768;
      const basePadding = isMobile ? Math.max(fontSize * 0.3, 20) : Math.max(fontSize * 0.5, 40);
      const minWidth = Math.max(textDimensions.width + basePadding * 2, isMobile ? 120 : 200);
      const minHeight = Math.max(textDimensions.height + basePadding * 2, isMobile ? 60 : 100);
      const parentRect = wrapperRef.current.parentElement?.getBoundingClientRect();
      const m = isMobile ? 0.95 : 0.9;
      const maxWidth = parentRect ? parentRect.width * m : window.innerWidth * m;
      const maxHeight = parentRect ? parentRect.height * m : window.innerHeight * m;
      setWrapperSize({
        width: Math.min(minWidth, maxWidth),
        height: Math.min(minHeight, maxHeight),
      });
    };
    if (textDimensions.width && textDimensions.height) handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [textDimensions, fontSize]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    setHasBeenShown(true);
  }, []);
  const handleMouseLeave = useCallback(() => {
    if (resetOnMouseLeave || !hasBeenShown) setIsHovered(false);
  }, [resetOnMouseLeave, hasBeenShown]);

  return (
    <div
      ref={wrapperRef}
      className={`relative flex items-center justify-center overflow-hidden rounded-2xl transition-all duration-300 ${className}`}
      style={{
        width: wrapperSize.width || "auto",
        height: wrapperSize.height || "auto",
        minWidth: "120px",
        minHeight: "64px",
        maxWidth: "100%",
        ...(chrome
          ? {
              backgroundColor: "rgba(28, 26, 43, 0.6)",
              border: "1px solid rgba(232, 213, 163, 0.12)",
              backdropFilter: "blur(10px)",
            }
          : {}),
        cursor: "pointer",
        ...style,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={`absolute z-10 transition-opacity duration-200 ${
          showText ? "opacity-100" : "opacity-0"
        }`}
        style={{
          color,
          fontFamily,
          fontWeight,
          fontSize: `${fontSize}px`,
          userSelect: "none",
          whiteSpace: "nowrap",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        {text}
      </div>
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
    </div>
  );
};

export default MagicTextReveal;
