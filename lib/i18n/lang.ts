import 'server-only';
import { cookies, headers } from 'next/headers';
import { dict, Lang } from './dict';

export const LANG_COOKIE = 'mr_lang';

/** Language from the cookie; first visit falls back to the browser's language (Norwegian → no, anything else → en). */
export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (c === 'no' || c === 'en') return c;
  const al = ((await headers()).get('accept-language') ?? '').toLowerCase();
  return /^(nb|nn|no)\b/.test(al) || al === '' ? 'no' : 'en';
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: dict[lang] };
}
