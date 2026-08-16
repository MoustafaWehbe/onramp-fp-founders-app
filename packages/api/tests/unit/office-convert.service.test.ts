import { EventEmitter } from "events";
import { writeFile } from "fs/promises";
import path from "path";

const spawnMock = jest.fn();
jest.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { isOfficeConvertible, officeConvertService } from "../../src/services/office-convert.service";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Stands in for the real `soffice` process: reads the --outdir argument off
 * the spawn call, drops a fake PDF there so the service's readFile succeeds,
 * then closes with the given exit code — same contract the real binary has,
 * without needing LibreOffice installed to run this suite.
 */
function mockSoffice(exitCode: number, stderr = "") {
  spawnMock.mockImplementation((_bin: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(async () => {
      if (exitCode === 0) {
        const outdir = args[args.indexOf("--outdir") + 1];
        await writeFile(path.join(outdir, "input.pdf"), Buffer.from("%PDF-fake"));
      } else if (stderr) {
        child.stderr.emit("data", Buffer.from(stderr));
      }
      child.emit("close", exitCode);
    });
    return child;
  });
}

beforeEach(() => jest.clearAllMocks());

describe("isOfficeConvertible", () => {
  it("accepts DOCX and PPTX", () => {
    expect(isOfficeConvertible(DOCX_MIME)).toBe(true);
    expect(isOfficeConvertible(PPTX_MIME)).toBe(true);
  });

  it("rejects everything else, including PDF itself", () => {
    expect(isOfficeConvertible("application/pdf")).toBe(false);
    expect(isOfficeConvertible("text/plain")).toBe(false);
    expect(
      isOfficeConvertible("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(false);
  });
});

describe("officeConvertService.convertToPdf", () => {
  it("returns the converted PDF bytes on success", async () => {
    mockSoffice(0);

    const result = await officeConvertService.convertToPdf(Buffer.from("docx-bytes"), DOCX_MIME);

    expect(result.toString()).toBe("%PDF-fake");
    expect(spawnMock).toHaveBeenCalledWith(
      "soffice",
      expect.arrayContaining(["--headless", "--convert-to", "pdf"]),
      expect.any(Object),
    );
  });

  it("rejects with soffice's stderr when the conversion fails", async () => {
    mockSoffice(1, "document is password protected");

    await expect(
      officeConvertService.convertToPdf(Buffer.from("pptx-bytes"), PPTX_MIME),
    ).rejects.toThrow(/password protected/);
  });

  it("rejects a mime type it doesn't know how to convert", async () => {
    await expect(
      officeConvertService.convertToPdf(Buffer.from("bytes"), "application/pdf"),
    ).rejects.toThrow(/Unsupported mime type/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
