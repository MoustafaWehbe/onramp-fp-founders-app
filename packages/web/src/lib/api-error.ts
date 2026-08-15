import { isAxiosError } from "axios";

/**
 * Turns an axios failure into something worth showing a user. 401/403 get
 * explicit copy because the API's own message for those ("Forbidden") tells
 * nobody anything; everything else prefers the server's message.
 */
export function apiErrorMessage(
  err: unknown,
  fallback: string,
  forbiddenMessage = "You don't have permission to do that in this workspace.",
): string {
  if (!isAxiosError(err)) return fallback;

  const status = err.response?.status;
  if (status === 401) return "Not signed in please log in again.";
  if (status === 403) return forbiddenMessage;

  const data = err.response?.data as { error?: string; message?: string } | undefined;
  return data?.error ?? data?.message ?? fallback;
}

/** The `code` field the API attaches to operational errors, when present. */
export function apiErrorCode(err: unknown): string | undefined {
  if (!isAxiosError(err)) return undefined;
  return (err.response?.data as { code?: string } | undefined)?.code;
}
