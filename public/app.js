const $ = selector => document.querySelector(selector);
const app = $('#app');
const loginView = $('#login-view');
const editor = $('#editor');
let items = [];
let editing = null;
let filter = 'all';
let category = 'All';
let subcategory = 'All';
let config = {};

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  let data = {};
  try { data = await response.json(); } catch { /* graceful handling */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

function showLogin() { clearShortcutKey(); $('#shortcut-setup').close(); app.hidden = true; loginView.hidden = false; $('#logout').hidden = true; $('#open-settings').hidden = true; $('#settings').close(); }
function showApp() { app.hidden = false; loginView.hidden = true; $('#logout').hidden = false; $('#open-settings').hidden = false; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 4800); }
function money(price, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price); }
  catch { return `${price} ${currency || ''}`; }
}
function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value != null) el.textContent = value;
  return el;
}
function action(label, callback, className = '') {
  const button = node('button', className, label);
  button.type = 'button'; button.addEventListener('click', callback); return button;
}

function card(item) {
  const article = node('article', 'card');
  article.dataset.itemId = item.id;
  const visual = node('a', 'visual');
  visual.href = item.url; visual.target = '_blank'; visual.rel = 'noopener noreferrer';
  visual.setAttribute('aria-label', 'Open ' + item.title);
  const missingPreview = () => {
    visual.classList.add('preview-missing');
    visual.replaceChildren(node('span', 'preview-label', 'Preview unavailable · Open product ↗'));
  };
  if (item.image) {
    const img = node('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy';
    img.onerror = missingPreview;
    visual.append(img);
  } else missingPreview();
  article.append(visual);
  const body = node('div', 'card-body');
  body.append(node('div', 'merchant', new URL(item.url).hostname.replace(/^www\./, '')));
  body.append(node('div', 'category-tag', `${item.category || 'Other'} · ${item.subcategory || 'Other'}`));
  const heading = node('h3');
  const titleLink = node('a', 'product-link', item.title);
  titleLink.href = item.url; titleLink.target = '_blank'; titleLink.rel = 'noopener noreferrer';
  heading.append(titleLink); body.append(heading);
  const prices = node('div', 'prices');
  if (item.price != null && item.currency) {
    prices.append(node('span', 'price', money(item.price, item.currency)));
    prices.append(node('span', 'muted', 'Last observed price'));
    if (item.baseline_price != null && item.price < item.baseline_price) {
      const drop = Math.floor((1 - item.price / item.baseline_price) * 100 + 1e-8);
      prices.append(node('span', 'watch', drop + '% below starting price'));
    }
  } else prices.append(node('span', 'muted', 'Waiting for a price'));
  body.append(prices);
  const watching = item.watch_enabled !== 0;
  body.append(node('p', 'watch-status', watching
    ? (item.price == null ? 'Watching · Waiting for a readable price' : 'Watching · Alert at 20% off')
    : 'Watching stopped'));
  if (watching && item.baseline_price != null && item.currency) body.append(node('p', 'fine',
    'Starting price ' + money(item.baseline_price, item.currency) + ' · Alert at ' + money(Math.floor(item.baseline_price * 80) / 100, item.currency) + ' or less'));
  if (item.note) body.append(node('p', 'note', `“${item.note}”`));
  if (item.observed_at) body.append(node('p', 'fine', `Price checked ${new Date(item.observed_at).toLocaleDateString()}. Confirm at the store.`));
  const actions = node('div', 'card-actions');
  const visit = node('a', '', 'View ↗'); visit.href = item.url; visit.target = '_blank'; visit.rel = 'noopener noreferrer';
  actions.append(visit, action('Share ↗', () => share(item)), action('Edit', () => openEditor(item)), action('Remove', () => remove(item), 'delete'));
  body.append(actions);
  const watchButton = action(watching ? 'Stop watching' : 'Resume watching', async () => {
    watchButton.disabled = true;
    try { await request('/api/items/' + item.id, { method: 'PATCH', body: JSON.stringify({ watch_enabled: !watching }) });
      await load(); toast(watching ? 'Watching stopped. Product kept in your collection.' : 'Watching for a 20% drop.');
    } catch (error) { toast(error.message); watchButton.disabled = false; }
  }, 'subtle');
  const tools = node('div', 'product-tools'); tools.append(watchButton);
  const retry = action('Refresh details', async () => {
    retry.disabled = true; retry.textContent = 'Checking…';
    try { const result = await request('/api/items/' + item.id + '/preview', { method: 'POST', body: '{}' });
      await load(); toast(result.message);
    } catch (error) { toast(error.message); }
    finally { retry.disabled = false; retry.textContent = 'Refresh details'; }
  }, 'subtle preview-retry');
  tools.append(retry); body.append(tools); article.append(body); return article;
}

function render() {
  $('#count').textContent = items.length ? `(${items.length})` : '';
  if (category !== 'All' && !items.some(i => i.category === category)) { category = 'All'; subcategory = 'All'; }
  const categories = ['All', ...Object.keys(config.categories || {}).filter(name => items.some(i => i.category === name))];
  $('#category-filters').replaceChildren(...categories.map(name => {
    const count = name === 'All' ? items.length : items.filter(i => i.category === name).length;
    const button = action(`${name} (${count})`, () => { category = name; subcategory = 'All'; render(); }, `filter${category === name ? ' active' : ''}`);
    button.setAttribute('aria-pressed', String(category === name)); return button;
  }));
  const subs = category === 'All' ? [] : [...new Set(items.filter(i => i.category === category).map(i => i.subcategory || 'Other'))];
  $('#subcategory-filters').hidden = !subs.length;
  $('#subcategory-filters').replaceChildren(...['All', ...subs].map(name => {
    const button = action(name, () => { subcategory = name; render(); }, `filter${subcategory === name ? ' active' : ''}`);
    button.setAttribute('aria-pressed', String(subcategory === name)); return button;
  }));
  const search = $('#collection-search').value.trim().toLocaleLowerCase();
  const visible = items.filter(i =>
    (category === 'All' || i.category === category) &&
    (subcategory === 'All' || i.subcategory === subcategory) &&
    (filter === 'all' || filter === 'drops' && i.price != null && i.baseline_price != null && i.price < i.baseline_price || filter === 'unpriced' && i.price == null) &&
    (!search || [i.title, i.description, i.note, i.url].some(value => String(value || '').toLocaleLowerCase().includes(search))));
  const counts = { all: items.length, drops: items.filter(i => i.price != null && i.baseline_price != null && i.price < i.baseline_price).length, unpriced: items.filter(i => i.price == null).length };
  const labels = { all: 'All saved', drops: 'Price drops', unpriced: 'Waiting for price' };
  document.querySelectorAll('.status-filters .filter').forEach(button => {
    button.textContent = labels[button.dataset.filter] + ' (' + counts[button.dataset.filter] + ')';
    button.setAttribute('aria-pressed', String(filter === button.dataset.filter));
  });
  $('#items').replaceChildren(...visible.map(card));
  $('#empty').hidden = items.length !== 0 || filter !== 'all';
  if (!visible.length && (items.length || filter !== 'all')) $('#items').append(node('p', 'empty-filter',
    filter === 'drops' ? 'No price drops yet. We check watched products daily.' :
    filter === 'unpriced' ? 'No products are waiting for a price in this view.' : 'No products match. Try another category or search.'));
}

async function load() {
  try {
    const [list, settings] = await Promise.all([request('/api/items'), request('/api/config')]);
    items = list.items; config = settings; render(); showApp();
    $('#saving-onboarding').hidden = config.savingSetupComplete;
    updatePushUI();
    $('#assistant-section').hidden = !config.assistant;
    const shared = new URL(location.href).searchParams.get('url');
    if (shared && !editor.open) { openEditor(null, shared); history.replaceState(null, '', '/'); }
    const highlighted = new URL(location.href).searchParams.get('item');
    if (highlighted && items.some(item => item.id === highlighted)) {
      category = 'All'; subcategory = 'All'; filter = 'all'; $('#collection-search').value = '';
      document.querySelectorAll('.status-filters .filter').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
      render();
      requestAnimationFrame(() => document.querySelectorAll('[data-item-id]').forEach(card => {
        if (card.dataset.itemId === highlighted) { card.scrollIntoView({ block: 'center' }); card.classList.add('highlighted'); }
      }));
      history.replaceState(null, '', '/');
    }
  } catch (error) { if (error.message !== 'Sign in to see your saved items.') toast(error.message); }
}

async function updatePushUI() {
  const status = $('#push-status');
  $('#notification-nudge').hidden = false;
  $('#enable-push').hidden = true; $('#disable-push').hidden = true;
  if (!config.alerts) { status.textContent = 'Phone alerts need push keys on the server before you can turn them on.'; return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status.textContent = 'On iPhone, add this site to your Home Screen from Safari or Chrome, then open it there to enable alerts.';
    return;
  }
  if (Notification.permission === 'denied') {
    status.textContent = 'Notifications are blocked. Allow them in your phone settings to receive price alerts.'; return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    $('#notification-nudge').hidden = Boolean(subscription);
    status.textContent = subscription ? 'Price alerts are on for this phone.' : 'Turn on notifications so price drops appear on your phone.';
    $('#enable-push').hidden = Boolean(subscription);
    $('#disable-push').hidden = !subscription;
  } catch { status.textContent = 'Could not check notifications on this phone. Try refreshing.'; }
}

function publicKeyBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function enablePush() {
  const button = $('#enable-push'); button.disabled = true;
  try {
    // Permission must be requested directly from this tap, especially on iPhone.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { await updatePushUI(); return; }
    const registration = await navigator.serviceWorker.register('/sw.js');
    const ready = await navigator.serviceWorker.ready;
    const subscription = await ready.pushManager.getSubscription() ||
      await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.pushPublicKey) });
    await request('/api/push-subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
    await updatePushUI(); toast('Phone alerts enabled. You can now watch a price.');
  } catch (error) { toast(error.message || 'Could not enable phone alerts.'); }
  finally { button.disabled = false; }
}

async function disablePush() {
  const button = $('#disable-push'); button.disabled = true;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await request('/api/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
    }
    await updatePushUI(); toast('Alerts turned off on this phone.');
  } catch (error) { toast(error.message || 'Could not turn off alerts.'); }
  finally { button.disabled = false; }
}

function openEditor(item = null, importedUrl = '') {
  editing = item?.id || null;
  $('#editor-form').reset();
  $('#form-error').textContent = '';
  $('#dialog-label').textContent = editing ? 'EDIT THIS FIND' : 'A NEW FIND';
  $('#dialog-title').textContent = editing ? 'The details matter.' : 'Keep it in mind.';
  $('#product-url').value = item?.url || importedUrl;
  $('#product-url').readOnly = Boolean(editing);
  $('#product-title').value = item?.title || '';
  $('#product-title').required = Boolean(editing);
  $('#product-note').value = item?.note || '';
  $('#category-editor').hidden = !editing;
  if (editing) {
    $('#product-category').replaceChildren(...Object.keys(config.categories || {}).map(name => node('option', '', name)));
    $('#product-category').value = item.category || 'Other';
    fillSubcategories(item.subcategory);
  }
  $('#product-watch').checked = item?.watch_enabled !== 0;
  $('#save-button').textContent = editing ? 'Save changes ↗' : 'Save this find ↗';
  editor.showModal();
  if (!importedUrl) $('#product-url').focus();
}
function closeEditor() { editor.close(); editing = null; }
function fillSubcategories(selected = 'Other') {
  const options = config.categories?.[$('#product-category').value] || ['Other'];
  $('#product-subcategory').replaceChildren(...options.map(name => node('option', '', name)));
  $('#product-subcategory').value = options.includes(selected) ? selected : options[0];
}

async function share(item) {
  const data = { title: item.title, text: `Thought you might like this: ${item.title}`, url: item.url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(`${item.title} — ${item.url}`);
    toast('Link copied. Paste it into WhatsApp, Messages, or Messenger.');
  } catch (error) { if (error.name !== 'AbortError') toast('Could not share the link. Try copying it from the store page.'); }
}

async function remove(item) {
  if (!confirm(`Remove “${item.title}” from your edit?`)) return;
  try { await request(`/api/items/${item.id}`, { method: 'DELETE' }); items = items.filter(i => i.id !== item.id); render(); toast('Removed from your edit.'); }
  catch (error) { toast(error.message); }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  try { await request('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; await load(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await request('/api/logout', { method: 'POST', body: '{}' }); items = []; showLogin(); });
$('#open-add').addEventListener('click', () => openEditor());
$('#empty-add').addEventListener('click', openShortcut);
$('#open-shortcut').addEventListener('click', openShortcut);
$('#onboarding-setup').addEventListener('click', openShortcut);
$('#open-settings').addEventListener('click', () => { $('#settings').showModal(); updatePushUI(); });
$('#notification-settings').addEventListener('click', () => { $('#settings').showModal(); updatePushUI(); });
$('#close-settings').addEventListener('click', () => $('#settings').close());
$('#complete-setup').addEventListener('click', async () => {
  try { await request('/api/saving-setup', { method: 'POST', body: '{}' }); $('#saving-onboarding').hidden = true; }
  catch (error) { toast(error.message); }
});
$('#close-dialog').addEventListener('click', closeEditor);
$('#refresh').addEventListener('click', load);
$('#enable-push').addEventListener('click', enablePush);
$('#disable-push').addEventListener('click', disablePush);
$('#collection-search').addEventListener('input', render);
$('#product-category').addEventListener('change', () => fillSubcategories());
document.querySelectorAll('.status-filters .filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('.status-filters .filter').forEach(b => b.classList.toggle('active', b === button)); render();
}));
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-button'); button.disabled = true; button.textContent = 'Saving…';
  $('#form-error').textContent = '';
  const payload = { url: $('#product-url').value, title: $('#product-title').value, note: $('#product-note').value, watch_enabled: $('#product-watch').checked };
  if (editing) {
    const original = items.find(item => item.id === editing);
    if (original && (original.category !== $('#product-category').value || original.subcategory !== $('#product-subcategory').value))
      Object.assign(payload, { category: $('#product-category').value, subcategory: $('#product-subcategory').value });
  }
  try {
    const result = editing
      ? await request(`/api/items/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await request('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    closeEditor(); await load(); toast(result.warning || (result.existing ? 'Already in your edit.' : 'Saved to your edit.'));

  } catch (error) { $('#form-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = editing ? 'Save changes ↗' : 'Save this find ↗'; }
});
$('#ask-form').addEventListener('submit', async event => {
  event.preventDefault(); const answer = $('#answer'); answer.hidden = false; answer.textContent = 'Thinking through your edit…';
  try { answer.textContent = (await request('/api/ask', { method: 'POST', body: JSON.stringify({ question: $('#question').value }) })).answer; }
  catch (error) { answer.textContent = error.message; }
});
let shortcutEnabled = false;
function clearShortcutKey() { $('#shortcut-key').value = ''; $('#shortcut-key-panel').hidden = true; }
function shortcutStatus() {
  $('#shortcut-key-status').textContent = shortcutEnabled ? 'A saving key is active. Keep using it, or replace it to set up again.' : 'No saving key is active yet.';
  $('#create-shortcut-key').textContent = shortcutEnabled ? 'Replace saving key' : 'Create saving key';
  $('#revoke-shortcut-key').hidden = !shortcutEnabled;
}
async function openShortcut() {
  $('#settings').close();
  clearShortcutKey(); $('#shortcut-error').textContent = '';
  $('#shortcut-endpoint').textContent = location.origin + '/api/capture';
  $('#shortcut-setup').showModal();
  try { shortcutEnabled = (await request('/api/shortcut-token')).enabled; shortcutStatus(); }
  catch (error) { $('#shortcut-error').textContent = error.message; }
}
$('#close-shortcut').addEventListener('click', () => $('#shortcut-setup').close());
$('#shortcut-setup').addEventListener('close', clearShortcutKey);
$('#create-shortcut-key').addEventListener('click', async () => {
  if (shortcutEnabled && !confirm('Replace the saving key? Update any existing Shortcut with the new key afterward.')) return;
  const button = $('#create-shortcut-key'); button.disabled = true; $('#shortcut-error').textContent = '';
  try {
    const result = await request('/api/shortcut-token', { method: 'POST', body: '{}' });
    $('#shortcut-key').value = result.token; $('#shortcut-key-panel').hidden = false;
    shortcutEnabled = true; shortcutStatus();
  } catch (error) { $('#shortcut-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#revoke-shortcut-key').addEventListener('click', async () => {
  if (!confirm('Disable saving from your existing Shortcut? Your saved finds will stay.')) return;
  try {
    await request('/api/shortcut-token', { method: 'DELETE' });
    clearShortcutKey(); shortcutEnabled = false; shortcutStatus();
  } catch (error) { $('#shortcut-error').textContent = error.message; }
});
async function copySetup(value) {
  try { await navigator.clipboard.writeText(value); toast('Copied. Paste it into Shortcuts.'); }
  catch { $('#shortcut-error').textContent = 'Clipboard access failed. Allow clipboard access and try again.'; }
}
$('#copy-shortcut-key').addEventListener('click', () => copySetup('Bearer ' + $('#shortcut-key').value));
$('#copy-shortcut-endpoint').addEventListener('click', () => copySetup(location.origin + '/api/capture'));
load();
