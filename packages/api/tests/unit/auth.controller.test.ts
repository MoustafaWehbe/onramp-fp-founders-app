import request from "supertest";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  credentialRateLimiter: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../../src/db/prisma", () => ({ prisma: {} }));
jest.mock("../../src/config/email", () => ({ resend: {} }));

jest.mock("../../src/services/auth.service", () => ({
  authService: {
    registerInitiate: jest.fn(),
    registerResend: jest.fn(),
    registerVerify: jest.fn(),
    login: jest.fn(),
    googleAuth: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    getProfile: jest.fn(),
  },
}));

import { authService } from "../../src/services/auth.service";
const mock = authService as jest.Mocked<typeof authService>;

const INITIATE_BODY = {
  first_name: "Alice",
  last_name: "Smith",
  email: "alice@example.com",
  password: "SecurePass1",
};

const VERIFY_BODY = {
  email: "alice@example.com",
  otp: "123456",
};

// POST /api/v1/auth/register/initiate

describe("POST /api/v1/auth/register/initiate", () => {
  it("returns 200 and a message on success", async () => {
    mock.registerInitiate.mockResolvedValue({
      message: "Verification code sent to alice@example.com",
      email: "alice@example.com",
      expires_in_seconds: 600,
    });

    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send(INITIATE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("alice@example.com");
    expect(res.body.data.expires_in_seconds).toBe(600);
  });

  it("returns 400 when email is invalid", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send({ ...INITIATE_BODY, email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when password is too weak", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send({ ...INITIATE_BODY, password: "weak" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when first_name is missing", async () => {
    const { first_name: _, ...body } = INITIATE_BODY;
    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 with same body when email already has an account (no enumeration)", async () => {
    mock.registerInitiate.mockResolvedValue({
      message: "Verification code sent to alice@example.com",
      email: "alice@example.com",
      expires_in_seconds: 600,
    });

    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send(INITIATE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("alice@example.com");
  });
});

// POST /api/v1/auth/register/resend

describe("POST /api/v1/auth/register/resend", () => {
  it("returns 200 on success", async () => {
    mock.registerResend.mockResolvedValue({
      message: "Verification code sent to alice@example.com",
      email: "alice@example.com",
      expires_in_seconds: 600,
    });

    const res = await request(app)
      .post("/api/v1/auth/register/resend")
      .send({ email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("alice@example.com");
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register/resend")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 with same body when no pending registration exists (no enumeration)", async () => {
    mock.registerResend.mockResolvedValue({
      message: "Verification code sent to nobody@example.com",
      email: "nobody@example.com",
      expires_in_seconds: 600,
    });

    const res = await request(app)
      .post("/api/v1/auth/register/resend")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("nobody@example.com");
  });
});

// POST /api/v1/auth/register/verify

describe("POST /api/v1/auth/register/verify", () => {
  it("returns 201 with user on success and sets cookies", async () => {
    mock.registerVerify.mockResolvedValue({
      user: { id: "uuid-1", email: "alice@example.com", firstName: "Alice", lastName: "Smith" },
      accessToken: "access.token",
      refreshToken: "refresh.token",
    });

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send(VERIFY_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("alice@example.com");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("accessToken="))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith("refreshToken="))).toBe(true);
  });

  it("returns 400 when otp is not 6 digits", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send({ email: "alice@example.com", otp: "12345" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 INVALID_OTP on wrong OTP", async () => {
    mock.registerVerify.mockRejectedValue(
      Object.assign(new Error("Invalid or expired verification code"), { statusCode: 400, code: "INVALID_OTP" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send(VERIFY_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_OTP");
  });

  it("returns 400 INVALID_OTP when no pending registration exists (no enumeration)", async () => {
    mock.registerVerify.mockRejectedValue(
      Object.assign(new Error("Invalid or expired verification code"), { statusCode: 400, code: "INVALID_OTP" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send({ email: "nobody@example.com", otp: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_OTP");
  });

  it("returns 410 on expired OTP", async () => {
    mock.registerVerify.mockRejectedValue(
      Object.assign(new Error("Verification code has expired"), { statusCode: 410, code: "OTP_EXPIRED" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send(VERIFY_BODY);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe("OTP_EXPIRED");
  });

  it("returns 429 after too many failed attempts", async () => {
    mock.registerVerify.mockRejectedValue(
      Object.assign(new Error("Too many failed attempts"), { statusCode: 429, code: "TOO_MANY_ATTEMPTS" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send(VERIFY_BODY);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("TOO_MANY_ATTEMPTS");
  });
});

// POST /api/v1/auth/login

describe("POST /api/v1/auth/login", () => {
  it("returns 200 with user and sets cookies", async () => {
    mock.login.mockResolvedValue({
      user: { id: "uuid-1", email: "alice@example.com", firstName: "Alice", lastName: "Smith" },
      accessToken: "access.token",
      refreshToken: "refresh.token",
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("alice@example.com");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("accessToken="))).toBe(true);
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 on invalid credentials", async () => {
    mock.login.mockRejectedValue(
      Object.assign(new Error("Invalid credentials"), { statusCode: 401, code: "INVALID_CREDENTIALS" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice@example.com", password: "WrongPass1" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 400 GOOGLE_ACCOUNT for Google-only users", async () => {
    mock.login.mockRejectedValue(
      Object.assign(new Error("This account uses Google sign-in. Please continue with Google."), {
        statusCode: 400,
        code: "GOOGLE_ACCOUNT",
      }),
    );

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "google@example.com", password: "SecurePass1" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("GOOGLE_ACCOUNT");
  });
});

// POST /api/v1/auth/google

describe("POST /api/v1/auth/google", () => {
  it("returns 200 with user and sets cookies for returning users", async () => {
    mock.googleAuth.mockResolvedValue({
      user: { id: "uuid-1", email: "google@example.com", firstName: "Google", lastName: "User" },
      accessToken: "access.token",
      refreshToken: "refresh.token",
      isNewUser: false,
    });

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "valid.google.token" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("google@example.com");
    expect(res.body.data.is_new_user).toBe(false);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("accessToken="))).toBe(true);
  });

  it("returns 201 with is_new_user true for new Google users", async () => {
    mock.googleAuth.mockResolvedValue({
      user: { id: "uuid-2", email: "new@example.com", firstName: "New", lastName: "User" },
      accessToken: "access.token",
      refreshToken: "refresh.token",
      isNewUser: true,
    });

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "valid.google.token" });

    expect(res.status).toBe(201);
    expect(res.body.data.is_new_user).toBe(true);
  });

  it("returns 400 when id_token is missing", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 INVALID_GOOGLE_TOKEN on bad token", async () => {
    mock.googleAuth.mockRejectedValue(
      Object.assign(new Error("Invalid or expired Google token"), {
        statusCode: 401,
        code: "INVALID_GOOGLE_TOKEN",
      }),
    );

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "bad.token" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_GOOGLE_TOKEN");
  });

  it("returns 401 EMAIL_NOT_VERIFIED when Google email is unverified", async () => {
    mock.googleAuth.mockRejectedValue(
      Object.assign(new Error("Google email not verified"), {
        statusCode: 401,
        code: "EMAIL_NOT_VERIFIED",
      }),
    );

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "unverified.token" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("returns 409 ACCOUNT_CONFLICT when email is linked to a different Google account", async () => {
    mock.googleAuth.mockRejectedValue(
      Object.assign(new Error("This email is already linked to a different Google account"), {
        statusCode: 409,
        code: "ACCOUNT_CONFLICT",
      }),
    );

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "conflicting.token" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_CONFLICT");
  });

  it("returns 200 with is_new_user false when existing local user links Google account", async () => {
    mock.googleAuth.mockResolvedValue({
      user: { id: "uuid-3", email: "local@example.com", firstName: "Local", lastName: "User" },
      accessToken: "access.token",
      refreshToken: "refresh.token",
      isNewUser: false,
    });

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ id_token: "valid.google.token" });

    expect(res.status).toBe(200);
    expect(res.body.data.is_new_user).toBe(false);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("accessToken="))).toBe(true);
  });
});

// POST /api/v1/auth/logout

describe("POST /api/v1/auth/logout", () => {
  it("returns 200 and clears cookies when authenticated", async () => {
    mock.logout.mockResolvedValue(undefined);
    const jwt = require("jsonwebtoken");
    const accessToken = jwt.sign(
      { sub: "uuid-1", type: "access", sessionId: "session-1", email: "alice@example.com" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m" },
    );

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", [`accessToken=${accessToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Logged out successfully");
    expect(mock.logout).toHaveBeenCalledWith("session-1");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("accessToken=;"))).toBe(true);
  });

  it("returns 401 without access token cookie", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(401);
  });
});
