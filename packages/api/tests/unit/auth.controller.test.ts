import request from "supertest";
import { app } from "../../app";

jest.mock("../../src/middleware/rate-limiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../../src/db/prisma", () => ({ prisma: {} }));
jest.mock("../../src/config/email", () => ({ resend: {} }));

jest.mock("../../src/services/auth.service", () => ({
  authService: {
    registerInitiate: jest.fn(),
    registerResend: jest.fn(),
    registerVerify: jest.fn(),
    login: jest.fn(),
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

  it("returns 409 when email already exists", async () => {
    mock.registerInitiate.mockRejectedValue(
      Object.assign(new Error("Email already in use"), { statusCode: 409, code: "EMAIL_ALREADY_EXISTS" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/initiate")
      .send(INITIATE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_ALREADY_EXISTS");
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

  it("returns 404 when no pending registration exists", async () => {
    mock.registerResend.mockRejectedValue(
      Object.assign(new Error("No pending registration found"), { statusCode: 404, code: "NOT_FOUND" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/resend")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
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

  it("returns 400 on wrong OTP", async () => {
    mock.registerVerify.mockRejectedValue(
      Object.assign(new Error("Invalid verification code"), { statusCode: 400, code: "INVALID_OTP" }),
    );

    const res = await request(app)
      .post("/api/v1/auth/register/verify")
      .send(VERIFY_BODY);

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
      Object.assign(new Error("Invalid credentials"), { statusCode: 401 }),
    );

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice@example.com", password: "WrongPass1" });

    expect(res.status).toBe(401);
  });
});
