import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useAuthContext } from "../../providers/AuthProvider";
import { toast } from "sonner";
import type { AxiosError } from "axios";

const RESEND_COOLDOWN_S = 60;

// ─── Apple-style OTP input ────────────────────────────────────────────────────

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  // Focus first box on mount
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Re-focus first box when OTP is cleared (e.g. after a failed attempt)
  useEffect(() => {
    if (value === "") refs.current[0]?.focus();
  }, [value]);

  function update(index: number, digit: string) {
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
  }

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      update(index, "");
      return;
    }

    // Handle autofill / fast typing where multiple digits arrive at once.
    const next = [...digits];
    for (let offset = 0; offset < raw.length && index + offset < 6; offset++) {
      next[index + offset] = raw[offset]!;
    }
    onChange(next.join(""));

    const nextIndex = Math.min(index + raw.length, 5);
    refs.current[nextIndex]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        update(index, "");
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        update(index - 1, "");
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length - 1, 5)]?.focus();
  }

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={i === 0 ? 6 : 1}
          value={digit}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of 6`}
          className={[
            "w-12 h-14 text-center text-2xl font-semibold",
            "rounded-xl border-2 bg-background text-foreground",
            "caret-transparent transition-colors duration-100",
            "focus:outline-none focus:border-primary",
            digit ? "border-foreground/25" : "border-border",
            disabled ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function VerifyOtp() {
  const { state } = useLocation() as { state?: { email?: string } };
  const email = state?.email ?? "";
  const navigate = useNavigate();
  const { registerVerify, registerResend } = useAuthContext();

  const [otp, setOtp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!email) navigate("/auth/register", { replace: true });
  }, [email, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function handleOtpChange(newOtp: string) {
    setOtp(newOtp);
    if (newOtp.length === 6 && !submittingRef.current) {
      submittingRef.current = true;
      setIsSubmitting(true);
      registerVerify(email, newOtp)
        .then(() => {
          toast.success("Email verified welcome!");
          navigate("/dashboard");
        })
        .catch((err) => {
          const msg =
            (err as AxiosError<{ error: string }>)?.response?.data?.error ??
            "Verification failed";
          toast.error(msg);
          setOtp("");
        })
        .finally(() => {
          submittingRef.current = false;
          setIsSubmitting(false);
        });
    }
  }

  async function onResend() {
    setIsResending(true);
    try {
      await registerResend(email);
      setCooldown(RESEND_COOLDOWN_S);
      toast.success("New code sent to " + email);
    } catch {
      toast.error("Failed to resend please try again");
    } finally {
      setIsResending(false);
    }
  }

  if (!email) return null;

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-semibold">Check your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We sent a 6-digit code to{" "}
        <strong className="font-medium text-foreground">{email}</strong>.
        <br />
        It expires in 10 minutes.
      </p>

      <div className="mt-8">
        <OtpInput value={otp} onChange={handleOtpChange} disabled={isSubmitting} />
      </div>

      <p className="mt-3 h-4 text-xs text-muted-foreground">
        {isSubmitting
          ? "Verifying…"
          : otp.length > 0 && otp.length < 6
            ? `${otp.length} of 6 digits entered`
            : null}
      </p>

      <div className="mt-5 text-sm text-muted-foreground">
        Didn't get a code?{" "}
        {cooldown > 0 ? (
          <span className="tabular-nums">Resend in {cooldown}s</span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={isResending}
            className="text-primary hover:underline disabled:opacity-50"
          >
            {isResending ? "Sending…" : "Resend"}
          </button>
        )}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        <Link to="/auth/register" className="text-primary hover:underline">
          Back to register
        </Link>
      </p>
    </div>
  );
}

export { VerifyOtp };
