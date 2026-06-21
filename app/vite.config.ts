import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// snarkjs, circomlibjs and @stellar/stellar-sdk expect Node globals
// (Buffer, process) in the browser. Polyfill them.
// The browser build needs node polyfills (snarkjs/circomlibjs/stellar-sdk); the
// vitest (node) run must NOT use them — node has the real modules.
const isTest = !!process.env.VITEST;

export default defineConfig({
  plugins: [
    react(),
    ...(isTest
      ? []
      : [
          nodePolyfills({
            globals: { Buffer: true, global: true, process: true },
            protocolImports: true,
          }),
        ]),
  ],
  test: {
    environment: "node",
    testTimeout: 60000,
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { target: "es2022" },
  // snarkjs ships large wasm/zkey work; keep esbuild happy with big int literals.
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
