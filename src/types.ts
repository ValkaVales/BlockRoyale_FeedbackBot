export interface SupportRequest {
  name: string;
  email: string;
  text: string;
}

export interface ApiResponse {
  success: boolean;
  message: string;
}

export interface ErrorResponse {
  error: string;
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUrl: string;
  senderEmail: string;
  senderName: string;
}

export interface GmailEmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  replyToMessageId?: string;
  cc?: string[];
  bcc?: string[];
}

export interface GmailEmailResponse {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  errorCode?: string | number;
  timestamp: string;
  requiresReAuth?: boolean;
}

export interface TokenStatus {
  valid: boolean;
  lastCheck: Date;
  needsReAuth: boolean;
  expiresAt?: Date;
}

export interface OAuth2Credentials {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}