import { Archive, ArchiveRestore, BarChart3, Download, Eye, History, MoreHorizontal, Pencil, Upload } from "lucide-react";
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
  canArchive: boolean;
  uploadingVersion: boolean;
  onPreview: (doc: VaultDocument) => void;
  onDownload: (doc: VaultDocument) => void;
  onUploadVersion: (doc: VaultDocument) => void;
  onEdit: (doc: VaultDocument) => void;
  onViewVersions: (doc: VaultDocument) => void;
  onViewAnalytics: (doc: VaultDocument) => void;
  onArchive: (doc: VaultDocument) => void;
  onRestore: (doc: VaultDocument) => void;
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
  canArchive,
  uploadingVersion,
  onPreview,
  onDownload,
  onUploadVersion,
  onEdit,
  onViewVersions,
  onViewAnalytics,
  onArchive,
  onRestore,
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
        <DropdownMenuItem onSelect={() => onViewAnalytics(document)}>
          <BarChart3 className="mr-2 h-4 w-4" /> Analytics
        </DropdownMenuItem>

        {canUpdate && !document.archivedAt && (
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

        {canArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => (document.archivedAt ? onRestore(document) : onArchive(document))}
            >
              {document.archivedAt ? (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {document.archivedAt ? "Restore document" : "Archive document"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
