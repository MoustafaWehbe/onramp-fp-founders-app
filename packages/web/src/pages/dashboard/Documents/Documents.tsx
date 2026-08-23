import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog";
import { EmptyState } from "../../../components/shared/EmptyState";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePermissions } from "../../../hooks/usePermissions";
import { useActiveStartupId } from "../../../hooks/useWorkspace";
import { apiErrorMessage } from "../../../lib/api-error";
import { runWithConcurrency } from "../../../lib/concurrency";
import {
  confirmDocumentVersion,
  createDocumentUploadSession,
  createVersionUploadSession,
  deleteDocument,
  getDocumentFileAccess,
  listDocuments,
  updateDocument,
  uploadToSignedUrl,
  type DocumentType,
  type DocumentVersion,
  type VaultDocument,
} from "../../../lib/document-api";
import { DocumentAnalyticsSheet } from "./DocumentAnalyticsSheet";
import { DocumentFormDialog, type DocumentFormValues } from "./DocumentFormDialog";
import { DocumentVersionsSheet } from "./DocumentVersionsSheet";
import { DocumentsCardList } from "./DocumentsCardList";
import { DocumentsTable } from "./DocumentsTable";
import { DocumentsToolbar, type DocumentFilters } from "./DocumentsToolbar";
import { UNSUPPORTED_TYPE_MESSAGE, UPLOAD_ACCEPT, guessMimeType, statusOf } from "./document-types";

export function Documents() {
  const startupId = useActiveStartupId();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [versionTargetId, setVersionTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<DocumentFilters>({ documentType: null, status: null });
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editingDoc, setEditingDoc] = useState<VaultDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultDocument | null>(null);
  const [versionsSheetDocId, setVersionsSheetDocId] = useState<string | null>(null);
  const [analyticsSheetDocId, setAnalyticsSheetDocId] = useState<string | null>(null);
  const [focusedDocumentId, setFocusedDocumentId] = useState<string | null>(null);

  // Header search deep-link: open that exact document's versions panel.
  const deepLinkDocumentId = searchParams.get("document");
  useEffect(() => {
    if (!deepLinkDocumentId) return;
    const id = deepLinkDocumentId;
    setFocusedDocumentId(id);
    // Force a clean open even if the sheet was already showing another doc.
    setVersionsSheetDocId(null);
    const timer = window.setTimeout(() => setVersionsSheetDocId(id), 0);
    setSearchParams(
      (prev) => {
        if (!prev.has("document")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("document");
        next.delete("preview");
        return next;
      },
      { replace: true },
    );
    return () => window.clearTimeout(timer);
  }, [deepLinkDocumentId, setSearchParams]);

  const queryKey = ["documents", startupId, search, filters.documentType];

  const docsQuery = useQuery({
    queryKey,
    queryFn: () =>
      listDocuments(startupId, {
        page: 1,
        limit: 100,
        search: search.trim() || undefined,
        documentType: filters.documentType || undefined,
      }),
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const busy = rows.some((row) => {
        const status = row.currentVersion?.processingStatus;
        return status === "processing" || status === "pending_upload";
      });
      return busy ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!focusedDocumentId) return;
    const node = window.document.querySelector(`[data-document-id="${focusedDocumentId}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFocusedDocumentId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusedDocumentId, docsQuery.data?.data]);

  const allRows = docsQuery.data?.data ?? [];
  // Status has no server-side filter (the API only filters by type/search), so
  // it narrows whatever page is already loaded.
  const rows = filters.status
    ? allRows.filter((row) => statusOf(row.currentVersion) === filters.status)
    : allRows;

  const canUpload = can("documents", "create");
  const canUpdate = can("documents", "update");
  const canDelete = can("documents", "delete");
  const canReadAiAnalyses = can("ai_reports", "read");
  const canCreateAiAnalysis = can("ai_reports", "create") && can("documents", "read");

  const analyticsDocument = allRows.find((row) => row.id === analyticsSheetDocId) ?? null;

  function invalidateDocuments() {
    void queryClient.invalidateQueries({ queryKey: ["documents", startupId] });
  }

  const uploadMutation = useMutation({
    mutationFn: async ({ file, values }: { file: File; values: DocumentFormValues }) => {
      const mimeType = guessMimeType(file);
      if (mimeType === "application/octet-stream") {
        throw new Error(UNSUPPORTED_TYPE_MESSAGE);
      }
      const session = await createDocumentUploadSession(startupId, {
        title: values.title,
        documentType: values.documentType,
        originalFilename: file.name,
        mimeType,
        fileSize: file.size,
        summary: values.summary,
      });
      try {
        await uploadToSignedUrl(session.upload.uploadUrl, file, session.upload.headers);
        await confirmDocumentVersion(startupId, session.document.id, session.upload.versionId);
      } catch (error) {
        // The document row was already created for this upload session. If the
        // bytes never made it to storage or confirm failed, remove it rather than
        // leaving a phantom "Uploading…" card that can never finish.
        await deleteDocument(startupId, session.document.id).catch(() => {});
        throw error;
      }
      return session.document;
    },
    onSuccess: () => {
      setPendingFile(null);
      invalidateDocuments();
      toast.success("Document uploaded — processing started");
    },
    onError: (error) => {
      invalidateDocuments();
      toast.error(apiErrorMessage(error, "Upload failed"));
    },
  });

  const versionMutation = useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }) => {
      const mimeType = guessMimeType(file);
      if (mimeType === "application/octet-stream") {
        throw new Error(UNSUPPORTED_TYPE_MESSAGE);
      }
      const session = await createVersionUploadSession(startupId, documentId, {
        originalFilename: file.name,
        mimeType,
        fileSize: file.size,
      });
      await uploadToSignedUrl(session.upload.uploadUrl, file, session.upload.headers);
      await confirmDocumentVersion(startupId, documentId, session.upload.versionId);
    },
    onSuccess: () => {
      setVersionTargetId(null);
      invalidateDocuments();
      toast.success("New version uploaded — processing started");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Version upload failed")),
  });

  const updateMutation = useMutation({
    mutationFn: (values: DocumentFormValues) => {
      if (!editingDoc) throw new Error("No document selected");
      return updateDocument(startupId, editingDoc.id, {
        title: values.title,
        documentType: values.documentType,
      });
    },
    onSuccess: () => {
      setEditingDoc(null);
      invalidateDocuments();
      toast.success("Document updated");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not update document")),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => deleteDocument(startupId, documentId),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateDocuments();
      toast.success("Document deleted");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Could not delete document")),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const settled = await runWithConcurrency(ids, 5, (id) => deleteDocument(startupId, id));
      const failedIds = ids.filter((_, index) => settled[index].status === "rejected");
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )?.reason;
      return { succeeded: ids.length - failedIds.length, failedIds, firstFailure };
    },
    onSuccess: ({ succeeded, failedIds, firstFailure }) => {
      setBulkDeleteConfirm(false);
      setSelectedIds(new Set(failedIds));
      invalidateDocuments();
      if (failedIds.length === 0) {
        toast.success(`${succeeded} document${succeeded === 1 ? "" : "s"} deleted`);
      } else {
        toast.error(
          `${succeeded} deleted, ${failedIds.length} could not be removed — ${apiErrorMessage(firstFailure, "some have related records")}`,
        );
      }
    },
  });

  const openFileAccess = async (
    documentId: string,
    versionId: string | undefined,
    disposition: "preview" | "download",
    fallbackName: string,
  ) => {
    const previewTab = disposition === "preview" ? window.open("about:blank", "_blank") : null;

    try {
      const access = await getDocumentFileAccess(startupId, documentId, versionId, disposition);
      const fileRes = await fetch(access.url);
      if (!fileRes.ok) throw new Error(`Could not fetch file (${fileRes.status})`);
      const blob = await fileRes.blob();
      const typed = new Blob([blob], {
        type: access.mimeType || blob.type || "application/octet-stream",
      });
      const objectUrl = URL.createObjectURL(typed);

      if (disposition === "download") {
        const a = window.document.createElement("a");
        a.href = objectUrl;
        a.download = access.originalFilename || fallbackName;
        window.document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      } else if (previewTab) {
        previewTab.location.href = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (error) {
      previewTab?.close();
      toast.error(apiErrorMessage(error, "Could not open file"));
    }
  };

  const openDocument = (doc: VaultDocument, disposition: "preview" | "download") =>
    void openFileAccess(doc.id, doc.currentVersion?.id, disposition, `${doc.title}.bin`);
  const openVersion = (version: DocumentVersion, disposition: "preview" | "download") =>
    void openFileAccess(version.documentId, version.id, disposition, version.originalFilename);

  const selectionActive = selectedIds !== null;
  const selectedCount = selectedIds?.size ?? 0;

  function toggleSelection() {
    setSelectedIds((current) => (current === null ? new Set() : null));
  }

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data room"
        description="Versioned documents, indexed for AI search and reviewer access."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) setPendingFile(file);
              }}
            />
            <input
              ref={versionInputRef}
              type="file"
              className="hidden"
              accept={UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                const documentId = versionTargetId;
                event.target.value = "";
                if (file && documentId) versionMutation.mutate({ documentId, file });
              }}
            />
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary-hover"
              disabled={!canUpload}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              Upload
            </Button>
          </>
        }
      />

      <DocumentsToolbar
        query={search}
        onQueryChange={setSearch}
        filters={filters}
        onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClearFilters={() => setFilters({ documentType: null, status: null })}
        canSelect={canDelete}
        selectionActive={selectionActive}
        onToggleSelection={toggleSelection}
        onSelectAllVisible={() => setSelectedIds(new Set(rows.map((r) => r.id)))}
        visibleCount={rows.length}
        selectedCount={selectedCount}
        onBulkDelete={() => setBulkDeleteConfirm(true)}
        bulkDeleting={bulkDeleteMutation.isPending}
      />

      {docsQuery.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : docsQuery.isError ? (
        <div className="card-elevated">
          <EmptyState
            icon={FileText}
            title="Could not load documents"
            description={apiErrorMessage(docsQuery.error, "Please try again.")}
            action={<Button onClick={() => void docsQuery.refetch()}>Retry</Button>}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="card-elevated">
          <EmptyState
            icon={FileText}
            title={allRows.length === 0 ? "No documents yet" : "No documents match your filters"}
            description={
              allRows.length === 0
                ? "Upload a PDF, DOCX, XLSX, PPTX, or TXT file to start your data room."
                : "Try a different search term or clear the active filters."
            }
            action={
              allRows.length === 0 && canUpload ? (
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> Upload
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className={docsQuery.isFetching ? "hidden opacity-60 lg:block" : "hidden lg:block"}>
            <div className="card-elevated overflow-hidden p-0">
              <DocumentsTable
                documents={rows}
                selectedIds={selectedIds}
                focusedDocumentId={focusedDocumentId}
                onToggleOne={toggleOne}
                canUpdate={canUpdate}
                canDelete={canDelete}
                uploadingVersionId={versionMutation.isPending ? versionTargetId : null}
                onPreview={(doc) => openDocument(doc, "preview")}
                onDownload={(doc) => openDocument(doc, "download")}
                onUploadVersion={(doc) => {
                  setVersionTargetId(doc.id);
                  versionInputRef.current?.click();
                }}
                onEdit={setEditingDoc}
                onViewVersions={(doc) => setVersionsSheetDocId(doc.id)}
                onViewAnalytics={(doc) => setAnalyticsSheetDocId(doc.id)}
                onDelete={setDeleteTarget}
              />
            </div>
          </div>
          <div className={docsQuery.isFetching ? "opacity-60 lg:hidden" : "lg:hidden"}>
            <DocumentsCardList
              documents={rows}
              selectedIds={selectedIds}
              focusedDocumentId={focusedDocumentId}
              onToggleOne={toggleOne}
              canUpdate={canUpdate}
              canDelete={canDelete}
              uploadingVersionId={versionMutation.isPending ? versionTargetId : null}
              onPreview={(doc) => openDocument(doc, "preview")}
              onDownload={(doc) => openDocument(doc, "download")}
              onUploadVersion={(doc) => {
                setVersionTargetId(doc.id);
                versionInputRef.current?.click();
              }}
              onEdit={setEditingDoc}
              onViewVersions={(doc) => setVersionsSheetDocId(doc.id)}
              onViewAnalytics={(doc) => setAnalyticsSheetDocId(doc.id)}
              onDelete={setDeleteTarget}
            />
          </div>
        </>
      )}

      {pendingFile && (
        <DocumentFormDialog
          open
          mode="create"
          file={pendingFile}
          isSubmitting={uploadMutation.isPending}
          onOpenChange={(next) => !next && setPendingFile(null)}
          onSubmit={(values) => uploadMutation.mutate({ file: pendingFile, values })}
        />
      )}

      {editingDoc && (
        <DocumentFormDialog
          open
          mode="edit"
          initial={{ title: editingDoc.title, documentType: editingDoc.documentType as DocumentType }}
          isSubmitting={updateMutation.isPending}
          onOpenChange={(next) => !next && setEditingDoc(null)}
          onSubmit={(values) => updateMutation.mutate(values)}
        />
      )}

      <DocumentVersionsSheet
        startupId={startupId}
        documentId={versionsSheetDocId}
        onOpenChange={(next) => !next && setVersionsSheetDocId(null)}
        onPreview={(version) => openVersion(version, "preview")}
        onDownload={(version) => openVersion(version, "download")}
      />

      <DocumentAnalyticsSheet
        startupId={startupId}
        documentId={analyticsSheetDocId}
        documentVersionId={analyticsDocument?.currentVersion?.id ?? null}
        canReadAiAnalyses={canReadAiAnalyses}
        canCreateAiAnalysis={canCreateAiAnalysis}
        onOpenChange={(next) => !next && setAnalyticsSheetDocId(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title="Delete document?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” and all of its versions will be permanently removed. This can't be undone.`
            : ""
        }
        confirmLabel="Delete document"
        pendingLabel="Deleting…"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title={`Delete ${selectedCount} document${selectedCount === 1 ? "" : "s"}?`}
        description="Every version of each selected document will be permanently removed. This can't be undone."
        confirmLabel="Delete selected"
        pendingLabel="Deleting…"
        isPending={bulkDeleteMutation.isPending}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds ?? []))}
      />
    </div>
  );
}
