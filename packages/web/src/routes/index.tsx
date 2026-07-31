import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { Login } from "../pages/auth/Login";
import { Register } from "../pages/auth/Register";
import { VerifyOtp } from "../pages/auth/verify";
import { Forgot } from "../pages/auth/forgot-password";
import { Reset } from "../pages/auth/reset-password";
import { Dashboard } from "../pages/dashboard/Dashboard";
import { Notifications } from "../pages/dashboard/Notifications/Notifications";
import { Pipeline } from "../pages/dashboard/Pipeline/Pipeline";
import { Investors } from "../pages/dashboard/Investors/Investors";
import { Documents } from "../pages/dashboard/Documents/Documents";
import { AiInsights } from "../pages/dashboard/AiInsights/AiInsights";
import { Team } from "../pages/dashboard/Team/Team";
import { Settings } from "../pages/dashboard/Settings";
import { NotFound } from "../pages/NotFound";
import { LandingPage } from "../pages/landing/Landing";
import PricingPage from "../pages/landing/Pricing";
import { AboutPage } from "../pages/landing/About";

export function AppRoutes() {
  return (
    <Routes>
      {/* Public marketing routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/about" element={<AboutPage />} />

      {/* Public auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/verify" element={<VerifyOtp />} />
        <Route path="/auth/forgot-password" element={<Forgot />} />
        <Route path="/auth/reset-password" element={<Reset />} />
      </Route>

      {/* Protected app routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/notifications" element={<Notifications />} />
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
