/** 1–5 star picker made of radio buttons – works without JavaScript and with the keyboard. */
export function StarInput({ name, label, required, size = 'lg' }: { name: string; label: string; required?: boolean; size?: 'lg' | 'sm' }) {
  return (
    <fieldset className={`stars stars-${size}`}>
      <legend>{label}</legend>
      <div className="stars-row">
        {[5, 4, 3, 2, 1].map(n => (
          <span key={n}>
            <input type="radio" id={`${name}-${n}`} name={name} value={n} required={required && n === 5 ? true : undefined} />
            <label htmlFor={`${name}-${n}`} title={`${n}`} aria-label={`${n} / 5`}>★</label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}

export function Stars({ n, size = '1rem' }: { n: number; size?: string }) {
  return <span className="stars-static" style={{ fontSize: size }} aria-label={`${n} / 5`}>{'★'.repeat(n)}<span className="off">{'★'.repeat(5 - n)}</span></span>;
}
