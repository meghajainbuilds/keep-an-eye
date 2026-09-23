const $ = selector => document.querySelector(selector);
const app = $('#app');
const loginView = $('#login-view');
const editor = $('#editor');
let items = [];
let editing = null;
let filter = 'all';
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

function showLogin() { app.hidden = true; loginView.hidden = false; $('#logout').hidden = true; }
function showApp() { app.hidden = false; loginView.hidden = true; $('#logout').hidden = false; }
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
  const visual = node('div', 'visual');
  if (item.image) {
    const img = node('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy';
    img.onerror = () => { visual.replaceChildren(node('span', 'placeholder', '◉')); };
    visual.append(img);
  } else visual.append(node('span', 'placeholder', '◉'));
  article.append(visual);
  const body = node('div', 'card-body');
  body.append(node('div', 'merchant', new URL(item.url).hostname.replace(/^www\./, '')));
  body.append(node('h3', '', item.title));
  const prices = node('div', 'prices');
  if (item.price != null && item.currency) {
    prices.append(node('span', 'price', money(item.price, item.currency)));
    if (item.target_price != null) prices.append(node('span', 'watch', `Watching ${money(item.target_price, item.currency)}`));
    if (item.discount_percent != null) prices.append(node('span', 'watch', `${item.discount_percent}% drop`));
    else prices.append(node('span', 'muted', 'Last observed price'));
  } else {
    prices.append(node('span', 'muted', 'Price not available'));
    if (item.target_price != null || item.discount_percent != null) prices.append(node('span', 'watch', 'Watching, awaiting price'));
  }
  body.append(prices);
  if (item.note) body.append(node('p', 'note', `“${item.note}”`));
  if (item.observed_at) body.append(node('p', 'fine', `Price checked ${new Date(item.observed_at).toLocaleDateString()}. Confirm at the store.`));
  const actions = node('div', 'card-actions');
  const visit = node('a', '', 'View ↗'); visit.href = item.url; visit.target = '_blank'; visit.rel = 'noopener noreferrer';
  actions.append(visit, action('Share ↗', () => share(item)), action('Edit', () => openEditor(item)), action('Remove', () => remove(item), 'delete'));
  body.append(actions); article.append(body); return article;
}

function render() {
  $('#count').textContent = items.length ? `(${items.length})` : '';
  const visible = items.filter(i => filter === 'all' || filter === 'watching' && (i.target_price != null || i.discount_percent != null) || filter === 'unpriced' && i.price == null);
  $('#items').replaceChildren(...visible.map(card));
  $('#empty').hidden = items.length !== 0 || filter !== 'all';
  if (items.length && !visible.length) $('#items').append(node('p', 'muted', 'Nothing here yet. Try another filter.'));
}

async function load() {
  try {
    const [list, settings] = await Promise.all([request('/api/items'), request('/api/config')]);
    items = list.items; config = settings; render(); showApp();
    if (!config.assistant) { $('#ask-form').hidden = true; $('#ai-note').textContent = 'Set OPENAI_API_KEY on your server to turn on the shopping assistant.'; }
    else { $('#ask-form').hidden = false; $('#ai-note').textContent = 'A quiet second opinion, grounded in your saved finds.'; }
    const shared = new URL(location.href).searchParams.get('url');
    if (shared && !editor.open) { openEditor(null, shared); history.replaceState(null, '', '/'); }
  } catch (error) { if (error.message !== 'Sign in to see your saved items.') toast(error.message); }
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
  $('#product-target').value = item?.target_price ?? '';
  $('#product-discount').value = item?.discount_percent ?? '';
  $('#currency-hint').textContent = item?.currency ? `(${item.currency}, absolute price)` : '(absolute price, optional)';
  $('#save-button').textContent = editing ? 'Save changes ↗' : 'Save this find ↗';
  editor.showModal();
  if (!importedUrl) $('#product-url').focus();
}
function closeEditor() { editor.close(); editing = null; }

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
$('#empty-add').addEventListener('click', () => openEditor());
$('#close-dialog').addEventListener('click', closeEditor);
$('#refresh').addEventListener('click', load);
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === button)); render();
}));
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-button'); button.disabled = true; button.textContent = 'Saving…';
  $('#form-error').textContent = '';
  const payload = { url: $('#product-url').value, title: $('#product-title').value, note: $('#product-note').value, target_price: $('#product-target').value, discount_percent: $('#product-discount').value };
  try {
    const result = editing
      ? await request(`/api/items/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await request('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    closeEditor(); await load(); toast(result.warning || (result.existing ? 'Already in your edit.' : 'Saved to your edit.'));
    if (!config.alerts && (payload.target_price || payload.discount_percent)) toast('Saved the alert. Configure email and daily checks to receive it.');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = editing ? 'Save changes ↗' : 'Save this find ↗'; }
});
$('#ask-form').addEventListener('submit', async event => {
  event.preventDefault(); const answer = $('#answer'); answer.hidden = false; answer.textContent = 'Thinking through your edit…';
  try { answer.textContent = (await request('/api/ask', { method: 'POST', body: JSON.stringify({ question: $('#question').value }) })).answer; }
  catch (error) { answer.textContent = error.message; }
});
load();
