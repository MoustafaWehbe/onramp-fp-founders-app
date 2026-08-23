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

// RBAC

export interface Member {
  id: string;
  userId: string;
  startupId: string;
  roleId: string;
  status: string;
}

// Jobs

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  reviewerInvitationId?: string;
  deliveryGeneration?: number;
}

export interface EmailJobResult {
  messageId: string;
}
