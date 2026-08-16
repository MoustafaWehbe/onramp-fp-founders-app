import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, BarChart3, Clock, Copy, Plus, Shield } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../components/shared/EmptyState";
import { StatTile } from "../../components/shared/StatTile";
import { PageHeader } from "../../components/layout/PageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { MultiSelect } from "../../components/ui/multi-select";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { usePermissions } from "../../hooks/usePermissions";
import { useActiveStartupId } from "../../hooks/useWorkspace";
import { apiErrorMessage } from "../../lib/api-error";
import { listDocuments } from "../../lib/document-api";
import {
  createReviewerInvitation,
  listReviewerInvitations,
  reviewerStatusClass,
  revokeReviewerInvitation,
} from "../../lib/reviewer-api";
import { ReviewerAnalyticsSheet } from "./ReviewerAnalyticsSheet";

function expiresLabel(iso: string, status: string) {
  if (status === "revoked") return "Revoked";
  if (status === "completed") return "Completed";
  if (status === "expired") return "Expired";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "1 day" : `${days} days`;
}

export function Reviewers() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canShare = can("documents", "share");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [allowDownload, setAllowDownload] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [allowPrint, setAllowPrint] = useState(false);
  const [screenshotGuard, setScreenshotGuard] = useState(true);
  const [requireNda, setRequireNda] = useState(false);
  const [ndaText, setNdaText] = useState("");
  const [password, setPassword] = useState("");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [analyticsInvitationId, setAnalyticsInvitationId] = useState<string | null>(null);

  const resetInviteForm = () => {
    setEmail("");
    setName("");
    setSelectedVersionIds([]);
    setAllowDownload(false);
    setWatermarkEnabled(true);
    setAllowPrint(false);
    setScreenshotGuard(true);
    setRequireNda(false);
    setNdaText("");
    setPassword("");
    setAllowedDomains("");
  };

  const invitesQuery = useQuery({
    queryKey: ["reviewer-invitations", startupId],
    queryFn: () => listReviewerInvitations(startupId, { page: 1, limit: 100 }),
  });

  const docsQuery = useQuery({
    queryKey: ["documents", startupId, "ready-for-share"],
    queryFn: () => listDocuments(startupId, { page: 1, limit: 100 }),
    enabled: inviteOpen,
  });

  const readyVersions = useMemo(
    () =>
      (docsQuery.data?.data ?? [])
        .filter((doc) => doc.currentVersion?.processingStatus === "ready")
        .map((doc) => ({
          documentId: doc.id,
          title: doc.title,
          versionId: doc.currentVersion!.id,
          versionNumber: doc.currentVersion!.versionNumber,
        })),
    [docsQuery.data],
  );

  const rows = invitesQuery.data?.data ?? [];
  const stats = useMemo(
    () => ({
      active: rows.filter((row) => row.status === "in_review" || row.status === "opened").length,
      pending: rows.filter((row) => row.status === "pending").length,
      closed: rows.filter((row) => ["expired", "revoked", "completed"].includes(row.status)).length,
    }),
    [rows],
  );

  const inviteMutation = useMutation({
    mutationFn: () =>
      createReviewerInvitation(startupId, {
        email,
        reviewerName: name || undefined,
        documentVersionIds: selectedVersionIds,
        expiresInDays: 14,
        allowDownload,
        watermarkEnabled,
        allowPrint,
        screenshotGuard,
        requireNda,
        ndaText: requireNda ? ndaText.trim() : undefined,
        password: password.trim() || undefined,
        allowedEmailDomains: allowedDomains
          .split(",")
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
      }),
    onSuccess: async (result) => {
      const hadPassword = Boolean(password.trim());
      setInviteOpen(false);
      resetInviteForm();
      void queryClient.invalidateQueries({ queryKey: ["reviewer-invitations", startupId] });
      try {
        await navigator.clipboard.writeText(result.accessUrl);
        toast.success("Invitation created — access link copied");
      } catch {
        toast.success("Invitation created", { description: result.accessUrl });
      }
      if (hadPassword) {
        toast.message("Share the password separately", {
          description: "It won't be shown again — send it through a different channel than the link.",
        });
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not create invitation")),
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => revokeReviewerInvitation(startupId, invitationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reviewer-invitations", startupId] });
      toast.success("Access revoked");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not revoke invitation")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviewers"
        description="Time-limited, verified access for investors and advisors to review your data room."
        actions={
          <Button size="sm" disabled={!canShare} onClick={() => setInviteOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Invite reviewer
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="In review / opened" value={String(stats.active)} icon={Shield} tone="success" />
        <StatTile label="Pending" value={String(stats.pending)} icon={Clock} tone="warning" />
        <StatTile label="Closed" value={String(stats.closed)} icon={Ban} tone="muted" />
      </div>

      <div className="card-elevated overflow-hidden">
        {invitesQuery.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : invitesQuery.isError ? (
          <EmptyState
            icon={Shield}
            title="Could not load invitations"
            description={apiErrorMessage(invitesQuery.error, "Please try again.")}
            action={<Button onClick={() => void invitesQuery.refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="No reviewer invitations yet"
            description="Upload ready documents in the Data room, then invite a reviewer to a pinned version."
            action={
              canShare ? (
                <Button onClick={() => setInviteOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Invite reviewer
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Reviewer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Documents</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.reviewerName || row.email}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`${reviewerStatusClass(row.status)} border-0 capitalize`}>
                        {row.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.documentCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {expiresLabel(row.expiresAt, row.status)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setAnalyticsInvitationId(row.id)}
                        >
                          <BarChart3 className="mr-1 h-3 w-3" /> Analytics
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() =>
                            toast.message("Access link was shown only at invite time", {
                              description: "Create a new invitation or use resend once portal emailing is fully wired.",
                            })
                          }
                        >
                          <Copy className="mr-1 h-3 w-3" /> Link
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={!canShare || row.status === "revoked" || revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(row.id)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite reviewer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reviewer-email">Email</Label>
              <Input
                id="reviewer-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="reviewer-name">Name (optional)</Label>
              <Input
                id="reviewer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Documents</Label>
              <div className="mt-2">
                {readyVersions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No ready documents yet. Upload a document from the Documents page first — it needs to finish processing before it can be shared.
                  </p>
                ) : (
                  <MultiSelect
                    options={readyVersions.map((item) => ({
                      value: item.versionId,
                      label: item.title,
                      description: `v${item.versionNumber}`,
                    }))}
                    selected={selectedVersionIds}
                    onChange={setSelectedVersionIds}
                    placeholder="Choose documents to share"
                    searchPlaceholder="Search documents…"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2.5 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
                Allow download (returns a watermarked PDF)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={watermarkEnabled} onChange={(e) => setWatermarkEnabled(e.target.checked)} />
                Watermark pages with reviewer identity
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} />
                Allow printing
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={screenshotGuard} onChange={(e) => setScreenshotGuard(e.target.checked)} />
                Screenshot / capture deterrence
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={requireNda} onChange={(e) => setRequireNda(e.target.checked)} />
                Require NDA acceptance before viewing
              </label>
              {requireNda && (
                <Textarea
                  placeholder="Paste the NDA text reviewers must accept…"
                  value={ndaText}
                  onChange={(e) => setNdaText(e.target.value)}
                  rows={4}
                />
              )}
            </div>

            <div>
              <Label htmlFor="reviewer-password">Access password (optional)</Label>
              <Input
                id="reviewer-password"
                type="text"
                placeholder="Second factor beyond the emailed code"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="reviewer-domains">Allowed email domains (optional)</Label>
              <Input
                id="reviewer-domains"
                placeholder="acme.com, fund.vc"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Reject creating this invitation unless the reviewer's email matches one of these domains.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !email.trim() ||
                selectedVersionIds.length === 0 ||
                (requireNda && !ndaText.trim()) ||
                inviteMutation.isPending
              }
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? "Sending…" : "Create invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewerAnalyticsSheet
        startupId={startupId}
        invitationId={analyticsInvitationId}
        onOpenChange={(next) => !next && setAnalyticsInvitationId(null)}
      />
    </div>
  );
}
