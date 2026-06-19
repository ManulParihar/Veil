// App shell — replaced/expanded by the UI layer. Minimal router placeholder so
// the project builds during foundation work.
import { Routes, Route, Navigate } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Placeholder() {
  return (
    <div className="min-h-full grid place-items-center">
      <div className="card p-8 text-center animate-fade-in">
        <h1 className="text-2xl font-bold text-veil-primary">Veil</h1>
        <p className="text-veil-muted mt-2">Private payments on Stellar — UI loading…</p>
      </div>
    </div>
  );
}
