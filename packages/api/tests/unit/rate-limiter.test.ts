import express from "express";
import request from "supertest";
import {
  authRateLimiter,
  credentialRateLimiter,
  emailSendRateLimiter,
} from "../../src/middleware/rate-limiter";

// These limiters are module-level singletons sharing one in-memory store keyed
// by IP, so each suite gets its own express app but they all look like the same
// client. Tests are written to run in order and not to lean on a clean store.

function appWith(middleware: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post("/", middleware, (req, res) => {
    // Mirrors a credential check: bad input answers 401, good input answers 200.
    if (req.body?.wrong) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    res.json({ ok: true });
  });
  return app;
}

describe("credentialRateLimiter", () => {
  const app = appWith(credentialRateLimiter);

  it("never blocks a client whose attempts keep succeeding", async () => {
    // Comfortably past the max of 10 successes must not accumulate.
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post("/").send({});
      expect(res.status).toBe(200);
    }
  });

  it("blocks once failed attempts pass the limit", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/").send({ wrong: true });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).post("/").send({ wrong: true });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too many failed attempts, please try again later.");
  });

  it("keeps blocking a correct attempt once the failure budget is spent", async () => {
    // The lockout is what protects the account, so a right password during the
    // window must not be a way out of it.
    const res = await request(app).post("/").send({});
    expect(res.status).toBe(429);
  });
});

describe("authRateLimiter", () => {
  const app = appWith(authRateLimiter);

  it("counts successful requests too, because each one sends an email", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/").send({});
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(
      "Too many authentication attempts, please try again later.",
    );
  });
});

describe("emailSendRateLimiter", () => {
  // Stands in for `authenticate`, which normally populates req.user before
  // this limiter runs the limiter keys on it, so the test has to too.
  function appWithUser() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        userId: req.header("x-test-user") ?? "anonymous",
        sessionId: "test-session",
        email: "test@example.com",
      };
      next();
    });
    app.post("/", emailSendRateLimiter, (_req, res) => res.json({ ok: true }));
    return app;
  }

  const app = appWithUser();

  it("keys the budget by user rather than IP, so one founder's sends don't spend another's", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/").set("x-test-user", "founder-a").send({});
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/").set("x-test-user", "founder-a").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too many emails sent please wait before sending more.");

    // Same test process, same IP, different user must not inherit the block.
    const otherFounder = await request(app).post("/").set("x-test-user", "founder-b").send({});
    expect(otherFounder.status).toBe(200);
  });
});
