import { useQuery } from "@tanstack/react-query";
import { listMyInvites } from "../lib/invite-api";

export const MY_INVITES_KEY = ["my-invites"] as const;

/** Invitations waiting for the signed-in user, acceptable without the email. */
export function useMyInvites() {
  return useQuery({ queryKey: MY_INVITES_KEY, queryFn: listMyInvites });
}
