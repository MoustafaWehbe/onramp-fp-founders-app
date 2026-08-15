import { encryptSecret, decryptSecret } from "../../src/utils/crypto";

// A Google refresh token sits behind this encryption at rest. Anything wrong
// here is either data loss (decrypt fails) or a security hole (weak key
// validation, or a decrypt that silently accepts tampered ciphertext).

const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
    "ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12";
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a refresh token", () => {
    const token = "1//09FAKE-REFRESH-TOKEN-VALUE";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces a different ciphertext each time (random iv)", () => {
    const token = "same-token";
    expect(encryptSecret(token)).not.toBe(encryptSecret(token));
  });

  it("rejects tampered ciphertext instead of returning garbage", () => {
    const encrypted = encryptSecret("a-real-token");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decryptSecret(bytes.toString("base64"))).toThrow();
  });

  it("throws rather than encrypting when the key is missing", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow("GOOGLE_TOKEN_ENCRYPTION_KEY is not set");
  });

  it("throws when the key is not 32 bytes of hex", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptSecret("x")).toThrow(/64-character hex/);
  });
});
