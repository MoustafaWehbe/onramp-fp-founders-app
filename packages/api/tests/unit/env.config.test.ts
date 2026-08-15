import { getTrustProxy } from "../../src/config/env";

// getTrustProxy decides what req.ip resolves to, which is what every rate
// limiter keys on a wrong value silently breaks throttling in one of two
// directions, so each branch is pinned here.

const original = process.env.TRUST_PROXY;

afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

describe("getTrustProxy", () => {
  it("trusts nothing when unset the safe default for local and direct exposure", () => {
    delete process.env.TRUST_PROXY;
    expect(getTrustProxy()).toBe(0);
  });

  it("treats an empty or whitespace value as unset rather than as a hostname", () => {
    process.env.TRUST_PROXY = "   ";
    expect(getTrustProxy()).toBe(0);
  });

  it("reads a hop count as a number", () => {
    process.env.TRUST_PROXY = "1";
    expect(getTrustProxy()).toBe(1);

    process.env.TRUST_PROXY = "2";
    expect(getTrustProxy()).toBe(2);
  });

  it("keeps an explicit zero as zero", () => {
    process.env.TRUST_PROXY = "0";
    expect(getTrustProxy()).toBe(0);
  });

  it("passes an address list through for Express to parse", () => {
    process.env.TRUST_PROXY = "10.0.0.0/8, 172.16.0.1";
    expect(getTrustProxy()).toBe("10.0.0.0/8, 172.16.0.1");
  });

  it("does not turn 'true' into a boolean, so blanket trust is never implicit", () => {
    // Express would read the string "true" as an address list and trust
    // nothing, which fails closed. Blanket trust would let any client forge
    // X-Forwarded-For and skip the limiters entirely.
    process.env.TRUST_PROXY = "true";
    expect(getTrustProxy()).toBe("true");
  });

  it("does not accept a negative hop count as a number", () => {
    process.env.TRUST_PROXY = "-1";
    expect(getTrustProxy()).toBe("-1");
  });
});
