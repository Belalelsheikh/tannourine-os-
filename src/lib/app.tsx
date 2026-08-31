import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { sb, errText } from './supabase';
import type { Outlet, Profile, RouteRow, Sku } from './types';

interface RefData {
  outlets: Outlet[];
  skus: Sku[];
  profiles: Profile[];
  routes: RouteRow[];
}

interface AppState extends RefData {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  /** Bumped by realtime events and manual refresh; every screen query depends on it. */
  tick: number;
  bump: () => void;
  reloadRef: () => Promise<void>;
  toast: (msg: string) => void;
  signOut: () => Promise<void>;
  online: boolean;
  outletById: (id: number) => Outlet | undefined;
  skuById: (id: string) => Sku | undefined;
  profileById: (id: string | null) => Profile | undefined;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

const EMPTY: RefData = { outlets: [], skus: [], profiles: [], routes: [] };

export function AppProvider({ children, onToast }: { children: ReactNode; onToast: (m: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ref, setRef] = useState<RefData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ---- auth session ----
  useEffect(() => {
    let alive = true;
    sb.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // ---- reference data, loaded once per session ----
  const loadRef = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [me, outlets, skus, profiles, routes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('outlets').select('*').order('chain').order('name'),
        sb.from('skus').select('*').order('line').order('id'),
        sb.from('profiles').select('*').order('full_name'),
        sb.from('routes').select('*'),
      ]);
      const firstErr = [me, outlets, skus, profiles, routes].find((r) => r.error)?.error;
      if (firstErr) throw firstErr;
      if (!me.data) throw new Error('لا يوجد ملف مستخدم (profile) لهذا الحساب — كلّم الإدارة');
      if (!(me.data as Profile).active) throw new Error('الحساب موقوف — كلّم الإدارة');
      setProfile(me.data as Profile);
      setRef({
        outlets: (outlets.data ?? []) as Outlet[],
        skus: (skus.data ?? []) as Sku[],
        profiles: (profiles.data ?? []) as Profile[],
        routes: (routes.data ?? []) as RouteRow[],
      });
    } catch (e) {
      setError(errText(e));
      setProfile(null);
      setRef(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); setRef(EMPTY); setLoading(false); return; }
    void loadRef(session.user.id);
  }, [session?.user?.id, loadRef]);

  const reloadRef = useCallback(async () => {
    if (session?.user) await loadRef(session.user.id);
    bump();
  }, [session?.user?.id, loadRef, bump]);

  // ---- realtime: live badges on visits / orders / collections (PRD §2, §15.3) ----
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  useEffect(() => {
    if (!session?.user) return;
    const channel = sb
      .channel('ops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => bumpRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => bumpRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'collections' }, () => bumpRef.current())
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [session?.user?.id]);

  const signOut = useCallback(async () => { await sb.auth.signOut(); setProfile(null); setRef(EMPTY); }, []);

  const outletIndex = useMemo(() => new Map(ref.outlets.map((o) => [o.id, o])), [ref.outlets]);
  const skuIndex = useMemo(() => new Map(ref.skus.map((s) => [s.id, s])), [ref.skus]);
  const profileIndex = useMemo(() => new Map(ref.profiles.map((p) => [p.id, p])), [ref.profiles]);

  const value: AppState = {
    ...ref,
    session,
    profile,
    loading,
    error,
    tick,
    bump,
    reloadRef,
    toast: onToast,
    signOut,
    online,
    outletById: (id) => outletIndex.get(id),
    skuById: (id) => skuIndex.get(id),
    profileById: (id) => (id == null ? undefined : profileIndex.get(id)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Screen-level query that re-runs whenever `tick` changes (realtime or manual refresh). */
export function useQuery<T>(
  run: () => Promise<T>,
  deps: unknown[],
  initial: T,
): { data: T; loading: boolean; error: string | null; reload: () => void } {
  const { tick } = useApp();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    runRef.current()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(errText(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, local, ...deps]);

  return { data, loading, error, reload: () => setLocal((n) => n + 1) };
}
