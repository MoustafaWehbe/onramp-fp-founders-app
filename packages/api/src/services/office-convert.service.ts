import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

/**
 * Converts DOCX/PPTX to PDF by shelling out to LibreOffice headless, so the
 * existing pdfjs-dist rasterizer (pdf-rasterize.ts) never has to know a page
 * came from anything but a PDF. Only runs inside the worker image built from
 * `Dockerfile.worker`, which is the one place `soffice` is installed — see
 * that file for why this isn't bundled into the plain api image.
 */

const SOFFICE_BIN = process.env.SOFFICE_BIN ?? "soffice";
const CONVERT_TIMEOUT_MS = 60_000;

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function isOfficeConvertible(mimeType: string): boolean {
  return mimeType in EXTENSION_BY_MIME;
}

function runSoffice(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(SOFFICE_BIN, args, { timeout: CONVERT_TIMEOUT_MS });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`soffice exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

export const officeConvertService = {
  async convertToPdf(buffer: Buffer, mimeType: string): Promise<Buffer> {
    const ext = EXTENSION_BY_MIME[mimeType];
    if (!ext) throw new Error(`Unsupported mime type for office conversion: ${mimeType}`);

    // Isolated temp dir per call for the input/output files, and an isolated
    // LibreOffice user profile via UserInstallation — soffice locks its
    // profile dir, so two conversions sharing one would collide the moment
    // more than one worker process runs on the same host.
    const workDir = await mkdtemp(path.join(tmpdir(), "office-convert-"));
    const profileDir = path.join(workDir, "profile");
    const inputPath = path.join(workDir, `input.${ext}`);

    try {
      await writeFile(inputPath, buffer);
      await runSoffice([
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ]);
      return await readFile(path.join(workDir, "input.pdf"));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },
};
