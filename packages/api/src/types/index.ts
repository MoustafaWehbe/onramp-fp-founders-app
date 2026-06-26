// Auth

export interface JwtPayload {
  userId: string;
  email: string;
  sessionId: string; // maps to familyId on RefreshToken
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Jobs

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
}

export interface EmailJobResult {
  messageId: string;
}
