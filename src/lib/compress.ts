/**
 * Client-side compress: longest edge `maxEdge`, JPEG q0.7 (PRD §5.3).
 *
 * A 12–48 MP camera JPEG costs 50–200 MB decoded, on the same phones that just lost the page
 * to the camera (Batch A5). Where the browser can, createImageBitmap resizes while decoding so
 * the full-size image is never held; `<img>` + canvas stays as the fallback. Orientation is
 * left to the browser (`imageOrientation: 'from-image'` is the default on current iOS/Android).
 */
export async function compressImage(file: Blob, maxEdge = 1024, quality = 0.7): Promise<Blob> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await viaBitmap(file, maxEdge, quality);
    } catch { /* e.g. a format the bitmap decoder refuses — the <img> path may still read it */ }
  }
  return viaImage(file, maxEdge, quality);
}

/** Scaled size with the longest edge at most `maxEdge`; never enlarges. */
export function fitSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

let resizeSupport: Promise<boolean> | null = null;
/** Does createImageBitmap honour resize options? Asked once with a 2×2 PNG, then cached. */
function bitmapResizes(): Promise<boolean> {
  resizeSupport ??= (async () => {
    try {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!png) return false;
      const b = await createImageBitmap(png, { resizeWidth: 1, resizeHeight: 1, resizeQuality: 'high' });
      const ok = b.width === 1 && b.height === 1;
      b.close();
      return ok;
    } catch {
      return false;
    }
  })();
  return resizeSupport;
}

async function viaBitmap(file: Blob, maxEdge: number, quality: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  if (await bitmapResizes()) {
    // The oriented size isn't known without decoding, so resize by width, then — for a
    // portrait shot — once more by height from the already-small bitmap.
    bitmap = await createImageBitmap(file, { resizeWidth: maxEdge, resizeQuality: 'high' });
    if (bitmap.height > maxEdge) {
      const tall = bitmap;
      bitmap = await createImageBitmap(tall, { resizeHeight: maxEdge, resizeQuality: 'high' });
      tall.close();
    }
  } else {
    bitmap = await createImageBitmap(file);
  }
  try {
    return await draw(bitmap, bitmap.width, bitmap.height, maxEdge, quality);
  } finally {
    bitmap.close();
  }
}

function viaImage(file: Blob, maxEdge: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      draw(img, img.width, img.height, maxEdge, quality).then(resolve, reject);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ملف الصورة غير صالح')); };
    img.src = url;
  });
}

function draw(src: CanvasImageSource, w: number, h: number, maxEdge: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const size = fitSize(w, h, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('canvas غير متاح')); return; }
    ctx.drawImage(src, 0, 0, size.width, size.height);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة'))),
      'image/jpeg',
      quality,
    );
  });
}
