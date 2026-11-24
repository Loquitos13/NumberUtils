'use strict';
/* Odontograma interativo reutilizável (ficha do paciente e ecrã de consulta).
   Vermelho = necessário (planeado), azul = feito (realizado). */


// mesmo arredondamento do servidor (r2 em server.js): meio cêntimo afasta-se do zero
function liqTrat(t) { const v = (t.preco || 0) * (1 - (t.desconto_pct || 0) / 100) * (1 + (t.iva || 0) / 100); return Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toPrecision(15))) / 100 || 0; }

// opts: { marcacao, onChange }
async function odontograma(el, p, opts = {}) {
  const st = el._od ||= { sel: new Set(), faces: new Set(), dec: false };
  const m = opts.marcacao;
  const [conds, trat] = await Promise.all([GET('t/dentes_condicoes?paciente_id=' + p.id), GET(`pacientes/${p.id}/tratamentos`)]);
  const lk = L();
  const filtro = st.filtro || 'tudo';
  const state = {};
  const S = n => (state[n] ||= { faces: {}, marcas: [], ausente: false, items: [], nec: false, feito: false });
  const CMAP = { carie: ['face', COR_NEC], restauracao: ['face', COR_FEITO], selante: ['selante', COR_FEITO], extrair: ['extracao', COR_NEC], endodontia: ['canal', COR_FEITO],
    coroa: ['coroa', COR_FEITO], implante: ['implante', COR_FEITO], fratura: ['fratura', COR_NEC], mobilidade: ['mobilidade', COR_NEC] };
  for (const c of conds) {
    const s = S(c.dente); s.items.push({ kind: 'c', ...c });
    if (c.condicao === 'ausente') { s.ausente = true; continue; }
    const [sym, cor] = CMAP[c.condicao] || ['', COR_NEC];
    const fs = (c.faces || '').split('').filter(f => FACES[f]);
    if (sym === 'face') (fs.length ? fs : ['O']).forEach(f => { s.faces[f] ||= cor; });
    else if (sym) s.marcas.push({ sym, cor });
  }
  for (const t of trat) {
    if (!t.dente) continue;
    const feito = t.estado === 'realizado';
    const mostra = filtro === 'tudo' || (filtro === 'nec' && !feito) || (filtro === 'feito' && feito) || (filtro === 'consulta' && m && t.marcacao_id === m.id);
    const sym = simboloServico(byId(lk.servicos, t.servico_id), t.descricao);
    const cor = feito ? COR_FEITO : COR_NEC;
    for (const d of String(t.dente).split(/[,\s]+/).filter(Boolean)) {
      const s = S(d); s.items.push({ kind: 't', ...t });
      if (!mostra) continue;
      feito ? (s.feito = true) : (s.nec = true);
      const fs = (t.faces || '').split('').filter(f => FACES[f]);
      if (sym === 'extracao' && feito) { s.ausente = true; continue; }
      if (sym === 'face' || (!sym && fs.length)) (fs.length ? fs : ['O']).forEach(f => { if (s.faces[f] !== COR_FEITO || feito) s.faces[f] = cor; });
      else if (sym) s.marcas.push({ sym, cor });
    }
  }
  const tooth = (n, lower) => { const d = S(String(n)); const on = st.sel.has(String(n));
    const num = `<span class="n ${d.nec ? 'is-nec' : d.feito ? 'is-feito' : ''}">${n}</span>`;
    return `<div class="tooth ${on ? 'sel' : ''}" data-n="${n}" role="button" tabindex="0" aria-pressed="${on}" aria-label="Dente ${n}">${lower ? '' : num}${desenhoDente(n, d)}${lower ? num : ''}</div>`; };
  const arc = (rows, lower) => `<div class="arc">${rows.map((q, i) => q.map(n => tooth(n, lower)).join('') + (i === 0 ? '<div class="gap"></div>' : '')).join('')}</div>`;
  const selList = () => [...st.sel].sort();
  // serviços agrupados por especialidade
  const grupos = {};
  for (const sv of ativos(lk.servicos)) (grupos[byId(lk.especialidades, sv.especialidade_id)?.nome || 'Outros'] ||= []).push(sv);
  const freq = await servicosFrequentes(m?.medico_id || App.user.medico_id);
  const atalhos = [...ativos(lk.servicos).filter(x => x.atalho), ...freq.map(f => byId(lk.servicos, f.servico_id)).filter(x => x && x.ativo)]
    .filter((x, k, a) => a.findIndex(y => y.id === x.id) === k).slice(0, 12);
  const svSel = byId(lk.servicos, st.serv);
  const picker = `<div class="tp">
      <div class="tp-sel" id="tp-sel">${svSel ? `<b>${esc(svSel.nome)}</b><span class="num">${eur(svSel.preco)}</span>` : '<span class="muted">Escolha o tratamento abaixo</span>'}</div>
      ${atalhos.length ? `<div class="tp-chips" aria-label="Atalhos">${atalhos.map(x => `<button type="button" class="chip ${st.serv === x.id ? 'on' : ''}" data-sv="${x.id}" title="${esc(x.nome)} — ${eur(x.preco)}">${esc(nomeCurto(x.nome))}</button>`).join('')}</div>` : ''}
      <input id="od-q" type="search" placeholder="Procurar tratamento…" autocomplete="off">
      <div class="tp-list" id="tp-list">${Object.entries(grupos).map(([g, l]) => `<div class="tp-g" data-g>${esc(g)}</div>${l.map(x => `<button type="button" class="tp-i ${st.serv === x.id ? 'on' : ''}" data-sv="${x.id}" data-txt="${esc((x.nome + ' ' + (x.codigo || '')).toLowerCase())}"><span>${esc(x.nome)}</span><span class="num muted">${eur(x.preco)}</span></button>`).join('')}`).join('')}</div>
    </div>`;
  // partes do painel que dependem da seleção (redesenhadas sem voltar ao servidor)
  const selHtml = () => { const s = selList();
    return `<div class="od-target">${s.length ? `<span class="muted">Dente${s.length > 1 ? 's' : ''}</span> <b class="num">${s.join(', ')}</b>` : '<span class="muted">Nenhum dente selecionado: o tratamento fica para a boca toda.</span><br><span class="small muted">Clique nos dentes para os selecionar; pode escolher vários.</span>'}</div>
      ${s.length ? `<div class="faces" role="group" aria-label="Faces">${Object.entries(FACES).map(([k, l]) => `<button type="button" class="face ${st.faces.has(k) ? 'on' : ''}" data-face="${k}" title="${l}" aria-pressed="${st.faces.has(k)}">${k}</button>`).join('')}<span class="small muted">faces</span></div>` : ''}`; };
  const histHtml = () => { const s = selList(); if (!s.length) return '';
    const seen = new Set(); const hist = s.flatMap(n => S(n).items).filter(i => { const k = i.kind + i.id; if (seen.has(k)) return false; seen.add(k); return true; });
    return `<h3 style="margin:14px 0 4px">Histórico</h3>${hist.length ? `<ul class="od-hist">${hist.map(i => i.kind === 'c'
      ? `<li><span class="dot" style="background:${COND[i.condicao]?.c}"></span><span class="grow">${esc(COND[i.condicao]?.l || i.condicao)} <span class="muted">${esc(i.dente)}${i.faces ? ' ' + esc(i.faces) : ''}</span><br><span class="muted small">${fmtDate(i.data)}</span></span>
         <button class="ghost sm icon" data-dc="${i.id}" title="Eliminar" aria-label="Eliminar"><i data-ic="trash"></i></button></li>`
      : `<li class="${i.estado === 'planeado' ? 'is-nec' : 'is-feito'}"><span class="mark"></span><span class="grow">${esc(i.descricao)} <span class="muted">${esc(i.dente)}${i.faces ? ' ' + esc(i.faces) : ''}</span><br><span class="muted small">${fmtDate(i.data)}</span></span>
         ${i.estado === 'planeado' ? `<button class="sm" data-done="${i.id}">Feito</button><button class="sm" data-ag="${i.id}" title="${i.marcacao_inicio ? 'Agendado ' + fmtDT(i.marcacao_inicio) : 'Agendar'}">${i.marcacao_inicio && i.marcacao_inicio >= isoDate() ? fmtDate(i.marcacao_inicio).slice(0, 5) : 'Agendar'}</button>` : ''}${i.documento_id || (i.estado === 'realizado' && App.user.perfil !== 'admin') ? '' : `<button class="ghost sm icon" data-dt="${i.id}" title="Eliminar" aria-label="Eliminar"><i data-ic="trash"></i></button>`}</li>`).join('')}</ul>` : '<p class="muted small">Sem registos.</p>'}`; };

  el.innerHTML = `<div class="od-wrap">
    <section class="card od-chart">
      <div class="row between"><h3 style="margin:0">Odontograma</h3>
        <span class="row"><span class="seg" role="group" aria-label="Mostrar">${[['tudo', 'Tudo'], ['nec', 'Necessário'], ['feito', 'Feito'], ...(m ? [['consulta', 'Esta consulta']] : [])].map(([k, l]) => `<button type="button" data-filtro="${k}" class="${filtro === k ? 'on' : ''}">${l}</button>`).join('')}</span>
        <label class="check small"><input type="checkbox" id="od-dec" ${st.dec ? 'checked' : ''}> Decídua</label>
        <button class="sm ghost ${st.sel.size ? '' : 'hidden'}" id="od-clear">Limpar seleção</button></span></div>
      <div class="odonto">${arc(Q_UP)}${st.dec ? arc(D_UP) + '<div class="midline"></div>' + arc(D_LO, true) : '<div class="midline"></div>'}${arc(Q_LO, true)}</div>
      <div class="odonto-legend"><span style="--c:${COR_NEC}">Necessário</span><span style="--c:${COR_FEITO}">Feito / existente</span>
        </div>
      <p class="muted small center" style="margin:4px 0 0">Clique no dente (ou Enter; setas mudam de dente) para o selecionar; clique numa face da vista oclusal para a marcar.</p>
      <p class="od-credito">Modelos dentários: <a href="img/dentes/LICENCA.txt" target="_blank" rel="noopener">BodyParts3D © DBCLS, CC BY 4.0</a></p>
    </section>
    <section class="card od-panel">
      <div id="od-selinfo">${selHtml()}</div>
      <div class="od-actions">
        <button class="nec" id="od-nec">Necessário</button>
        <button class="primary" id="od-feito">${m ? 'Feito nesta consulta' : 'Feito'}</button>
      </div>
      ${picker}
      <details class="od-more"><summary>Registar condição do dente</summary>
        <div class="row" style="margin-top:6px">${sel('cond', optsArr(CONDICOES.map(([k, l]) => [k, l])), 'id="od-cond" aria-label="Condição do dente" style="flex:1"')}<button id="od-addc" ${st.sel.size ? '' : 'disabled'}>Registar</button></div></details>
      <div id="od-histbox">${histHtml()}</div>
    </section></div>`;

  const redraw = async () => { await odontograma(el, p, opts); opts.onChange && opts.onChange(); };
  $('#od-dec', el).onchange = e => { st.dec = e.target.checked; odontograma(el, p, opts); };
  $$('[data-filtro]', el).forEach(b => b.onclick = () => { st.filtro = b.dataset.filtro; odontograma(el, p, opts); });
  const bindSel = () => {
    $$('[data-face]', el).forEach(b => b.onclick = () => { const f = b.dataset.face; st.faces.has(f) ? st.faces.delete(f) : st.faces.add(f); b.classList.toggle('on'); b.setAttribute('aria-pressed', st.faces.has(f)); });
    $$('[data-dc]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar esta condição do dente?', 'Eliminar', true)) { await act(() => DEL('t/dentes_condicoes/' + b.dataset.dc)); redraw(); } });
    $$('[data-dt]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar este tratamento?', 'Eliminar', true)) { await act(() => DEL('t/tratamentos/' + b.dataset.dt)); redraw(); } });
    $$('[data-ag]', el).forEach(b => b.onclick = () => agendarTratamentos([trat.find(t => t.id === Number(b.dataset.ag))], p, redraw));
    $$('[data-done]', el).forEach(b => b.onclick = async () => {
      await act(() => PUT('t/tratamentos/' + b.dataset.done, { estado: 'realizado', data: isoDate(), ...(m ? { marcacao_id: m.id, medico_id: m.medico_id } : {}) }), 'Marcado como feito');
      redraw();
    });
  };
  // mudar a seleção só mexe nos dentes e no painel: o foco fica no dente e não há pedidos ao servidor
  const selMudou = () => {
    $$('.tooth', el).forEach(t => { const on = st.sel.has(t.dataset.n); t.classList.toggle('sel', on); t.setAttribute('aria-pressed', on); });
    $('#od-selinfo', el).innerHTML = selHtml(); $('#od-histbox', el).innerHTML = histHtml();
    $('#od-addc', el).disabled = !st.sel.size; $('#od-clear', el).classList.toggle('hidden', !st.sel.size);
    bindSel();
  };
  bindSel();
  $('#od-clear', el).onclick = () => { st.sel.clear(); st.faces.clear(); selMudou(); $('.tooth', el).focus(); };
  const toque = (t, e) => {
    const n = t.dataset.n; const f = e && e.target.closest('[data-f]')?.dataset.f;
    if (f) { if (!st.sel.has(n)) { st.sel.add(n); st.faces = new Set([f]); } else st.faces.has(f) ? st.faces.delete(f) : st.faces.add(f); }
    else if (st.sel.has(n)) st.sel.delete(n); else st.sel.add(n);
    if (!st.sel.size) st.faces.clear();
    selMudou();
  };
  const dentes = $$('.tooth', el);
  dentes.forEach((t, k) => { t.onclick = e => toque(t, e); t.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toque(t); }
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); dentes[(k + d + dentes.length) % dentes.length].focus(); }
  }; });
  const facesStr = () => [...st.faces].join('');
  const add = async estado => {
    const sv = byId(lk.servicos, st.serv);
    if (!sv) { toast('Escolha o tratamento na lista', true); $('#od-q', el)?.focus(); return; }
    const ent = byId(lk.entidades, p.entidade_id); const s = selList();
    const base = { paciente_id: p.id, medico_id: m?.medico_id || App.user.medico_id || p.medico_id || null, servico_id: sv.id, descricao: sv.nome,
      faces: facesStr(), estado, data: isoDate(), preco: sv.preco, iva: sv.iva, iva_id: sv.iva_id, desconto_pct: ent?.desconto_pct || 0, marcacao_id: estado === 'realizado' ? (m?.id || null) : null };
    const alvos = s.length ? (sv.por_dente ? s.map(d => [d]) : [s]) : [[]];
    await act(async () => { for (const d of alvos) await POST('t/tratamentos', { ...base, dente: d.join(',') || null }); },
      `${sv.nome}: ${estado === 'planeado' ? 'necessário (fica no plano do paciente)' : 'feito'}${s.length ? ' (' + s.join(', ') + ')' : ''}`);
    st.faces.clear(); redraw();
  };
  $('#od-nec', el).onclick = () => add('planeado');
  $('#od-feito', el).onclick = () => add('realizado');
  $('#od-addc', el).onclick = async () => {
    await act(async () => { for (const d of selList()) await POST('t/dentes_condicoes', { paciente_id: p.id, dente: d, condicao: $('#od-cond', el).value, faces: facesStr(), data: isoDate() }); }, 'Condição registada');
    redraw();
  };
  // seletor: escolher, pesquisar
  const marcar = id => { st.serv = id; const x = byId(lk.servicos, id);
    $$('[data-sv]', el).forEach(b => b.classList.toggle('on', Number(b.dataset.sv) === id));
    $('#tp-sel', el).innerHTML = `<b>${esc(x.nome)}</b><span class="num">${eur(x.preco)}</span>`; };
  $$('[data-sv]', el).forEach(b => { b.onclick = () => marcar(Number(b.dataset.sv)); b.ondblclick = () => { marcar(Number(b.dataset.sv)); add('planeado'); }; });
  const q = $('#od-q', el);
  q.oninput = () => {
    const t = q.value.trim().toLowerCase();
    $$('.tp-i', el).forEach(b => b.classList.toggle('hidden', !!t && !b.dataset.txt.includes(t)));
    $$('[data-g]', el).forEach(g => { let n = g.nextElementSibling, vis = false; while (n && !n.hasAttribute('data-g')) { if (!n.classList.contains('hidden')) vis = true; n = n.nextElementSibling; } g.classList.toggle('hidden', !vis); });
  };
  q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = $('.tp-i:not(.hidden)', el); if (f) marcar(Number(f.dataset.sv)); } };
}

// ---------- ecrã de consulta (uma marcação) ----------
route('consulta', async (view, [id]) => {
  const m = await GET('marcacoes/' + id);
  const p = await GET(`pacientes/${m.paciente_id}/resumo`);
  const est = n => L().estados.find(e => e.nome === n);
  const concl = est('Concluída') || L().estados.find(e => e.categoria === 'REALIZADAS');
  const fluxo = [est('Presente'), est('Em consulta'), concl].filter(Boolean);
  view.innerHTML = `<div class="consulta-head card">
      <div class="row">
        <a class="back btn ghost icon" href="#/agenda/${m.inicio.slice(0, 10)}" title="Voltar à agenda" aria-label="Voltar à agenda"><i data-ic="chevron-left"></i></a>
        ${p.foto ? `<img class="avatar" src="${esc(p.foto)}" alt="">` : `<div class="avatar">${esc(iniciais(p.nome))}</div>`}
        <div class="grow"><h1 style="margin:0"><a href="#/paciente/${p.id}" class="plain">${esc(p.nome)}</a></h1>
          <div class="muted small">Proc. <span class="num">${esc(p.numero)}</span>${p.data_nasc ? ` · ${idade(p.data_nasc)} anos` : ''}${p.telemovel ? ` · <span class="num">${esc(p.telemovel)}</span>` : ''}${p.entidade_nome ? ' · ' + esc(p.entidade_nome) : ''}</div></div>
        <div class="consulta-when"><div class="num bold">${fmtDate(m.inicio)} · ${fmtTime(m.inicio)}–${fmtTime(m.fim)}</div><div class="muted small">${esc(m.medico_nome)}${m.gabinete_nome ? ' · ' + esc(m.gabinete_nome) : ''}${m.servico_nome ? ' · ' + esc(m.servico_nome) : ''}</div></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="steps">${fluxo.map(e => `<button class="${e.id === m.estado_id ? 'on' : ''}" data-est="${e.id}">${esc(e.nome)}</button>`).join('')}</div>
        <span class="badge est" style="--st:${esc(m.estado_cor)}">${esc(m.estado_nome)}</span>
        <div class="spacer"></div>
        <button id="cs-edit">Editar marcação</button>
        <button id="cs-next">Marcar próxima</button>
      </div>
      ${alertasHtml(p)}
    </div>
    <div class="consulta-grid">
      <div class="consulta-main" id="cs-odonto"></div>
      <div class="consulta-side">
        <section class="card" id="cs-resumo"></section>
        <section class="card"><h3>Notas da consulta</h3><div id="cs-notas"></div>
          <textarea id="cs-nota" placeholder="O que foi feito, observações, indicações ao paciente…"></textarea>
          <div class="row end" style="margin-top:6px"><button id="cs-nota-add">Guardar nota</button></div></section>
      </div>
    </div>`;
  $$('.steps [data-est]', view).forEach(b => b.onclick = async () => {
    await act(() => PUT('marcacoes/' + m.id, { estado_id: Number(b.dataset.est), forcar: true }), 'Estado atualizado'); render();
  });
  $('#cs-edit').onclick = () => openMarcacao({ id: m.id });
  const resumo = async () => {
    const trat = (await GET(`pacientes/${p.id}/tratamentos`));
    const nesta = trat.filter(t => t.marcacao_id === m.id);
    const feito = nesta.filter(t => t.estado === 'realizado'), nec = trat.filter(t => t.estado === 'planeado');
    const hoje = nec.filter(t => t.marcacao_id === m.id), plano = nec.filter(t => t.marcacao_id !== m.id);
    const porFat = feito.filter(t => !t.documento_id);
    const linha = (t, act2, oculta) => `<li class="${t.estado === 'planeado' ? 'is-nec' : 'is-feito'}${oculta ? ' hidden' : ''}"><span class="mark"></span><span class="grow">${esc(t.descricao)}${t.dente ? ` <span class="muted num">${esc(t.dente)}${t.faces ? ' ' + esc(t.faces) : ''}</span>` : ''}</span>
      ${t.estado === 'realizado' ? estadoChip(t) : ''}<span class="num">${eur(liqTrat(t))}</span>${act2 || ''}</li>`;
    $('#cs-resumo').innerHTML = `${hoje.length ? `<h3>Previsto para esta consulta</h3><ul class="od-hist">${hoje.map(t => linha(t, ` <button class="sm" data-fazer="${t.id}">Feito</button>`)).join('')}</ul><div style="height:12px"></div>` : ''}
      <h3>Feito nesta consulta</h3>
      ${feito.length ? `<ul class="od-hist">${feito.map(t => linha(t, t.documento_id ? ` <a href="#" data-doc="${t.documento_id}" class="small" title="Ver documento">ver</a>` : '')).join('')}</ul>` : '<p class="muted small">Nada registado ainda. Selecione dentes no odontograma e carregue em "Feito".</p>'}
      <div class="row between" style="margin-top:8px"><span class="muted">Total feito</span><b class="ok num">${eur(feito.reduce((s, t) => s + liqTrat(t), 0))}</b></div>
      <button class="primary" id="cs-fat" style="width:100%;justify-content:center;margin-top:8px" ${porFat.length ? '' : 'disabled'}>Faturar o que foi feito${porFat.length ? ' · ' + eur(porFat.reduce((s, t) => s + liqTrat(t), 0)) : ''}</button>
      <h3 style="margin-top:16px">Plano do paciente · por fazer</h3>
      ${plano.length ? `<ul class="od-hist" id="cs-plano">${plano.map((t, k) => linha(t, ` <button class="sm" data-fazer="${t.id}" title="Fazer nesta consulta">Feito</button><button class="sm" data-agc="${t.id}" title="${t.marcacao_inicio ? 'Agendado ' + fmtDT(t.marcacao_inicio) : 'Agendar consulta'}">${t.marcacao_inicio && t.marcacao_inicio >= isoDate() ? fmtDate(t.marcacao_inicio).slice(0, 5) : 'Agendar'}</button>`, k >= 5)).join('')}</ul>
        ${plano.length > 5 ? `<button class="sm ghost" id="cs-mais" aria-controls="cs-plano">Ver mais (${plano.length - 5})</button>` : ''}
        <div class="row between" style="margin-top:8px"><span class="muted">Por fazer</span><b class="danger num">${eur(plano.reduce((s, t) => s + liqTrat(t), 0))}</b></div>` : '<p class="muted small">Sem tratamentos por fazer.</p>'}
      <div class="row" style="margin-top:8px"><button class="sm" id="cs-orc" ${plano.length ? '' : 'disabled'}>Orçamento do plano</button>
        <button class="sm" id="cs-agtodos" ${plano.filter(t => !t.marcacao_inicio || t.marcacao_inicio < isoDate()).length ? '' : 'disabled'}>Agendar o que falta</button></div>`;
    const mais = $('#cs-mais'); if (mais) mais.onclick = () => { const ocultas = $$('#cs-plano li.hidden'); ocultas.forEach(l => l.classList.remove('hidden')); mais.remove(); $('button', ocultas[0])?.focus(); };
    $('#cs-fat').onclick = () => emitirDocumento({ paciente: p, tratamentos: porFat, onDone: () => resumo() });
    $$('[data-doc]', view).forEach(x => x.onclick = e => { e.preventDefault(); verDocumento(Number(x.dataset.doc)); });
    $$('[data-fazer]', view).forEach(b => b.onclick = async () => {
      await act(() => PUT('t/tratamentos/' + b.dataset.fazer, { estado: 'realizado', data: isoDate(), marcacao_id: m.id, medico_id: m.medico_id }), 'Marcado como feito');
      odontograma($('#cs-odonto'), p, { marcacao: m, onChange: resumo }); resumo();
    });
    const refrescar = () => { odontograma($('#cs-odonto'), p, { marcacao: m, onChange: resumo }); resumo(); };
    $$('[data-agc]', view).forEach(b => b.onclick = () => agendarTratamentos([plano.find(t => t.id === Number(b.dataset.agc))], p, refrescar));
    $('#cs-agtodos').onclick = () => agendarTratamentos(plano.filter(t => !t.marcacao_inicio || t.marcacao_inicio < isoDate()), p, refrescar);
    $('#cs-orc').onclick = () => editOrcamento(null, { paciente: p, linhas: plano.filter(t => !t.orcamento_id).map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco, desconto_pct: t.desconto_pct, iva: t.iva, iva_id: t.iva_id })) });
    $('#cs-next').onclick = () => openMarcacao({ paciente: { id: p.id, nome: p.nome }, medico_id: m.medico_id, servico_id: nec[0]?.servico_id });
  };
  const notas = async () => {
    const ns = (await GET(`pacientes/${p.id}/notas`)).filter(n => n.marcacao_id === m.id);
    $('#cs-notas').innerHTML = ns.map(n => `<div class="nota"><div class="muted small">${fmtDT(n.data)} · ${esc(n.medico_nome || n.user_nome || '')}</div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('');
  };
  $('#cs-nota-add').onclick = async () => {
    const texto = $('#cs-nota').value.trim(); if (!texto) return toast('Escreva a nota', true);
    await act(() => POST('notas', { paciente_id: p.id, texto, medico_id: m.medico_id, marcacao_id: m.id }), 'Nota guardada');
    $('#cs-nota').value = ''; App.dirty = false; notas();
  };
  await Promise.all([odontograma($('#cs-odonto'), p, { marcacao: m, onChange: resumo }), resumo(), notas()]);
});

// atalhos: tratamentos mais usados (cache por sessão)
const _freq = {};
async function servicosFrequentes(medicoId) {
  const k = medicoId || 0;
  if (!_freq[k]) _freq[k] = await GET('servicos-frequentes' + (medicoId ? '?medico_id=' + medicoId : '')).catch(() => []);
  return _freq[k];
}
function nomeCurto(n) {
  return String(n).replace(/\s*\([^)]*\)/g, '').replace(/^Restauração compósito/, 'Restauração').replace(/^Consulta de /, 'Consulta ').replace(/^Endodontia /, 'Endo ').trim();
}

// agenda uma consulta para um ou mais tratamentos do plano e liga-os a essa marcação
function agendarTratamentos(lista, p, onDone) {
  lista = (lista || []).filter(Boolean);
  if (!lista.length) return toast('Nada para agendar', true);
  const lk = L();
  const dur = Math.max(15, lista.reduce((s, t) => s + (byId(lk.servicos, t.servico_id)?.duracao_min || 30), 0));
  const nota = lista.map(t => `${t.descricao}${t.dente ? ' (' + t.dente + ')' : ''}`).join('; ');
  openMarcacao({ paciente: { id: p.id, nome: p.nome }, medico_id: lista[0].medico_id || p.medico_id, servico_id: lista[0].servico_id, duracao: Math.min(dur, 240), notas: nota,
    onSaved: async mk => {
      for (const t of lista) await PUT('t/tratamentos/' + t.id, { marcacao_id: mk.id });
      toast(`Agendado para ${fmtDT(mk.inicio)}`); onDone && onDone();
    } });
}
