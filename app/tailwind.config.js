/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Veil brand: deep indigo/violet "shielded" palette
        veil: {
          bg: "#0a0a12",
          surface: "#12121f",
          card: "#171728",
          border: "#262640",
          muted: "#6b6b8a",
          text: "#e8e8f5",
          primary: "#7c5cff",
          primaryhover: "#6b4ce0",
          accent: "#22d3ee",
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
        glow: "0 0 40px -10px rgba(124, 92, 255, 0.45)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
