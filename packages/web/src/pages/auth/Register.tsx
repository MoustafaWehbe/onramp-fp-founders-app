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

function Register() {
  // Arriving from /accept-invite: the invited address is prefilled because the
  // API only claims pending invites that match the verified email exactly.
  const [searchParams] = useSearchParams();
  const invitedEmail = searchParams.get("email");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { registerInitiate } = useAuthContext();
  const navigate = useNavigate();

  const allRulesPass = PASSWORD_RULES.every((r) => r.pass(password));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allRulesPass) return;
    setIsSubmitting(true);
    try {
      await registerInitiate({ first_name: firstName, last_name: lastName, email, password });
      navigate("/auth/verify", { state: { email } });
    } catch (err) {
      const axErr = err as AxiosError<{
        error: string;
        details?: { field: string; message: string }[];
      }>;
      const detail = axErr.response?.data?.details?.[0]?.message;
      const msg = detail ?? axErr.response?.data?.error ?? "Registration failed";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {invitedEmail
          ? "Finish signing up and you'll land straight in the workspace you were invited to."
          : "Start as a user. You can create a startup or accept an invite once you're in."}
      </p>

      <div className="mt-6 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
        {invitedEmail ? (
          <>
            <strong className="text-foreground">Your invitation is tied to this email.</strong>{" "}
            Sign up with <em>{invitedEmail}</em> and you'll join the workspace as soon as you
            verify it. Registering with a different address won't accept the invite.
          </>
        ) : (
          <>
            <strong className="text-foreground">Heads up:</strong> registering only creates{" "}
            <em>you</em> no startup yet. Waiting on a team invite? Sign up, then open the invite
            link from your email.
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fn">First name</Label>
            <Input
              id="fn"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln">Last name</Label>
            <Input
              id="ln"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="e">Work email</Label>
          <Input
            id="e"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p">Password</Label>
          <Input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <PasswordStrength password={password} />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting || (password.length > 0 && !allRulesPass)}
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/auth/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export { Register };
