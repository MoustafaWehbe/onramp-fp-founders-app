import {
  createPageToken,
  verifyPageToken,
  PAGE_TOKEN_TTL_SECONDS,
} from "../../src/utils/page-token";

const SESSION_ID = "session-abc";
const VERSION_ID = "version-xyz";

describe("page tokens", () => {
  it("round-trips the session and version it was minted for", () => {
    const token = createPageToken(SESSION_ID, VERSION_ID);
    const claims = verifyPageToken(token);

    expect(claims).toMatchObject({ sessionId: SESSION_ID, versionId: VERSION_ID });
  });

  it("rejects a token whose payload was edited", () => {
    const token = createPageToken(SESSION_ID, VERSION_ID);
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      `${SESSION_ID}.other-version.${Math.floor(Date.now() / 1000) + 600}`,
    ).toString("base64url");

    expect(verifyPageToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a token with a truncated signature", () => {
    const token = createPageToken(SESSION_ID, VERSION_ID);
    const [payload, signature] = token.split(".");

    expect(verifyPageToken(`${payload}.${signature!.slice(0, -4)}`)).toBeNull();
  });

  it("rejects a token past its expiry", () => {
    const token = createPageToken(SESSION_ID, VERSION_ID);
    const afterExpiry = Date.now() + (PAGE_TOKEN_TTL_SECONDS + 1) * 1000;

    expect(verifyPageToken(token, afterExpiry)).toBeNull();
  });

  it("rejects structurally invalid input without throwing", () => {
    for (const bad of ["", ".", "a.b.c", "not-a-token", "!!!.???"]) {
      expect(verifyPageToken(bad)).toBeNull();
    }
  });
});
