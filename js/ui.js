// Pequenos utilitários de interface. Todo texto vindo de dados entra por textContent (nunca innerHTML).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); appendAll(el, children); return el; }

// ---------- datas ----------
const pad = (n) => String(n).padStart(2, '0');
export function isoDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function today() { return isoDate(new Date()); }
export function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function parseISO(iso) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function diffDays(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = parseISO(iso);
  if (opts.long) return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  if (opts.short) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return d.toLocaleDateString('pt-BR');
}
export function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; }
export function fmtDist(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}
export function relDays(iso) {
  const n = diffDays(iso, today());
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

// ---------- toast ----------
let toastHost;
export function toast(msg, kind = 'info') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// ---------- folha (modal em desktop, folha inferior no celular) ----------
const stack = [];
export function sheet({ title, body, actions = [], wide = false, onClose } = {}) {
  const close = () => {
    overlay.remove();
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && stack[stack.length - 1] === api) close(); };
  const footer = actions.length ? h('div', { class: 'sheet-actions' }, actions.map((a) => a instanceof Node ? a : h('button', {
    class: `btn ${a.kind ? 'btn-' + a.kind : ''}`, type: 'button',
    onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false && !a.keepOpen) close(); },
  }, a.label))) : null;
  const panel = h('div', { class: `sheet ${wide ? 'sheet-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title || ''),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: () => close() }, '✕')),
    h('div', { class: 'sheet-body' }, body),
    footer);
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } }, panel);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  const api = { close, el: panel, body: panel.querySelector('.sheet-body') };
  stack.push(api);
  setTimeout(() => { const f = panel.querySelector('input, select, textarea'); if (f && window.matchMedia('(pointer:fine)').matches) f.focus(); }, 30);
  return api;
}

export function confirmar(texto, { ok = 'Confirmar', kind = 'primary' } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    sheet({
      title: 'Confirmar', body: h('p', {}, texto),
      actions: [
        { label: 'Cancelar', onClick: () => { decided = true; resolve(false); } },
        { label: ok, kind, onClick: () => { decided = true; resolve(true); } },
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

// ---------- formulários ----------
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}
export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)));
}
export function chip(text, cls = '') { return h('span', { class: `chip ${cls}` }, text); }

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
