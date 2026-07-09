import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "sonner";

function Reset() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const navigate = useNavigate();
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose something you'll remember.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (pw !== pw2) return toast.error("Passwords don't match"); toast.success("Password updated"); navigate("/auth/login"); }} className="mt-6 space-y-4">
        <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} /></div>
        <div className="space-y-1.5"><Label>Confirm</Label><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
        <Button type="submit" className="w-full">Update password</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground"><Link to="/auth/login" className="text-primary hover:underline">Back to sign in</Link></p>
    </div>
  );
}

export { Reset };
