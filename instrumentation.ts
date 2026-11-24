/**
 * Runs once when the server starts. On Render (RUN_JOBS_IN_PROCESS=1) it starts the background jobs
 * (e-mail queue, payment deadlines, calendar sync, reminders, bonus) every minute inside the web server.
 * On Vercel the jobs are triggered from outside via /api/cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.RUN_JOBS_IN_PROCESS === '1') {
    const { startInProcessScheduler } = await import('./lib/scheduler');
    startInProcessScheduler();
  }
}
