import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAuthContext } from "../../providers/AuthProvider";

const GENERIC_MESSAGE =
  "If an account exists with that email, a password reset link has been sent.";

function Forgot() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { forgotPassword } = useAuthContext();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const msg = await forgotPassword(email);
      setMessage(msg);
    } catch {
      // Show the same generic message even on network/server errors —
      // don't let failures reveal whether an email exists
      setMessage(GENERIC_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">We'll email you a reset link.</p>

      {message ? (
        <div className="mt-6 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
          {message}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e">Email</Label>
            <Input
              id="e"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/auth/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export { Forgot };
