import {
  hashToken,
  hashOTP,
  generateRefreshToken,
  generateOTP,
  generateAccessToken,
  verifyAccessToken,
  hashPassword,
  verifyPassword,
} from "../../src/utils/auth";

// hashToken

describe("hashToken", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const result = hashToken("abc");
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashToken("same")).toBe(hashToken("same"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

// generateRefreshToken

describe("generateRefreshToken", () => {
  it("returns a raw token and its hash", () => {
    const { raw, hash } = generateRefreshToken();
    expect(typeof raw).toBe("string");
    expect(typeof hash).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
  });

  it("hash matches hashToken(raw)", () => {
    const { raw, hash } = generateRefreshToken();
    expect(hash).toBe(hashToken(raw));
  });

  it("generates unique tokens on each call", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});

// generateOTP

describe("generateOTP", () => {
  it("raw is a 6-digit numeric string", () => {
    const { raw } = generateOTP();
    expect(raw).toMatch(/^\d{6}$/);
  });

  it("raw is within [100000, 999999]", () => {
    for (let i = 0; i < 20; i++) {
      const n = parseInt(generateOTP().raw, 10);
      expect(n).toBeGreaterThanOrEqual(100_000);
      expect(n).toBeLessThanOrEqual(999_999);
    }
  });

  it("hash matches hashOTP(raw)", () => {
    const { raw, hash } = generateOTP();
    expect(hash).toBe(hashOTP(raw));
  });

  it("generates unique OTPs on each call (probabilistically)", () => {
    const otps = Array.from({ length: 10 }, () => generateOTP().raw);
    const unique = new Set(otps);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// generateAccessToken / verifyAccessToken

describe("generateAccessToken / verifyAccessToken", () => {
  const userId = "user-uuid-123";
  const sessionId = "session-uuid-456";
  const email = "test@example.com";

  it("round-trips: verify returns what was signed", () => {
    const token = generateAccessToken(userId, sessionId, email);
    const payload = verifyAccessToken(token);

    expect(payload.userId).toBe(userId);
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.email).toBe(email);
  });

  it("throws on a tampered token", () => {
    const token = generateAccessToken(userId, sessionId, email);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("throws when token type is not 'access'", () => {
    // manually build a token signed with the same secret but wrong type
    const jwt = require("jsonwebtoken");
    const fakeToken = jwt.sign(
      { sub: userId, type: "refresh", sessionId, email },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m" },
    );
    expect(() => verifyAccessToken(fakeToken)).toThrow("Invalid token type");
  });

  it("throws on an expired token", () => {
    const jwt = require("jsonwebtoken");
    const expired = jwt.sign(
      { sub: userId, type: "access", sessionId, email },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: 0 },
    );
    expect(() => verifyAccessToken(expired)).toThrow();
  });
});

// hashPassword / verifyPassword

describe("hashPassword / verifyPassword", () => {
  it("hashes and verifies correctly", async () => {
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

  it("produces different hashes for the same password (salting)", async () => {
    const [hash1, hash2] = await Promise.all([
      hashPassword("SamePassword1"),
      hashPassword("SamePassword1"),
    ]);
    expect(hash1).not.toBe(hash2);
  });
});
