import Link from 'next/link';
import { q } from '@/lib/db';
import { LeaseForm } from '@/components/forms/LeaseForm';
import { issueChallenge } from '@/lib/captcha';
import { todayOslo } from '@/lib/format';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fast leie' };

export default async function LongTerm({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { lang, t } = await getT();
  const T = t.lease;
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  return (
    <main style={{ padding: 0 }}>
      <div className="narrow" style={{ maxWidth: 640 }}>
        <div className="row between" style={{ marginBottom: 28 }}>
          <Link href="/"><img src="/brand/logo-light.png" alt="Mountain Retreat" width={180} style={{ height: 'auto', display: 'block' }} /></Link>
          <div className="row"><LangSwitch lang={lang} /><Link href="/" className="btn ghost small">{t.common.home}</Link></div>
        </div>
        <span className="eyebrow">{T.eyebrow}</span>
        <h1>{T.title}</h1>
        {sp.sendt ? (
          <div className="card">
            <h3>{T.thanksTitle}</h3>
            <p className="muted">{T.thanksText}</p>
            <Link href="/" className="btn secondary">{T.backHome}</Link>
          </div>
        ) : (
          <>
            <p className="muted">{T.lead}</p>
            <LeaseForm T={T} privacy={t.common.privacy} lang={lang} props={props} minDate={todayOslo()} challenge={issueChallenge()} />
          </>
        )}
      </div>
    </main>
  );
}
