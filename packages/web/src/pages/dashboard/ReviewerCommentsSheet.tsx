import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, MessageSquare, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { Skeleton } from "../../components/ui/skeleton";
import { apiErrorMessage } from "../../lib/api-error";
import {
  listFounderReviewerComments,
  markFounderReviewerCommentRead,
  resolveFounderReviewerComment,
  reviewerDocumentContextHref,
} from "../../lib/reviewer-api";
import { cn, formatDate } from "../../lib/utils";

type CommentFilter = "open" | "unread" | "resolved" | "all";

export function ReviewerCommentsSheet({
  startupId,
  open,
  canResolve,
  onOpenChange,
}: {
  startupId: string;
  open: boolean;
  canResolve: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<CommentFilter>("open");
  const queryKey = ["reviewer-comments-founder", startupId, filter] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listFounderReviewerComments(startupId, { page: 1, limit: 100, status: filter }),
    enabled: open,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["reviewer-comments-founder", startupId] });
  };
  const readMutation = useMutation({
    mutationFn: (commentId: string) => markFounderReviewerCommentRead(startupId, commentId),
    onSuccess: refresh,
    onError: (error) => toast.error(apiErrorMessage(error, "Could not mark comment as read")),
  });
  const resolveMutation = useMutation({
    mutationFn: (commentId: string) => resolveFounderReviewerComment(startupId, commentId),
    onSuccess: () => {
      refresh();
      toast.success("Comment resolved");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not resolve comment")),
  });

  const rows = query.data?.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Reviewer comments</SheetTitle>
          <SheetDescription>
            Questions and feedback left by investors while reviewing your documents.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-surface/40 p-1">
          {(["open", "unread", "resolved", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === value
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>

        {query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
            <TriangleAlert className="mr-2 inline h-4 w-4" />
            {apiErrorMessage(query.error, "Could not load reviewer comments")}
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border/70 py-12 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No {filter === "all" ? "" : filter} comments</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((comment) => (
              <li
                key={comment.id}
                className={cn(
                  "rounded-xl border border-border/70 p-4",
                  !comment.readAt && !comment.resolvedAt && "border-primary/30 bg-primary/3",
                )}
              >
                <div className="flex items-start gap-2">
                  <Circle
                    className={cn(
                      "mt-1 h-2.5 w-2.5 shrink-0 fill-current",
                      comment.readAt ? "text-transparent" : "text-primary",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-semibold text-foreground">
                        {comment.reviewerName || comment.reviewerEmail}
                      </span>
                      <span className="text-muted-foreground">{formatDate(comment.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {comment.document?.title || "General data-room comment"}
                      {comment.section?.label ? ` · ${comment.section.label}` : ""}
                      {comment.section?.pageNumber ? ` · page ${comment.section.pageNumber}` : ""}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{comment.commentText}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!comment.readAt && !comment.resolvedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={readMutation.isPending}
                          onClick={() => readMutation.mutate(comment.id)}
                        >
                          Mark read
                        </Button>
                      )}
                      {!comment.resolvedAt && canResolve && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate(comment.id)}
                        >
                          <Check className="h-3.5 w-3.5" /> Resolve
                        </Button>
                      )}
                      {comment.document && (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                        >
                          <Link
                            to={reviewerDocumentContextHref({
                              documentId: comment.document.id,
                              versionId: comment.document.versionId,
                              pageNumber: comment.section?.pageNumber,
                              sectionLabel: comment.section?.label,
                            })}
                            onClick={() => {
                              if (!comment.readAt && !comment.resolvedAt) {
                                readMutation.mutate(comment.id);
                              }
                              onOpenChange(false);
                            }}
                          >
                            Open context
                          </Link>
                        </Button>
                      )}
                      {comment.resolvedAt && (
                        <span className="text-xs text-success">
                          Resolved{comment.resolvedBy?.name ? ` by ${comment.resolvedBy.name}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
