declare module "circomlibjs";
declare module "snarkjs";

// dotLottie animations referenced via Vite ?url imports (also servable from /public).
declare module "*.lottie?url" {
  const src: string;
  export default src;
}

// Self-hosted wasm assets imported as URLs (dotLottie player).
declare module "*.wasm?url" {
  const src: string;
  export default src;
}
