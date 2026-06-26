import type { Response } from "express";
import { authService } from "../services/auth.service";
import { asyncHandler, createError } from "../utils/errors";

const isProduction = process.env.NODE_ENV === "production";
const ACCESS_COOKIE = "accessToken";
const REFRESH_COOKIE = "refreshToken";
const ACCESS_MAX_AGE = 15 * 60 * 1_000;
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1_000;

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/api",
    maxAge: ACCESS_MAX_AGE,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/api/auth/refresh",
    maxAge: REFRESH_MAX_AGE,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: "/api" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth/refresh" });
}

export const authController = {
  register: asyncHandler(async (req, res) => {
    const user = await authService.register(req.body);
    res.status(201).json({ data: user });
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
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
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
