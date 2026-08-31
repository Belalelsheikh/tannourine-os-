/* Row types mirroring schema.sql. The schema is the contract — these follow it, never the reverse. */

export type Role = 'mgmt' | 'router' | 'invoice' | 'finance' | 'supervisor' | 'coordinator';
export type Scope = 'القاهرة' | 'الإسكندرية' | 'الكل';
export type OrderingMode = 'rep' | 'central' | 'mixed';
export type PaymentPath = 'cheque' | 'transfer' | 'unknown';
export type VisitStatus = 'pending' | 'approved' | 'flagged';
export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'invoiced';
export type InvoiceStatus = 'created' | 'dispatched' | 'delivered' | 'void';
export type CollectionStatus = 'received' | 'deposited' | 'cleared' | 'returned';
export type CollectionType = 'cheque' | 'transfer';
export type ZeroReason = 'المخزن فاضي' | 'الفرع لم يطلب' | 'أوردر متأخر' | 'مساحة الرف';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  scope: Scope;
  supervisor_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Outlet {
  id: number;
  chain: string;
  gov: string;
  name: string;
  ordering_mode: OrderingMode;
  payment_path: PaymentPath;
  manager_name: string | null;
  manager_phone: string | null;
  lat: number | null;
  lng: number | null;
  pin_set_by: string | null;
  pin_set_at: string | null;
  active: boolean;
}

export interface Sku {
  id: string;
  name_ar: string;
  line: 'PET' | 'VIA';
  case_size: number;
  price_case_incl_vat: number;
  active: boolean;
}

export interface RouteRow {
  coordinator_id: string;
  weekday: number;
  outlet_id: number;
}

export interface Visit {
  id: string;
  coordinator_id: string;
  outlet_id: number;
  checkin_at: string;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkout_at: string | null;
  checkout_lat: number | null;
  checkout_lng: number | null;
  dwell_seconds: number | null;
  distance_m: number | null;
  photo_path: string | null;
  status: VisitStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  flags: string[];
  off_route: boolean;
  created_at: string;
}

export interface VisitLine {
  visit_id: string;
  sku_id: string;
  shelf: number;
  warehouse: number;
  sold_cases: number;
  zero_reason: ZeroReason | null;
}

export interface Order {
  id: string;
  outlet_id: number;
  source: 'coordinator' | 'email';
  po_number: string | null;
  order_date: string;
  status: OrderStatus;
  created_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface OrderLine {
  order_id: string;
  sku_id: string;
  cases: number;
}

export interface Invoice {
  id: string;
  invoice_no: number;
  order_id: string | null;
  outlet_id: number;
  invoice_date: string;
  amount: number;
  status: InvoiceStatus;
  legacy: boolean;
  pod_path: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  created_by: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface InvoiceLine {
  invoice_id: string;
  sku_id: string;
  cases: number;
  price_case: number;
}

export interface Collection {
  id: string;
  invoice_id: string;
  outlet_id: number;
  type: CollectionType;
  amount: number;
  cheque_date: string | null;
  status: CollectionStatus;
  received_by: string | null;
  received_at: string;
  deposited_at: string | null;
  settled_at: string | null;
  note: string | null;
}

export interface Container {
  id: string;
  arrival_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ContainerLine {
  container_id: string;
  sku_id: string;
  cases: number;
}

export interface Followup {
  id: string;
  outlet_id: number;
  visit_id: string | null;
  zero_skus: string[];
  status: 'open' | 'done';
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

/** View: invoices with collections netted off (returned cheques excluded). */
export interface InvoiceOpen {
  id: string;
  invoice_no: number;
  outlet_id: number;
  invoice_date: string;
  amount: number;
  legacy: boolean;
  status: InvoiceStatus;
  open_amount: number;
  age_days: number;
}

/** View: containers in − non-legacy invoiced out. */
export interface BookStock {
  sku_id: string;
  name_ar: string;
  cases_in: number;
  cases_out: number;
}
