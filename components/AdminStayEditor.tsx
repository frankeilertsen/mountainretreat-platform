import { BED_LABELS } from '@/lib/domain/beds';
import { ValueButton } from '@/components/ValueButton';
import { adminPreparationAction, sleepingPlanAction, taskNotesAction } from '@/app/actions/admin';

type Plan = { source: string; rooms: { name: string; beds: { id: string; label: string; bed_type: string; sleeps: number; allocation: { persons: number; guest_type: string; linen?: boolean } | null }[] }[] };
type Prep = { id: string; adults: number; children: number; infants: number; arrival: string | null; comment: string | null };

/**
 * Admin-only editing of the next guests for a cleaning job: number of guests, arrival time, message to the cleaner,
 * the bed setup (override of the automatic plan) and the job's own instructions. Used on the booking page and in the cleaning portal
 * (where Airbnb stays otherwise have no guest information).
 */
export function AdminStayEditor({ prep, plan, back, task }: { prep: Prep | null; plan: Plan | null; back: string; task?: { id: string; notes: string | null } }) {
  const allBeds = plan ? plan.rooms.flatMap(r => r.beds.map(bd => ({ ...bd, room: r.name }))) : [];
  return (
    <div className="card admin-stay">
      <div className="row between"><h3 style={{ margin: 0 }}>Administrator: neste gjester og senger</h3>{plan && prep && <span className="badge">{plan.source === 'admin_override' ? 'Overstyrt av admin' : plan.source === 'member' ? 'Valgt av gjesten' : 'Automatisk'}</span>}</div>
      {task && (
        <form action={taskNotesAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="back" value={back} />
          <label>Beskjed til denne vaskejobben</label>
          <div className="row" style={{ gap: 8 }}><input name="notes" defaultValue={task.notes ?? ''} placeholder="F.eks. sjekk oppvaskmaskinen, legg ut ekstra dyner" style={{ flex: 1 }} /><button className="btn secondary small">Lagre</button></div>
          <small className="muted">Vises for renholderen som 📋. Den som er tildelt jobben, får beskjed når du endrer.</small>
        </form>
      )}
      {!prep ? <p className="muted" style={{ marginTop: 12 }}>Ingen neste gjester er registrert etter denne jobben, så det er ingen senger å sette opp.</p> : <>
        <form action={adminPreparationAction} className="fields" style={{ margin: '16px 0' }}>
          <input type="hidden" name="prepId" value={prep.id} /><input type="hidden" name="back" value={back} />
          <div><label>Voksne</label><input type="number" name="adults" defaultValue={prep.adults} min={0} /></div>
          <div><label>Barn</label><input type="number" name="children" defaultValue={prep.children} min={0} /></div>
          <div><label>Spedbarn</label><input type="number" name="infants" defaultValue={prep.infants} min={0} /></div>
          <div><label>Ankomst</label><input type="time" name="arrival" defaultValue={prep.arrival ?? ''} /></div>
          <div style={{ gridColumn: '1/-1' }}><label>Beskjed om neste gjester</label><input name="comment" defaultValue={prep.comment ?? ''} placeholder="F.eks. to barn sover i køyesengen, ønsker barneseng" /></div>
          <div><button className="btn secondary small">Lagre gjester</button></div>
        </form>
        <small className="muted">Antall gjester gir en automatisk soveplan. Vil du bestemme sengene selv, bruker du «Sett opp sengene selv».</small>
        {allBeds.length > 0 && <details style={{ marginTop: 10 }} open={plan?.source === 'admin_override'}><summary>Sett opp sengene selv</summary>
          <form action={sleepingPlanAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="prepId" value={prep.id} /><input type="hidden" name="back" value={back} />
            <div className="table-wrap"><table><thead><tr><th>Seng</th><th>Personer</th><th>Hvem</th></tr></thead><tbody>{allBeds.map(bd => (
              <tr key={bd.id}><td>{bd.room}<br /><small>{bd.label} · {BED_LABELS[bd.bed_type as keyof typeof BED_LABELS] ?? bd.bed_type}</small></td>
                <td><input type="number" name={'bed_' + bd.id} min={0} max={bd.sleeps} defaultValue={bd.allocation?.persons ?? 0} style={{ width: 70 }} /></td>
                <td><select name={'type_' + bd.id} defaultValue={bd.allocation?.guest_type ?? 'adult'}><option value="adult">Voksen</option><option value="child">Barn</option><option value="infant">Spedbarn</option><option value="mixed">Blandet</option></select></td></tr>))}</tbody></table></div>
            <div className="row" style={{ marginTop: 10 }}><button className="btn small">Lagre sengeoppsett</button>{plan?.source === 'admin_override' && <ValueButton className="btn ghost small" name="reset" value="1">Tilbake til automatisk</ValueButton>}</div>
          </form>
        </details>}
      </>}
    </div>
  );
}
