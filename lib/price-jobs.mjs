import { checkPrices } from './alerts.mjs';
import { randomUUID } from 'node:crypto';

// One durable cursor per collection. A short scheduler request starts or joins the
// job; a restart resumes at the unfinished product without losing the remaining list.
export function createPriceJobs(store, options = {}) {
  let stopped = false, active = false, timer;
  const status = () => JSON.parse(store.getSetting('price_job') || 'null');
  const save = job => store.setSetting('price_job', JSON.stringify(job));
  const wake = () => { clearTimeout(timer); if (!stopped && !active) { timer = setTimeout(run, 0); timer.unref?.(); } };
  async function run() {
    if (stopped || active) return;
    const job = status();
    if (!job || job.state !== 'running') return;
    active = true;
    try {
      if (job.cursor < job.ids.length) {
        const result = await (options.check || checkPrices)(store, { ...options, itemId: job.ids[job.cursor], scheduled: true });
        job.checked += result.checked; job.alerted += result.alerted; job.unavailable += result.unavailable;
        job.errors += result.errors.length; job.cursor++; job.updatedAt = new Date().toISOString();
      }
      if (job.cursor >= job.ids.length) { job.state = 'completed'; job.completedAt = new Date().toISOString(); }
      save(job);
    } catch {
      job.state = 'failed'; job.updatedAt = new Date().toISOString(); save(job);
      console.error('Background price check failed; inspect authenticated job status.');
    } finally { active = false; if (!stopped && status()?.state === 'running') wake(); }
  }
  function start() {
    const existing = status();
    if (existing?.state === 'running') { wake(); return existing; }
    const job = { id: randomUUID(), state: 'running', startedAt: new Date().toISOString(),
      ids: store.list().filter(i => i.watch_enabled || i.variant_watches.some(w => w.watch_enabled)).map(i => i.id),
      cursor: 0, checked: 0, alerted: 0, unavailable: 0, errors: 0 };
    save(job); wake(); return job;
  }
  wake();
  return { start, status, stop() { stopped = true; clearTimeout(timer); } };
}

export function createPushRetries(store, notify, interval = 60_000) {
  let active = false, stopped = false;
  async function run() {
    if (active || stopped || !notify) return;
    active = true;
    try {
      for (const event of store.pendingNotifications()) {
        if (stopped) break;
        const product = store.get(event.item_id);
        const watch = event.watch_id === event.item_id ? product : store.getWatch(event.watch_id);
        if (!watch || !watch.watch_enabled) { store.resolveNotification(event.watch_id); continue; }
        // Old notifications remain in the inbox but are not sent as fresh phone alerts.
        if (Date.now() - Date.parse(event.created_at) > 86400_000) { store.resolveNotification(event.watch_id); continue; }
        try {
          await notify({ item: JSON.parse(event.payload), price: event.price, notificationId: event.id });
          store.notificationAttempt(event.id);
          if (event.watch_id === event.item_id) store.update(event.watch_id, { last_notified_at: new Date().toISOString() });
          else if (store.getWatch(event.watch_id)) store.updateWatch(event.watch_id, { last_notified_at: new Date().toISOString() });
        } catch (error) { store.notificationAttempt(event.id, error.message); }
      }
    } finally { active = false; }
  }
  const timer = setInterval(() => run().catch(() => console.error('Notification retry failed')), interval); timer.unref?.();
  return { run, stop() { stopped = true; clearInterval(timer); } };
}
