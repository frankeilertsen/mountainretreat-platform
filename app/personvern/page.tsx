import Link from 'next/link';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export const metadata = { title: 'Personvern' };
export const dynamic = 'force-dynamic';

export default async function Privacy() {
  const { lang, t } = await getT();
  return (
    <div className="narrow" style={{ position: 'relative' }}>
      <LangSwitch lang={lang} className="lang-corner" />
      <Link href="/" className="btn ghost small" style={{ marginBottom: 28 }}>{t.common.home}</Link>
      <span className="eyebrow">FKE Property AS</span>
      <h1>{t.privacy.title}</h1>
      {t.privacy.body.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}
