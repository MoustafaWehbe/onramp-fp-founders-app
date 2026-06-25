// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "user";

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  EMAIL: "email",
  EMBEDDINGS: "embeddings",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface EmailJobData {
  to: string;
  subject: string;
  template: string;
  variables?: Record<string, string>;
}

export interface EmbeddingsJobData {
  entityId: string;
  entityType: string;
  text: string;
}

export interface EmailJobResult {
  messageId: string;
}

export interface EmbeddingsJobResult {
  dimensions: number;
}
