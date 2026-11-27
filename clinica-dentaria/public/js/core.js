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
  let r;
  try { r = await fetch('/api/' + url.replace(/^\//, ''), opt); }
  catch (e) { if (e instanceof TypeError) throw new Error('Sem ligação ao servidor'); throw e; }
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
  const box = $('#toasts'); box.appendChild(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}
// executa uma ação mostrando o erro se falhar; o botão que a disparou fica desativado
// enquanto corre (duplo clique não cria registos repetidos)
async function act(fn, okMsg) {
  const ev = window.event, t = ev && (ev.submitter || ev.target);
  const b = t && t.closest ? t.closest('button') : null;
  const lock = b && !b.disabled; // já desativado (ex.: botão de modal): quem o desativou é que o reativa
  const tinhaFoco = lock && document.activeElement === b;
  if (lock) b.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); throw e; }
  finally {
    if (lock) b.disabled = false;
    // desativar tira o foco ao botão: devolve-o se ninguém o levou para outro lado
    if (tinhaFoco && b.isConnected && (document.activeElement === document.body || !document.activeElement)) b.focus();
  }
}

// 1.º e último nome, por grafema (emoji e acentos compostos não se partem)
function iniciais(nome) {
  const g = w => Intl.Segmenter ? [...new Intl.Segmenter('pt').segment(w)][0].segment : Array.from(w)[0];
  const ws = String(nome || '').split(/\s+/).filter(Boolean);
  return ws.filter((_, i) => i === 0 || i === ws.length - 1).map(g).join('').toUpperCase();
}

// ---------- modais ----------
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let modalSeq = 0;
// semAlteracoes: não pergunta "alterações por guardar" ao fechar (pesquisas, envios)
// semCtrlS: Ctrl+S não carrega em nenhum botão (pagamentos, documentos fiscais, envios)
// onClose: chamado sempre que o modal fecha (guardar, Cancelar, Esc, X, fundo)
function modal({ title, body = '', size = '', buttons = [], onOpen, onClose, semAlteracoes = false, semCtrlS = false }) {
  const opener = document.activeElement;
  const hid = 'mdl-h' + (++modalSeq);
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${hid}"><header><h2 id="${hid}">${esc(title)}</h2><button class="ghost icon" data-x aria-label="Fechar"><i data-ic="x"></i></button></header>
    <div class="body"></div><footer></footer></div>`;
  const bodyEl = $('.body', bg);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = $('footer', bg);
  // alterações por guardar: só contam as feitas pelo utilizador (eventos input)
  let dirty = false;
  if (!semAlteracoes) bodyEl.addEventListener('input', () => { dirty = true; });
  if (semCtrlS) bg.dataset.semCtrlS = '';
  const close = () => {
    if (!bg.isConnected) return;
    bg.remove(); document.removeEventListener('keydown', onKey);
    if (opener && opener.isConnected && opener.focus) opener.focus();
    if (onClose) onClose();
  };
  // fecho pedido pelo utilizador (Esc, X, fundo, Cancelar): confirma se há alterações
  const dismiss = async () => {
    if (dirty && !(await confirmDlg('Há alterações por guardar. Fechar sem guardar?', 'Fechar sem guardar', true))) return;
    close();
  };
  const onKey = e => {
    if (document.body.lastElementChild !== bg) return;
    if (e.key === 'Escape') { if (!e.defaultPrevented) { e.preventDefault(); dismiss(); } return; }
    if (e.key !== 'Tab') return;
    const f = $$(FOCAVEIS, bg).filter(x => x.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!bg.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  bg._close = close; bg._dirty = () => dirty;
  const ctx = { el: bg, body: bodyEl, close };
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label; btn.className = b.cls || '';
    if (b.left) btn.style.marginRight = 'auto';
    // btn._p: o Ctrl+S espera por ele para devolver o foco ao campo
    btn.onclick = () => btn._p = (async () => {
      if (!b.onClick) return dismiss();
      btn.disabled = true;
      try { const r = await b.onClick(ctx); if (r !== false) close(); }
      catch (e) { toast(e.message, true); marcarInvalido(bodyEl, e.message); }
      finally { btn.disabled = false; }
    })();
    foot.appendChild(btn);
  }
  if (!buttons.length) foot.remove();
  $('[data-x]', bg).onclick = dismiss;
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.dataset.down = '1'; });
  bg.addEventListener('mouseup', e => { if (e.target === bg && bg.dataset.down) dismiss(); delete bg.dataset.down; });
  document.body.appendChild(bg);
  if (onOpen) onOpen(ctx);
  const first = $('[autofocus]', bodyEl) || $('input:not([type=hidden]):not([readonly]), select, textarea', bodyEl);
  setTimeout(() => {
    if (!bg.isConnected || bg.contains(document.activeElement)) return;
    (first || $('footer button.primary', bg) || $('[data-x]', bg)).focus();
  }, 30);
  return ctx;
}
// erro ao guardar: o 1.º campo inválido ou obrigatório vazio fica marcado, com a mensagem por baixo e o foco (3.3.1)
// (pacField: o texto escrito não conta se o paciente não foi escolhido da lista)
function marcarInvalido(root, msg) {
  const vazio = i => !String(i.value).trim() || (i.dataset.pac && !$(`input[name="${i.dataset.pac}"]`, root)?.value);
  const f = $$('input:not([type=hidden]), select, textarea', root)
    .find(i => i.getClientRects().length && !i.disabled && (!i.checkValidity() || (i.required && vazio(i))));
  if (!f) return;
  const box = f.closest('.field') || f.parentNode;
  let er = $('.field-erro', box);
  if (!er) { er = document.createElement('div'); er.className = 'field-erro'; er.id = 'erro-' + (++fldSeq); box.appendChild(er); }
  er.textContent = msg; er.classList.remove('limpo');
  f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', er.id);
  // limpa ao editar; a linha fica reservada (visibility) para o formulário não saltar enquanto se escreve
  f.addEventListener('input', () => { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); er.classList.add('limpo'); }, { once: true });
  f.focus();
}
// Esc, X ou fundo valem como Cancelar (a promessa resolve sempre; a 1.ª resposta é a que conta)
function confirmDlg(msg, okLabel = 'Confirmar', danger = false) {
  return new Promise(res => {
    modal({ title: 'Confirmação', size: 'sm', semCtrlS: true, body: `<p>${esc(msg)}</p>`, onClose: () => res(false),
      buttons: [{ label: 'Cancelar', onClick: () => res(false) }, { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => res(true) }] });
  });
}
function promptDlg(title, label, value = '') {
  return new Promise(res => {
    modal({ title, size: 'sm', semCtrlS: true, body: `<div class="field"><label class="f" for="pd">${esc(label)}</label><input id="pd" value="${esc(value)}"></div>`, onClose: () => res(null),
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
// o rótulo fica associado ao 1.º campo (usa o id que já tenha ou gera um)
let fldSeq = 0;
function fld(label, input, cls = '') {
  let id = '';
  const html = String(input).replace(/<(input|select|textarea)\b([^>]*)>/gi, (m, tag, attrs) => {
    if (id || /\btype\s*=\s*["']?(hidden|checkbox|radio)\b/i.test(attrs)) return m;
    const ex = attrs.match(/(?:^|\s)id\s*=\s*["']([^"']+)["']/i);
    if (ex) { id = ex[1]; return m; }
    id = 'fld-' + (++fldSeq); return `<${tag} id="${id}"${attrs}>`;
  });
  return `<div class="field ${cls}"><label class="f"${id ? ` for="${esc(id)}"` : ''}>${esc(label)}</label>${html}</div>`;
}
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
// cols: [{h: 'Título', f: r => html, cls: 'right', sr: 'título só para leitores de ecrã quando h é vazio'}]
// caption: legenda da tabela, só para leitores de ecrã
function table(rows, cols, { onClick, empty = 'Sem registos', rowCls, foot, caption } = {}) {
  if (!rows || !rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const id = 't' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const t = document.getElementById(id); if (!t || !onClick) return;
    t.addEventListener('click', e => {
      if (e.target.closest('button, a, input, select')) return;
      const tr = e.target.closest('tr[data-i]'); if (tr) onClick(rows[Number(tr.dataset.i)], e);
    });
    t.addEventListener('keydown', e => {
      if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('tr[data-i]')) return;
      e.preventDefault(); onClick(rows[Number(e.target.dataset.i)], e);
    });
  });
  // coluna sem título: "Selecionar" se for de caixas de seleção, senão "Ações"
  const th = c => c.h ? esc(c.h) : `<span class="sr-only">${esc(c.sr || (/type="checkbox"/.test(c.f(rows[0])) ? 'Selecionar' : 'Ações'))}</span>`;
  return `<table class="t" id="${id}">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${th(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}"${onClick ? ' tabindex="0"' : ''} class="${onClick ? 'click' : ''} ${rowCls ? rowCls(r) : ''}">${cols.map(c => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table>`;
}

function downloadCSV(nome, rows, cols) {
  const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // ' antes de = + - @ evita que o Excel trate o texto como fórmula
  const q = s => `"${strip(s).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
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
    <div>NIF ${esc(c.clinica_nif)} · Tel. ${esc(c.clinica_telefone)} · ${esc(c.clinica_email)}</div>${c.clinica_ers ? `<div>ERS n.º ${esc(c.clinica_ers)}</div>` : ''}
    ${c.clinica_capital || c.clinica_crc ? `<div style="font-size:10px">${c.clinica_capital ? 'Capital social ' + esc(c.clinica_capital) : ''}${c.clinica_crc ? ' · CRC ' + esc(c.clinica_crc) : ''}</div>` : ''}</div>`;
}

// ---------- seletor de paciente (autocomplete) ----------
function patientPicker(input, onSelect) {
  const wrap = input.parentElement; wrap.classList.add('ac');
  const podeCriar = typeof editPaciente === 'function';
  let list = null, items = [], idx = -1, seq = 0, q = '';
  // combobox (ARIA 1.2): a lista é um listbox e a opção ativa segue as setas via aria-activedescendant
  const lid = 'ac-' + (++fldSeq);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', lid);
  const close = () => {
    if (list) list.remove(); list = null; idx = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  };
  const opt = d => { d.setAttribute('role', 'option'); d.id = `${lid}-${list.children.length}`; d.setAttribute('aria-selected', 'false'); };
  const render = () => {
    close();
    list = document.createElement('div'); list.className = 'ac-list'; list.id = lid;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Pacientes encontrados');
    if (!items.length) list.innerHTML = '<div class="muted" data-none role="option" aria-disabled="true">Sem resultados</div>';
    items.forEach((p, i) => {
      const d = document.createElement('div'); opt(d);
      d.innerHTML = `<b>${esc(p.nome)}</b> <span class="muted small">n.º ${esc(p.numero)}${p.nif ? ' · NIF ' + esc(p.nif) : ''}${p.telemovel ? ' · ' + esc(p.telemovel) : ''}</span>`;
      d.onmousedown = e => { e.preventDefault(); choose(i); };
      list.appendChild(d);
    });
    if (podeCriar) {
      const d = document.createElement('div'); opt(d);
      d.innerHTML = `<span style="color:var(--blue-ink)">+ Criar paciente «${esc(q)}»</span>`;
      d.onmousedown = e => { e.preventDefault(); choose(items.length); };
      list.appendChild(d);
    }
    wrap.appendChild(list); input.setAttribute('aria-expanded', 'true');
  };
  // abre "Novo paciente" com o nome pesquisado
  const criar = nome => editPaciente(null, p => onSelect(p), { nome });
  const choose = i => {
    if (podeCriar && i === items.length) { close(); return criar(q); }
    const p = items[i]; if (!p) return; close(); onSelect(p);
  };
  const search = debounce(async () => {
    const my = seq, v = input.value.trim();
    if (v.length < 2) return close();
    let r;
    try { r = await GET('pacientes?limit=15&q=' + encodeURIComponent(v)); }
    catch (e) { if (my === seq) toast(e.message, true); return; }
    if (my !== seq) return; // resposta antiga: entretanto o texto mudou
    items = r; q = v; render();
  }, 200);
  input.addEventListener('input', () => { seq++; search(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (!list) return;
    const els = $$('div:not([data-none])', list);
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, els.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (els.length) choose(idx < 0 ? 0 : idx); return; }
    else if (e.key === 'Escape') { e.preventDefault(); return close(); }
    els.forEach((el, i) => { el.classList.toggle('sel', i === idx); el.setAttribute('aria-selected', String(i === idx)); });
    if (els[idx]) { input.setAttribute('aria-activedescendant', els[idx].id); els[idx].scrollIntoView({ block: 'nearest' }); }
  });
}
// campo de paciente com valor escondido
function pacField(name, pid, pnome, label = 'Paciente', req = false) {
  return fld(req ? label + ' *' : label, `<input type="hidden" name="${name}" value="${esc(pid ?? '')}"><input data-pac="${name}" value="${esc(pnome ?? '')}" placeholder="Escreva para pesquisar…" autocomplete="off"${req ? ' required' : ''}>`);
}
function bindPacField(root, name, onPick) {
  const vis = $(`[data-pac="${name}"]`, root), hid = $(`input[name="${name}"]`, root);
  if (!vis) return;
  patientPicker(vis, p => { hid.value = p.id; vis.value = p.nome; onPick && onPick(p); });
  vis.addEventListener('input', () => { hid.value = ''; });
}

// ---------- ícones (SVG próprios, traço 1.6) ----------
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  tooth: 'M7.5 3.5C5 3.5 3.8 5.6 4.2 8.3c.4 2.5 1.4 3.8 1.8 6.2.5 3 1 6 2.4 6 1.6 0 1.6-5 3.6-5s2 5 3.6 5c1.4 0 1.9-3 2.4-6 .4-2.4 1.4-3.7 1.8-6.2.4-2.7-.8-4.8-3.3-4.8-1.9 0-2.6 1-4.5 1s-2.6-1-4.5-1z',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  mail: 'M3.5 6h17v12h-17zM3.5 6l8.5 7 8.5-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5.5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  key: 'M7.5 16.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zM12 12h9M18 12v3.5M21 12v2.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  x: 'M6 6l12 12M18 6 6 18',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};
function ic(name) { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`; }
function hydrateIcons(root) { for (const i of root.querySelectorAll ? root.querySelectorAll('i[data-ic]') : []) i.outerHTML = ic(i.dataset.ic); }
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('i[data-ic]')) n.outerHTML = ic(n.dataset.ic); else hydrateIcons(n); } })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => hydrateIcons(document));

// ---------- IVA ----------
function ivaLabel(v) { return v ? `${num(v.taxa)}% ${v.codigo || ''}${v.regiao && v.regiao !== 'PT' ? ' ' + v.regiao : ''}${v.isencao_cod ? ' · ' + v.isencao_cod : ''}` : ''; }
function ivaDefault() {
  const ivs = ativos(L().ivas); const reg = L().config.clinica_regiao_iva || 'PT';
  const taxa = Number(L().config.iva_default) || 0;
  return ivs.find(v => v.taxa === taxa && v.regiao === reg) || ivs.find(v => v.taxa === taxa) || ivs[0];
}
function ivaOpts(id) { return opts(L().ivas, id ?? ivaDefault()?.id, { label: ivaLabel, only: v => v.ativo }); }
// garante iva_id/iva coerentes numa linha
function ivaFix(l) {
  let v = l.iva_id ? byId(L().ivas, l.iva_id) : null;
  if (!v) v = ativos(L().ivas).find(x => x.taxa === Number(l.iva ?? NaN)) || ivaDefault();
  if (v) { l.iva_id = v.id; l.iva = v.taxa; }
  return l;
}

// ---------- gráficos simples ----------
function hbars(rows, { label = 'nome', value = 'n', color, fmt = v => v } = {}) {
  if (!rows.length) return '<div class="empty">Sem dados no período</div>';
  const max = Math.max(...rows.map(r => r[value]), 1);
  return `<div class="bars">${rows.map(r => `<div class="bar"><div class="lbl" title="${esc(r[label])}">${esc(r[label])}</div>
    <div class="track"><div class="fill" style="width:${(r[value] / max) * 100}%;${color && color(r) ? 'background:' + color(r) : ''}"></div></div>
    <div class="right bold">${esc(fmt(r[value]))}</div></div>`).join('')}</div>`;
}

// ---------- separadores de secção (links) ----------
const SEC_FAT = [['#/faturacao', 'Documentos'], ['#/orcamentos', 'Orçamentos'], ['#/faturacao/devedores', 'Saldos de pacientes'], ['#/faturacao/caixa', 'Fecho de caixa']];
const SEC_REL = [['#/listagens', 'Listagens'], ['#/estatisticas', 'Estatísticas']];
function secTabs(items, active) {
  return `<nav class="tabs" aria-label="Secção">${items.map(([h, l]) => `<a href="${h}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

// ---------- router ----------
function route(name, fn) { App.routes[name] = fn; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
let renderSeq = 0, lastHash = location.hash;
async function render() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const r = App.routes[name || 'inicio'] || App.routes.inicio;
  const sec = { orcamentos: 'faturacao', estatisticas: 'listagens', paciente: 'pacientes', consulta: 'agenda' }[name] || name || 'inicio';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === sec));
  const view = $('#view'), bar = $('#busy'), my = ++renderSeq;
  App.current = name; App.dirty = false; lastHash = location.hash;
  view.setAttribute('aria-busy', 'true');
  const t = setTimeout(() => bar && bar.classList.add('on'), 300);
  try { await r(view, params.map(decodeURIComponent)); }
  catch (e) {
    console.error(e);
    // erro de uma página que entretanto foi substituída (navegação rápida): ignora
    if (my === renderSeq && e.message !== 'Sessão expirada') view.innerHTML = `<div class="alert danger"><h1 style="font-size:inherit;margin:0">${esc(e.message)}</h1></div>`;
  }
  finally {
    clearTimeout(t);
    if (my === renderSeq) {
      view.removeAttribute('aria-busy'); if (bar) bar.classList.remove('on');
      // título do separador = título da página (2.4.2)
      const h1 = $('h1', view), clin = (App.L && App.L.config.clinica_nome) || 'Clínica';
      const tt = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
      document.title = tt ? `${tt} — ${clin}` : `${clin} — Gestão`;
    }
  }
}
// formulário da página com alterações por guardar (ficha, anamnese, configuração, notas)
document.addEventListener('input', e => { if (e.target.closest('#view form.form-grid, #view textarea, #view [data-dirty]')) App.dirty = true; });
const temAlteracoes = () => App.dirty || $$('.modal-bg').some(m => m._dirty && m._dirty());
const fecharModais = () => $$('.modal-bg').forEach(m => m._close ? m._close() : m.remove());
window.addEventListener('hashchange', async () => {
  const to = location.hash;
  if (temAlteracoes()) {
    history.replaceState(null, '', lastHash); // fica na página até o utilizador confirmar
    if (!(await confirmDlg('Há alterações por guardar. Sair sem guardar?', 'Sair sem guardar', true))) return;
    App.dirty = false; fecharModais(); location.hash = to; return;
  }
  fecharModais(); render();
});

// menus "Mais ⋯" (<details class="mais">): fecham com clique fora, ao escolher uma opção ou com Esc
document.addEventListener('click', e => {
  for (const d of $$('details.mais[open]')) if (!d.contains(e.target) || e.target.closest('.mais-menu button, .mais-menu a')) d.open = false;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const d = $$('details.mais[open]').pop(); if (!d) return;
  e.preventDefault(); d.open = false; $('summary', d).focus(); // preventDefault: o Esc não fecha também o modal
});

function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
