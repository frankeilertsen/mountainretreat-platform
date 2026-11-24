import { NextResponse } from 'next/server';

/**
 * Redirect to a path on this site with a relative Location header.
 * Behind Render's proxy, req.url is the internal address (http://localhost:10000), so absolute
 * redirects built from it send the browser to localhost. A relative Location is resolved by the
 * browser against the address it is actually on (onrender.com or mountainretreat.no).
 */
export function redirectTo(path: string, status: 302 | 303 | 307 = 307): NextResponse {
  if (!path.startsWith('/') || path.startsWith('//')) path = '/';
  return new NextResponse(null, { status, headers: { Location: path } });
}

/** The host the visitor actually used (proxy-aware). */
export function publicHost(headers: Headers): string | null {
  return (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',')[0].trim().toLowerCase() ?? null;
}
