'use strict';
/* Núcleo: API, utilitários, modais, formulários, router */
const App = { user: null, L: null, routes: {}, current: null };

// ---------- utilitários ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pad = n => String(n).padStart(2, '0');
function isoDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
function fmtDate(s) { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : s; }
function fmtDT(s) { if (!s) return ''; return `${fmtDate(s)} ${String(s).slice(11, 16)}`; }
function fmtTime(s) { return s ? String(s).slice(11, 16) : ''; }
function eur(n) { return (Number(n) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); }
function num(n, d = 2) { return (Number(n) || 0).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: d }); }
function idade(dn) {
  if (!dn) return '';
  const b = new Date(dn + 'T12:00:00'), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_C = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function dataLonga(iso) { const d = new Date(iso + 'T12:00:00'); return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; }
function byId(list, id) { return (list || []).find(x => String(x.id) === String(id)); }
function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- API ----------
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api/' + url.replace(/^\//, ''), opt);
  if (r.status === 401 && !url.startsWith('login')) { showLogin(); throw new Error('Sessão expirada'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((data && data.erro) || `Erro ${r.status}`); e.status = r.status; throw e; }
  return data;
}
const GET = u => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b || {}), DEL = u => api('DELETE', u);

async function refreshLookups() { App.L = await GET('lookups'); return App.L; }
const L = () => App.L;
const ativos = list => (list || []).filter(x => x.ativo);

// ---------- toasts ----------
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}
// executa uma ação mostrando o erro se falhar
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); throw e; }
}

// ---------- modais ----------
function modal({ title, body = '', size = '', buttons = [], onOpen }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}"><header><h2>${esc(title)}</h2><button class="ghost" data-x>✕</button></header>
    <div class="body"></div><footer></footer></div>`;
  const bodyEl = $('.body', bg);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = $('footer', bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && document.body.lastElementChild === bg) close(); };
  document.addEventListener('keydown', onKey);
  const ctx = { el: bg, body: bodyEl, close };
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label; btn.className = b.cls || '';
    if (b.left) btn.style.marginRight = 'auto';
    btn.onclick = async () => {
      if (!b.onClick) return close();
      btn.disabled = true;
      try { const r = await b.onClick(ctx); if (r !== false) close(); }
      catch (e) { toast(e.message, true); }
      finally { btn.disabled = false; }
    };
    foot.appendChild(btn);
  }
  if (!buttons.length) foot.remove();
  $('[data-x]', bg).onclick = close;
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.dataset.down = '1'; });
  bg.addEventListener('mouseup', e => { if (e.target === bg && bg.dataset.down) close(); delete bg.dataset.down; });
  document.body.appendChild(bg);
  if (onOpen) onOpen(ctx);
  const first = $('input:not([type=hidden]):not([readonly]), select, textarea', bodyEl);
  if (first) setTimeout(() => first.focus(), 30);
  return ctx;
}
function confirmDlg(msg, okLabel = 'Confirmar', danger = false) {
  return new Promise(res => {
    modal({ title: 'Confirmação', size: 'sm', body: `<p>${esc(msg)}</p>`,
      buttons: [{ label: 'Cancelar', onClick: () => res(false) }, { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => res(true) }] });
  });
}
function promptDlg(title, label, value = '') {
  return new Promise(res => {
    modal({ title, size: 'sm', body: `<div class="field"><label class="f">${esc(label)}</label><input id="pd" value="${esc(value)}"></div>`,
      buttons: [{ label: 'Cancelar', onClick: () => res(null) }, { label: 'OK', cls: 'primary', onClick: c => res($('#pd', c.body).value) }] });
  });
}

// ---------- formulários ----------
function opts(list, value, { label = 'nome', empty = null, only = null } = {}) {
  let h = empty !== null ? `<option value="">${esc(empty)}</option>` : '';
  for (const o of list || []) {
    if (only && !only(o) && String(o.id) !== String(value)) continue;
    const lbl = typeof label === 'function' ? label(o) : o[label];
    h += `<option value="${esc(o.id)}" ${String(o.id) === String(value ?? '') ? 'selected' : ''}>${esc(lbl)}</option>`;
  }
  return h;
}
function optsArr(arr, value) { // arr: [[valor, rótulo]] ou ['valor']
  return arr.map(a => { const [v, l] = Array.isArray(a) ? a : [a, a]; return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
}
function fld(label, input, cls = '') { return `<div class="field ${cls}"><label class="f">${esc(label)}</label>${input}</div>`; }
function inp(name, value, attrs = '') { return `<input name="${name}" value="${esc(value ?? '')}" ${attrs}>`; }
function sel(name, optionsHtml, attrs = '') { return `<select name="${name}" ${attrs}>${optionsHtml}</select>`; }
function txt(name, value, attrs = '') { return `<textarea name="${name}" ${attrs}>${esc(value ?? '')}</textarea>`; }
function chk(name, checked, label) { return `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${esc(label)}</label>`; }
function readForm(el) {
  const o = {};
  for (const i of $$('input[name], select[name], textarea[name]', el)) {
    if (i.type === 'checkbox') o[i.name] = i.checked ? 1 : 0;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else if (i.type === 'number') o[i.name] = i.value === '' ? null : Number(i.value);
    else o[i.name] = i.value;
  }
  return o;
}

// ---------- tabelas ----------
// cols: [{h: 'Título', f: r => html, cls: 'right'}]
function table(rows, cols, { onClick, empty = 'Sem registos', rowCls, foot } = {}) {
  if (!rows || !rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const id = 't' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const t = document.getElementById(id); if (!t || !onClick) return;
    t.addEventListener('click', e => {
      if (e.target.closest('button, a, input, select')) return;
      const tr = e.target.closest('tr[data-i]'); if (tr) onClick(rows[Number(tr.dataset.i)], e);
    });
  });
  return `<table class="t" id="${id}"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${onClick ? 'click' : ''} ${rowCls ? rowCls(r) : ''}">${cols.map(c => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table>`;
}

function downloadCSV(nome, rows, cols) {
  const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const q = s => `"${strip(s).replace(/"/g, '""')}"`;
  const lines = [cols.map(c => q(c.h)).join(';'), ...rows.map(r => cols.map(c => q(c.csv ? c.csv(r) : c.f(r))).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function printHTML(html) {
  $('#print-area').innerHTML = html;
  setTimeout(() => window.print(), 50);
}
function cabecalhoClinica() {
  const c = L().config;
  return `<div><div style="font-size:18px;font-weight:700">${esc(c.clinica_nome)}</div><div>${esc(c.clinica_morada)}</div><div>${esc(c.clinica_cp)}</div>
    <div>NIF ${esc(c.clinica_nif)} · Tel. ${esc(c.clinica_telefone)} · ${esc(c.clinica_email)}</div>${c.clinica_ers ? `<div>ERS n.º ${esc(c.clinica_ers)}</div>` : ''}</div>`;
}

// ---------- seletor de paciente (autocomplete) ----------
function patientPicker(input, onSelect) {
  const wrap = input.parentElement; wrap.classList.add('ac');
  let list = null, items = [], idx = -1;
  const close = () => { if (list) list.remove(); list = null; idx = -1; };
  const render = () => {
    close();
    list = document.createElement('div'); list.className = 'ac-list';
    if (!items.length) list.innerHTML = '<div class="muted">Sem resultados</div>';
    items.forEach((p, i) => {
      const d = document.createElement('div');
      d.innerHTML = `<b>${esc(p.nome)}</b> <span class="muted small">n.º ${esc(p.numero)}${p.nif ? ' · NIF ' + esc(p.nif) : ''}${p.telemovel ? ' · ' + esc(p.telemovel) : ''}</span>`;
      d.onmousedown = e => { e.preventDefault(); choose(i); };
      list.appendChild(d);
    });
    wrap.appendChild(list);
  };
  const choose = i => { const p = items[i]; if (!p) return; close(); onSelect(p); };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return close();
    items = await GET('pacientes?limit=15&q=' + encodeURIComponent(q)); render();
  }, 200);
  input.addEventListener('input', search);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (!list) return;
    const els = $$('div', list);
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(idx < 0 ? 0 : idx); return; }
    else if (e.key === 'Escape') return close();
    els.forEach((el, i) => el.classList.toggle('sel', i === idx));
  });
}
// campo de paciente com valor escondido
function pacField(name, pid, pnome, label = 'Paciente') {
  return fld(label, `<input type="hidden" name="${name}" value="${esc(pid ?? '')}"><input data-pac="${name}" value="${esc(pnome ?? '')}" placeholder="Escreva para pesquisar…" autocomplete="off">`);
}
function bindPacField(root, name, onPick) {
  const vis = $(`[data-pac="${name}"]`, root), hid = $(`input[name="${name}"]`, root);
  if (!vis) return;
  patientPicker(vis, p => { hid.value = p.id; vis.value = p.nome; onPick && onPick(p); });
  vis.addEventListener('input', () => { hid.value = ''; });
}

// ---------- gráficos simples ----------
function hbars(rows, { label = 'nome', value = 'n', color, fmt = v => v } = {}) {
  if (!rows.length) return '<div class="empty">Sem dados no período</div>';
  const max = Math.max(...rows.map(r => r[value]), 1);
  return `<div class="bars">${rows.map(r => `<div class="bar"><div class="lbl" title="${esc(r[label])}">${esc(r[label])}</div>
    <div class="track"><div class="fill" style="width:${(r[value] / max) * 100}%;${color && color(r) ? 'background:' + color(r) : ''}"></div></div>
    <div class="right bold">${esc(fmt(r[value]))}</div></div>`).join('')}</div>`;
}

// ---------- router ----------
function route(name, fn) { App.routes[name] = fn; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
async function render() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const r = App.routes[name || 'inicio'] || App.routes.inicio;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === (name || 'inicio')));
  const view = $('#view');
  App.current = name;
  try { await r(view, params.map(decodeURIComponent)); }
  catch (e) { if (e.message !== 'Sessão expirada') view.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; console.error(e); }
}
window.addEventListener('hashchange', () => { $$('.modal-bg').forEach(m => m.remove()); render(); });

function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
