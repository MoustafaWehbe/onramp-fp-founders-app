import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Ban,
  BarChart3,
  Clock,
  Copy,
  Download,
  Droplets,
  FileText,
  KeyRound,
  Plus,
  Printer,
  ScanEye,
  ScrollText,
  Shield,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "../../components/shared/EmptyState";
import { StatTile } from "../../components/shared/StatTile";
import { PageHeader } from "../../components/layout/PageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { MultiSelect } from "../../components/ui/multi-select";
import { Skeleton } from "../../components/ui/skeleton";
import { SwitchIndicator } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite reviewer</DialogTitle>
            <DialogDescription>
              Creates a private access link that expires in 14 days. You can revoke it at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <section className="space-y-3">
              <SectionLabel icon={UserRound}>Who</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reviewer-email">Email</Label>
                  <Input
                    id="reviewer-email"
                    type="email"
                    placeholder="partner@fund.vc"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reviewer-name">
                    Name <span className="font-normal text-muted-foreground">optional</span>
                  </Label>
                  <Input
                    id="reviewer-name"
                    placeholder="Jordan Ellis"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <SectionLabel icon={FileText}>Documents</SectionLabel>
              {docsQuery.isPending ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : readyVersions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/80 bg-surface/40 px-4 py-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    No ready documents yet. Upload one from the Data room — it has to finish
                    processing before it can be shared.
                  </p>
                </div>
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
            </section>

            <section className="space-y-3">
              <SectionLabel icon={Shield}>Protection</SectionLabel>
              <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-surface/40">
                <ToggleRow
                  icon={Download}
                  title="Allow download"
                  hint="Reviewers get a watermarked PDF copy"
                  checked={allowDownload}
                  onCheckedChange={setAllowDownload}
                />
                <ToggleRow
                  icon={Droplets}
                  title="Watermark pages"
                  hint="Stamps every page with the reviewer's identity"
                  checked={watermarkEnabled}
                  onCheckedChange={setWatermarkEnabled}
                />
                <ToggleRow
                  icon={Printer}
                  title="Allow printing"
                  hint="Off means the viewer blanks when a print starts"
                  checked={allowPrint}
                  onCheckedChange={setAllowPrint}
                />
                <ToggleRow
                  icon={ScanEye}
                  title="Capture deterrence"
                  hint="Blanks the page on PrintScreen or tab-out, and blocks copy"
                  checked={screenshotGuard}
                  onCheckedChange={setScreenshotGuard}
                />
                <div>
                  <ToggleRow
                    icon={ScrollText}
                    title="Require NDA"
                    hint="Reviewer must accept before any document opens"
                    checked={requireNda}
                    onCheckedChange={setRequireNda}
                  />
                  {requireNda && (
                    <div className="border-t border-border/60 bg-background/40 p-3">
                      <Textarea
                        autoFocus
                        placeholder="Paste the NDA text reviewers must accept…"
                        value={ndaText}
                        onChange={(e) => setNdaText(e.target.value)}
                        rows={4}
                        className="resize-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <SectionLabel icon={KeyRound}>Access gate</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reviewer-password">
                    Password <span className="font-normal text-muted-foreground">optional</span>
                  </Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="reviewer-password"
                      type="text"
                      placeholder="Second factor"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Send it through a different channel than the link.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reviewer-domains">
                    Email domains <span className="font-normal text-muted-foreground">optional</span>
                  </Label>
                  <div className="relative">
                    <AtSign className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="reviewer-domains"
                      placeholder="acme.com, fund.vc"
                      value={allowedDomains}
                      onChange={(e) => setAllowedDomains(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The invitation is rejected unless the email matches one of these.
                  </p>
                </div>
              </div>
            </section>
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

function SectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

/**
 * A full-width settings row that is itself the switch: the whole row is the hit
 * target and carries the `role="switch"` semantics, so the visual toggle stays
 * decorative rather than adding a second tab stop per option.
 */
function ToggleRow({
  icon: Icon,
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
          checked
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border/70 bg-background/60 text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-tight">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span>
      </span>
      <SwitchIndicator checked={checked} />
    </button>
  );
}
