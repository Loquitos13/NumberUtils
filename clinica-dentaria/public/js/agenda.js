'use strict';
/* Agenda: vista diária por médico/gabinete, semanal, lista; marcações */
const AG = { date: isoDate(), mode: 'dia', medicos: null, medicoSemana: null, calMonth: null, feriados: {} };
const SLOT_H = 22; // px por intervalo

function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function minToHHMM(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }

async function loadFeriados(ano) {
  if (AG.feriados[ano]) return AG.feriados[ano];
  const l = await GET('feriados?ano=' + ano);
  AG.feriados[ano] = Object.fromEntries(l.map(f => [f.data, f.nome]));
  return AG.feriados[ano];
}
async function feriadoDe(iso) { return (await loadFeriados(Number(iso.slice(0, 4))))[iso]; }

route('agenda', async (view, params) => {
  if (params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0])) AG.date = params[0];
  const meds = ativos(L().medicos);
  if (!AG.medicos) {
    AG.medicos = new Set(App.user.medico_id && App.user.perfil === 'medico' ? [App.user.medico_id] : meds.map(m => m.id));
  }
  if (!AG.medicoSemana) AG.medicoSemana = App.user.medico_id || meds[0]?.id;
  view.innerHTML = `<div class="agenda-wrap">
    <div class="agenda-side">
      ${L().config.agenda_mensagem ? `<div class="alert info" style="white-space:pre-wrap">${esc(L().config.agenda_mensagem)}</div>` : ''}
      <div class="card"><div id="minical" class="mini-cal"></div></div>
      <div class="card">
        <h3>Vista</h3>
        <div class="subnav" id="ag-modes">
          ${[['dia', 'Dia'], ['semana', 'Semana'], ['gabinetes', 'Gabinetes'], ['lista', 'Lista']].map(([k, l]) => `<button class="sm ${AG.mode === k ? 'active' : ''}" data-m="${k}">${l}</button>`).join('')}
        </div>
        <div id="ag-filter"></div>
      </div>
      <div class="card"><div class="row between"><h3 style="margin:0">Lista de espera</h3><span class="badge warn" id="ag-esp-n">…</span></div>
        <div class="row" style="margin-top:8px"><button class="sm" id="ag-esp">Ver lista</button><button class="sm" id="ag-esp-add">Adicionar</button></div></div>
      <div class="card"><h3>Estados</h3><div class="legend">${ativos(L().estados).map(e => `<span><span class="dot" style="background:${esc(e.cor)}"></span>${esc(e.nome)}</span>`).join('')}</div></div>
    </div>
    <div class="agenda-main">
      <div class="page-head">
        <button id="ag-prev" class="icon" aria-label="Anterior" title="Anterior"><i data-ic="chevron-left"></i></button><button id="ag-today">Hoje</button><button id="ag-next" class="icon" aria-label="Seguinte" title="Seguinte"><i data-ic="chevron-right"></i></button>
        <h1 id="ag-title" style="font-size:1.2rem"></h1>
        <span id="ag-hol" class="badge danger hidden"></span>
        <div class="spacer"></div>
        <button id="ag-vagas">Procurar vaga</button>
        <button id="ag-bloq" title="Férias, congressos, ausências">Bloquear</button>
        <button id="ag-sms">Lembretes</button>
        <button id="ag-print">Imprimir</button>
      </div>
      <div id="ag-body"></div>
    </div></div>`;

  $$('#ag-modes button', view).forEach(b => b.onclick = () => { AG.mode = b.dataset.m; render(); });
  const step = AG.mode === 'semana' ? 7 : 1;
  $('#ag-prev', view).onclick = () => { AG.date = addDays(AG.date, -step); drawAgenda(); };
  $('#ag-next', view).onclick = () => { AG.date = addDays(AG.date, step); drawAgenda(); };
  $('#ag-today', view).onclick = () => { AG.date = isoDate(); drawAgenda(); };
  $('#ag-vagas', view).onclick = procurarVaga;
  $('#ag-bloq', view).onclick = () => editBloqueio(null, { date: AG.date, medico_id: AG.mode === 'semana' ? AG.medicoSemana : null });
  $('#ag-esp', view).onclick = listaEspera;
  $('#ag-esp-add', view).onclick = () => editEspera(null);
  GET('espera').then(l => { const b = $('#ag-esp-n'); if (b) b.textContent = l.length; });
  $('#ag-sms', view).onclick = lembretesDia;
  $('#ag-print', view).onclick = imprimirAgenda;

  // filtros
  const f = $('#ag-filter', view);
  if (AG.mode === 'semana') {
    f.innerHTML = fld('Médico', sel('ms', opts(meds, AG.medicoSemana)));
    $('select', f).onchange = e => { AG.medicoSemana = Number(e.target.value); drawAgenda(); };
  } else if (AG.mode !== 'gabinetes') {
    f.innerHTML = `<label class="f">Médicos</label>` + meds.map(m => `<label class="check" style="display:flex;margin:4px 0">
      <input type="checkbox" value="${m.id}" ${AG.medicos.has(m.id) ? 'checked' : ''}><span class="dot" style="background:${esc(m.cor)}"></span>${esc(m.nome)}</label>`).join('') +
      `<div class="row" style="margin-top:6px"><button class="sm" data-all>Todos</button><button class="sm" data-none>Nenhum</button></div>`;
    $$('input', f).forEach(c => c.onchange = () => { c.checked ? AG.medicos.add(Number(c.value)) : AG.medicos.delete(Number(c.value)); drawAgenda(); });
    $('[data-all]', f).onclick = () => { AG.medicos = new Set(meds.map(m => m.id)); render(); };
    $('[data-none]', f).onclick = () => { AG.medicos = new Set(); render(); };
  } else f.innerHTML = '<p class="muted small">Ocupação por gabinete.</p>';

  await drawAgenda();
});

async function drawMiniCal() {
  const el = $('#minical'); if (!el) return;
  const ref = AG.calMonth || AG.date.slice(0, 7);
  const [y, m] = ref.split('-').map(Number);
  const fer = await loadFeriados(y);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  let h = `<div class="hd"><button class="ghost sm icon" data-p aria-label="Mês anterior"><i data-ic="chevron-left"></i></button><span>${MESES[m - 1]} ${y}</span><button class="ghost sm icon" data-n aria-label="Mês seguinte"><i data-ic="chevron-right"></i></button></div>
    <table><tr>${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(d => `<th>${d}</th>`).join('')}</tr>`;
  const d = new Date(start); const hoje = isoDate();
  for (let w = 0; w < 6; w++) {
    h += '<tr>';
    for (let i = 0; i < 7; i++) {
      const iso = isoDate(d);
      const cls = [d.getMonth() !== m - 1 ? 'other' : '', iso === hoje ? 'today' : '', iso === AG.date ? 'sel' : '', fer[iso] ? 'hol' : ''].join(' ');
      h += `<td class="${cls}" data-d="${iso}" title="${esc(fer[iso] || '')}">${d.getDate()}</td>`;
      d.setDate(d.getDate() + 1);
    }
    h += '</tr>';
  }
  el.innerHTML = h + '</table>';
  $$('td[data-d]', el).forEach(td => td.onclick = () => { AG.date = td.dataset.d; AG.calMonth = null; drawAgenda(); });
  const mv = n => { const dd = new Date(y, m - 1 + n, 1); AG.calMonth = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}`; drawMiniCal(); };
  $('[data-p]', el).onclick = () => mv(-1); $('[data-n]', el).onclick = () => mv(1);
}

function weekStart(iso) { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); }

async function drawAgenda() {
  const body = $('#ag-body'); if (!body) return;
  drawMiniCal();
  const cfg = L().config;
  const t0 = toMin(cfg.agenda_inicio || '08:00'), t1 = toMin(cfg.agenda_fim || '20:00'), step = Number(cfg.agenda_intervalo) || 15;
  const diasAbertos = (cfg.agenda_dias || '1,2,3,4,5').split(',').map(Number);
  const meds = ativos(L().medicos);
  let cols = [], de = AG.date, ate = AG.date;

  if (AG.mode === 'semana') {
    de = weekStart(AG.date); ate = addDays(de, 6);
    $('#ag-title').textContent = `Semana de ${fmtDate(de)} a ${fmtDate(ate)} — ${byId(meds, AG.medicoSemana)?.nome || ''}`;
    for (let i = 0; i < 7; i++) {
      const iso = addDays(de, i); const dow = new Date(iso + 'T12:00:00').getDay();
      if (!diasAbertos.includes(dow) && i >= 5) continue;
      cols.push({ key: iso, title: `${DIAS_C[dow]} ${fmtDate(iso).slice(0, 5)}`, date: iso, medico_id: AG.medicoSemana, filter: m => m.inicio.startsWith(iso) && m.medico_id === AG.medicoSemana, closed: !diasAbertos.includes(dow) });
    }
  } else if (AG.mode === 'gabinetes') {
    $('#ag-title').textContent = dataLonga(AG.date);
    cols = ativos(L().gabinetes).map(g => ({ key: 'g' + g.id, title: g.nome, date: AG.date, gabinete_id: g.id, filter: m => m.gabinete_id === g.id }));
  } else {
    $('#ag-title').textContent = dataLonga(AG.date);
    cols = meds.filter(m => AG.medicos.has(m.id)).map(m => ({ key: 'm' + m.id, title: m.nome, color: m.cor, date: AG.date, medico_id: m.id, filter: x => x.medico_id === m.id }));
  }

  const hol = AG.mode !== 'semana' ? await feriadoDe(AG.date) : null;
  $('#ag-hol').classList.toggle('hidden', !hol); $('#ag-hol').textContent = hol ? 'Feriado: ' + hol : '';

  const [marc, bloqs] = await Promise.all([GET(`agenda?de=${de}&ate=${ate}`), GET(`bloqueios?de=${de}&ate=${ate}`)]);

  if (AG.mode === 'lista') {
    const rows = marc.filter(m => AG.medicos.has(m.medico_id));
    body.innerHTML = `<div class="card">${table(rows, [
      { h: 'Hora', f: m => `<b>${fmtTime(m.inicio)}</b>–${fmtTime(m.fim)}` },
      { h: 'Paciente', f: m => `${esc(m.paciente_nome)} <span class="muted small">n.º ${esc(m.paciente_numero)}</span>` },
      { h: 'Contacto', f: m => esc(m.paciente_telemovel) },
      { h: 'Médico', f: m => `<span class="dot" style="background:${esc(m.medico_cor)}"></span>${esc(m.medico_nome)}` },
      { h: 'Gabinete', f: m => esc(m.gabinete_nome) },
      { h: 'Serviço', f: m => esc(m.servico_nome) },
      { h: 'Estado', f: m => `<span class="badge" style="background:${esc(m.estado_cor)}22;color:${esc(m.estado_cor)}">${esc(m.estado_nome)}</span>` },
      { h: '', cls: 'right', f: m => estadoRapido(m) },
    ], { onClick: m => openMarcacao({ id: m.id }), empty: 'Sem marcações neste dia' })}</div>
    ${bloqs.length ? `<div class="card"><h3>Bloqueios / ausências</h3>${bloqs.map(b => `<div class="row" style="padding:4px 0"><span class="badge danger">${esc(b.tipo_nome)}</span> ${esc(b.medico_nome || 'Todos os médicos')} · ${fmtDT(b.inicio)} → ${fmtDT(b.fim)} ${esc(b.motivo || '')}<button class="ghost sm icon" data-bl="${b.id}" aria-label="Editar" title="Editar"><i data-ic="edit"></i></button></div>`).join('')}</div>` : ''}`;
    $$('[data-bl]', body).forEach(x => x.onclick = () => editBloqueio(byId(bloqs, x.dataset.bl)));
    bindEstadoRapido(body);
    return;
  }
  if (!cols.length) { body.innerHTML = '<div class="empty card">Selecione pelo menos um médico.</div>'; return; }

  const nSlots = Math.ceil((t1 - t0) / step);
  const H = nSlots * SLOT_H;
  const pxMin = SLOT_H / step;
  let h = `<div class="cal" style="grid-template-columns:56px repeat(${cols.length}, minmax(150px,1fr))">
    <div class="colh corner"></div>${cols.map(c => `<div class="colh" title="${esc(c.title)}">${c.color ? `<span class="dot" style="background:${esc(c.color)}"></span>` : ''}${esc(c.title)}</div>`).join('')}
    <div class="times" style="height:${H}px">`;
  for (let i = 0; i < nSlots; i++) {
    const t = t0 + i * step;
    h += `<div class="tlabel" style="height:${SLOT_H}px">${t % 60 === 0 || step >= 30 ? minToHHMM(t) : ''}</div>`;
  }
  h += '</div>';
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  for (const c of cols) {
    const closed = c.closed || (AG.mode === 'semana' && AG.feriados[c.date.slice(0, 4)]?.[c.date]);
    h += `<div class="col ${closed ? 'closed' : ''}" data-col="${esc(c.key)}" style="height:${H}px">`;
    for (let i = 0; i < nSlots; i++) {
      const t = t0 + i * step;
      h += `<div class="slot ${(t + step) % 60 === 0 ? 'hour' : ''}" style="height:${SLOT_H}px" data-t="${minToHHMM(t)}"></div>`;
    }
    // eventos com sobreposição lado a lado
    const evs = marc.filter(c.filter).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const lanes = [];
    for (const e of evs) {
      let lane = lanes.findIndex(end => end <= e.inicio);
      if (lane < 0) { lane = lanes.length; lanes.push(e.fim); } else lanes[lane] = e.fim;
      e._lane = lane;
    }
    for (const e of evs) {
      const s = toMin(fmtTime(e.inicio)), f = toMin(fmtTime(e.fim));
      const top = (s - t0) * pxMin, hh = Math.max((f - s) * pxMin - 2, 16);
      const nL = Math.max(1, ...evs.filter(o => o.inicio < e.fim && o.fim > e.inicio).map(o => o._lane + 1));
      const w = 100 / nL;
      const inact = ['INATIVAS', 'FALTAS'].includes(e.estado_categoria);
      const sub = AG.mode === 'gabinetes' ? e.medico_nome : (e.servico_nome || '');
      h += `<div class="ev ${inact ? 'inact' : ''}" data-id="${e.id}" style="top:${top}px;height:${hh}px;left:calc(${e._lane * w}% + 3px);width:calc(${w}% - 6px);right:auto;--st:${esc(e.estado_cor)}"
        title="${esc(`${fmtTime(e.inicio)}-${fmtTime(e.fim)} ${e.paciente_nome}\n${e.servico_nome || ''}\n${e.estado_nome}${e.notas ? '\n' + e.notas : ''}`)}">
        <div class="h"><span class="dot"></span><span class="num">${fmtTime(e.inicio)}</span> ${esc(e.paciente_nome)}</div><div class="small">${esc(sub)}${e.notas ? ' · notas' : ''}${e.primeira ? ' · 1.ª consulta' : ''}</div></div>`;
    }
    // bloqueios (férias, congressos, ausências)
    if (AG.mode !== 'gabinetes') for (const b of bloqs.filter(b => !b.medico_id || b.medico_id === c.medico_id)) {
      const s0 = b.inicio.slice(0, 10) < c.date ? t0 : Math.max(t0, toMin(fmtTime(b.inicio)));
      const e0 = b.fim.slice(0, 10) > c.date ? t1 : Math.min(t1, toMin(fmtTime(b.fim)));
      if (b.inicio.slice(0, 10) > c.date || b.fim.slice(0, 10) < c.date || e0 <= s0) continue;
      h += `<div class="blk" data-bl="${b.id}" style="top:${(s0 - t0) * pxMin}px;height:${(e0 - s0) * pxMin}px" title="${esc(b.tipo_nome + (b.motivo ? ': ' + b.motivo : ''))}">${esc(b.tipo_nome)}${b.motivo ? ' — ' + esc(b.motivo) : ''}</div>`;
    }
    if (c.date === isoDate() && nowMin >= t0 && nowMin <= t1) h += `<div class="now-line" style="top:${(nowMin - t0) * pxMin}px"></div>`;
    h += '</div>';
  }
  body.innerHTML = h + '</div>';

  const colMap = Object.fromEntries(cols.map(c => [c.key, c]));
  $$('.col', body).forEach(colEl => colEl.addEventListener('click', e => {
    const blk = e.target.closest('.blk');
    if (blk) return editBloqueio(byId(bloqs, blk.dataset.bl));
    const ev = e.target.closest('.ev');
    if (ev) return openMarcacao({ id: Number(ev.dataset.id) });
    const slot = e.target.closest('.slot'); if (!slot) return;
    const c = colMap[colEl.dataset.col];
    openMarcacao({ date: c.date, hora: slot.dataset.t, medico_id: c.medico_id, gabinete_id: c.gabinete_id });
  }));
  // rola até à hora atual
  const cal = $('.cal', body);
  if (AG.date === isoDate() && cal) cal.scrollTop = Math.max(0, (nowMin - t0) * pxMin - 120);
}

function estadoRapido(m) {
  const pres = L().estados.find(e => e.nome === 'Presente'), falt = L().estados.find(e => e.categoria === 'FALTAS');
  return `<span class="nowrap"><a class="btn sm" href="#/consulta/${m.id}">Consulta</a> ${pres ? `<button class="sm" data-est="${pres.id}" data-mid="${m.id}" title="Marcar presente">Presente</button>` : ''}
    ${falt ? `<button class="sm" data-est="${falt.id}" data-mid="${m.id}" title="Marcar falta">Faltou</button>` : ''}</span>`;
}
function bindEstadoRapido(root, after = drawAgenda) {
  $$('[data-est]', root).forEach(b => b.onclick = async () => {
    await act(() => PUT('marcacoes/' + b.dataset.mid, { estado_id: Number(b.dataset.est), forcar: true }), 'Estado atualizado');
    after();
  });
}

// ---------- modal de marcação ----------
async function openMarcacao({ id, date, hora, medico_id, gabinete_id, paciente, duracao, servico_id, notas, onSaved } = {}) {
  const lk = L(); const cfg = lk.config;
  let m = id ? await GET('marcacoes/' + id) : null;
  const durDefault = duracao || byId(lk.servicos, servico_id)?.duracao_min || 30;
  const ini = m ? m.inicio : `${date || AG.date || isoDate()}T${hora || '09:00'}`;
  const dur = m ? toMin(fmtTime(m.fim)) - toMin(fmtTime(m.inicio)) + (m.fim.slice(0, 10) !== m.inicio.slice(0, 10) ? 1440 : 0) : durDefault;
  const medId = m ? m.medico_id : (medico_id || App.user.medico_id || ativos(lk.medicos)[0]?.id);
  const estados = ativos(lk.estados);
  const body = `<form class="form-grid" onsubmit="return false">
    <div class="s3">${pacField('paciente_id', m?.paciente_id ?? paciente?.id, m?.paciente_nome ?? paciente?.nome)}</div>
    <div class="field"><label class="f">&nbsp;</label><button type="button" id="mk-newpac" style="width:100%">Novo paciente</button></div>
    ${fld('Médico', sel('medico_id', opts(lk.medicos, medId, { only: x => x.ativo })), 's2')}
    ${fld('Gabinete', sel('gabinete_id', opts(lk.gabinetes, m?.gabinete_id ?? gabinete_id, { empty: '—', only: x => x.ativo })), 's2')}
    ${fld('Serviço / motivo', sel('servico_id', opts(lk.servicos, m?.servico_id ?? servico_id, { empty: '—', only: x => x.ativo, label: s => `${s.codigo ? s.codigo + ' · ' : ''}${s.nome} (${s.duracao_min} min)` })), 's4')}
    ${fld('Data', inp('data', ini.slice(0, 10), 'type="date"'))}
    ${fld('Hora', inp('hora', fmtTime(ini), `type="time" step="${(Number(cfg.agenda_intervalo) || 15) * 60}"`))}
    ${fld('Duração (min)', inp('duracao', dur, 'type="number" min="5" step="5"'))}
    ${fld('Estado', sel('estado_id', opts(estados, m?.estado_id ?? estados[0]?.id)))}
    <div class="s4">${chk('primeira', m?.primeira, 'Primeira consulta')}</div>
    ${fld('Notas', txt('notas', m?.notas ?? notas), 's4')}
    <div class="s4 small muted" id="mk-info"></div>
  </form>`;
  const buttons = [];
  if (m) buttons.push({ label: 'Eliminar', cls: 'danger', left: true, onClick: async () => {
    if (!await confirmDlg('Eliminar definitivamente esta marcação? (Para manter histórico, altere o estado para Desmarcada.)', 'Eliminar', true)) return false;
    await DEL('marcacoes/' + m.id); toast('Marcação eliminada'); refreshCurrent();
  } });
  if (m) buttons.push({ label: 'Abrir consulta', onClick: () => go('#/consulta/' + m.id) });
  if (m) buttons.push({ label: 'Ficha', onClick: () => go('#/paciente/' + m.paciente_id) });
  if (m) buttons.push({ label: 'Avisar paciente', onClick: async () => { await smsMarcacoes([m.id], `Avisar ${m.paciente_nome}`, 'Confirmação de marcação'); return false; } });
  buttons.push({ label: 'Cancelar' });
  buttons.push({ label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.paciente_id) throw new Error('Escolha um paciente da lista (ou crie um novo).');
    const s = toMin(f.hora); const e = s + (Number(f.duracao) || 30);
    if (e >= 1440) throw new Error('A marcação não pode passar da meia-noite');
    const payload = { paciente_id: Number(f.paciente_id), medico_id: Number(f.medico_id), gabinete_id: f.gabinete_id ? Number(f.gabinete_id) : null,
      servico_id: f.servico_id ? Number(f.servico_id) : null, estado_id: Number(f.estado_id), notas: f.notas, primeira: f.primeira,
      inicio: `${f.data}T${f.hora}`, fim: `${f.data}T${minToHHMM(e)}` };
    const save = forcar => m ? PUT('marcacoes/' + m.id, { ...payload, forcar }) : POST('marcacoes', { ...payload, forcar });
    let gravada;
    try { gravada = await save(false); }
    catch (err) {
      if (err.status !== 409) throw err;
      if (!await confirmDlg(err.message + ' Pretende gravar mesmo assim?', 'Gravar mesmo assim')) return false;
      gravada = await save(true);
    }
    toast('Marcação guardada');
    if (onSaved) await onSaved(gravada); else refreshCurrent();
  } });
  modal({ title: m ? `Marcação — ${m.paciente_nome}` : 'Nova marcação', size: 'lg', body, buttons, onOpen: c => {
    const form = $('form', c.body);
    const info = async pid => {
      if (!pid) { $('#mk-info', c.body).textContent = ''; return; }
      const p = await GET(`pacientes/${pid}/resumo`);
      const al = [p.anamnese.alergias && `Alergias: ${p.anamnese.alergias}`, p.saldo.saldo > 0 && `Saldo em dívida: ${eur(p.saldo.saldo)}`,
        p.telemovel && `Tel.: ${p.telemovel}`, p.ultima && `Última: ${fmtDT(p.ultima.inicio)} (${p.ultima.estado_nome})`].filter(Boolean);
      $('#mk-info', c.body).innerHTML = al.map(esc).join(' · ');
    };
    bindPacField(form, 'paciente_id', p => info(p.id));
    if (m || paciente) info(m?.paciente_id ?? paciente.id);
    form.servico_id.onchange = () => { const s = byId(lk.servicos, form.servico_id.value); if (s) form.duracao.value = s.duracao_min; };
    $('#mk-newpac', c.body).onclick = () => editPaciente(null, p => { form.paciente_id.value = p.id; $('[data-pac]', form).value = p.nome; info(p.id); });
  } });
}

function refreshCurrent() { if (['agenda', 'inicio', 'paciente', 'listagens'].includes(App.current)) render(); }

// ---------- procurar vaga ----------
function procurarVaga(preset = {}) {
  const lk = L(); const meds = ativos(lk.medicos); const cfg = lk.config;
  const diasAb = (cfg.agenda_dias || '1,2,3,4,5').split(',');
  modal({ title: 'Pesquisa de vagas', size: 'lg', body: `<form class="form-grid" onsubmit="return false">
      ${fld('Médico', sel('medico_id', opts(meds, preset.medico_id || (AG.medicos && [...AG.medicos][0]))), 's2')}
      ${fld('2.º médico (opcional — ambos livres)', sel('medico2_id', opts(meds, null, { empty: '—' })), 's2')}
      ${fld('Duração (min)', inp('duracao', preset.duracao || 30, 'type="number" step="5" min="5"'))}${fld('A partir de', inp('de', isoDate(), 'type="date"'))}
      ${fld('Hora mínima', inp('hora_min', cfg.agenda_inicio || '09:00', 'type="time"'))}${fld('Hora máxima', inp('hora_max', cfg.agenda_fim || '19:30', 'type="time"'))}
      <div class="s4">${chk('manha', 1, 'Manhã')}${chk('tarde', 1, 'Tarde')}${chk('noite', 0, 'Noite (após 20h)')}${chk('feriados', 0, 'Incluir feriados')}</div>
      <div class="s4"><label class="f">Dias da semana</label>${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" data-dia="${d}" ${diasAb.includes(String(d)) ? 'checked' : ''}> ${DIAS_C[d]}</label>`).join('')}</div>
    </form><div id="vg-res"></div>`,
  buttons: [{ label: 'Fechar' }, { label: 'Pesquisar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    const dias = $$('[data-dia]:checked', c.body).map(x => x.dataset.dia).join(',');
    if (!dias) throw new Error('Escolha pelo menos um dia da semana');
    const qs = new URLSearchParams({ medico_id: f.medico_id, medico2_id: f.medico2_id || '', duracao: f.duracao, de: f.de, hora_min: f.hora_min, hora_max: f.hora_max,
      manha: f.manha, tarde: f.tarde, noite: f.noite, feriados: f.feriados, dias, limite: 30 });
    const r = await GET('pesquisa-vagas?' + qs);
    $('#vg-res', c.body).innerHTML = r.length ? `<p class="muted small">Clique numa vaga para marcar.</p>${table(r, [
      { h: 'Dia', f: v => `${DIAS[new Date(v.inicio).getDay()]}, ${fmtDate(v.inicio)}` }, { h: 'Hora', f: v => `<b>${fmtTime(v.inicio)}</b> – ${fmtTime(v.fim)}` },
      { h: 'Médico(s)', f: v => v.medicos.map(id => esc(byId(lk.medicos, id)?.nome)).join(' + ') }], { onClick: v => {
        c.close(); openMarcacao({ date: v.inicio.slice(0, 10), hora: fmtTime(v.inicio), medico_id: Number(f.medico_id), duracao: Number(f.duracao), paciente: preset.paciente });
      } })}` : '<div class="empty">Sem vagas com estes critérios nos próximos 4 meses</div>';
    return false;
  } }] });
}

// ---------- bloqueios da agenda ----------
function editBloqueio(b, { date, medico_id } = {}) {
  const lk = L(); const isNew = !b;
  b = b || { tipo: 'ferias', medico_id, inicio: `${date || isoDate()}T00:00`, fim: `${date || isoDate()}T23:59` };
  const tipos = Object.entries(lk.tipos_bloqueio);
  const buttons = [];
  if (!isNew) buttons.push({ label: 'Remover', cls: 'danger', left: true, onClick: async () => { await DEL('t/bloqueios/' + b.id); toast('Bloqueio removido'); refreshCurrent(); } });
  buttons.push({ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    const inicio = `${f.d1}T${f.dia_todo ? '00:00' : f.h1}`, fim = `${f.d2}T${f.dia_todo ? '23:59' : f.h2}`;
    if (fim <= inicio) throw new Error('O fim tem de ser depois do início');
    const ocup = (await GET(`agenda?de=${f.d1}&ate=${f.d2}`)).filter(m => (!f.medico_id || String(m.medico_id) === f.medico_id) && m.inicio < fim && m.fim > inicio && !['INATIVAS', 'FALTAS'].includes(m.estado_categoria));
    if (ocup.length && !await confirmDlg(`Existem ${ocup.length} marcação(ões) neste período (ex.: ${ocup[0].paciente_nome} a ${fmtDT(ocup[0].inicio)}). Bloquear mesmo assim? As marcações não são alteradas.`, 'Bloquear')) return false;
    const payload = { medico_id: f.medico_id ? Number(f.medico_id) : null, tipo: f.tipo, motivo: f.motivo, inicio, fim };
    isNew ? await POST('t/bloqueios', payload) : await PUT('t/bloqueios/' + b.id, payload);
    toast('Agenda bloqueada'); refreshCurrent();
  } });
  const diaTodo = fmtTime(b.inicio) === '00:00' && fmtTime(b.fim) === '23:59';
  modal({ title: isNew ? 'Bloquear agenda' : 'Bloqueio da agenda', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Médico', sel('medico_id', opts(lk.medicos, b.medico_id, { empty: 'Todos (clínica fechada)', only: x => x.ativo })), 's2')}
    ${fld('Tipo', sel('tipo', optsArr(tipos, b.tipo)), 's2')}
    ${fld('De', inp('d1', b.inicio.slice(0, 10), 'type="date"'))}${fld('Hora', inp('h1', diaTodo ? '09:00' : fmtTime(b.inicio), 'type="time"'))}
    ${fld('Até', inp('d2', b.fim.slice(0, 10), 'type="date"'))}${fld('Hora', inp('h2', diaTodo ? '13:00' : fmtTime(b.fim), 'type="time"'))}
    <div class="s4">${chk('dia_todo', diaTodo, 'Dia(s) inteiro(s)')}</div>
    ${fld('Motivo / notas', inp('motivo', b.motivo), 's4')}</form>`, buttons,
  onOpen: c => {
    const form = $('form', c.body);
    const upd = () => { form.h1.disabled = form.h2.disabled = form.dia_todo.checked; };
    form.dia_todo.onchange = upd; upd();
    form.d1.onchange = () => { if (form.d2.value < form.d1.value) form.d2.value = form.d1.value; };
  } });
}

// ---------- lista de espera ----------
async function listaEspera() {
  const rows = await GET('espera');
  const m = modal({ title: `Lista de espera (${rows.length})`, size: 'lg', body: table(rows, [
    { h: 'Desde', f: r => fmtDate(r.criado_em) }, { h: 'Paciente', f: r => `<b>${esc(r.paciente_nome)}</b><br><span class="small muted">${esc(r.telemovel)}</span>` },
    { h: 'Médico', f: r => esc(r.medico_nome) }, { h: 'Serviço', f: r => esc(r.servico_nome) }, { h: 'Preferência', f: r => esc(r.preferencia) }, { h: 'Notas', f: r => esc(r.notas) },
    { h: '', cls: 'right', f: r => `<span class="nowrap"><button class="sm primary" data-mk="${r.id}">Marcar</button> <button class="sm" data-vg="${r.id}">Vagas</button> <button class="ghost sm icon" data-ed="${r.id}" aria-label="Editar" title="Editar"><i data-ic="edit"></i></button></span>` },
  ], { empty: 'Ninguém em lista de espera' }),
  buttons: [{ label: 'Adicionar', left: true, onClick: () => editEspera(null) }, { label: 'Fechar' }] });
  const pac = r => ({ id: r.paciente_id, nome: r.paciente_nome });
  $$('[data-mk]', m.body).forEach(b => b.onclick = async () => {
    const r = byId(rows, b.dataset.mk);
    await PUT('t/lista_espera/' + r.id, { estado: 'marcado' }); m.close();
    openMarcacao({ paciente: pac(r), medico_id: r.medico_id, servico_id: r.servico_id });
  });
  $$('[data-vg]', m.body).forEach(b => b.onclick = () => { const r = byId(rows, b.dataset.vg); m.close(); procurarVaga({ medico_id: r.medico_id, paciente: pac(r) }); });
  $$('[data-ed]', m.body).forEach(b => b.onclick = () => { m.close(); editEspera(byId(rows, b.dataset.ed)); });
}
function editEspera(r, paciente) {
  const lk = L(); const isNew = !r; r = r || { paciente_id: paciente?.id, paciente_nome: paciente?.nome };
  const buttons = [];
  if (!isNew) buttons.push({ label: 'Retirar da lista', cls: 'danger', left: true, onClick: async () => { await PUT('t/lista_espera/' + r.id, { estado: 'cancelado' }); toast('Retirado da lista de espera'); refreshCurrent(); } });
  buttons.push({ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.paciente_id) throw new Error('Escolha o paciente');
    for (const k of ['paciente_id', 'medico_id', 'servico_id']) f[k] = f[k] ? Number(f[k]) : null;
    isNew ? await POST('t/lista_espera', f) : await PUT('t/lista_espera/' + r.id, f);
    toast('Lista de espera atualizada'); refreshCurrent();
  } });
  modal({ title: isNew ? 'Adicionar à lista de espera' : 'Lista de espera', body: `<form class="form-grid" onsubmit="return false">
    <div class="s4">${pacField('paciente_id', r.paciente_id, r.paciente_nome)}</div>
    ${fld('Médico', sel('medico_id', opts(lk.medicos, r.medico_id, { empty: 'Qualquer', only: x => x.ativo })), 's2')}
    ${fld('Serviço', sel('servico_id', opts(lk.servicos, r.servico_id, { empty: '—', only: x => x.ativo })), 's2')}
    ${fld('Preferência de horário', inp('preferencia', r.preferencia, 'placeholder="ex.: manhãs, 2.ª e 4.ª"'), 's4')}${fld('Notas', txt('notas', r.notas), 's4')}</form>`,
  buttons, onOpen: c => bindPacField($('form', c.body), 'paciente_id') });
}

// ---------- lembretes SMS ----------
async function lembretesDia() {
  const dia = addDays(AG.date, AG.date === isoDate() ? 1 : 0);
  const marc = (await GET(`agenda?de=${dia}&ate=${dia}`)).filter(m => !['INATIVAS', 'FALTAS', 'REALIZADAS'].includes(m.estado_categoria));
  if (!marc.length) return toast('Sem marcações ativas em ' + fmtDate(dia));
  await smsMarcacoes(marc.map(m => m.id), `Lembretes para ${fmtDate(dia)} (${marc.length})`, 'Lembrete de consulta');
}
async function smsMarcacoes(ids, titulo = 'Avisar paciente', modeloNome) { return enviarAviso({ marcacao_ids: ids }, titulo, modeloNome); }

// Janela única de mensagens (SMS e/ou e-mail) para marcações ou pacientes
async function enviarAviso(alvo, titulo = 'Enviar mensagem', modeloNome) {
  const modelos = ativos(L().sms_modelos);
  const est = await GET('sms/estado').catch(() => ({ email: false, sms: false }));
  const mdef = modelos.find(m => m.nome === modeloNome) || modelos[0];
  modal({ title: titulo, size: 'lg', body: `<form class="form-grid" onsubmit="return false">
      ${fld('Modelo', sel('modelo_id', opts(modelos, mdef?.id)), 's2')}
      <div class="s2"><label class="f">Enviar por</label><div style="padding-top:5px">${chk('c_sms', 1, 'SMS')}${chk('c_email', 0, 'E-mail')}</div></div>
      <div class="s4 small muted">${est.sms ? 'SMS: envio automático ativo.' : 'SMS: sem fornecedor configurado — as mensagens ficam preparadas para copiar ou abrir no telemóvel.'}
        ${est.email ? ' E-mail: envio ativo.' : ' E-mail: não configurado (Configuração → E-mail e SMS).'}</div>
    </form><div id="sms-res"></div>`,
  buttons: [{ label: 'Fechar' }, { label: 'Pré-visualizar', onClick: c => go_(c, false) }, { label: 'Enviar', cls: 'primary', onClick: c => go_(c, true) }] });
  async function go_(c, enviar) {
    const f = readForm($('form', c.body));
    const canais = [f.c_sms && 'sms', f.c_email && 'email'].filter(Boolean);
    if (!canais.length) throw new Error('Escolha SMS e/ou e-mail');
    if (enviar && !await confirmDlg(`Enviar ${canais.join(' e ').replace('email', 'e-mail').toUpperCase()} para ${(alvo.marcacao_ids || alvo.paciente_ids || []).length} destinatário(s)?`, 'Enviar')) return false;
    const r = await POST(enviar ? 'sms/enviar' : 'sms/preparar', { ...alvo, modelo_id: Number(f.modelo_id), canais });
    $('#sms-res', c.body).innerHTML = smsResultado(r); bindSmsResultado(c.body);
    if (enviar) { const ok = r.filter(x => x.estado === 'enviado').length; toast(`${ok} enviada(s)${r.length - ok ? ` · ${r.length - ok} por enviar` : ''}`); }
    return false;
  }
}
const EST_MSG = { enviado: 'st-pago', preparado: 'st-real', erro: 'st-nec', 'sem consentimento': 'st-orc', 'sem número': 'st-orc', 'sem e-mail': 'st-orc' };
function smsResultado(r) {
  return table(r, [{ h: 'Paciente', f: x => esc(x.nome) }, { h: 'Canal', f: x => x.canal === 'email' ? 'E-mail' : 'SMS' }, { h: 'Destino', f: x => `<span class="num">${esc(x.destino || '')}</span>` },
    { h: 'Mensagem', f: x => `<span class="small">${x.canal === 'email' ? `<b>${esc(x.assunto)}</b><br>` : ''}${esc(x.texto)}</span>` },
    { h: 'Estado', f: x => `<span class="st ${EST_MSG[x.estado] || ''}">${esc(x.estado)}</span>${x.erro ? `<div class="small danger">${esc(x.erro)}</div>` : ''}` },
    { h: '', f: x => x.estado === 'preparado' && x.canal === 'sms' && x.destino ? `<span class="nowrap"><button class="sm" data-copy="${esc(x.texto)}">Copiar</button> <a class="btn sm" href="sms:${esc(x.destino)}?body=${encodeURIComponent(x.texto)}">Abrir</a></span>`
      : x.estado === 'preparado' && x.canal === 'email' && x.destino ? `<a class="btn sm" href="mailto:${esc(x.destino)}?subject=${encodeURIComponent(x.assunto)}&body=${encodeURIComponent(x.texto)}">Abrir</a>` : '' }]);
}
function bindSmsResultado(root) { $$('[data-copy]', root).forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copiado'); }); }

async function imprimirAgenda() {
  const de = AG.mode === 'semana' ? weekStart(AG.date) : AG.date, ate = AG.mode === 'semana' ? addDays(de, 6) : AG.date;
  let marc = await GET(`agenda?de=${de}&ate=${ate}`);
  if (AG.mode === 'semana') marc = marc.filter(m => m.medico_id === AG.medicoSemana);
  else if (AG.mode !== 'gabinetes') marc = marc.filter(m => AG.medicos.has(m.medico_id));
  const grupos = {};
  for (const m of marc) (grupos[AG.mode === 'semana' ? fmtDate(m.inicio) : m.medico_nome] ||= []).push(m);
  printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Agenda</h2>${de === ate ? dataLonga(de) : fmtDate(de) + ' a ' + fmtDate(ate)}</div></div>
    ${Object.entries(grupos).map(([g, l]) => `<h3>${esc(g)}</h3><table><tr><th>Hora</th><th>Paciente</th><th>Telemóvel</th><th>Serviço</th><th>Estado</th><th>Notas</th></tr>
    ${l.map(m => `<tr><td>${fmtTime(m.inicio)}-${fmtTime(m.fim)}</td><td>${esc(m.paciente_nome)}</td><td>${esc(m.paciente_telemovel)}</td><td>${esc(m.servico_nome)}</td><td>${esc(m.estado_nome)}</td><td>${esc(m.notas)}</td></tr>`).join('')}</table>`).join('') || '<p>Sem marcações.</p>'}</div>`);
}
