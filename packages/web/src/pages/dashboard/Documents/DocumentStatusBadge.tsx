import { CheckCircle2, Loader2, TriangleAlert, UploadCloud } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import { STATUS_LABELS, type ProcessingStatus } from "./document-types";

const STYLES: Record<ProcessingStatus, string> = {
  ready: "border-transparent bg-success/15 text-success",
  processing: "border-transparent bg-primary/15 text-primary",
  pending_upload: "border-transparent bg-muted text-muted-foreground",
  failed: "border-transparent bg-destructive/15 text-destructive",
};

const ICONS: Record<ProcessingStatus, typeof CheckCircle2> = {
  ready: CheckCircle2,
  processing: Loader2,
  pending_upload: UploadCloud,
  failed: TriangleAlert,
};

export function DocumentStatusBadge({ status }: { status: ProcessingStatus }) {
  const Icon = ICONS[status];
  return (
    <Badge className={cn("gap-1 font-medium", STYLES[status])}>
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} />
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
