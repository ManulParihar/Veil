import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useWallet } from "./store/wallet";
import { ToastProvider } from "./components/ui";
import Layout from "./components/Layout";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Deposit from "./pages/Deposit";
import Send from "./pages/Send";
import Receive from "./pages/Receive";
import Activity from "./pages/Activity";

export default function App() {
  const initialised = useWallet((s) => s.initialised);
  const feeFunded = useWallet((s) => s.feeAccount?.funded ?? false);
  const loc = useLocation();

  // Gate: must have an identity AND a funded fee account before the app proper.
  const ready = initialised && feeFunded;

  return (
    <ToastProvider>
      <Routes>
        <Route path="/welcome" element={ready ? <Navigate to="/" replace /> : <Onboarding />} />
        <Route
          path="/"
          element={ready ? <Layout><Dashboard /></Layout> : <Navigate to="/welcome" replace state={{ from: loc }} />}
        />
        <Route path="/deposit" element={ready ? <Layout><Deposit /></Layout> : <Navigate to="/welcome" replace />} />
        <Route path="/send" element={ready ? <Layout><Send /></Layout> : <Navigate to="/welcome" replace />} />
        <Route path="/receive" element={ready ? <Layout><Receive /></Layout> : <Navigate to="/welcome" replace />} />
        <Route path="/activity" element={ready ? <Layout><Activity /></Layout> : <Navigate to="/welcome" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
