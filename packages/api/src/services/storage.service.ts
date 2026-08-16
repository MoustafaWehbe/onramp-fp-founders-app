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
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

// WebP first; PNG is kept only because Safari's canvas.toBlob("image/webp")
// silently falls back to PNG on versions that cannot encode WebP the
// browser never errors, it just hands back a different mime type. JPEG is
// deliberately not accepted: nothing on the client ever produces it anymore.
export const ACCEPTED_AVATAR_MIME_TYPES = ["image/webp", "image/png"] as const;

// The client resizes to 512px and targets well under this before upload;
// this is a hard backstop, not the normal case.
export const MAX_AVATAR_UPLOAD_BYTES = 600 * 1024;

export type AcceptedAvatarMimeType = (typeof ACCEPTED_AVATAR_MIME_TYPES)[number];

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
      "Unsupported file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT",
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

function assertAcceptedAvatarMime(mimeType: string): asserts mimeType is AcceptedAvatarMimeType {
  if (!(ACCEPTED_AVATAR_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw createError("Unsupported image type. Allowed: WebP, PNG", 400, "UNSUPPORTED_MIME");
  }
}

function assertAvatarSize(fileSize: number) {
  if (fileSize <= 0 || fileSize > MAX_AVATAR_UPLOAD_BYTES) {
    throw createError(
      `Image must be between 1 byte and ${MAX_AVATAR_UPLOAD_BYTES} bytes`,
      400,
      "FILE_TOO_LARGE",
    );
  }
}

function buildStorageKey(startupId: string, documentId: string, versionId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `startups/${startupId}/documents/${documentId}/${versionId}/${safe}`;
}

// Random suffix rather than a fixed per-user path: replacing a photo must mint
// a new URL so browsers/CDNs never keep serving a stale cached image, and the
// old object simply becomes unreferenced (deleteAvatar cleans it up).
function buildAvatarKey(userId: string, mimeType: AcceptedAvatarMimeType) {
  const ext = mimeType === "image/png" ? "png" : "webp";
  return `avatars/${userId}/${randomBytes(8).toString("hex")}.${ext}`;
}

/** True only for keys this module actually generates — guards path traversal
 * before any of it touches the filesystem or an object-storage call. */
function isValidAvatarKey(storageKey: string): boolean {
  return /^avatars\/[a-zA-Z0-9-]+\/[a-f0-9]{16}\.(webp|png)$/.test(storageKey);
}

function isValidDocumentKey(storageKey: string): boolean {
  return /^startups\/[a-zA-Z0-9-]+\/documents\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(
    storageKey,
  );
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

function avatarsBucketConfigured() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_AVATARS_BUCKET,
  );
}

function getSupabaseAvatars(): { client: SupabaseClient; bucket: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_AVATARS_BUCKET;
  if (!url || !key || !bucket) {
    throw createError("Avatar storage is not configured", 500, "STORAGE_NOT_CONFIGURED");
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

  /**
   * Profile photos are small, non-sensitive, and read constantly (every chat
   * message, every member list) so unlike documents they are uploaded
   * server-mediated in one request and served from a public bucket/route
   * rather than through short-lived signed URLs a founder's avatar does not
   * need per-request signing, and re-signing it on every message would be
   * pure overhead.
   */
  async uploadAvatar(
    userId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ storageKey: string; url: string }> {
    assertAcceptedAvatarMime(mimeType);
    assertAvatarSize(buffer.length);
    const storageKey = buildAvatarKey(userId, mimeType);

    if (avatarsBucketConfigured()) {
      const { client, bucket } = getSupabaseAvatars();
      const { error } = await client.storage.from(bucket).upload(storageKey, buffer, {
        contentType: mimeType,
        // Content-addressed by a random suffix, so a year-long cache is safe:
        // a changed photo is always a new key, never a mutated one.
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw createError(error.message, 502, "STORAGE_ERROR");
      const { data } = client.storage.from(bucket).getPublicUrl(storageKey);
      return { storageKey, url: data.publicUrl };
    }

    const fullPath = path.join(localRoot(), storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return { storageKey, url: this.resolveAvatarUrl(storageKey, null)! };
  }

  /** Best-effort: a leftover object left behind in storage is a storage cost, not a correctness bug. */
  async deleteAvatar(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey || !isValidAvatarKey(storageKey)) return;
    try {
      if (avatarsBucketConfigured()) {
        const { client, bucket } = getSupabaseAvatars();
        await client.storage.from(bucket).remove([storageKey]);
      } else {
        await fs.unlink(path.join(localRoot(), storageKey));
      }
    } catch {
      // Nothing to recover from here: the object may already be gone.
    }
  }

  /**
   * Best-effort cleanup for one or more document version objects, e.g. when
   * a document is deleted. A leftover object left behind in storage is a
   * storage cost, not a correctness bug, so failures are swallowed same
   * contract as deleteAvatar.
   */
  async deleteObjects(objects: { storageKey: string; storageProvider: string }[]): Promise<void> {
    const supabaseKeys = objects
      .filter((o) => o.storageProvider === "supabase" && isValidDocumentKey(o.storageKey))
      .map((o) => o.storageKey);
    const localKeys = objects
      .filter((o) => o.storageProvider !== "supabase" && isValidDocumentKey(o.storageKey))
      .map((o) => o.storageKey);

    if (supabaseKeys.length > 0 && supabaseConfigured()) {
      try {
        const { client, bucket } = getSupabase();
        await client.storage.from(bucket).remove(supabaseKeys);
      } catch {
        // Nothing to recover from here: the object(s) may already be gone.
      }
    }

    await Promise.all(
      localKeys.map(async (storageKey) => {
        try {
          await fs.unlink(path.join(localRoot(), storageKey));
        } catch {
          // Nothing to recover from here: the object may already be gone.
        }
      }),
    );
  }

  /**
   * Resolves what any consumer should render as the user's avatar.
   * storageKey (a self-uploaded photo) always wins over fallbackUrl (an
   * external URL such as Google's picture claim), matching the write-side
   * rule in user.service.ts and auth.service.ts.
   */
  resolveAvatarUrl(storageKey: string | null | undefined, fallbackUrl: string | null): string | null {
    if (storageKey && isValidAvatarKey(storageKey)) {
      if (avatarsBucketConfigured()) {
        const { client, bucket } = getSupabaseAvatars();
        return client.storage.from(bucket).getPublicUrl(storageKey).data.publicUrl;
      }
      return `/api/v1/avatar-files/${storageKey.slice("avatars/".length)}`;
    }
    return fallbackUrl;
  }

  /** Local/dev counterpart to resolveAvatarUrl's local branch — validates the
   * key shape itself rather than trusting the two route params it's built from. */
  resolveLocalAvatarFile(userId: string, filename: string): { fullPath: string; contentType: string } {
    const storageKey = `avatars/${userId}/${filename}`;
    if (!isValidAvatarKey(storageKey)) {
      throw createError("Avatar not found", 404, "OBJECT_NOT_FOUND");
    }
    return {
      fullPath: path.join(localRoot(), storageKey),
      contentType: filename.endsWith(".png") ? "image/png" : "image/webp",
    };
  }
}

export const storageService = new StorageService();
