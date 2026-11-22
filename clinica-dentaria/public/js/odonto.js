'use strict';
/* Odontograma interativo reutilizável (ficha do paciente e ecrã de consulta).
   Vermelho = necessário (planeado), azul = feito (realizado). */


function liqTrat(t) { return (t.preco || 0) * (1 - (t.desconto_pct || 0) / 100) * (1 + (t.iva || 0) / 100); }

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
  const selList = [...st.sel].sort();
  const items = selList.flatMap(n => S(n).items.map(i => ({ ...i, _d: n })));
  const seen = new Set(); const hist = items.filter(i => { const k = i.kind + i.id; if (seen.has(k)) return false; seen.add(k); return true; });
  // serviços agrupados por especialidade
  const grupos = {};
  for (const s of ativos(lk.servicos)) (grupos[byId(lk.especialidades, s.especialidade_id)?.nome || 'Outros'] ||= []).push(s);
  const servOpts = `<option value="">Escolha o tratamento…</option>` + Object.entries(grupos).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(s => `<option value="${s.id}">${esc(s.nome)} — ${eur(s.preco)}</option>`).join('')}</optgroup>`).join('');

  el.innerHTML = `<div class="od-wrap">
    <section class="card od-chart">
      <div class="row between"><h3 style="margin:0">Odontograma</h3>
        <span class="row"><span class="seg" role="group" aria-label="Mostrar">${[['tudo', 'Tudo'], ['nec', 'Necessário'], ['feito', 'Feito'], ...(m ? [['consulta', 'Esta consulta']] : [])].map(([k, l]) => `<button type="button" data-filtro="${k}" class="${filtro === k ? 'on' : ''}">${l}</button>`).join('')}</span>
        <label class="check small"><input type="checkbox" id="od-dec" ${st.dec ? 'checked' : ''}> Decídua</label>
        ${st.sel.size ? '<button class="sm ghost" id="od-clear">Limpar seleção</button>' : ''}</span></div>
      <div class="odonto">${arc(Q_UP)}${st.dec ? arc(D_UP) + '<div class="midline"></div>' + arc(D_LO, true) : '<div class="midline"></div>'}${arc(Q_LO, true)}</div>
      <div class="odonto-legend"><span style="--c:${COR_NEC}">Necessário</span><span style="--c:${COR_FEITO}">Feito / existente</span>
        </div>
      <p class="muted small center" style="margin:4px 0 0">Clique no dente para o selecionar; clique numa face da vista oclusal para a marcar.</p>
    </section>
    <section class="card od-panel">
      <div class="od-target">${selList.length ? `<span class="muted">Dente${selList.length > 1 ? 's' : ''}</span> <b class="num">${selList.join(', ')}</b>` : '<span class="muted">Nenhum dente selecionado: o tratamento fica para a boca toda.</span><br><span class="small muted">Clique nos dentes para os selecionar; pode escolher vários.</span>'}</div>
      ${selList.length ? `<div class="faces" role="group" aria-label="Faces">${Object.entries(FACES).map(([k, l]) => `<button type="button" class="face ${st.faces.has(k) ? 'on' : ''}" data-face="${k}" title="${l}">${k}</button>`).join('')}<span class="small muted">faces</span></div>` : ''}
      <select id="od-serv" style="margin-top:8px">${servOpts}</select>
      <div class="od-actions">
        <button class="nec" id="od-nec">Necessário</button>
        <button class="primary" id="od-feito">${m ? 'Feito nesta consulta' : 'Feito'}</button>
      </div>
      <details class="od-more"><summary>Registar condição do dente</summary>
        <div class="row" style="margin-top:6px">${sel('cond', optsArr(CONDICOES.map(([k, l]) => [k, l])), 'id="od-cond" style="flex:1"')}<button id="od-addc" ${selList.length ? '' : 'disabled'}>Registar</button></div></details>
      ${selList.length ? `<h3 style="margin:14px 0 4px">Histórico</h3>${hist.length ? `<ul class="od-hist">${hist.map(i => i.kind === 'c'
        ? `<li><span class="dot" style="background:${COND[i.condicao]?.c}"></span><span class="grow">${esc(COND[i.condicao]?.l || i.condicao)} <span class="muted">${esc(i.dente)}${i.faces ? ' ' + esc(i.faces) : ''}</span></span><span class="muted small">${fmtDate(i.data)}</span>
           <button class="ghost sm icon" data-dc="${i.id}" title="Eliminar" aria-label="Eliminar"><i data-ic="trash"></i></button></li>`
        : `<li class="${i.estado === 'planeado' ? 'is-nec' : 'is-feito'}"><span class="mark"></span><span class="grow">${esc(i.descricao)} <span class="muted">${esc(i.dente)}${i.faces ? ' ' + esc(i.faces) : ''}</span></span><span class="muted small">${fmtDate(i.data)}</span>
           ${i.estado === 'planeado' ? `<button class="sm" data-done="${i.id}">Feito</button>` : ''}${i.documento_id ? '' : `<button class="ghost sm icon" data-dt="${i.id}" title="Eliminar" aria-label="Eliminar"><i data-ic="trash"></i></button>`}</li>`).join('')}</ul>` : '<p class="muted small">Sem registos.</p>'}` : ''}
    </section></div>`;

  const redraw = async () => { await odontograma(el, p, opts); opts.onChange && opts.onChange(); };
  $('#od-dec', el).onchange = e => { st.dec = e.target.checked; odontograma(el, p, opts); };
  const clr = $('#od-clear', el); if (clr) clr.onclick = () => { st.sel.clear(); st.faces.clear(); odontograma(el, p, opts); };
  $$('[data-filtro]', el).forEach(b => b.onclick = () => { st.filtro = b.dataset.filtro; odontograma(el, p, opts); });
  const toque = (t, e) => {
    const n = t.dataset.n; const f = e && e.target.closest('[data-f]')?.dataset.f;
    if (f) { if (!st.sel.has(n)) { st.sel.add(n); st.faces = new Set([f]); } else st.faces.has(f) ? st.faces.delete(f) : st.faces.add(f); }
    else if (st.sel.has(n)) st.sel.delete(n); else st.sel.add(n);
    if (!st.sel.size) st.faces.clear();
    odontograma(el, p, opts);
  };
  $$('.tooth', el).forEach(t => { t.onclick = e => toque(t, e); t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toque(t); } }; });
  $$('[data-face]', el).forEach(b => b.onclick = () => { const f = b.dataset.face; st.faces.has(f) ? st.faces.delete(f) : st.faces.add(f); b.classList.toggle('on'); });
  const facesStr = () => [...st.faces].join('');
  const add = async estado => {
    const sv = byId(lk.servicos, $('#od-serv', el).value);
    if (!sv) { toast('Escolha o tratamento', true); $('#od-serv', el).focus(); return; }
    const ent = byId(lk.entidades, p.entidade_id);
    const base = { paciente_id: p.id, medico_id: m?.medico_id || App.user.medico_id || p.medico_id || null, servico_id: sv.id, descricao: sv.nome,
      faces: facesStr(), estado, data: isoDate(), preco: sv.preco, iva: sv.iva, iva_id: sv.iva_id, desconto_pct: ent?.desconto_pct || 0, marcacao_id: m?.id || null };
    const dentes = selList.length ? (sv.por_dente ? selList.map(d => [d]) : [selList]) : [[]];
    await act(async () => { for (const d of dentes) await POST('t/tratamentos', { ...base, dente: d.join(',') || null }); },
      `${sv.nome}: ${estado === 'planeado' ? 'necessário' : 'feito'}${selList.length ? ' (' + selList.join(', ') + ')' : ''}`);
    st.faces.clear(); redraw();
  };
  $('#od-nec', el).onclick = () => add('planeado');
  $('#od-feito', el).onclick = () => add('realizado');
  $('#od-addc', el).onclick = async () => {
    await act(async () => { for (const d of selList) await POST('t/dentes_condicoes', { paciente_id: p.id, dente: d, condicao: $('#od-cond', el).value, faces: facesStr(), data: isoDate() }); }, 'Condição registada');
    redraw();
  };
  $$('[data-dc]', el).forEach(b => b.onclick = async () => { await DEL('t/dentes_condicoes/' + b.dataset.dc); redraw(); });
  $$('[data-dt]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar este tratamento?', 'Eliminar', true)) { await DEL('t/tratamentos/' + b.dataset.dt); redraw(); } });
  $$('[data-done]', el).forEach(b => b.onclick = async () => {
    await act(() => PUT('t/tratamentos/' + b.dataset.done, { estado: 'realizado', data: isoDate(), ...(m ? { marcacao_id: m.id, medico_id: m.medico_id } : {}) }), 'Marcado como feito');
    redraw();
  });
}

// ---------- ecrã de consulta (uma marcação) ----------
route('consulta', async (view, [id]) => {
  const m = await GET('marcacoes/' + id);
  const p = await GET(`pacientes/${m.paciente_id}/resumo`);
  const a = p.anamnese || {};
  const alertas = [a.alergias && `Alergias: ${a.alergias}`, a.anticoagulantes && 'Anticoagulantes', a.cardiaco && 'Doença cardíaca', a.diabetes && 'Diabetes',
    a.hipertensao && 'Hipertensão', a.gravidez && 'Gravidez', a.hepatite && 'Hepatite'].filter(Boolean);
  const est = n => L().estados.find(e => e.nome === n);
  const concl = est('Concluída') || L().estados.find(e => e.categoria === 'REALIZADAS');
  const fluxo = [est('Presente'), est('Em consulta'), concl].filter(Boolean);
  view.innerHTML = `<div class="consulta-head card">
      <div class="row">
        <a class="back btn ghost icon" href="#/agenda/${m.inicio.slice(0, 10)}" title="Voltar à agenda" aria-label="Voltar à agenda"><i data-ic="chevron-left"></i></a>
        ${p.foto ? `<img class="avatar" src="${esc(p.foto)}" alt="">` : `<div class="avatar">${esc(p.nome.split(' ').filter(Boolean).filter((_, i, x) => i === 0 || i === x.length - 1).map(w => w[0]).join('').toUpperCase())}</div>`}
        <div class="grow"><h1 style="margin:0"><a href="#/paciente/${p.id}" class="plain">${esc(p.nome)}</a></h1>
          <div class="muted small">Proc. <span class="num">${esc(p.numero)}</span>${p.data_nasc ? ` · ${idade(p.data_nasc)} anos` : ''}${p.telemovel ? ` · <span class="num">${esc(p.telemovel)}</span>` : ''}${p.entidade_nome ? ' · ' + esc(p.entidade_nome) : ''}</div></div>
        <div class="consulta-when"><div class="num bold">${fmtDate(m.inicio)} · ${fmtTime(m.inicio)}–${fmtTime(m.fim)}</div><div class="muted small">${esc(m.medico_nome)}${m.gabinete_nome ? ' · ' + esc(m.gabinete_nome) : ''}${m.servico_nome ? ' · ' + esc(m.servico_nome) : ''}</div></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="steps">${fluxo.map(e => `<button class="${e.id === m.estado_id ? 'on' : ''}" data-est="${e.id}">${esc(e.nome)}</button>`).join('')}</div>
        <span class="badge" style="background:${esc(m.estado_cor)}1f;color:${esc(m.estado_cor)}">${esc(m.estado_nome)}</span>
        <div class="spacer"></div>
        <button id="cs-edit">Editar marcação</button>
        <button id="cs-next">Marcar próxima</button>
      </div>
      ${alertas.length ? `<div class="alert danger" style="margin:10px 0 0">${alertas.map(esc).join(' · ')}</div>` : ''}
    </div>
    <div class="consulta-body">
      <div id="cs-odonto"></div>
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
    const porFat = feito.filter(t => !t.documento_id);
    const linha = (t, act2) => `<li class="${t.estado === 'planeado' ? 'is-nec' : 'is-feito'}"><span class="mark"></span><span class="grow">${esc(t.descricao)}${t.dente ? ` <span class="muted num">${esc(t.dente)}${t.faces ? ' ' + esc(t.faces) : ''}</span>` : ''}</span>
      ${t.estado === 'realizado' ? estadoChip(t) : ''}<span class="num">${eur(liqTrat(t))}</span>${act2 || ''}</li>`;
    $('#cs-resumo').innerHTML = `<h3>Feito nesta consulta</h3>
      ${feito.length ? `<ul class="od-hist">${feito.map(t => linha(t, t.documento_id ? ` <a href="#" data-doc="${t.documento_id}" class="small" title="Ver documento">ver</a>` : '')).join('')}</ul>` : '<p class="muted small">Nada registado ainda. Selecione dentes no odontograma e carregue em "Feito".</p>'}
      <div class="row between" style="margin-top:8px"><span class="muted">Total feito</span><b class="ok num">${eur(feito.reduce((s, t) => s + liqTrat(t), 0))}</b></div>
      <button class="primary" id="cs-fat" style="width:100%;justify-content:center;margin-top:8px" ${porFat.length ? '' : 'disabled'}>Faturar o que foi feito${porFat.length ? ' · ' + eur(porFat.reduce((s, t) => s + liqTrat(t), 0)) : ''}</button>
      <h3 style="margin-top:16px">Necessário (plano em aberto)</h3>
      ${nec.length ? `<ul class="od-hist">${nec.map(t => linha(t, ` <button class="sm" data-fazer="${t.id}">Feito</button>`)).join('')}</ul>
        <div class="row between" style="margin-top:8px"><span class="muted">Por fazer</span><b class="danger num">${eur(nec.reduce((s, t) => s + liqTrat(t), 0))}</b></div>` : '<p class="muted small">Sem tratamentos por fazer.</p>'}
      <div class="row" style="margin-top:8px"><button class="sm" id="cs-orc" ${nec.length ? '' : 'disabled'}>Orçamento do plano</button></div>`;
    $('#cs-fat').onclick = () => emitirDocumento({ paciente: p, tratamentos: porFat, onDone: () => resumo() });
    $$('[data-doc]', view).forEach(x => x.onclick = e => { e.preventDefault(); verDocumento(Number(x.dataset.doc)); });
    $$('[data-fazer]', view).forEach(b => b.onclick = async () => {
      await act(() => PUT('t/tratamentos/' + b.dataset.fazer, { estado: 'realizado', data: isoDate(), marcacao_id: m.id, medico_id: m.medico_id }), 'Marcado como feito');
      odontograma($('#cs-odonto'), p, { marcacao: m, onChange: resumo }); resumo();
    });
    $('#cs-orc').onclick = () => editOrcamento(null, { paciente: p, linhas: nec.filter(t => !t.orcamento_id).map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco, desconto_pct: t.desconto_pct, iva: t.iva, iva_id: t.iva_id })) });
    $('#cs-next').onclick = () => openMarcacao({ paciente: { id: p.id, nome: p.nome }, medico_id: m.medico_id, servico_id: nec[0]?.servico_id });
  };
  const notas = async () => {
    const ns = (await GET(`pacientes/${p.id}/notas`)).filter(n => n.marcacao_id === m.id);
    $('#cs-notas').innerHTML = ns.map(n => `<div class="nota"><div class="muted small">${esc(n.data)} · ${esc(n.medico_nome || n.user_nome || '')}</div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('');
  };
  $('#cs-nota-add').onclick = async () => {
    const texto = $('#cs-nota').value.trim(); if (!texto) return toast('Escreva a nota', true);
    await act(() => POST('notas', { paciente_id: p.id, texto, medico_id: m.medico_id, marcacao_id: m.id }), 'Nota guardada');
    $('#cs-nota').value = ''; notas();
  };
  await Promise.all([odontograma($('#cs-odonto'), p, { marcacao: m, onChange: resumo }), resumo(), notas()]);
});
