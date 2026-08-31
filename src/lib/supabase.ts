import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && anonKey);

if (!configured) {
  // Loud in the console, and App renders a setup screen — never a blank white page.
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Copy .env.example to .env.');
}

/** Single client for the whole app. Anon key only — the service key never reaches the browser. */
export const sb = createClient(url ?? 'http://localhost:54321', anonKey ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const BUCKET_VISITS = 'visit-photos';
export const BUCKET_PODS = 'pods';

/** Supabase errors are objects, not Errors — normalise to Arabic-safe text for the UI. */
export function errText(e: unknown): string {
  if (!e) return 'خطأ غير معروف';
  const anyE = e as { message?: string; error_description?: string; details?: string };
  return anyE.message || anyE.error_description || anyE.details || String(e);
}
