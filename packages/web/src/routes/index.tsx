import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequireWorkspace } from "./RequireWorkspace";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";

const Login = lazy(() => import("../pages/auth/Login").then((module) => ({ default: module.Login })));
const Register = lazy(() => import("../pages/auth/Register").then((module) => ({ default: module.Register })));
const VerifyOtp = lazy(() => import("../pages/auth/verify").then((module) => ({ default: module.VerifyOtp })));
const Forgot = lazy(() => import("../pages/auth/forgot-password").then((module) => ({ default: module.Forgot })));
const Reset = lazy(() => import("../pages/auth/reset-password").then((module) => ({ default: module.Reset })));
const AcceptInvite = lazy(() => import("../pages/auth/accept-invite").then((module) => ({ default: module.AcceptInvite })));
const Dashboard = lazy(() => import("../pages/dashboard/Dashboard").then((module) => ({ default: module.Dashboard })));
const Notifications = lazy(() => import("../pages/dashboard/Notifications/Notifications").then((module) => ({ default: module.Notifications })));
const Pipeline = lazy(() => import("../pages/dashboard/Pipeline/Pipeline").then((module) => ({ default: module.Pipeline })));
const Investors = lazy(() => import("../pages/dashboard/Investors/Investors").then((module) => ({ default: module.Investors })));
const Chat = lazy(() => import("../pages/dashboard/Chat/Chat").then((module) => ({ default: module.Chat })));
const Fundraising = lazy(() => import("../pages/dashboard/Fundraising/Fundraising").then((module) => ({ default: module.Fundraising })));
const Documents = lazy(() => import("../pages/dashboard/Documents/Documents").then((module) => ({ default: module.Documents })));
const Ai = lazy(() => import("../pages/dashboard/Ai/Ai").then((module) => ({ default: module.Ai })));
const Team = lazy(() => import("../pages/dashboard/Team/Team").then((module) => ({ default: module.Team })));
const Settings = lazy(() => import("../pages/dashboard/Settings").then((module) => ({ default: module.Settings })));
const Reviewers = lazy(() => import("../pages/dashboard/Reviewers").then((module) => ({ default: module.Reviewers })));
const Audit = lazy(() => import("../pages/dashboard/Audit/Audit").then((module) => ({ default: module.Audit })));
const Startup = lazy(() => import("../pages/dashboard/Startup").then((module) => ({ default: module.Startup })));
const Profile = lazy(() => import("../pages/dashboard/Profile").then((module) => ({ default: module.Profile })));
const NotFound = lazy(() => import("../pages/NotFound").then((module) => ({ default: module.NotFound })));
const LandingPage = lazy(() => import("../pages/landing/Landing").then((module) => ({ default: module.LandingPage })));
const PricingPage = lazy(() => import("../pages/landing/Pricing"));
const AboutPage = lazy(() => import("../pages/landing/About").then((module) => ({ default: module.AboutPage })));
const ReviewerAccess = lazy(() => import("../pages/review/ReviewerAccess").then((module) => ({ default: module.ReviewerAccess })));
const ReviewerExpired = lazy(() => import("../pages/review/ReviewerExpired").then((module) => ({ default: module.ReviewerExpired })));
const ReviewerWorkspace = lazy(() => import("../pages/review/ReviewerWorkspace").then((module) => ({ default: module.ReviewerWorkspace })));

function RouteFallback() {
  return <div className="grid min-h-48 place-items-center text-sm text-muted-foreground" role="status">Loading…</div>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
            <Route path="/ai" element={<Ai />} />
            <Route path="/ai/chat" element={<Navigate to="/ai" replace />} />
            <Route path="/ai/analysis" element={<Navigate to="/ai" replace />} />
            <Route path="/ai-insights" element={<Navigate to="/ai" replace />} />
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
    </Suspense>
  );
}
