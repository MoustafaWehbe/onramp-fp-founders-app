import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequireWorkspace } from "./RequireWorkspace";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { Login } from "../pages/auth/Login";
import { Register } from "../pages/auth/Register";
import { VerifyOtp } from "../pages/auth/verify";
import { Forgot } from "../pages/auth/forgot-password";
import { Reset } from "../pages/auth/reset-password";
import { AcceptInvite } from "../pages/auth/accept-invite";
import { Dashboard } from "../pages/dashboard/Dashboard";
import { Notifications } from "../pages/dashboard/Notifications/Notifications";
import { Pipeline } from "../pages/dashboard/Pipeline/Pipeline";
import { Investors } from "../pages/dashboard/Investors/Investors";
import { Chat } from "../pages/dashboard/Chat/Chat";
import { Fundraising } from "../pages/dashboard/Fundraising/Fundraising";
import { Documents } from "../pages/dashboard/Documents/Documents";
import { AiInsights } from "../pages/dashboard/AiInsights/AiInsights";
import { Team } from "../pages/dashboard/Team/Team";
import { Settings } from "../pages/dashboard/Settings";
import { Reviewers } from "../pages/dashboard/Reviewers";
import { Audit } from "../pages/dashboard/Audit/Audit";
import { Startup } from "../pages/dashboard/Startup";
import { Profile } from "../pages/dashboard/Profile";
import { NotFound } from "../pages/NotFound";
import { LandingPage } from "../pages/landing/Landing";
import PricingPage from "../pages/landing/Pricing";
import { AboutPage } from "../pages/landing/About";
import { ReviewerAccess } from "../pages/review/ReviewerAccess";
import { ReviewerExpired } from "../pages/review/ReviewerExpired";
import { ReviewerWorkspace } from "../pages/review/ReviewerWorkspace";

export function AppRoutes() {
  return (
    <Routes>
      {/* Public marketing routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/about" element={<AboutPage />} />

      {/* External reviewer portal — no founder auth / workspace shell */}
      <Route path="/review/expired" element={<ReviewerExpired />} />
      <Route path="/review/workspace" element={<ReviewerWorkspace />} />
      <Route path="/review/:token" element={<ReviewerAccess />} />

      {/* Public auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/verify" element={<VerifyOtp />} />
        <Route path="/auth/forgot-password" element={<Forgot />} />
        <Route path="/auth/reset-password" element={<Reset />} />
        {/* Target of the invitation email link built in invite.controller.ts */}
        <Route path="/accept-invite" element={<AcceptInvite />} />
      </Route>

      {/* Protected app routes */}
      <Route element={<ProtectedRoute />}>
        {/* Creating a startup is a dialog inside the dashboard now. The old
            standalone route stays as a redirect so existing links still land
            somewhere sensible. */}
        <Route path="/onboarding" element={<Navigate to="/dashboard" replace />} />

        <Route element={<AppLayout />}>
          {/* Reachable with no workspace: this is where someone who skipped
              creating a startup waits for an invitation. */}
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/profile" element={<Profile />} />

          {/* Everything below needs a startup id to render at all. */}
          <Route element={<RequireWorkspace />}>
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/investors" element={<Investors />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/fundraising" element={<Fundraising />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/ai-insights" element={<AiInsights />} />
            <Route path="/team" element={<Team />} />
            <Route path="/reviewers" element={<Reviewers />} />
            <Route path="/startup" element={<Startup />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
