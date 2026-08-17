import sharp from "sharp";
import { getRedis } from "../db/redis";

/**
 * Burns the reviewer's identity into a page image before it leaves the
 * server. This is the layer that survives a screenshot, crop, or phone
 * photo — the live overlay in the client is cosmetic by comparison.
 */

const CACHE_TTL_SECONDS = 60 * 60;
const TILE_WIDTH = 420;
const TILE_HEIGHT = 260;

function cacheKey(invitationId: string, versionId: string, pageNumber: number): string {
  return `wm:${invitationId}:${versionId}:${pageNumber}`;
}

/** Not looked up anywhere — just a short, stable label to print alongside the
 * email, so a cropped watermark tile still identifies which link leaked. */
export function shortLinkId(invitationId: string): string {
  return `FPF-${invitationId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tileSvg(text: string): Buffer {
  const label = escapeXml(text);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}">
      <text
        x="${TILE_WIDTH / 2}"
        y="${TILE_HEIGHT / 2}"
        transform="rotate(-30 ${TILE_WIDTH / 2} ${TILE_HEIGHT / 2})"
        font-family="sans-serif"
        font-size="18"
        fill="black"
        fill-opacity="0.06"
        text-anchor="middle"
        dominant-baseline="middle"
      >${label}</text>
    </svg>
  `);
}

async function compositeWatermark(input: {
  buffer: Buffer;
  width: number;
  height: number;
  text: string;
}): Promise<Buffer> {
  const tile = tileSvg(input.text);
  const tilePng = await sharp(tile).png().toBuffer();

  // `tile: true` repeats one small rendered SVG across the whole page rather
  // than rasterizing one giant SVG sized to the page — cheaper, and it keeps
  // every crop of the page containing a full instance of the text.
  return sharp(input.buffer)
    .composite([{ input: tilePng, tile: true }])
    .webp({ quality: 80 })
    .toBuffer();
}

export const watermarkService = {
  /**
   * Returns watermarked page bytes, cached in Redis so a scrolling reviewer
   * re-fetching the same page doesn't pay the composite cost twice. Callers
   * are responsible for deciding whether watermarking applies at all (the
   * per-invitation `watermarkEnabled` toggle) — this function always burns
   * the text it's given.
   */
  async getWatermarkedPage(input: {
    invitationId: string;
    versionId: string;
    pageNumber: number;
    email: string;
    buffer: Buffer;
    width: number;
    height: number;
  }): Promise<Buffer> {
    const key = cacheKey(input.invitationId, input.versionId, input.pageNumber);
    const redis = getRedis();

    const cached = await redis.getBuffer(key);
    if (cached) return cached;

    const date = new Date().toISOString().slice(0, 10);
    const text = `${input.email} · ${shortLinkId(input.invitationId)} · ${date}`;

    const watermarked = await compositeWatermark({
      buffer: input.buffer,
      width: input.width,
      height: input.height,
      text,
    });

    await redis.set(key, watermarked, "EX", CACHE_TTL_SECONDS);
    return watermarked;
  },
};
