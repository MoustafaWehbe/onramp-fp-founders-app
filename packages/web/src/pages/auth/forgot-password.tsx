import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "sonner";

function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">We'll email you a reset link.</p>
      {sent ? (
        <div className="mt-6 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">Check <strong>{email}</strong> for a reset link.</div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setSent(true); toast.success("Reset link sent"); }} className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="e">Email</Label><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <Button type="submit" className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground"><Link to="/auth/login" className="text-primary hover:underline">Back to sign in</Link></p>
    </div>
  );
}

export { Forgot };
