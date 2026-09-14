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

    // Read the day's current order before destroying it. Saving is still delete-then-insert,
    // so without this the visit order the router planned is silently replaced by outlet_id
    // order the first time anyone edits the day.
    const prev = await sb
      .from('routes')
      .select('outlet_id, seq')
      .eq('coordinator_id', coordId)
      .eq('weekday', day);
    if (prev.error) { setErr(errText(prev.error)); return; }

    const prevRows = (prev.data ?? []) as { outlet_id: number; seq: number | null }[];
    const seqByOutlet = new Map(prevRows.map((r) => [r.outlet_id, r.seq]));
    // A day that was never ordered stays unordered — inventing an order here would present
    // an arbitrary outlet_id sequence to the coordinator as if someone had planned it.
    const wasOrdered = prevRows.some((r) => r.seq != null);
    let nextSeq = Math.max(0, ...prevRows.map((r) => r.seq ?? 0)) + 1;

    const del = await sb.from('routes').delete().eq('coordinator_id', coordId).eq('weekday', day);
    if (del.error) { setErr(errText(del.error)); return; }

    if (selected.size > 0) {
      const ins = await sb.from('routes').insert(
        // Outlets already on the day keep their seq; additions land after the current maximum,
        // in the order they were picked. Removals leave gaps, which sorting does not care about.
        [...selected].map((outlet_id) => ({
          coordinator_id: coordId,
          weekday: day,
          outlet_id,
          seq: wasOrdered ? seqByOutlet.get(outlet_id) ?? nextSeq++ : null,
        })),
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
