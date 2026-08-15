import { useQuery } from "@tanstack/react-query";
import { getGoogleConnectionStatus } from "../lib/integrations-api";

export const GOOGLE_CONNECTION_QUERY_KEY = ["google-connection-status"] as const;

/** Shared across Settings and anywhere compose needs to know whether Gmail send is available. */
export function useGoogleConnectionStatus() {
  return useQuery({
    queryKey: GOOGLE_CONNECTION_QUERY_KEY,
    queryFn: getGoogleConnectionStatus,
  });
}
