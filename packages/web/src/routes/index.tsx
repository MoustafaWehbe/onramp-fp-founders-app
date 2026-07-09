import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { Login } from "../pages/auth/Login";
import { Register } from "../pages/auth/Register";
import { Forgot } from "../pages/auth/forgot-password";
import { Reset } from "../pages/auth/reset-password";
import { Dashboard } from "../pages/dashboard/Dashboard";
import { Pipeline } from "../pages/dashboard/Pipeline/Pipeline";
import { Investors } from "../pages/dashboard/Investors/Investors";
import { Documents } from "../pages/dashboard/Documents/Documents";
import { AiInsights } from "../pages/dashboard/AiInsights/AiInsights";
import { Team } from "../pages/dashboard/Team/Team";
import { Settings } from "../pages/dashboard/Settings";
import { NotFound } from "../pages/NotFound";



export function AppRoutes() {
  return (
    <Routes>
      {/* Redirect root to login */}
      <Route path="/" element={<Navigate to="/auth/login" replace />} />

      {/* Public auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/forgot-password" element={<Forgot />} />
        <Route path="/auth/reset-password" element={<Reset />} />
      </Route>

      {/* Protected app routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/investors" element={<Investors />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/ai-insights" element={<AiInsights />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
