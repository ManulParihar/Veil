import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
// Self-host the player wasm (bundled by Vite) instead of fetching it from a
// public CDN at runtime — no external dependency for a privacy wallet.
import dotLottieWasm from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";

setWasmUrl(dotLottieWasm);

/**
 * Named dotLottie animations shipped in /public/animation. Used sparingly to
 * add a little personality to waits and confirmations:
 *  - dog      → the proof is "fetching"… a dog runs while the SNARK cooks
 *  - bored    → a bored hand taps while we wait on the chain
 *  - transfer → a glassy whoosh on a confirmed shielded transfer
 */
export type PoofAnim = "dog" | "bored" | "transfer";

const SRC: Record<PoofAnim, string> = {
  dog: "/animation/Run_Dog_Run.lottie",
  bored: "/animation/Loading_Animation_BoredHand.lottie",
  transfer: "/animation/Glassmorphism_transfer-animaiton.lottie",
};

interface PoofLottieProps {
  name: PoofAnim;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
}

export default function PoofLottie({
  name,
  className = "h-24 w-24",
  loop = true,
  autoplay = true,
}: PoofLottieProps) {
  return (
    <div className={className} aria-hidden>
      <DotLottieReact
        src={SRC[name]}
        loop={loop}
        autoplay={autoplay}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
