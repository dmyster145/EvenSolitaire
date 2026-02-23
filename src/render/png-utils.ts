/** PNG/canvas helpers for image-container rendering. */

export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<number[]> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve([]);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
        };
        reader.readAsArrayBuffer(blob);
      },
      "image/png"
    );
  });
}

export async function pngBytesToImageBitmap(pngBytes: number[]): Promise<ImageBitmap | null> {
  if (!pngBytes || pngBytes.length === 0) return null;
  const blob = new Blob([new Uint8Array(pngBytes)], { type: "image/png" });
  return await createImageBitmap(blob);
}

export async function scalePngBytes(pngBytes: number[], width: number, height: number): Promise<number[]> {
  const img = await pngBytesToImageBitmap(pngBytes);
  if (!img) return [];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToPngBytes(canvas);
}

export async function cropScalePngBytes(
  pngBytes: number[],
  source: { x: number; y: number; width: number; height: number },
  target: { width: number; height: number }
): Promise<number[]> {
  const img = await pngBytesToImageBitmap(pngBytes);
  if (!img) return [];
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    img,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    target.width,
    target.height
  );
  return canvasToPngBytes(canvas);
}
