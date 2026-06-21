import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initCrypto } from "./lib/crypto";
import { Logo } from "./components/ui";
import PoofSparkle from "./components/PoofSparkle";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Splash while Poseidon (circomlibjs) initialises — note math must be ready
// before any component or the store touches it.
root.render(
  <div className="min-h-full grid place-items-center">
    <div className="text-center relative">
      <span className="smoke-wisp h-10 w-10 left-1/2 -translate-x-1/2 -top-2 animate-smoke-rise" />
      <Logo className="h-14 w-14 mx-auto relative animate-float" />
      <div className="text-2xl font-bold text-magic mt-3">Poof</div>
      <div className="text-poof-muted mt-1 text-sm">Initialising the trick…</div>
      <PoofSparkle active count={12} className="w-14 h-14 mx-auto mt-1" />
    </div>
  </div>
);

initCrypto().then(() => {
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
