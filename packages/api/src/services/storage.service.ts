import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getRedis } from "../db/redis";
import { createError } from "../utils/errors";

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
] as const;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

type SignedUpload = {
  provider: "supabase" | "local";
  uploadUrl: string;
  storageKey: string;
  headers?: Record<string, string>;
  /** Local adapter only — token used by PUT /documents/local-upload/:token */
  localToken?: string;
};

type ObjectMeta = {
  size: number;
  contentType: string | null;
};

function assertAcceptedMime(mimeType: string): asserts mimeType is AcceptedMimeType {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw createError(
      "Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT",
      400,
      "UNSUPPORTED_MIME",
    );
  }
}

function assertSize(fileSize: number) {
  if (fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
    throw createError(
      `File size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`,
      400,
      "FILE_TOO_LARGE",
    );
  }
}

function buildStorageKey(startupId: string, documentId: string, versionId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `startups/${startupId}/documents/${documentId}/${versionId}/${safe}`;
}

function localRoot() {
  return path.resolve(process.cwd(), ".uploads");
}

function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET);
}

function getSupabase(): { client: SupabaseClient; bucket: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!url || !key || !bucket) {
    throw createError("Supabase Storage is not configured", 500, "STORAGE_NOT_CONFIGURED");
  }
  return { client: createClient(url, key), bucket };
}

export class StorageService {
  assertUploadConstraints(mimeType: string, fileSize: number) {
    assertAcceptedMime(mimeType);
    assertSize(fileSize);
  }

  buildKey(startupId: string, documentId: string, versionId: string, filename: string) {
    return buildStorageKey(startupId, documentId, versionId, filename);
  }

  async createSignedUpload(input: {
    startupId: string;
    documentId: string;
    versionId: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
  }): Promise<SignedUpload> {
    this.assertUploadConstraints(input.mimeType, input.fileSize);
    const storageKey = this.buildKey(
      input.startupId,
      input.documentId,
      input.versionId,
      input.originalFilename,
    );

    if (supabaseConfigured()) {
      const { client, bucket } = getSupabase();
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(storageKey);
      if (error || !data?.signedUrl) {
        throw createError(error?.message ?? "Could not create signed upload URL", 502, "STORAGE_ERROR");
      }
      return {
        provider: "supabase",
        uploadUrl: data.signedUrl,
        storageKey,
        headers: { "Content-Type": input.mimeType },
      };
    }

    // Local/dev adapter: short-lived Redis token → PUT to our API.
    const token = randomBytes(24).toString("base64url");
    const redis = getRedis();
    await redis.set(
      `doc-upload:${token}`,
      JSON.stringify({
        storageKey,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        startupId: input.startupId,
        documentId: input.documentId,
        versionId: input.versionId,
      }),
      "EX",
      15 * 60,
    );

    // Relative URL so the browser hits the Vite `/api` proxy in local dev.
    return {
      provider: "local",
      uploadUrl: `/api/v1/documents/local-upload/${token}`,
      storageKey,
      headers: { "Content-Type": input.mimeType },
      localToken: token,
    };
  }

  async putLocalUpload(token: string, body: Buffer, contentType: string | undefined) {
    const redis = getRedis();
    const raw = await redis.get(`doc-upload:${token}`);
    if (!raw) throw createError("Upload token expired or invalid", 410, "UPLOAD_TOKEN_INVALID");
    const meta = JSON.parse(raw) as {
      storageKey: string;
      mimeType: string;
      fileSize: number;
    };
    if (body.length > MAX_UPLOAD_BYTES) {
      throw createError("Uploaded file exceeds size limit", 400, "FILE_TOO_LARGE");
    }
    const incomingMime = contentType?.split(";")[0]?.trim();
    if (incomingMime && incomingMime !== meta.mimeType) {
      throw createError("Content-Type does not match the upload session", 400, "MIME_MISMATCH");
    }

    const fullPath = path.join(localRoot(), meta.storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body);
    await redis.del(`doc-upload:${token}`);
    return meta;
  }

  async getObjectMeta(storageKey: string, provider: string): Promise<ObjectMeta> {
    if (provider === "supabase" || (provider === "local" && supabaseConfigured() && provider !== "local")) {
      // fall through
    }

    if (provider === "supabase" && supabaseConfigured()) {
      const { client, bucket } = getSupabase();
      const { data, error } = await client.storage.from(bucket).list(path.posix.dirname(storageKey), {
        search: path.posix.basename(storageKey),
        limit: 1,
      });
      if (error) throw createError(error.message, 502, "STORAGE_ERROR");
      const file = data?.[0];
      if (!file) throw createError("Uploaded object not found in storage", 404, "OBJECT_NOT_FOUND");
      return {
        size: Number(file.metadata?.size ?? file.metadata?.contentLength ?? 0),
        contentType: (file.metadata?.mimetype as string | undefined) ?? null,
      };
    }

    const fullPath = path.join(localRoot(), storageKey);
    try {
      const stat = await fs.stat(fullPath);
      return { size: stat.size, contentType: null };
    } catch {
      throw createError("Uploaded object not found in storage", 404, "OBJECT_NOT_FOUND");
    }
  }

  async createSignedReadUrl(
    storageKey: string,
    provider: string,
    expiresInSeconds = 300,
    meta?: { mimeType?: string; originalFilename?: string },
  ) {
    if (provider === "supabase" && supabaseConfigured()) {
      const { client, bucket } = getSupabase();
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(storageKey, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw createError(error?.message ?? "Could not create signed read URL", 502, "STORAGE_ERROR");
      }
      return data.signedUrl;
    }

    // Local: short-lived download token
    const token = randomBytes(24).toString("base64url");
    await getRedis().set(
      `doc-read:${token}`,
      JSON.stringify({
        storageKey,
        mimeType: meta?.mimeType ?? "application/octet-stream",
        originalFilename: meta?.originalFilename ?? path.posix.basename(storageKey),
      }),
      "EX",
      expiresInSeconds,
    );
    return `/api/v1/documents/local-download/${token}`;
  }

  async readObject(storageKey: string, provider: string): Promise<Buffer> {
    if (provider === "supabase" && supabaseConfigured()) {
      const { client, bucket } = getSupabase();
      const { data, error } = await client.storage.from(bucket).download(storageKey);
      if (error || !data) throw createError(error?.message ?? "Download failed", 502, "STORAGE_ERROR");
      return Buffer.from(await data.arrayBuffer());
    }
    return fs.readFile(path.join(localRoot(), storageKey));
  }

  async resolveLocalDownload(token: string): Promise<{
    fullPath: string;
    mimeType: string;
    originalFilename: string;
  }> {
    const raw = await getRedis().get(`doc-read:${token}`);
    if (!raw) throw createError("Download token expired or invalid", 410, "DOWNLOAD_TOKEN_INVALID");
    const parsed = JSON.parse(raw) as {
      storageKey: string;
      mimeType?: string;
      originalFilename?: string;
    };
    return {
      fullPath: path.join(localRoot(), parsed.storageKey),
      mimeType: parsed.mimeType ?? "application/octet-stream",
      originalFilename: parsed.originalFilename ?? path.basename(parsed.storageKey),
    };
  }

  checksum(buffer: Buffer) {
    return createHash("sha256").update(buffer).digest("hex");
  }
}

export const storageService = new StorageService();
