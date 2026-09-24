import { checkPrices } from './alerts.mjs';

// Durable queue state is stored with each item. One worker limits merchant traffic.
export function createEnrichmentQueue(store, options = {}) {
  let timer, active = false, stopped = false;
  const delays = options.delays || [10_000, 60_000, 300_000];
  function wake() {
    if (stopped || active) return;
    clearTimeout(timer);
    const pending = store.list().filter(i => i.extraction_status === 'pending');
    if (!pending.length) return;
    const due = Math.min(...pending.map(i => i.next_attempt_at ? Date.parse(i.next_attempt_at) : 0));
    timer = setTimeout(run, Math.max(0, due - Date.now())); timer.unref?.();
  }
  async function run() {
    if (stopped || active) return;
    active = true;
    try {
      const item = store.list().find(i => i.extraction_status === 'pending' && (!i.next_attempt_at || Date.parse(i.next_attempt_at) <= Date.now()));
      if (!item) return;
      await checkPrices(store, { ...options, itemId: item.id });
      let current = store.get(item.id);
      if (current && options.classify && current.category_source !== 'manual' && current.title !== new URL(current.url).hostname) {
        const category = await options.classify(current);
        const latest = store.get(item.id);
        if (latest && latest.category_source !== 'manual' && latest.note === current.note && latest.title === current.title) store.update(item.id, category);
        current = store.get(item.id);
      }
      if (!current || current.variant_id !== item.variant_id && item.variant_id) return;
      if (current.extraction_status === 'unavailable' && current.retry_count < delays.length) {
        store.update(item.id, { extraction_status: 'pending', retry_count: current.retry_count + 1,
          next_attempt_at: new Date(Date.now() + delays[current.retry_count]).toISOString() });
      } else store.update(item.id, { next_attempt_at: null });
    } finally { active = false; wake(); }
  }
  function enqueue(id) {
    if (!store.get(id)) return;
    store.update(id, { extraction_status: 'pending', retry_count: 0, next_attempt_at: null });
    wake();
  }
  wake(); // Recovers unfinished work after a deployment or restart.
  return { enqueue, stop() { stopped = true; clearTimeout(timer); } };
}
