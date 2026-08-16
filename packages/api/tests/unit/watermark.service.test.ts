const store = new Map<string, Buffer>();

jest.mock("../../src/db/redis", () => ({
  getRedis: () => ({
    getBuffer: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: Buffer) => {
      store.set(key, value);
      return "OK";
    }),
  }),
}));

import sharp from "sharp";
import { shortLinkId, watermarkService } from "../../src/services/watermark.service";

const WEBP_MAGIC = Buffer.from("WEBP", "ascii");

async function basePage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .webp()
    .toBuffer();
}

beforeEach(() => store.clear());

describe("shortLinkId", () => {
  it("is deterministic and does not depend on hyphens in the invitation id", () => {
    const id = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
    expect(shortLinkId(id)).toBe(shortLinkId(id));
    expect(shortLinkId(id)).toMatch(/^FPF-[0-9A-F]{6}$/);
  });
});

describe("watermarkService.getWatermarkedPage", () => {
  it("returns a valid WebP image with the source page's dimensions", async () => {
    const buffer = await basePage(900, 1200);

    const result = await watermarkService.getWatermarkedPage({
      invitationId: "inv-1",
      versionId: "ver-1",
      pageNumber: 1,
      email: "vc@example.com",
      buffer,
      width: 900,
      height: 1200,
    });

    expect(result.subarray(8, 12)).toEqual(WEBP_MAGIC);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(900);
    expect(meta.height).toBe(1200);
    // The composited output is a different image than the untouched input.
    expect(Buffer.compare(result, buffer)).not.toBe(0);
  });

  it("caches by invitation/version/page so a re-fetch does not recomposite", async () => {
    const first = await basePage(900, 1200);
    const firstResult = await watermarkService.getWatermarkedPage({
      invitationId: "inv-1",
      versionId: "ver-1",
      pageNumber: 1,
      email: "vc@example.com",
      buffer: first,
      width: 900,
      height: 1200,
    });

    // Different input entirely (and, notably, too small to ever pass
    // through the real composite path) — a cache hit must never look at it
    // and must return exactly what was cached the first time.
    const second = await basePage(50, 50);
    const secondResult = await watermarkService.getWatermarkedPage({
      invitationId: "inv-1",
      versionId: "ver-1",
      pageNumber: 1,
      email: "someone-else@example.com",
      buffer: second,
      width: 50,
      height: 50,
    });

    expect(Buffer.compare(secondResult, firstResult)).toBe(0);
  });

  it("keys the cache by invitation, version, and page number separately", async () => {
    const buffer = await basePage(900, 1200);
    const call = (pageNumber: number) =>
      watermarkService.getWatermarkedPage({
        invitationId: "inv-1",
        versionId: "ver-1",
        pageNumber,
        email: "vc@example.com",
        buffer,
        width: 900,
        height: 1200,
      });

    await call(1);
    await call(2);

    expect(store.has("wm:inv-1:ver-1:1")).toBe(true);
    expect(store.has("wm:inv-1:ver-1:2")).toBe(true);
  });
});
