import { useState } from 'react';
import { sb, errText } from '../lib/supabase';
import { Field } from './ui';

const DOMAIN = '@tannourine.local';

export default function Login() {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const handle = user.trim().toLowerCase();
    if (!handle || !pass) { setErr('اكتب اسم المستخدم والرقم السري'); return; }
    setBusy(true);
    setErr(null);
    const email = handle.includes('@') ? handle : handle + DOMAIN;
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    setBusy(false);
    if (error) {
      setErr(
        /invalid login/i.test(error.message)
          ? 'اسم المستخدم أو الرقم السري غلط'
          : errText(error),
      );
    }
  };

  return (
    <div className="login-wrap">
      <div className="brand">
        <h1>تنورين مصر</h1>
        <p>نظام التشغيل</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="اسم المستخدم">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            dir="ltr"
            style={{ textAlign: 'left' }}
            placeholder="nada"
          />
        </Field>
        <Field label="الرقم السري">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            style={{ textAlign: 'left' }}
            placeholder="••••••••"
          />
        </Field>
        {err && <p className="err">{err}</p>}
        <button className="send" type="submit" disabled={busy}>
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
      <p className="small" style={{ marginTop: 14, textAlign: 'center' }}>
        لو نسيت الرقم السري كلّم الإدارة
      </p>
    </div>
  );
}
