import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { reviewerPortalRouter } from "../../src/routes/reviewer-portal.routes";
import { reviewerPortalService } from "../../src/services/reviewer-portal.service";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/reviewer-portal", reviewerPortalRouter);
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.statusCode ?? 500).json({ code: error.code, error: error.message });
  };
  app.use(errorHandler);
  return app;
}

const token = "raw-invitation-token-value-1234567890";
const challengeId = "00000000-0000-0000-0000-000000000099";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reviewer portal HTTP access boundary", () => {
  it("carries the issued challenge through verification and sets a scoped HttpOnly cookie", async () => {
    jest.spyOn(reviewerPortalService, "requestAccess").mockResolvedValue({
      invitationId: "invitation-1",
      challengeId,
      emailHint: "ad***@example.com",
      expiresInSeconds: 600,
    });
    jest.spyOn(reviewerPortalService, "verifyAccess").mockResolvedValue({
      rawSessionToken: "raw-reviewer-session",
      session: {
        id: "session-1",
        expiresAt: new Date(Date.now() + 60_000),
        allowDownload: false,
        reviewerName: "Ada Investor",
        email: "ada@example.com",
        startupId: "startup-1",
      },
    });
    const app = createApp();

    const access = await request(app)
      .post("/api/v1/reviewer-portal/access")
      .send({ token });
    expect(access.status).toBe(200);
    expect(access.body.data.challengeId).toBe(challengeId);

    const verify = await request(app)
      .post("/api/v1/reviewer-portal/verify")
      .send({ token, challengeId, otp: "123456" });

    expect(verify.status).toBe(200);
    expect(reviewerPortalService.verifyAccess).toHaveBeenCalledWith(
      { token, challengeId, otp: "123456" },
      expect.objectContaining({ ip: expect.any(String) }),
    );
    expect(verify.headers["set-cookie"]?.[0]).toContain("reviewerSessionToken=raw-reviewer-session");
    expect(verify.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(verify.headers["set-cookie"]?.[0]).toContain("Path=/api/v1/reviewer-portal");
    expect(verify.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
  });

  it("rejects verification without a challenge before the service runs", async () => {
    const verify = jest.spyOn(reviewerPortalService, "verifyAccess");
    const response = await request(createApp())
      .post("/api/v1/reviewer-portal/verify")
      .send({ token, otp: "123456" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(verify).not.toHaveBeenCalled();
  });
});
