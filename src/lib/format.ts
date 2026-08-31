import type { OrderingMode, PaymentPath, Role, ZeroReason } from './types';

/** Western numerals throughout — PRD §11. */
export const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const fmt0 = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const isToday = (ts: string) => new Date(ts).toDateString() === new Date().toDateString();

export const timeOf = (ts: string) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Time alone for today, date + time for anything older — used wherever a stale row can surface. */
export const stampOf = (ts: string) =>
  isToday(ts) ? timeOf(ts) : `${new Date(ts).toLocaleDateString('en-GB')} ${timeOf(ts)}`;

export const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/** «منذ HH:MM» for an open visit — PRD §5.8. */
export function sinceHHMM(from: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Relative Arabic time for the activity feed. */
export function relTime(ts: string): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'دلوقتي';
  if (mins < 60) return `من ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `من ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'إمبارح' : `من ${days} يوم`;
}

export function dwellText(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} د ${s} ث` : `${s} ث`;
}

export const ROLE_NAMES: Record<Role, string> = {
  mgmt: 'الإدارة',
  router: 'الأوردرات',
  invoice: 'الفواتير',
  finance: 'المالية',
  supervisor: 'مشرف',
  coordinator: 'منسق',
};

export const DAY_LABELS: Record<number, string> = {
  6: 'السبت', 0: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة',
};
export const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

export const PAY_LABEL: Record<PaymentPath, string> = {
  cheque: 'شيك',
  transfer: 'تحويل بنكي',
  unknown: 'غير مسجلة',
};

export const ORD_LABEL: Record<OrderingMode, string> = {
  rep: 'أوردر مندوب',
  central: 'أوردر مركزي (إيميل)',
  mixed: 'إيميل أو مندوب',
};

export const REASONS: ZeroReason[] = ['المخزن فاضي', 'الفرع لم يطلب', 'أوردر متأخر', 'مساحة الرف'];

export const FLAG_LABEL: Record<string, string> = {
  short_visit: 'زيارة قصيرة',
  far_from_pin: 'بعيد عن الفرع',
  no_checkin_gps: 'بدون GPS عند البدء',
  no_checkout_gps: 'بدون GPS عند الإرسال',
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  created: 'اتعملت',
  dispatched: 'خرجت مع العربية',
  delivered: 'اتسلّمت',
  void: 'ملغاة',
};

export const COLLECTION_STATUS_LABEL: Record<string, string> = {
  received: 'في العهدة',
  deposited: 'مودع',
  cleared: 'تحصّل',
  returned: 'مرتد',
};

/** Phone numbers in the seed lost their leading zero (stored as digits). */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const first = phone.split(/[/_\-\s]/).map((s) => s.trim()).filter(Boolean)[0];
  if (!first) return null;
  const digits = first.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${digits.startsWith('0') ? digits : '0' + digits}`;
}
