import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAppStore } from "@/lib/app-store";
import { toast } from "sonner";

function Login() {
  const [email, setEmail] = useState("founder@northwind.ai");
  const [password, setPassword] = useState("demo1234");
  const login = useAppStore((s) => s.login);
  const navigate = useNavigate();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(email);
    toast.success("Welcome back");
    navigate("/app");
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back. Let's get your round closed.</p>

      <Button variant="outline" className="mt-6 w-full gap-2" onClick={() => { login("google.user@example.com", "Google", "User"); navigate("/app"); }}>
        <GoogleIcon /> Continue with Google
      </Button>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Label htmlFor="pw">Password</Label>
            <Link to="/auth/forgot-password" className="text-xs text-primary hover:underline">Forgot?</Link>
          </div>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full">Sign in</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don't have an account? <Link to="/auth/register" className="text-primary hover:underline">Create one</Link>
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.5 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.5 3-2.2 5.5-4.8 7.2l7.4 5.7c4.3-4 6.7-9.9 6.7-17.2z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.8 16.3 0 20 0 24s.8 7.7 2.5 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.2-2 14.9-5.5l-7.4-5.7c-2 1.4-4.6 2.2-7.5 2.2-6.3 0-11.6-3.9-13.6-9.3l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
  );
}

export { Login };
