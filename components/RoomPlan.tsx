import { BED_LABELS } from '@/lib/domain/beds';
import type { Lang } from '@/lib/i18n/dict';
import { cleanDict, translateWarning } from '@/lib/i18n/cleaning';

type Plan = Awaited<ReturnType<typeof import('@/lib/domain/cleaning').roomPlanForPreparation>>;

/** Visual room-by-room bed overview (used by both admin and cleaning portal). */
export function RoomPlan({ plan, doneRooms, roomAction, taskId, lang = 'no' }: { plan: Plan; doneRooms?: Set<string>; roomAction?: (f: FormData) => Promise<void>; taskId?: string; lang?: Lang }) {
  const C = cleanDict[lang].room;
  const BEDS = cleanDict[lang].beds;
  return (
    <div>
      {plan.warnings.map(w => <div key={w} className="flash err">{translateWarning(w, lang)}</div>)}
      {plan.rooms.map(r => {
        const done = doneRooms?.has(r.id);
        const prepare = r.beds.some(b => b.allocation);
        return (
          <div key={r.id} className={`room ${done ? 'done' : ''}`}>
            {r.photo_id && <img className="room-photo" src={`/api/photos/${r.photo_id}`} alt={r.name} loading="lazy" />}
            <div className="room-head">
              <div>
                <h3 style={{ margin: 0 }}>{r.name} {r.floor && <small className="muted">· {r.floor}</small>}</h3>
                <small className="muted">{prepare ? C.guestsInRoom(r.guestsInRoom) : C.empty}</small>
              </div>
              {roomAction && taskId && (
                <form action={roomAction}><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="done" value={done ? '0' : '1'} />
                  <button className={`btn small ${done ? 'ok' : 'secondary'}`}>{done ? C.done : C.markDone}</button></form>
              )}
            </div>
            <div className="beds">
              {r.beds.map(b => (
                <div key={b.id} className={`bed ${b.allocation ? '' : 'unused'}`}>
                  {b.allocation && <span className="persons" title={C.persons}>{b.allocation.persons}</span>}
                  <div className="shape">{Array.from({ length: Math.min(b.sleeps, 2) }, (_, i) => <span key={i} className="pillow" />)}</div>
                  <strong style={{ fontSize: '.9rem' }}>{b.label}</strong><br />
                  <small>{BEDS[b.bed_type] ?? BED_LABELS[b.bed_type]}{b.width_cm ? ` · ${b.width_cm}×${b.length_cm}` : ''}</small><br />
                  <small style={{ fontWeight: 600 }}>{b.allocation ? (b.allocation.linen === false ? C.ownLinen(b.allocation.persons) : b.bed_type === 'cot' ? C.makeCot : C.makeFor(b.allocation.persons, b.allocation.guest_type === 'child')) : C.unused}</small>
                </div>
              ))}
              {r.beds.length === 0 && <small className="muted">{C.noBeds}</small>}
            </div>
            {prepare && (
              <div className="supplies">
                {r.supplies.sheets > 0 && <span>🛏 {C.sheets(r.supplies.sheets)}</span>}
                {r.supplies.duvets > 0 && <span>{C.duvets(r.supplies.duvets)}</span>}
                {r.supplies.pillows > 0 && <span>{C.pillows(r.supplies.pillows)}</span>}
                {r.supplies.towelsLarge > 0 && <span>{C.towels(r.supplies.towelsLarge, r.supplies.towelsSmall)}</span>}
                {r.supplies.cotSets > 0 && <span>{C.cot(r.supplies.cotSets)}</span>}
              </div>
            )}
            {r.bedding_instructions && <p style={{ padding: '0 16px 12px', margin: 0, fontSize: '.88rem' }}><strong>{C.instructions}</strong> {r.bedding_instructions}</p>}
          </div>
        );
      })}
    </div>
  );
}
