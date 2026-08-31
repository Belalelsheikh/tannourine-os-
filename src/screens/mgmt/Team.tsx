import { useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { ROLE_NAMES } from '../../lib/format';
import { ActionButton, ErrLine, Field, Hint, Pill, Sect } from '../../components/ui';
import type { Profile, Role, Scope } from '../../lib/types';

const ROLES: Role[] = ['coordinator', 'supervisor', 'router', 'invoice', 'finance', 'mgmt'];
const SCOPES: Scope[] = ['القاهرة', 'الإسكندرية', 'الكل'];

export default function Team() {
  const { profile, profiles, reloadRef, toast } = useApp();
  const [err, setErr] = useState<string | null>(null);

  // new-user form
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<Role>('coordinator');
  const [scope, setScope] = useState<Scope>('القاهرة');
  const [pass, setPass] = useState('');
  const [newErr, setNewErr] = useState<string | null>(null);

  const supervisors = profiles.filter((p) => p.role === 'supervisor' && p.active);
  const coordinators = profiles.filter((p) => p.role === 'coordinator');
  const others = profiles.filter((p) => p.role !== 'coordinator');
  const unassigned = coordinators.filter((c) => c.active && !c.supervisor_id).length;

  /** «المشرف» select — the only path that writes profiles.supervisor_id (PRD §17.8). */
  const assign = async (c: Profile, supervisorId: string | null) => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.from('profiles').update({ supervisor_id: supervisorId }).eq('id', c.id);
    if (error) { setErr(errText(error)); return; }
    await audit(profile.id, 'set_supervisor', 'profiles', c.id, {
      coordinator: c.full_name, supervisor_id: supervisorId,
    });
    toast(supervisorId ? 'اتحدد المشرف — «الفريق الآن» هيتحدث' : 'اتشال المشرف');
    await reloadRef();
  };

  const setActive = async (p: Profile, active: boolean) => {
    if (!profile) return;
    setErr(null);
    const { error } = await sb.from('profiles').update({ active }).eq('id', p.id);
    if (error) { setErr(errText(error)); return; }
    await audit(profile.id, active ? 'activate_user' : 'deactivate_user', 'profiles', p.id, {
      full_name: p.full_name,
    });
    toast(active ? 'اترجّع للخدمة' : 'اتوقف الحساب');
    await reloadRef();
  };

  const createUser = async () => {
    setNewErr(null);
    if (!name.trim()) { setNewErr('الاسم مطلوب'); return; }
    if (!/^[a-z0-9._-]{2,}$/.test(handle.trim().toLowerCase())) {
      setNewErr('اسم المستخدم بالإنجليزي فقط (حروف صغيرة وأرقام و . _ -)');
      return;
    }
    if (pass.length < 8) { setNewErr('الرقم السري ٨ حروف على الأقل'); return; }

    const { data, error } = await sb.functions.invoke('admin-create-user', {
      body: {
        full_name: name.trim(),
        handle: handle.trim().toLowerCase(),
        role,
        scope,
        password: pass,
      },
    });
    if (error) { setNewErr(errText(error)); return; }
    const res = data as { error?: string } | null;
    if (res?.error) { setNewErr(res.error); return; }

    toast('اتضاف المستخدم');
    setName(''); setHandle(''); setPass('');
    await reloadRef();
  };

  const Row = ({ p }: { p: Profile }) => (
    <div className={`card ${p.active ? '' : 'feeditem bad'}`}>
      <b>{p.full_name}</b>{' '}
      <Pill tone={p.active ? 'g' : 'r'}>{p.active ? ROLE_NAMES[p.role] : 'موقوف'}</Pill>
      <br />
      <span className="small">{ROLE_NAMES[p.role]} · {p.scope}</span>

      {p.role === 'coordinator' && (
        <div className="f" style={{ marginTop: 8, marginBottom: 0 }}>
          <label>المشرف</label>
          <select
            value={p.supervisor_id ?? ''}
            onChange={(e) => void assign(p, e.target.value === '' ? null : e.target.value)}
          >
            <option value="">— بدون مشرف —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name} ({s.scope})</option>
            ))}
          </select>
        </div>
      )}

      {p.id !== profile?.id && (
        <div className="btnrow">
          {p.active
            ? <ActionButton className="mini red" onClick={() => setActive(p, false)}>إيقاف</ActionButton>
            : <ActionButton className="mini grn" onClick={() => setActive(p, true)}>تفعيل</ActionButton>}
        </div>
      )}
    </div>
  );

  return (
    <>
      {unassigned > 0 && (
        <div className="card feeditem pend">
          <b>{unassigned} منسق من غير مشرف</b>
          <br />
          <span className="small">
            من غير تعيين، كل مشرفي نفس المحافظة بيشوفوا نفس «الفريق الآن». حدد المشرف من القائمة تحت.
          </span>
        </div>
      )}

      <ErrLine>{err}</ErrLine>

      <Sect>المنسقون ({coordinators.length})</Sect>
      {coordinators.map((p) => <Row key={p.id} p={p} />)}

      <Sect>باقي الفريق ({others.length})</Sect>
      {others.map((p) => <Row key={p.id} p={p} />)}

      <Sect>إضافة مستخدم</Sect>
      <Hint>الإضافة بتتم على السيرفر (Edge Function) — الإدارة بس اللي تقدر.</Hint>
      <Field label="الاسم" required>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أحمد سمير" />
      </Field>
      <Field label="اسم المستخدم (إنجليزي)" required>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          dir="ltr"
          style={{ textAlign: 'left' }}
          placeholder="ahmed.samir"
        />
      </Field>
      <Field label="الدور" required>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
        </select>
      </Field>
      <Field label="المحافظة" required>
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="رقم سري مؤقت (٨ حروف على الأقل)" required>
        <input
          type="text"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          dir="ltr"
          style={{ textAlign: 'left' }}
          placeholder="Tan@2026x"
        />
      </Field>
      <ErrLine>{newErr}</ErrLine>
      <ActionButton className="send" onClick={createUser}>إضافة المستخدم</ActionButton>
    </>
  );
}
