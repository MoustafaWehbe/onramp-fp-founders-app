import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { apiErrorMessage } from "../../lib/api-error";
import { requestReviewerAccess, verifyReviewerAccess } from "../../lib/reviewer-portal-api";

export function ReviewerAccess() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [emailHint, setEmailHint] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    setBusy(true);
    try {
      const result = await requestReviewerAccess(token);
      setEmailHint(result.emailHint);
      setStep("verify");
      toast.success("Verification code sent");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not start review access"));
      navigate("/review/expired", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      await verifyReviewerAccess(token, otp.trim());
      navigate("/review/workspace", { replace: true });
    } catch (error) {
      toast.error(apiErrorMessage(error, "Invalid verification code"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="card-elevated w-full max-w-md space-y-5 p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold">Secure document review</h1>
            <p className="text-sm text-muted-foreground">
              Verify your email to open the shared data room.
            </p>
          </div>
        </div>

        {step === "request" ? (
          <Button className="w-full" disabled={busy || !token} onClick={() => void requestCode()}>
            {busy ? "Sending…" : "Email me a verification code"}
          </Button>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to <span className="font-medium text-foreground">{emailHint}</span>.
            </p>
            <div>
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1.5 tracking-[0.3em]"
              />
            </div>
            <Button className="w-full" disabled={busy || otp.length !== 6} onClick={() => void verify()}>
              {busy ? "Verifying…" : "Continue"}
            </Button>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void requestCode()}>
              Resend code
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
