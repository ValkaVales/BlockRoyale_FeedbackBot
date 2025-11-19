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