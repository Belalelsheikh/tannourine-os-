import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compressImage, signedUrl } from '../lib/photo';

export const Sect = ({ children }: { children: ReactNode }) => <div className="sect">{children}</div>;
export const Empty = ({ children = 'مفيش حاجة هنا' }: { children?: ReactNode }) => (
  <p className="empty">{children}</p>
);
export const Hint = ({ children }: { children: ReactNode }) => <p className="hint">{children}</p>;
export const ErrLine = ({ children }: { children: ReactNode }) =>
  children ? <p className="err">{children}</p> : null;

export function Pill({ tone, children }: { tone: 'r' | 'g' | 'y' | 'v' | 'n'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function StatTiles({ items }: { items: { n: ReactNode; label: string; tone?: 'bad' | 'good' | 'w' }[] }) {
  return (
    <div className="stat">
      {items.map((it, i) => (
        <div key={i} className={it.tone ?? ''}>
          <b>{it.n}</b>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Arabic-Indic (٠-٩) and extended (۰-۹) numerals → ASCII. Egyptian Android keyboards
 * emit these, and JS `\d` is ASCII-only, so without this they are stripped as non-numeric
 * and the field silently stays empty.
 */
const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** Stepper input (− value +) — the only quantity control in the system (PRD §11). */
export function Stepper({
  value, onChange, allowEmpty = false,
}: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean }) {
  const step = (d: number) => onChange(Math.max(0, (value ?? 0) + d));
  return (
    <div className="step">
      <button type="button" onClick={() => step(-1)} aria-label="ناقص">−</button>
      <input
        inputMode="numeric"
        className={value === 0 ? 'zero' : ''}
        value={value === null ? '' : String(value)}
        placeholder={allowEmpty ? '—' : '0'}
        /*
         * Select on focus so the first keystroke replaces the standing value instead of
         * landing beside it: tapping the centred «0» put the caret before it, so typing 12
         * produced 120 — a 10× order. preventDefault on mouseup stops Safari collapsing
         * that selection on the tap that follows focus.
         */
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = toAsciiDigits(e.target.value).replace(/\D/g, '');
          onChange(digits === '' ? (allowEmpty ? null : 0) : Number(digits));
        }}
      />
      <button type="button" onClick={() => step(1)} aria-label="زائد">+</button>
    </div>
  );
}

/**
 * Camera/file picker that compresses before handing the blob back.
 * Keeps the preview so a failed submit never loses the photo (PRD §15.9).
 */
export function PhotoPicker({
  label, blob, onPick, onError,
}: {
  label: string;
  blob: Blob | null;
  onPick: (b: Blob) => void;
  onError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) { setPreview(null); return; }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <>
      {preview && <img className="thumb" src={preview} alt="معاينة" />}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onPick(await compressImage(file));
          } catch (err) {
            onError(err instanceof Error ? err.message : 'فشل تجهيز الصورة');
          }
        }}
      />
      <button type="button" className={`photo ${blob ? 'on' : ''}`} onClick={() => inputRef.current?.click()}>
        {blob ? '✓ تم إرفاق الصورة — اضغط للتغيير' : label}
      </button>
    </>
  );
}

/** Private-bucket image: resolves a signed URL on mount. */
export function SecureImage({ bucket, path }: { bucket: string; path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    void signedUrl(bucket, path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [bucket, path]);
  if (!path) return null;
  if (!url) return <p className="small">جارٍ تحميل الصورة…</p>;
  return <img className="thumb" src={url} alt="صورة" style={{ marginTop: 8 }} />;
}

/** Search + chain filter used by outlet pickers and the routes builder. */
export function Segmented({
  options, value, onChange,
}: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} type="button" className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="f">
      <label>{label} {required && <em>*</em>}</label>
      {children}
    </div>
  );
}

/** Busy-guarded action button — prevents double-submit on slow networks. */
export function ActionButton({
  className = 'mini', onClick, children, disabled,
}: { className?: string; onClick: () => Promise<void> | void; children: ReactNode; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await onClick(); } finally { setBusy(false); }
      }}
    >
      {busy ? '…' : children}
    </button>
  );
}
