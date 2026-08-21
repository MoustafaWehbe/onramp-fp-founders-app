import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAuthContext } from "../../providers/auth-context";
import { toast } from "sonner";
import type { AxiosError } from "axios";

const PASSWORD_RULES = [
  { label: "At least 8 characters", pass: (p: string) => p.length >= 8 },
  { label: "One uppercase letter (A–Z)", pass: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter (a–z)", pass: (p: string) => /[a-z]/.test(p) },
  { label: "One number (0–9)", pass: (p: string) => /[0-9]/.test(p) },
];

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {PASSWORD_RULES.map(({ label, pass }) => {
        const ok = pass(password);
        return (
          <li
            key={label}
            className={`flex items-center gap-2 text-xs transition-colors duration-150 ${
              ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
            }`}
          >
            {ok ? (
              <svg className="shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" fill="currentColor" opacity="0.15" />
                <path
                  d="M4.5 7l2 2 3-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="shrink-0 inline-flex w-3.5 h-3.5 items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />
              </span>
            )}
            {label}
          </li>
        );
      })}
    </ul>
  );
}

function Reset() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { resetPassword } = useAuthContext();
  const navigate = useNavigate();

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold">Invalid link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This reset link is missing a token. Please request a new one.
        </p>
        <div className="mt-6">
          <Link to="/auth/forgot-password" className="text-sm text-primary hover:underline">
            Request a new reset link →
          </Link>
        </div>
      </div>
    );
  }

  const allRulesPass = PASSWORD_RULES.every((r) => r.pass(pw));
  const passwordsMatch = pw === pw2;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allRulesPass || !passwordsMatch) return;
    setIsSubmitting(true);
    try {
      await resetPassword(token, pw);
      toast.success("Password updated please sign in");
      navigate("/auth/login");
    } catch (err) {
      const axErr = err as AxiosError<{ error: string; code?: string }>;
      const code = axErr.response?.data?.code;
      if (code === "TOKEN_EXPIRED") {
        toast.error("This reset link has expired. Please request a new one.");
      } else if (code === "TOKEN_ALREADY_USED") {
        toast.error("This reset link has already been used.");
      } else {
        toast.error(axErr.response?.data?.error ?? "Password reset failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose something you'll remember.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pw">New password</Label>
          <Input
            id="pw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            required
          />
          <PasswordStrength password={pw} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pw2">Confirm password</Label>
          <Input
            id="pw2"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            required
          />
          {pw2.length > 0 && !passwordsMatch && (
            <p className="text-xs text-destructive">Passwords don't match</p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={
            isSubmitting ||
            (pw.length > 0 && !allRulesPass) ||
            (pw2.length > 0 && !passwordsMatch)
          }
        >
          {isSubmitting ? "Updating…" : "Update password"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/auth/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export { Reset };
