import { Link } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { Button } from "../../components/ui/button";

export function ReviewerExpired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="card-elevated w-full max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-destructive/15 text-destructive">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h1 className="font-display text-xl font-semibold">Review access unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This invitation is expired, revoked, or invalid. Ask the founder to send a new invite.
        </p>
        <Button asChild variant="outline">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
