import Link from 'next/link';
export default function NotFound() {
  return <div className="narrow"><h1>Fant ikke siden</h1><p className="muted">Siden finnes ikke, eller du har ikke tilgang.</p><Link href="/" className="btn">Til forsiden</Link></div>;
}
