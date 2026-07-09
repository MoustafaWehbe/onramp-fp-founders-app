import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAppStore } from "@/lib/app-store";
import { toast } from "sonner";

function Register() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const register = useAppStore((s) => s.register);
  const navigate = useNavigate();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    register(email, firstName || "New", lastName || "User");
    toast.success("Account created — welcome!");
    navigate("/app");
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Start as a user. You can create a startup or accept an invite once you're in.</p>

      <div className="mt-6 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Heads up:</strong> registering only creates <em>you</em> — no startup yet. Waiting on a team invite? Sign up, then paste the invite link.
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="fn">First name</Label><Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="ln">Last name</Label><Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} required /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="e">Work email</Label><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label htmlFor="p">Password</Label><Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
        <Button type="submit" className="w-full">Create account</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <Link to="/auth/login" className="text-primary hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

export { Register };
