import { sb } from './supabase';
import type { VisitPhoto } from './types';

/** Client-side compress: longest edge 1024px, JPEG q0.7 (PRD §5.3). */
export function compressImage(file: File, maxEdge = 1024, quality = 0.7): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas غير متاح')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ملف الصورة غير صالح')); };
    img.src = url;
  });
}

/**
 * Upload with upsert so a retry after a partial failure overwrites rather than
 * colliding — the submit pipeline must be replayable (PRD §15.9).
 */
export async function uploadPhoto(bucket: string, path: string, blob: Blob): Promise<void> {
  const { error } = await sb.storage
    .from(bucket)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
}

/** Buckets are private — render through a short-lived signed URL. */
export async function signedUrl(bucket: string, path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Visit photos (Batch A3): 1280 px long edge, JPEG 0.7, under `visits/<visit_id>/`. */
export const VISIT_PHOTO_EDGE = 1280;
/** Non-gate photos per visit; the DB policy enforces the same cap. */
export const MAX_VISIT_PHOTOS = 6;
export const visitPhotoPath = (visitId: string, photoId: string) => `visits/${visitId}/${photoId}.jpg`;

/**
 * Record an uploaded photo. A replayed gate insert hits the one-gate-per-visit index (23505);
 * that means the first attempt landed, so hand back the row that is already there.
 */
export async function insertVisitPhoto(row: Omit<VisitPhoto, 'taken_at'>): Promise<VisitPhoto> {
  const { data, error } = await sb.from('visit_photos').insert(row).select('*').single();
  if (!error) return data as VisitPhoto;
  if (error.code === '23505' && row.kind === 'gate') {
    const again = await sb.from('visit_photos').select('*')
      .eq('visit_id', row.visit_id).eq('kind', 'gate').single();
    if (!again.error) return again.data as VisitPhoto;
  }
  throw error;
}

/** Gate first (proof of presence), then the rest in the order they were taken. */
export const sortVisitPhotos = (photos: VisitPhoto[]) =>
  [...photos].sort((a, b) =>
    Number(b.kind === 'gate') - Number(a.kind === 'gate') || a.taken_at.localeCompare(b.taken_at));
