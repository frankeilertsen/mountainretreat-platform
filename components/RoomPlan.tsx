import { BED_LABELS } from '@/lib/domain/beds';

type Plan = Awaited<ReturnType<typeof import('@/lib/domain/cleaning').roomPlanForPreparation>>;

/** Visual room-by-room bed overview (used by both admin and cleaning portal). */
export function RoomPlan({ plan, doneRooms, roomAction, taskId }: { plan: Plan; doneRooms?: Set<string>; roomAction?: (f: FormData) => Promise<void>; taskId?: string }) {
  return (
    <div>
      {plan.warnings.map(w => <div key={w} className="flash err">{w}</div>)}
      {plan.rooms.map(r => {
        const done = doneRooms?.has(r.id);
        const prepare = r.beds.some(b => b.allocation);
        return (
          <div key={r.id} className={`room ${done ? 'done' : ''}`}>
            {r.photo_id && <img className="room-photo" src={`/api/photos/${r.photo_id}`} alt={r.name} loading="lazy" />}
            <div className="room-head">
              <div>
                <h3 style={{ margin: 0 }}>{r.name} {r.floor && <small className="muted">· {r.floor}</small>}</h3>
                <small className="muted">{prepare ? `${r.guestsInRoom} gjest${r.guestsInRoom === 1 ? '' : 'er'} i rommet` : 'Ingen gjester – ikke re opp'}</small>
              </div>
              {roomAction && taskId && (
                <form action={roomAction}><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="done" value={done ? '0' : '1'} />
                  <button className={`btn small ${done ? 'ok' : 'secondary'}`}>{done ? '✓ Ferdig' : 'Marker ferdig'}</button></form>
              )}
            </div>
            <div className="beds">
              {r.beds.map(b => (
                <div key={b.id} className={`bed ${b.allocation ? '' : 'unused'}`}>
                  {b.allocation && <span className="persons" title="Antall personer">{b.allocation.persons}</span>}
                  <div className="shape">{Array.from({ length: Math.min(b.sleeps, 2) }, (_, i) => <span key={i} className="pillow" />)}</div>
                  <strong style={{ fontSize: '.9rem' }}>{b.label}</strong><br />
                  <small>{BED_LABELS[b.bed_type]}{b.width_cm ? ` · ${b.width_cm}×${b.length_cm}` : ''}</small><br />
                  <small style={{ fontWeight: 600 }}>{b.allocation ? (b.bed_type === 'cot' ? 'Gjør klar barneseng' : `Re opp for ${b.allocation.persons}${b.allocation.guest_type === 'child' ? ' (barn)' : ''}`) : 'Ikke i bruk'}</small>
                </div>
              ))}
              {r.beds.length === 0 && <small className="muted">Ingen senger i dette rommet.</small>}
            </div>
            {prepare && (
              <div className="supplies">
                {r.supplies.sheets > 0 && <span>🛏 {r.supplies.sheets} sengesett</span>}
                {r.supplies.duvets > 0 && <span>{r.supplies.duvets} dyner</span>}
                {r.supplies.pillows > 0 && <span>{r.supplies.pillows} puter</span>}
                {r.supplies.towelsLarge > 0 && <span>{r.supplies.towelsLarge} store + {r.supplies.towelsSmall} små håndklær</span>}
                {r.supplies.cotSets > 0 && <span>{r.supplies.cotSets} sett barnesengtøy</span>}
              </div>
            )}
            {r.bedding_instructions && <p style={{ padding: '0 16px 12px', margin: 0, fontSize: '.88rem' }}><strong>Instruks:</strong> {r.bedding_instructions}</p>}
          </div>
        );
      })}
    </div>
  );
}
