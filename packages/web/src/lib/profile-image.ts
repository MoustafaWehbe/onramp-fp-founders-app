const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 512;
// Matches MAX_AVATAR_UPLOAD_BYTES in packages/api/src/services/storage.service.ts.
const MAX_ENCODED_BYTES = 600 * 1024;

export type PreparedAvatar = {
  blob: Blob;
  /** Object URL for local preview — caller must revoke it when done. */
  previewUrl: string;
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be opened"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize locally so a profile photo stays quick to load and small on the wire.
 * Encodes as WebP; Safari versions that cannot encode WebP silently hand back
 * a PNG blob instead of erroring (canvas.toBlob's documented fallback
 * behavior), which the upload endpoint also accepts for exactly this reason.
 */
export async function prepareProfileImage(file: File): Promise<PreparedAvatar> {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
    throw new Error("Choose a JPEG, PNG, or WebP image");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 8 MB");
  }

  const source = await readFile(file);
  const image = await loadImage(source);
  const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process that image");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.86, 0.72, 0.58, 0.42]) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob && blob.size <= MAX_ENCODED_BYTES) {
      return { blob, previewUrl: URL.createObjectURL(blob) };
    }
  }

  throw new Error("That image is still too large after resizing");
}
