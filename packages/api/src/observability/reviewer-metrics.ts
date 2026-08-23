import crypto from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getReviewerOperationsConfig } from "../config/reviewer-operations";

interface RequestMetric { count: number; durationSeconds: number }

const requests = new Map<string, RequestMetric>();
const rateLimits = new Map<string, number>();
const retentionRuns = new Map<string, number>();
const retentionRecords = new Map<string, number>();
let retentionLastSuccessSeconds = 0;

function operationFor(req: Request): string {
  const path = req.path;
  if (path === "/access") return "access";
  if (path === "/verify") return "verify";
  if (path === "/workspace") return "workspace";
  if (path === "/nda/accept") return "nda_accept";
  if (/^\/documents\/[^/]+\/manifest$/.test(path)) return "manifest";
  if (/^\/pages\/[^/]+\/[^/]+$/.test(path)) return "page";
  if (/^\/documents\/[^/]+\/download$/.test(path)) return "download";
  if (path === "/comments") return req.method === "POST" ? "comment_create" : "comments_list";
  if (path === "/events") return "event";
  if (path === "/telemetry") return "telemetry";
  if (path === "/complete") return "complete";
  if (path === "/logout") return "logout";
  return "unknown";
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export const reviewerMetricsMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const operation = operationFor(req);
  res.once("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    const key = `${operation}\0${statusClass}`;
    const current = requests.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += durationSeconds;
    requests.set(key, current);
  });
  next();
};

export function recordReviewerRateLimit(scope: string): void {
  increment(rateLimits, scope);
}

export function recordReviewerRetentionRun<T extends object>(
  outcome: "success" | "error",
  records?: T,
): void {
  increment(retentionRuns, outcome);
  for (const [action, count] of Object.entries(records ?? {})) {
    if (typeof count === "number") increment(retentionRecords, action, count);
  }
  if (outcome === "success") retentionLastSuccessSeconds = Math.floor(Date.now() / 1_000);
}

function line(name: string, labels: Record<string, string>, value: number): string {
  const rendered = Object.entries(labels)
    .map(([key, label]) => `${key}="${label.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `${name}{${rendered}} ${value}`;
}

export function renderMetrics(): string {
  const output = [
    "# HELP raise_reviewer_portal_http_requests_total Reviewer portal HTTP responses.",
    "# TYPE raise_reviewer_portal_http_requests_total counter",
  ];
  for (const [key, metric] of [...requests.entries()].sort()) {
    const [operation, statusClass] = key.split("\0");
    output.push(line("raise_reviewer_portal_http_requests_total", { operation, status_class: statusClass }, metric.count));
  }
  output.push(
    "# HELP raise_reviewer_portal_http_request_duration_seconds Reviewer portal request time.",
    "# TYPE raise_reviewer_portal_http_request_duration_seconds summary",
  );
  for (const [key, metric] of [...requests.entries()].sort()) {
    const [operation, statusClass] = key.split("\0");
    const labels = { operation, status_class: statusClass };
    output.push(
      line("raise_reviewer_portal_http_request_duration_seconds_sum", labels, metric.durationSeconds),
      line("raise_reviewer_portal_http_request_duration_seconds_count", labels, metric.count),
    );
  }
  output.push("# HELP raise_reviewer_rate_limit_hits_total Reviewer requests rejected by a scoped rate limiter.", "# TYPE raise_reviewer_rate_limit_hits_total counter");
  for (const [scope, count] of [...rateLimits.entries()].sort()) output.push(line("raise_reviewer_rate_limit_hits_total", { scope }, count));
  output.push("# HELP raise_reviewer_retention_runs_total Reviewer retention runs by outcome.", "# TYPE raise_reviewer_retention_runs_total counter");
  for (const [outcome, count] of [...retentionRuns.entries()].sort()) output.push(line("raise_reviewer_retention_runs_total", { outcome }, count));
  output.push("# HELP raise_reviewer_retention_records_total Reviewer records deleted or redacted.", "# TYPE raise_reviewer_retention_records_total counter");
  for (const [action, count] of [...retentionRecords.entries()].sort()) output.push(line("raise_reviewer_retention_records_total", { action }, count));
  output.push(
    "# HELP raise_reviewer_retention_last_success_timestamp_seconds Last successful reviewer retention run.",
    "# TYPE raise_reviewer_retention_last_success_timestamp_seconds gauge",
    `raise_reviewer_retention_last_success_timestamp_seconds ${retentionLastSuccessSeconds}`,
    "# HELP raise_process_uptime_seconds Process uptime.",
    "# TYPE raise_process_uptime_seconds gauge",
    `raise_process_uptime_seconds ${process.uptime()}`,
  );
  return `${output.join("\n")}\n`;
}

function hasValidToken(req: Request, expected: string): boolean {
  const prefix = "Bearer ";
  const authorization = req.get("authorization") ?? "";
  if (!authorization.startsWith(prefix)) return false;
  const received = Buffer.from(authorization.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
}

export function metricsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const config = getReviewerOperationsConfig();
    if (!config.metricsEnabled) {
      res.status(404).send("Not Found");
      return;
    }
    if (!config.metricsToken || !hasValidToken(req, config.metricsToken)) {
      res.set("WWW-Authenticate", "Bearer").status(401).send("Unauthorized");
      return;
    }
    res.set("Cache-Control", "no-store");
    res.type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics());
  } catch (error) {
    next(error);
  }
}

export function resetReviewerMetricsForTests(): void {
  requests.clear();
  rateLimits.clear();
  retentionRuns.clear();
  retentionRecords.clear();
  retentionLastSuccessSeconds = 0;
}
