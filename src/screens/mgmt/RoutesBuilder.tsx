import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../lib/app';
import { sb, errText } from '../../lib/supabase';
import { DAY_LABELS, DAY_ORDER } from '../../lib/format';
import { ActionButton, Empty, ErrLine, Field, Hint, Pill, Segmented } from '../../components/ui';

/** Route builder — writes `routes` for one coordinator/weekday at a time (PRD §15.6). */
export default function RoutesBuilder() {
  const { profiles, outlets, routes, reloadRef, toast } = useApp();
  const coordinators = profiles.filter((p) => p.role === 'coordinator' && p.active);

  const [coordId, setCoordId] = useState<string>('');
  const [day, setDay] = useState<number>(new Date().getDay());
  const [chain, setChain] = useState('الكل');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!coordId && coordinators.length) setCoordId(coordinators[0].id);
  }, [coordinators.length]);

  // Reset the working set whenever the coordinator/day changes.
  useEffect(() => {
    if (!coordId) return;
    setSelected(new Set(
      routes.filter((r) => r.coordinator_id === coordId && r.weekday === day).map((r) => r.outlet_id),
    ));
  }, [coordId, day, routes]);

  const chains = useMemo(() => ['الكل', ...new Set(outlets.map((o) => o.chain))], [outlets]);
  const needle = q.trim();
  const list = outlets.filter(
    (o) => (chain === 'الكل' || o.chain === chain) && (!needle || (o.name + o.chain).includes(needle)),
  );

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const save = async () => {
    if (!coordId) return;
    setErr(null);
    // Replace the whole day: delete then insert. RLS grants mgmt/router both.
    const del = await sb.from('routes').delete().eq('coordinator_id', coordId).eq('weekday', day);
    if (del.error) { setErr(errText(del.error)); return; }

    if (selected.size > 0) {
      const ins = await sb.from('routes').insert(
        [...selected].map((outlet_id) => ({ coordinator_id: coordId, weekday: day, outlet_id })),
      );
      if (ins.error) { setErr(errText(ins.error)); return; }
    }
    toast(`اتحفظ خط ${DAY_LABELS[day]}`);
    await reloadRef();
  };

  if (coordinators.length === 0) return <Empty>ضيف منسقين الأول من تبويب الفريق</Empty>;

  return (
    <>
      <Field label="المنسق">
        <select value={coordId} onChange={(e) => setCoordId(e.target.value)}>
          {coordinators.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      </Field>

      <div className="day-tabs">
        {DAY_ORDER.map((d) => (
          <button key={d} className={d === day ? 'on' : ''} onClick={() => setDay(d)}>
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>

      <Hint>مختار: <b>{selected.size}</b> فرع لليوم ده</Hint>

      <Segmented options={chains} value={chain} onChange={setChain} />
      <Field label="بحث بالاسم">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الفرع" />
      </Field>

      <ErrLine>{err}</ErrLine>

      <div style={{ maxHeight: 360, overflow: 'auto', marginBottom: 10 }}>
        {list.length === 0 && <Empty>لا نتائج</Empty>}
        {list.map((o) => (
          <button
            key={o.id}
            className={`rowbtn ${selected.has(o.id) ? 'ok' : ''}`}
            onClick={() => toggle(o.id)}
          >
            <span>
              <span className="nm">{o.name}</span>
              <span className="sub">{o.chain} · {o.gov}</span>
            </span>
            {selected.has(o.id) && <Pill tone="g">بالخط</Pill>}
          </button>
        ))}
      </div>

      <ActionButton className="send okbtn" onClick={save}>حفظ خط {DAY_LABELS[day]}</ActionButton>
    </>
  );
}
