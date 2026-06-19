import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initCrypto } from "./lib/crypto";
import { Logo } from "./components/ui";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Splash while Poseidon (circomlibjs) initialises — note math must be ready
// before any component or the store touches it.
root.render(
  <div className="min-h-full grid place-items-center">
    <div className="animate-pulse text-center">
      <Logo className="h-12 w-12 mx-auto" />
      <div className="text-veil-muted mt-3 text-sm">Initialising…</div>
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
