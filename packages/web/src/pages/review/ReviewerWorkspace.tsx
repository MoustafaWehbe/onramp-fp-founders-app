import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Download, Eye, FileText, LogOut, MessageSquare, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/shared/EmptyState";
import { apiErrorMessage } from "../../lib/api-error";
import {
  completeReviewerSession,
  createReviewerComment,
  getReviewerFileAccess,
  getReviewerWorkspace,
  listReviewerComments,
  logoutReviewerSession,
} from "../../lib/reviewer-portal-api";
import { formatDate } from "../../lib/utils";

export function ReviewerWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const workspaceQuery = useQuery({
    queryKey: ["reviewer-workspace"],
    queryFn: getReviewerWorkspace,
    retry: false,
  });

  const documents = workspaceQuery.data?.documents ?? [];
  const activeDocumentId = selectedDocumentId ?? documents[0]?.documentId ?? null;

  const commentsQuery = useQuery({
    queryKey: ["reviewer-comments", activeDocumentId],
    queryFn: () => listReviewerComments(activeDocumentId ?? undefined),
    enabled: Boolean(workspaceQuery.data),
  });

  const openFile = async (documentId: string, disposition: "preview" | "download") => {
    const previewTab = disposition === "preview" ? window.open("about:blank", "_blank") : null;
    try {
      const access = await getReviewerFileAccess(documentId, disposition);
      const fileRes = await fetch(access.url);
      if (!fileRes.ok) throw new Error(`Could not fetch file (${fileRes.status})`);
      const blob = await fileRes.blob();
      const objectUrl = URL.createObjectURL(
        new Blob([blob], { type: access.mimeType || blob.type || "application/octet-stream" }),
      );
      if (disposition === "download") {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = access.originalFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (previewTab) {
        previewTab.location.href = objectUrl;
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      previewTab?.close();
      toast.error(apiErrorMessage(error, "Could not open file"));
    }
  };

  const commentMutation = useMutation({
    mutationFn: () =>
      createReviewerComment({
        documentId: activeDocumentId ?? undefined,
        commentText: comment.trim(),
      }),
    onSuccess: () => {
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["reviewer-comments"] });
      toast.success("Comment posted");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not post comment")),
  });

  const completeMutation = useMutation({
    mutationFn: completeReviewerSession,
    onSuccess: () => {
      toast.success("Review marked complete");
      void workspaceQuery.refetch();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not complete review")),
  });

  const logoutMutation = useMutation({
    mutationFn: logoutReviewerSession,
    onSuccess: () => navigate("/review/expired", { replace: true }),
  });

  const activeDoc = useMemo(
    () => documents.find((doc) => doc.documentId === activeDocumentId) ?? null,
    [activeDocumentId, documents],
  );

  if (workspaceQuery.isError) {
    navigate("/review/expired", { replace: true });
    return null;
  }

  if (workspaceQuery.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const workspace = workspaceQuery.data!;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{workspace.startup.name} data room</div>
              <div className="text-xs text-muted-foreground">
                Signed in as {workspace.invitation.email}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={completeMutation.isPending || workspace.invitation.status === "completed"}
              onClick={() => completeMutation.mutate()}
            >
              Mark complete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => logoutMutation.mutate()}
            >
              <LogOut className="mr-1.5 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="card-elevated h-fit p-3">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Shared documents
          </div>
          <div className="space-y-1">
            {documents.map((doc) => (
              <button
                key={doc.documentId}
                type="button"
                className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover ${
                  activeDocumentId === doc.documentId ? "bg-primary/10 text-primary" : ""
                }`}
                onClick={() => setSelectedDocumentId(doc.documentId)}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block font-medium">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">v{doc.version.versionNumber}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          {!activeDoc ? (
            <EmptyState
              icon={FileText}
              title="No documents shared"
              description="Ask the founder to attach ready documents to this invitation."
            />
          ) : (
            <div className="card-elevated space-y-4 p-5">
              <div>
                <h2 className="font-display text-xl font-semibold">{activeDoc.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {activeDoc.version.originalFilename} · updated {formatDate(workspace.invitation.expiresAt)}
                </p>
                {workspace.invitation.personalMessage && (
                  <p className="mt-3 rounded-md border border-border bg-surface/50 p-3 text-sm">
                    {workspace.invitation.personalMessage}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void openFile(activeDoc.documentId, "preview")}>
                  <Eye className="mr-1.5 h-4 w-4" /> Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!workspace.invitation.allowDownload}
                  onClick={() => void openFile(activeDoc.documentId, "download")}
                >
                  <Download className="mr-1.5 h-4 w-4" /> Download
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4" /> Comments
                </div>
                <div className="mb-3 space-y-2">
                  {(commentsQuery.data ?? []).map((item) => (
                    <div key={item.id} className="rounded-md border border-border bg-surface/40 p-3 text-sm">
                      <p>{item.commentText}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                    </div>
                  ))}
                  {(commentsQuery.data ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No comments yet.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Leave feedback for the founder…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    disabled={!comment.trim() || commentMutation.isPending}
                    onClick={() => commentMutation.mutate()}
                  >
                    Post
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
