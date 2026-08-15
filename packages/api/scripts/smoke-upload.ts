import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";

const API = process.env.API_URL ?? "http://localhost:3000/api/v1";
const STARTUP_ID = "00000002-0000-0000-0000-000000000001";

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "muhamad.houda@gmail.com", password: "Founder1234!" }),
  });
  const setCookie = login.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!login.ok) throw new Error(`login failed ${login.status}`);

  const filePath = path.resolve("scripts/sample-upload.txt");
  const buffer = readFileSync(filePath);
  const originalFilename = "sample-upload.txt";
  const mimeType = "text/plain";

  const sessionRes = await fetch(`${API}/startups/${STARTUP_ID}/documents/upload-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "Pipeline smoke-test upload",
      documentType: "other",
      originalFilename,
      mimeType,
      fileSize: buffer.length,
    }),
  });
  const sessionBody = await sessionRes.json();
  console.log("upload-session", sessionRes.status, sessionBody?.data?.document?.id);
  if (!sessionRes.ok) throw new Error(JSON.stringify(sessionBody));

  const uploadUrl = sessionBody.data.upload.uploadUrl as string;
  const absoluteUpload = uploadUrl.startsWith("http") ? uploadUrl : `http://localhost:3000${uploadUrl}`;
  const put = await fetch(absoluteUpload, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: buffer,
  });
  console.log("put", put.status);

  const documentId = sessionBody.data.document.id as string;
  const versionId = sessionBody.data.upload.versionId as string;
  const confirmRes = await fetch(
    `${API}/startups/${STARTUP_ID}/documents/${documentId}/versions/${versionId}/confirm`,
    { method: "POST", headers: { Cookie: cookie } },
  );
  const confirmBody = await confirmRes.json();
  console.log("confirm", confirmRes.status, confirmBody?.data?.processingStatus);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const list = await fetch(`${API}/startups/${STARTUP_ID}/documents?limit=20`, {
      headers: { Cookie: cookie },
    });
    const body = await list.json();
    const row = body.data?.find((d: { id: string }) => d.id === documentId);
    const status = row?.currentVersion?.processingStatus;
    console.log(`poll ${i + 1}`, status);
    if (status === "ready" || status === "failed") {
      const accessRes = await fetch(
        `${API}/startups/${STARTUP_ID}/documents/${documentId}/file-access`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      const access = await accessRes.json();
      const url = access.data.url as string;
      const absolute = url.startsWith("http") ? url : `http://localhost:3000${url}`;
      const fileRes = await fetch(absolute);
      const text = await fileRes.text();
      console.log("preview-fetch", fileRes.status, fileRes.headers.get("content-type"), text.slice(0, 80));
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
