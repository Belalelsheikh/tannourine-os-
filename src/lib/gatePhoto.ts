/**
 * Where a gate photo came from (Batch A6). `capture="environment"` on a file input is only a
 * hint: Samsung Internet, some OEM Chromes and in-app browsers show a chooser with the gallery.
 * So the in-page camera (getUserMedia) is the gate's main path — the browser makes the pixels —
 * and the file input is only offered once that camera fails, behind a freshness check, and is
 * flagged for the supervisor. `sha256` lets review spot the same picture used twice.
 */

export type GatePhotoSource = 'live' | 'file';

export interface GatePhotoMeta {
  source: GatePhotoSource;
  /** Seconds between the file's lastModified and the pick; null for a live frame. */
  file_age_s: number | null;
  sha256: string | null;
}

/** A camera capture handed back through a file input is seconds old; a gallery pick is not. */
export const FILE_MAX_AGE_S = 120;
/** Phone clocks drift; a file a little in the "future" is still today's capture. */
const FILE_MAX_SKEW_S = 60;

export const fileAgeSeconds = (lastModified: number, now = Date.now()) =>
  Math.round((now - lastModified) / 1000);

/** lastModified is a heuristic (a copied file gets a new one), hence the supervisor flag too. */
export const fileFresh = (ageS: number) => ageS <= FILE_MAX_AGE_S && ageS >= -FILE_MAX_SKEW_S;

export const STALE_FILE_TEXT = 'الصورة دي مش لسه متصورة — صوّر واحدة جديدة دلوقتي';

export const CAMERA_PERMISSION_HINT =
  'الكاميرا مقفولة لـ Chrome — إعدادات الموبايل ← التطبيقات ← Chrome ← الأذونات ← الكاميرا ← السماح، وبعدين ارجع هنا';

/** getUserMedia's DOMException name, in the coordinator's words. */
export function cameraErrorText(name: string | undefined): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_PERMISSION_HINT;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'المتصفح مش لاقي كاميرا على الموبايل ده';
    case 'NotReadableError':
    case 'AbortError':
      return 'الكاميرا مشغولة في تطبيق تاني — اقفله وحاول تاني';
    default:
      return 'المتصفح ده مش بيفتح الكاميرا جوه الصفحة';
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
