import { hashPassword, verifyPassword, signAccessToken, verifyAccessToken } from "../../src/utils/auth";

// ─── Password utilities ───────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies it correctly", async () => {
    const password = "MySecurePass1";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(20);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it("returns false for a wrong password", async () => {
    const hash = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("produces different hashes for the same password (salt uniqueness)", async () => {
    const password = "SamePassword1";
    const [hash1, hash2] = await Promise.all([
      hashPassword(password),
      hashPassword(password),
    ]);
    expect(hash1).not.toBe(hash2);
  });
});

// ─── JWT utilities ────────────────────────────────────────────────────────────

describe("signAccessToken / verifyAccessToken", () => {
  const payload = {
    userId: "user-uuid-123",
    email: "test@example.com",
    role: "user" as const,
    sessionId: "session-uuid-456",
  };

  it("signs and verifies a token successfully", () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);

    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.role).toBe(payload.role);
  });

  it("throws when verifying a tampered token", () => {
    const token = signAccessToken(payload);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });
});
