import { useEffect, useState, type ReactElement } from 'react';
import { useApp, useQuery } from './lib/app';
import { sb, configured } from './lib/supabase';
import { ROLE_NAMES } from './lib/format';
import type { Role } from './lib/types';
import Login from './components/Login';

import RouteToday from './screens/coordinator/RouteToday';
import CoordCheques from './screens/coordinator/Cheques';
import MyLog from './screens/coordinator/MyLog';
import Feed from './screens/supervisor/Feed';
import TeamNow from './screens/supervisor/TeamNow';
import Followups from './screens/supervisor/Followups';
import Intake from './screens/router/Intake';
import Board from './screens/router/Board';
import ToInvoice from './screens/invoice/ToInvoice';
import Invoices from './screens/invoice/Invoices';
import FinCheques from './screens/finance/Cheques';
import Transfers from './screens/finance/Transfers';
import Aging from './screens/finance/Aging';
import Corrections from './screens/finance/Corrections';
import Dashboard from './screens/mgmt/Dashboard';
import Stock from './screens/mgmt/Stock';
import Team from './screens/mgmt/Team';
import RoutesBuilder from './screens/mgmt/RoutesBuilder';
import OutletsEditor from './screens/mgmt/Outlets';

interface Tab { id: string; label: string; render: () => ReactElement; }

const TABS: Record<Role, Tab[]> = {
  coordinator: [
    { id: 'route', label: 'خط اليوم', render: () => <RouteToday /> },
    { id: 'chq', label: 'الشيكات', render: () => <CoordCheques /> },
    { id: 'mylog', label: 'سجلّي', render: () => <MyLog /> },
  ],
  supervisor: [
    { id: 'feed', label: 'المتابعة', render: () => <Feed /> },
    { id: 'now', label: 'الفريق الآن', render: () => <TeamNow /> },
    { id: 'fups', label: 'تنبيهات', render: () => <Followups /> },
  ],
  router: [
    { id: 'intake', label: 'تسجيل وارد', render: () => <Intake /> },
    { id: 'board', label: 'الأوردرات', render: () => <Board /> },
    { id: 'dash', label: 'لوحة', render: () => <Dashboard readOnly /> },
  ],
  invoice: [
    { id: 'toinv', label: 'للفوترة', render: () => <ToInvoice /> },
    { id: 'invs', label: 'الفواتير', render: () => <Invoices /> },
  ],
  finance: [
    { id: 'chqb', label: 'الشيكات', render: () => <FinCheques /> },
    { id: 'trf', label: 'التحويلات', render: () => <Transfers /> },
    { id: 'aging', label: 'الأعمار', render: () => <Aging /> },
    { id: 'fix', label: 'تصحيحات', render: () => <Corrections /> },
  ],
  mgmt: [
    { id: 'dash', label: 'اللوحة', render: () => <Dashboard /> },
    { id: 'stock', label: 'المخزون', render: () => <Stock /> },
    { id: 'team', label: 'الفريق', render: () => <Team /> },
    { id: 'routes', label: 'الخطوط', render: () => <RoutesBuilder /> },
    { id: 'outlets', label: 'الفروع', render: () => <OutletsEditor /> },
  ],
};

/** Office roles get laptop table layouts at ≥900px — PRD §4. */
const WIDE_ROLES: Role[] = ['router', 'invoice', 'finance', 'mgmt'];

/** Count badges on the bottom tab bar; recomputed on every realtime tick. */
function useBadges(role: Role | undefined, uid: string | undefined) {
  const { data } = useQuery<Record<string, number>>(
    async () => {
      if (!role || !uid) return {};
      const cnt = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
      const head = { count: 'exact' as const, head: true };
      const out: Record<string, number> = {};

      if (role === 'supervisor') {
        // Submitted-but-unreviewed only: an open visit is not yet waiting on the supervisor.
        out.feed = await cnt(
          sb.from('visits').select('id', head).eq('status', 'pending').not('checkout_at', 'is', null));
        out.fups = await cnt(sb.from('followups').select('id', head).eq('status', 'open'));
      } else if (role === 'router') {
        out.board = await cnt(sb.from('orders').select('id', head).eq('status', 'pending'));
      } else if (role === 'invoice') {
        out.toinv = await cnt(sb.from('orders').select('id', head).eq('status', 'approved'));
        out.invs = await cnt(
          sb.from('invoices').select('id', head).in('status', ['created', 'dispatched']));
      } else if (role === 'finance') {
        out.chqb = await cnt(
          sb.from('collections').select('id', head).eq('type', 'cheque').in('status', ['received', 'deposited']));
      }
      return out;
    },
    [role, uid],
    {},
  );
  return data;
}

export default function App() {
  const { session, profile, loading, error, online, reloadRef, signOut } = useApp();
  const [tabId, setTabId] = useState<string | null>(null);
  const badges = useBadges(profile?.role, profile?.id);

  const tabs = profile ? TABS[profile.role] : [];
  useEffect(() => {
    if (profile && (!tabId || !tabs.some((t) => t.id === tabId))) setTabId(tabs[0]?.id ?? null);
  }, [profile?.role]);

  if (!configured) {
    return (
      <div className="phone">
        <main className="body">
          <div className="login-wrap">
            <div className="brand"><h1>تنورين مصر</h1></div>
            <p className="err">الإعدادات ناقصة</p>
            <p className="small">
              انسخ <b>.env.example</b> إلى <b>.env</b> واملأ VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY،
              وبعدها أعد تشغيل التطبيق.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="phone">
        {!online && <div className="banner off">لا يوجد اتصال</div>}
        <main className="body" style={{ paddingBottom: 14 }}><Login /></main>
      </div>
    );
  }

  if (loading) {
    return <div className="phone"><main className="body"><p className="empty">جارٍ التحميل…</p></main></div>;
  }

  if (error || !profile) {
    return (
      <div className="phone">
        <main className="body">
          <p className="err">{error ?? 'تعذّر تحميل الحساب'}</p>
          <button className="ghost" onClick={() => void signOut()}>خروج</button>
        </main>
      </div>
    );
  }

  const active = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const wide = WIDE_ROLES.includes(profile.role);

  return (
    <div className={`phone ${wide ? 'wide' : ''}`}>
      <div className="bar">
        <div>
          <div className="who">{profile.full_name}</div>
          <div className="ttl">
            {active?.label}
            <span className="rolechip">{ROLE_NAMES[profile.role]}</span>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => void reloadRef()}>تحديث</button>
          <button onClick={() => void signOut()}>خروج</button>
        </div>
      </div>
      {!online && <div className="banner off">لا يوجد اتصال — التسجيل هيفضل محفوظ لحد ما النت يرجع</div>}
      <main className="body">{active?.render()}</main>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={t.id === active?.id ? 'on' : ''} onClick={() => setTabId(t.id)}>
            {t.label}
            {badges[t.id] ? <span className="badge">{badges[t.id]}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
