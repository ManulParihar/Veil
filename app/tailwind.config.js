/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Poof brand: Gold + Lavender with sparkle magic (theatrical, premium, fun)
        // Focus: deep inky lavender backgrounds, warm gold reveals, playful sparkle pops
        poof: {
          bg: "#050410",
          surface: "#0F0D1E",
          card: "#161330",
          border: "#2A2545",
          muted: "#6B6090",
          text: "#F0ECF8",
          gold: "#E8D5A3",
          goldHover: "#D4B36E",
          lavender: "#A78BFA",
          primary: "#A78BFA",
          primaryhover: "#8B6EE8",
          accent: "#E85A9E", // sparkle flash / poof pop
          success: "#34d399",
          danger: "#f87171",
          warn: "#fbbf24",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(232, 213, 163, 0.35)", // gold glow
        sparkle: "0 0 20px rgba(232, 90, 158, 0.6)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        poof: {
          "0%": { transform: "scale(0.6)", opacity: "0.8" },
          "50%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "0" },
        },
        sparkle: {
          "0%, 100%": { opacity: "0.3", transform: "scale(0.6)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
        // animated gold→lavender→pink sweep for magic text & progress fills
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        // gentle vertical bob for floating accents (logo sparkles, hero)
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        // a smoke wisp rising and fading
        "smoke-rise": {
          "0%": { transform: "translateY(8px) scale(0.9)", opacity: "0" },
          "30%": { opacity: "0.6" },
          "100%": { transform: "translateY(-22px) scale(1.25)", opacity: "0" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.05)" },
        },
        "score-fill": {
          from: { strokeDashoffset: "440" },
        },
        "bar-fill": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "fade-in": "fade-in 0.3s ease-out",
        poof: "poof 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        sparkle: "sparkle 1.1s ease-in-out infinite",
        "gradient-x": "gradient-x 6s ease infinite",
        float: "float 4s ease-in-out infinite",
        "smoke-rise": "smoke-rise 2.4s ease-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "score-fill": "score-fill 1.5s ease-out forwards",
        "bar-fill": "bar-fill 0.8s ease-out forwards",
      },
    },
  },
  plugins: [],
};
