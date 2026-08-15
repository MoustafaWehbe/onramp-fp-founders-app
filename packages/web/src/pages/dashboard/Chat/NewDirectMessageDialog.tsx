import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Skeleton } from "../../../components/ui/skeleton";
import { EmptyState } from "../../../components/shared/EmptyState";
import { getInitials } from "../../../lib/utils";
import { qk } from "../../../lib/query-keys";
import { listMembers } from "../../../lib/team-api";
import { useAuth } from "../../../hooks/useAuth";
import { Users } from "lucide-react";

type NewDirectMessageDialogProps = {
  startupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (memberId: string) => void;
};

export function NewDirectMessageDialog({
  startupId,
  open,
  onOpenChange,
  onSelect,
}: NewDirectMessageDialogProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const membersQuery = useQuery({
    queryKey: qk.members(startupId),
    queryFn: () => listMembers(startupId),
    enabled: open,
  });

  const candidates = (membersQuery.data ?? []).filter(
    (member) =>
      member.status === "active" &&
      member.user &&
      member.user.id !== user?.id &&
      `${member.user.firstName} ${member.user.lastName}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search teammates…"
          className="mb-1"
        />

        <div className="scrollbar-slim max-h-72 space-y-0.5 overflow-y-auto">
          {membersQuery.isLoading ? (
            <div className="space-y-1 py-1" aria-hidden>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No teammates found"
              description={query.trim() ? "Try a different name." : "You're the only active member here."}
              compact
            />
          ) : (
            candidates.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => onSelect(member.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="text-[11px] font-medium">
                    {getInitials(`${member.user!.firstName} ${member.user!.lastName}`)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {member.user!.firstName} {member.user!.lastName}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
