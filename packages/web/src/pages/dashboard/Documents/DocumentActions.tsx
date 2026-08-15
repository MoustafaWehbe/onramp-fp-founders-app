import { Download, Eye, History, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { VaultDocument } from "../../../lib/document-api";

type DocumentActionsProps = {
  document: VaultDocument;
  canOpen: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  uploadingVersion: boolean;
  onPreview: (doc: VaultDocument) => void;
  onDownload: (doc: VaultDocument) => void;
  onUploadVersion: (doc: VaultDocument) => void;
  onEdit: (doc: VaultDocument) => void;
  onViewVersions: (doc: VaultDocument) => void;
  onDelete: (doc: VaultDocument) => void;
  /**
   * Table rows have no other affordance for these, so the menu is the only
   * way to reach them. Cards already show Preview/Download/Upload-version as
   * buttons omit those items here so the same action isn't offered twice.
   */
  includeQuickActions?: boolean;
};

export function DocumentActions({
  document,
  canOpen,
  canUpdate,
  canDelete,
  uploadingVersion,
  onPreview,
  onDownload,
  onUploadVersion,
  onEdit,
  onViewVersions,
  onDelete,
  includeQuickActions = true,
}: DocumentActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${document.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {includeQuickActions && (
          <>
            <DropdownMenuItem disabled={!canOpen} onSelect={() => onPreview(document)}>
              <Eye className="mr-2 h-4 w-4" /> Preview
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canOpen} onSelect={() => onDownload(document)}>
              <Download className="mr-2 h-4 w-4" /> Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onSelect={() => onViewVersions(document)}>
          <History className="mr-2 h-4 w-4" /> Version history
        </DropdownMenuItem>

        {canUpdate && (
          <>
            <DropdownMenuItem onSelect={() => onEdit(document)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit details
            </DropdownMenuItem>
            {includeQuickActions && (
              <DropdownMenuItem
                disabled={uploadingVersion || document.currentVersion?.processingStatus === "pending_upload"}
                onSelect={() => onUploadVersion(document)}
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploadingVersion ? "Uploading…" : "Upload new version"}
              </DropdownMenuItem>
            )}
          </>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(document)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete document
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
