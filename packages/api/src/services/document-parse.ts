import { createError } from "../utils/errors";

/**
 * Extract structured markdown from an uploaded vault file.
 * Prefer LlamaParse when LLAMA_CLOUD_API_KEY is set; TXT falls back to utf8;
 * other types without LlamaParse fail clearly so the UI can show processing failed.
 */
export async function extractDocumentMarkdown(input: {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}): Promise<string> {
  if (input.mimeType === "text/plain") {
    return input.buffer.toString("utf8");
  }

  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw createError(
      "LLAMA_CLOUD_API_KEY is not configured — cannot parse PDF/DOCX/XLSX in this environment",
      503,
      "PARSE_UNAVAILABLE",
    );
  }

  const form = new FormData();
  const blob = new Blob([input.buffer], { type: input.mimeType });
  form.append("file", blob, input.originalFilename);
  form.append("result_type", "markdown");

  const uploadRes = await fetch("https://api.cloud.llamaindex.ai/api/v1/parsing/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw createError(`LlamaParse upload failed: ${text}`, 502, "PARSE_FAILED");
  }

  const uploaded = (await uploadRes.json()) as { id?: string };
  if (!uploaded.id) throw createError("LlamaParse did not return a job id", 502, "PARSE_FAILED");

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const statusRes = await fetch(
      `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${uploaded.id}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as { status?: string };
    if (status.status === "SUCCESS") break;
    if (status.status === "ERROR" || status.status === "FAILED") {
      throw createError("LlamaParse failed to parse this file", 422, "PARSE_FAILED");
    }
    if (attempt === 39) throw createError("LlamaParse timed out", 504, "PARSE_TIMEOUT");
  }

  const resultRes = await fetch(
    `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${uploaded.id}/result/markdown`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!resultRes.ok) {
    throw createError("Could not fetch LlamaParse markdown result", 502, "PARSE_FAILED");
  }
  const result = (await resultRes.json()) as { markdown?: string };
  if (!result.markdown?.trim()) {
    throw createError("LlamaParse returned empty markdown", 422, "PARSE_FAILED");
  }
  return result.markdown;
}
