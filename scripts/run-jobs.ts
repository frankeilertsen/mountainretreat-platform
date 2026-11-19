import './load-env';
import { runAllJobs, runJob } from '../lib/jobs';
import { getPool } from '../lib/db';

// Usage: npm run jobs            (all jobs once)
//        npm run jobs -- --loop  (every 60 s; use a proper scheduler in production)
//        npm run jobs -- expire_holds
async function main() {
  const args = process.argv.slice(2);
  const loop = args.includes('--loop');
  const only = args.find(a => !a.startsWith('--'));
  do {
    const r = only ? await runJob(only) : await runAllJobs();
    console.log(new Date().toISOString(), JSON.stringify(r));
    if (loop) await new Promise(r => setTimeout(r, 60000));
  } while (loop);
  await getPool().end();
}
main().catch(e => { console.error(e); process.exit(1); });
