import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useWallet } from "./store/wallet";
import { ToastProvider } from "./components/ui";
import { SmokeBackground } from "./components/fx/SmokeBackground";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Deposit from "./pages/Deposit";
import Send from "./pages/Send";
import Withdraw from "./pages/Withdraw";
import Receive from "./pages/Receive";
import Activity from "./pages/Activity";
import Privacy from "./pages/Privacy";
import Disclosure from "./pages/Disclosure";
import Scheduled from "./pages/Scheduled";

export default function App() {
  const initialised = useWallet((s) => s.initialised);
  const feeFunded = useWallet((s) => s.feeAccount?.funded ?? false);
  const loc = useLocation();

  // Gate: must have an identity AND a funded fee account before the app proper.
  const ready = initialised && feeFunded;

  return (
    <ToastProvider>
      {/* Subtle drifting smoke behind the entire app — the "poof" never settles.
          (Hidden behind the landing's opaque cream canvas at "/".) */}
      <SmokeBackground className="fixed inset-0 -z-10" smokeColor="#A78BFA" opacity={0.12} speed={0.3} />
      <Routes>
        {/* Public marketing site */}
        <Route path="/" element={<Landing />} />

        {/* The wallet, gated behind an identity + funded fee account */}
        <Route path="/app/welcome" element={ready ? <Navigate to="/app" replace /> : <Onboarding />} />
        <Route
          path="/app"
          element={ready ? <Layout><Dashboard /></Layout> : <Navigate to="/app/welcome" replace state={{ from: loc }} />}
        />
        <Route path="/app/deposit" element={ready ? <Layout><Deposit /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/send" element={ready ? <Layout><Send /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/withdraw" element={ready ? <Layout><Withdraw /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/receive" element={ready ? <Layout><Receive /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/activity" element={ready ? <Layout><Activity /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/privacy" element={ready ? <Layout><Privacy /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/disclosure" element={ready ? <Layout><Disclosure /></Layout> : <Navigate to="/app/welcome" replace />} />
        <Route path="/app/scheduled" element={ready ? <Layout><Scheduled /></Layout> : <Navigate to="/app/welcome" replace />} />

        {/* Legacy deep links → keep old bookmarks working */}
        <Route path="/welcome" element={<Navigate to="/app/welcome" replace />} />
        <Route path="/deposit" element={<Navigate to="/app/deposit" replace />} />
        <Route path="/send" element={<Navigate to="/app/send" replace />} />
        <Route path="/withdraw" element={<Navigate to="/app/withdraw" replace />} />
        <Route path="/receive" element={<Navigate to="/app/receive" replace />} />
        <Route path="/activity" element={<Navigate to="/app/activity" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
