import type { Response } from "express";
import { authService } from "../services/auth.service";
import { asyncHandler, createError } from "../utils/errors";

const IS_PROD = process.env.NODE_ENV === "production";

const COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie("accessToken", accessToken, {
    ...COOKIE_BASE,
    maxAge: 15 * 60 * 1_000, // 15 min
  });
  res.cookie("refreshToken", refreshToken, {
    ...COOKIE_BASE,
    path: "/api/auth/refresh",
    maxAge: 30 * 24 * 60 * 60 * 1_000, // 30 days
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
}

export const authController = {
  registerInitiate: asyncHandler(async (req, res) => {
    const result = await authService.registerInitiate(req.body);
    res.json({ data: result });
  }),

  registerResend: asyncHandler(async (req, res) => {
    const result = await authService.registerResend(req.body.email);
    res.json({ data: result });
  }),

  registerVerify: asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await authService.registerVerify(req.body, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ data: { user } });
  }),

  login: asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await authService.login({
      ...req.body,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ data: { user } });
  }),

  refresh: asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) throw createError("Missing refresh token", 401);
    const tokens = await authService.refresh(token);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ data: { message: "Token refreshed" } });
  }),

  logout: asyncHandler(async (req, res) => {
    if (req.user?.sessionId) await authService.logout(req.user.sessionId);
    clearAuthCookies(res);
    res.json({ data: { message: "Logged out successfully" } });
  }),

  me: asyncHandler(async (req, res) => {
    const user = await authService.getProfile(req.user!.userId);
    res.json({ data: user });
  }),
};
