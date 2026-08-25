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
  roleName: string;
  status: string;
  /**
   * Every "resource:action" the caller's role grants, resolved once by
   * requireMember. Route gates and controllers both read it, so a request
   * never issues a second permission query.
   */
  permissions: ReadonlySet<string>;
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
