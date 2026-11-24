'use strict';
/* Início, próteses, stocks, estatísticas, comunicação (SMS), aniversários */

// ---------- início ----------
route('inicio', async (view) => {
  const d = await GET('dashboard');
  const hoje = d.hoje;
  const ativas = hoje.filter(m => !['INATIVAS', 'FALTAS'].includes(m.estado_categoria));
  const meus = App.user.perfil === 'medico' ? hoje.filter(m => m.medico_id === App.user.medico_id) : hoje;
  view.innerHTML = `<div class="page-head"><h1>Hoje</h1><span class="muted">${dataLonga(isoDate())}</span>
    ${d.feriado ? `<span class="badge danger">Feriado: ${esc(d.feriado.nome)}</span>` : ''}</div>
    <div class="facts">
      <a class="fact" href="#/agenda"><div class="l">Marcações hoje</div><div class="v">${ativas.length}</div><div class="small muted">${hoje.filter(m => m.estado_nome === 'Presente').length} presente(s)</div></a>
      <a class="fact" href="#/faturacao/caixa"><div class="l">Recebido hoje</div><div class="v ok">${eur(d.recebido_hoje)}</div><div class="small muted">Faturado ${eur(d.faturado_hoje)}</div></a>
      <a class="fact" href="#/proteses/atraso"><div class="l">Próteses em atraso</div><div class="v ${d.proteses_atraso ? 'danger' : ''}">${d.proteses_atraso}</div><div class="small muted">${d.proteses_clinica} na clínica p/ entrega</div></a>
      <a class="fact" href="#/stocks"><div class="l">Alertas de stock</div><div class="v ${d.stock_alertas ? 'warn' : ''}">${d.stock_alertas}</div><div class="small muted">${d.orcamentos_abertos} orçamento(s) em aberto</div></a>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
      <div class="card"><div class="row between"><h2>${App.user.perfil === 'medico' ? 'As minhas consultas de hoje' : 'Consultas de hoje'}</h2><a href="#/agenda">Abrir agenda</a></div>
        ${table(meus, [
          { h: 'Hora', cls: 'nowrap', f: m => `<b>${fmtTime(m.inicio)}</b>` }, { h: 'Paciente', f: m => `<a href="#/paciente/${m.paciente_id}">${esc(m.paciente_nome)}</a>` },
          { h: 'Médico', cls: 'nowrap', f: m => `<span class="dot" style="background:${esc(m.medico_cor)}"></span>${esc(m.medico_nome)}` }, { h: 'Serviço', f: m => esc(m.servico_nome) },
          { h: 'Estado', cls: 'nowrap', f: estadoBadge },
          { h: '', cls: 'right nowrap', f: m => estadoRapido(m) }], { onClick: m => openMarcacao({ id: m.id }), empty: 'Sem marcações para hoje' })}</div>
      <div>
        <div class="card"><h3>Aniversários hoje</h3>${d.aniversarios.map(p => `<div><a href="#/paciente/${p.id}">${esc(p.nome)}</a> <span class="muted small">(${idade(p.data_nasc)} anos)</span></div>`).join('') || '<div class="muted">Nenhum</div>'}
          <div style="margin-top:8px"><a href="#/comunicacao/aniversarios">Ver aniversários</a></div></div>
        <div class="card"><h3>Atalhos</h3><div class="row">
          <button onclick="openMarcacao({})">Nova marcação</button><button onclick="editPaciente(null, p => go('#/paciente/' + p.id))">Novo paciente</button>
          <button onclick="emitirDocumento({onDone: () => render()})">Documento</button><button onclick="emitirRecibo({onDone: () => render()})">Recibo</button>
          <button onclick="editOrcamento(null, {})">Orçamento</button><button onclick="lembretesAmanha()">Lembretes amanhã</button></div></div>
      </div></div>`;
  bindEstadoRapido(view, render);
});
async function lembretesAmanha() { const saved = AG.date; AG.date = isoDate(); await lembretesDia(); AG.date = saved; }

// ---------- próteses ----------
const FASES = { pedido: ['Pedido (por enviar)', 'warn'], enviado: ['Enviado ao laboratório', 'info'], em_prova: ['Em prova', 'info'], recebido: ['Recebido na clínica', 'ok'], entregue: ['Entregue ao paciente', ''], cancelado: ['Cancelado', 'danger'] };
const TIPOS_PROT = ['Coroa', 'Ponte', 'Prótese removível acrílica', 'Prótese esquelética', 'Prótese total', 'Faceta', 'Inlay/Onlay', 'Coroa sobre implante', 'Goteira', 'Aparelho/contenção', 'Outro'];
const PROT_COLS = [
  { h: 'Paciente', f: r => `<b>${esc(r.paciente_nome)}</b>` }, { h: 'Tipo', f: r => esc(r.tipo) }, { h: 'Dentes', f: r => esc(r.dentes) },
  { h: 'Laboratório', f: r => esc(r.laboratorio_nome) }, { h: 'Médico', f: r => esc(r.medico_nome) }, { h: 'Emissão', f: r => fmtDate(r.data_emissao) },
  { h: 'Prevista', f: r => `${fmtDate(r.data_prevista)}${['pedido', 'enviado', 'em_prova'].includes(r.fase) && r.data_prevista && r.data_prevista < isoDate() ? ' <span class="badge danger">atraso</span>' : ''}` },
  { h: 'Fase', f: r => `<span class="badge ${FASES[r.fase]?.[1]}">${esc(FASES[r.fase]?.[0] || r.fase)}</span>`, csv: r => FASES[r.fase]?.[0] },
  { h: 'Custo', cls: 'right', f: r => r.custo ? eur(r.custo) : '' },
];
route('proteses', async (view, [filtro = 'pendentes']) => {
  const fl = [['atraso', 'Em atraso'], ['pendentes', 'Pendentes no laboratório'], ['para_enviar', 'Para enviar'], ['na_clinica', 'Na clínica (p/ prova ou entrega)'], ['entregues', 'Entregues'], ['canceladas', 'Canceladas'], ['todas', 'Todas']];
  view.innerHTML = `<div class="page-head"><h1>Próteses / Laboratório</h1><div class="spacer"></div><button id="pr-csv">Exportar</button><button class="primary" id="pr-new">Novo trabalho</button></div>
    <div class="subnav">${fl.map(([k, l]) => `<button class="${k === filtro ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div><div class="card" id="pr-list"></div>`;
  $$('.subnav button', view).forEach(b => b.onclick = () => go('#/proteses/' + b.dataset.f));
  const rows = await GET('proteses?filtro=' + filtro);
  $('#pr-list').innerHTML = table(rows, PROT_COLS, { onClick: r => editProtese(r), empty: 'Sem trabalhos nesta vista' });
  $('#pr-new').onclick = () => editProtese(null);
  $('#pr-csv').onclick = () => downloadCSV('proteses', rows, PROT_COLS);
});
async function tabProtesesPac(el, p) {
  const rows = await GET('proteses?paciente_id=' + p.id);
  el.innerHTML = `<div class="card"><div class="row end" style="margin-bottom:10px"><button class="primary" id="pp-new">Novo trabalho</button></div>${table(rows, PROT_COLS, { onClick: r => editProtese(r), empty: 'Sem trabalhos de prótese' })}</div>`;
  $('#pp-new').onclick = () => editProtese(null, p);
}
function editProtese(r, paciente) {
  const lk = L(); r = r || { data_emissao: isoDate(), data_prevista: addDays(isoDate(), 10), fase: 'pedido', medico_id: paciente?.medico_id || App.user.medico_id, paciente_id: paciente?.id, paciente_nome: paciente?.nome };
  const next = { pedido: ['enviado', 'Marcar enviado', 'data_envio'], enviado: ['recebido', 'Marcar recebido', 'data_rececao'], em_prova: ['recebido', 'Recebido (após prova)', 'data_rececao'], recebido: ['entregue', 'Marcar entregue', 'data_entrega'] }[r.fase];
  const buttons = [];
  if (r.id && App.user.perfil === 'admin') buttons.push({ label: 'Eliminar', cls: 'danger', left: true, onClick: async () => { if (!await confirmDlg('Eliminar este trabalho?', 'Eliminar', true)) return false; await DEL('t/proteses/' + r.id); render(); } });
  if (r.id) buttons.push({ label: 'Guia', onClick: () => { imprimirGuiaProtese(r); return false; } });
  buttons.push({ label: 'Cancelar' });
  const save = async (c, extra = {}) => {
    const f = { ...readForm($('form', c.body)), ...extra };
    if (!f.paciente_id) throw new Error('Escolha o paciente');
    for (const k of ['paciente_id', 'medico_id', 'laboratorio_id']) f[k] = f[k] ? Number(f[k]) : null;
    r.id ? await PUT('t/proteses/' + r.id, f) : await POST('t/proteses', f);
    toast('Trabalho guardado'); render();
  };
  if (r.id && next) buttons.push({ label: '' + next[1], onClick: c => save(c, { fase: next[0], [next[2]]: isoDate() }) });
  buttons.push({ label: 'Guardar', cls: 'primary', onClick: c => save(c) });
  modal({ title: r.id ? 'Trabalho de prótese' : 'Novo trabalho de prótese', size: 'lg', body: `<form class="form-grid" onsubmit="return false">
    <div class="s2">${pacField('paciente_id', r.paciente_id, r.paciente_nome)}</div>
    ${fld('Médico', sel('medico_id', opts(lk.medicos, r.medico_id, { empty: '—', only: x => x.ativo })))}${fld('Laboratório', sel('laboratorio_id', opts(lk.laboratorios, r.laboratorio_id, { empty: '—', only: x => x.ativo })))}
    ${fld('Tipo', sel('tipo', optsArr(TIPOS_PROT, r.tipo)))}${fld('Dentes', inp('dentes', r.dentes))}${fld('Cor', inp('cor', r.cor, 'placeholder="ex.: A2"'))}${fld('Referência lab.', inp('referencia', r.referencia))}
    ${fld('Descrição / instruções', txt('descricao', r.descricao), 's4')}
    ${fld('Emissão', inp('data_emissao', r.data_emissao, 'type="date"'))}${fld('Prevista', inp('data_prevista', r.data_prevista, 'type="date"'))}
    ${fld('Envio', inp('data_envio', r.data_envio, 'type="date"'))}${fld('Receção', inp('data_rececao', r.data_rececao, 'type="date"'))}
    ${fld('Entrega ao paciente', inp('data_entrega', r.data_entrega, 'type="date"'))}${fld('Fase', sel('fase', optsArr(Object.entries(FASES).map(([k, v]) => [k, v[0]]), r.fase)))}
    ${fld('Custo laboratório (€)', inp('custo', r.custo, 'type="number" step="0.01"'))}<div></div>
    ${fld('Notas', txt('notas', r.notas), 's4')}</form>`, buttons, onOpen: c => bindPacField($('form', c.body), 'paciente_id') });
}
function imprimirGuiaProtese(r) {
  printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Guia de prótese</h2>Emissão: ${fmtDate(r.data_emissao)}<br>Entrega prevista: ${fmtDate(r.data_prevista)}</div></div>
    <p>Laboratório: <b>${esc(r.laboratorio_nome || '')}</b></p><p>Paciente: <b>${esc(r.paciente_nome)}</b><br>Médico: ${esc(r.medico_nome || '')}</p>
    <table><tr><th>Tipo</th><td>${esc(r.tipo)}</td></tr><tr><th>Dentes</th><td>${esc(r.dentes)}</td></tr><tr><th>Cor</th><td>${esc(r.cor)}</td></tr><tr><th>Instruções</th><td>${esc(r.descricao).replace(/\n/g, '<br>')}</td></tr></table>
    <div style="margin-top:50px">Assinatura: ______________________</div></div>`);
}

// ---------- stocks ----------
const MOV_TIPOS = { entrada: 'Entrada', saida: 'Saída / consumo', 'ajuste+': 'Ajuste (+)', 'ajuste-': 'Ajuste (−)', transf_entrada: 'Transferência (entrada)', transf_saida: 'Transferência (saída)' };
route('stocks', async (view, [sub = 'existencias']) => {
  view.innerHTML = `<div class="page-head"><h1>Stocks</h1><div class="spacer"></div>
    <button id="st-in">Entrada</button><button id="st-out">Saída</button><button id="st-tr">Transferir</button><button class="primary" id="st-prod">Novo produto</button></div>
    <div class="subnav">${[['existencias', 'Existências'], ['movimentos', 'Movimentos'], ['produtos', 'Produtos']].map(([k, l]) => `<button class="${k === sub ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div><div id="st-body"></div>`;
  $$('.subnav button', view).forEach(b => b.onclick = () => go('#/stocks/' + b.dataset.s));
  $('#st-in').onclick = () => movimentoStock('entrada'); $('#st-out').onclick = () => movimentoStock('saida');
  $('#st-tr').onclick = () => transferirStock(); $('#st-prod').onclick = () => editProduto(null);
  const body = $('#st-body');
  if (sub === 'movimentos') {
    const rows = await GET('stocks/movimentos');
    body.innerHTML = `<div class="card">${table(rows, [{ h: 'Data', f: r => fmtDate(r.data) }, { h: 'Produto', f: r => esc(r.produto_nome) }, { h: 'Armazém', f: r => esc(r.armazem_nome) },
      { h: 'Tipo', f: r => esc(MOV_TIPOS[r.tipo] || r.tipo) }, { h: 'Qtd', cls: 'right', f: r => `${['saida', 'ajuste-', 'transf_saida'].includes(r.tipo) ? '−' : '+'}${num(r.qtd)} ${esc(r.unidade)}` },
      { h: 'Lote', f: r => esc(r.lote) }, { h: 'Validade', f: r => fmtDate(r.validade) }, { h: 'Motivo', f: r => esc(r.motivo) },
      { h: '', f: r => `<button class="ghost sm icon" data-del="${r.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button>` }], { empty: 'Sem movimentos' })}</div>`;
    $$('[data-del]', body).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar este movimento?', 'Eliminar', true)) { await DEL('t/movimentos_stock/' + b.dataset.del); render(); } });
    return;
  }
  if (sub === 'produtos') {
    const rows = await GET('t/produtos');
    body.innerHTML = `<div class="card">${table(rows, [{ h: 'Código', f: r => esc(r.codigo) }, { h: 'Produto', f: r => `<b>${esc(r.nome)}</b>` }, { h: 'Família', f: r => esc(r.familia) },
      { h: 'Unid.', f: r => esc(r.unidade) }, { h: 'Mín.', cls: 'right', f: r => num(r.stock_min) }, { h: 'Ideal', cls: 'right', f: r => num(r.stock_ideal) },
      { h: 'Custo', cls: 'right', f: r => eur(r.preco_custo) }, { h: 'Fornecedor', f: r => esc(r.fornecedor) }], { onClick: r => editProduto(r), rowCls: r => r.ativo ? '' : 'off' })}</div>`;
    return;
  }
  const arm = body.dataset.arm || '';
  const rows = await GET('stocks/existencias' + (arm ? '?armazem_id=' + arm : ''));
  const familias = [...new Set(rows.map(r => r.familia).filter(Boolean))].sort();
  body.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px">
    <input id="st-q" placeholder="Pesquisar produto…" style="max-width:280px">
    <select id="st-arm" aria-label="Armazém" style="width:auto">${opts(ativos(L().armazens), arm, { empty: 'Todos os armazéns' })}</select>
    <select id="st-fam" aria-label="Família" style="width:auto"><option value="">Todas as famílias</option>${familias.map(f => `<option>${esc(f)}</option>`).join('')}</select>
    <select id="st-al" aria-label="Alertas" style="width:auto">${optsArr([['', 'Todos'], ['alerta', 'Só com alertas']])}</select><div class="spacer"></div><button id="st-csv">Exportar</button></div>
    <div class="legend" style="margin-bottom:8px"><span><span class="badge danger">negativo / abaixo do mínimo</span></span><span><span class="badge warn">abaixo do ideal</span></span><span><span class="badge info">validade ≤ 60 dias</span></span></div>
    <div id="st-tbl"></div></div>`;
  const cols = [{ h: 'Código', f: r => esc(r.codigo) }, { h: 'Produto', f: r => `<b>${esc(r.nome)}</b>` }, { h: 'Família', f: r => esc(r.familia) },
    { h: 'Qtd', cls: 'right', f: r => `<b class="${r.alertas.includes('negativo') || r.alertas.includes('minimo') ? 'danger' : ''}">${num(r.qtd)}</b> ${esc(r.unidade)}`, csv: r => r.qtd },
    { h: 'Mín./Ideal', cls: 'right', f: r => `${num(r.stock_min)} / ${num(r.stock_ideal)}` }, { h: 'Próx. validade', f: r => fmtDate(r.prox_validade) },
    { h: 'A encomendar', cls: 'right', f: r => r.qtd < r.stock_ideal ? num(r.stock_ideal - r.qtd) : '' },
    { h: 'Alertas', f: r => r.alertas.map(a => `<span class="badge ${{ negativo: 'danger', minimo: 'danger', ideal: 'warn', validade: 'info' }[a]}">${{ negativo: 'negativo', minimo: '< mínimo', ideal: '< ideal', validade: 'validade' }[a]}</span>`).join(' '), csv: r => r.alertas.join(',') }];
  const draw = () => {
    const q = $('#st-q').value.toLowerCase(), fam = $('#st-fam').value, al = $('#st-al').value;
    const fr = rows.filter(r => (!q || (r.nome + ' ' + (r.codigo || '')).toLowerCase().includes(q)) && (!fam || r.familia === fam) && (!al || r.alertas.length));
    $('#st-tbl').innerHTML = table(fr, cols, { onClick: r => verLotes(r) });
    $('#st-csv').onclick = () => downloadCSV('existencias', fr, cols);
  };
  $('#st-q').oninput = draw; $('#st-fam').onchange = draw; $('#st-al').onchange = draw;
  $('#st-arm').onchange = e => { body.dataset.arm = e.target.value; render(); };
  draw();
});
async function verLotes(p) {
  const l = await GET('stocks/lotes?produto_id=' + p.id);
  modal({ title: p.nome, body: table(l, [{ h: 'Armazém', f: r => esc(r.armazem) }, { h: 'Lote', f: r => esc(r.lote || '—') }, { h: 'Validade', f: r => fmtDate(r.validade) }, { h: 'Qtd', cls: 'right', f: r => num(r.qtd) }], { empty: 'Sem existências' }),
    buttons: [{ label: 'Editar produto', left: true, onClick: () => editProduto(p) }, { label: 'Saída', onClick: () => movimentoStock('saida', p) }, { label: 'Entrada', cls: 'primary', onClick: () => movimentoStock('entrada', p) }] });
}
async function movimentoStock(tipo, produto) {
  const lk = L(); const prods = await GET('t/produtos?ativo=1');
  modal({ title: tipo === 'entrada' ? 'Entrada de stock' : 'Saída / consumo de stock', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Produto', sel('produto_id', opts(prods, produto?.id, { label: p => `${p.nome}${p.codigo ? ' (' + p.codigo + ')' : ''}` })), 's4')}
    ${fld('Tipo', sel('tipo', optsArr(tipo === 'entrada' ? [['entrada', 'Entrada (compra)'], ['ajuste+', 'Ajuste de inventário (+)']] : [['saida', 'Saída / consumo'], ['ajuste-', 'Ajuste de inventário (−)']])))}
    ${fld('Armazém', sel('armazem_id', opts(ativos(lk.armazens), lk.armazens[0]?.id)))}${fld('Quantidade', inp('qtd', 1, 'type="number" step="any" min="0"'))}${fld('Data', inp('data', isoDate(), 'type="date"'))}
    ${fld('Lote', inp('lote', ''))}${fld('Validade', inp('validade', '', 'type="date"'))}${fld('Motivo / documento', inp('motivo', ''), 's2')}</form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Registar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body)); f.produto_id = Number(f.produto_id); f.armazem_id = Number(f.armazem_id);
    await POST('t/movimentos_stock', f); toast('Movimento registado'); if (App.current === 'stocks') render();
  } }] });
}
async function transferirStock() {
  const lk = L(); const prods = await GET('t/produtos?ativo=1'); const arms = ativos(lk.armazens);
  modal({ title: 'Transferência entre armazéns', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Produto', sel('produto_id', opts(prods)), 's4')}${fld('De', sel('de', opts(arms, arms[0]?.id)), 's2')}${fld('Para', sel('para', opts(arms, arms[1]?.id)), 's2')}
    ${fld('Quantidade', inp('qtd', 1, 'type="number" step="any"'))}${fld('Lote', inp('lote', ''))}${fld('Validade', inp('validade', '', 'type="date"'))}</form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Transferir', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body)); await POST('stocks/transferir', { ...f, produto_id: Number(f.produto_id), de: Number(f.de), para: Number(f.para) });
    toast('Transferência registada'); if (App.current === 'stocks') render();
  } }] });
}
function editProduto(p) {
  p = p || { unidade: 'un', ativo: 1 };
  modal({ title: p.id ? 'Editar produto' : 'Novo produto', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Código', inp('codigo', p.codigo))}${fld('Nome', inp('nome', p.nome), 's3')}${fld('Família', inp('familia', p.familia, 'list="fam-list"'))}${fld('Unidade', inp('unidade', p.unidade))}
    ${fld('Stock mínimo', inp('stock_min', p.stock_min ?? 0, 'type="number" step="any"'))}${fld('Stock ideal', inp('stock_ideal', p.stock_ideal ?? 0, 'type="number" step="any"'))}
    ${fld('Preço de custo', inp('preco_custo', p.preco_custo ?? 0, 'type="number" step="0.01"'))}${fld('Fornecedor', inp('fornecedor', p.fornecedor), 's3')}
    <div class="s4">${chk('ativo', p.ativo, 'Ativo')}</div></form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body)); if (!f.nome) throw new Error('Indique o nome');
    p.id ? await PUT('t/produtos/' + p.id, f) : await POST('t/produtos', f); toast('Produto guardado'); if (App.current === 'stocks') render();
  } }] });
}

// ---------- estatísticas ----------
route('estatisticas', async (view) => {
  const st0 = view.dataset.p ? JSON.parse(view.dataset.p) : { de: isoDate().slice(0, 8) + '01', ate: isoDate() };
  view.innerHTML = `<div class="page-head"><h1>Relatórios</h1><div class="spacer"></div>
    <div class="row">${['mes', 'mesant', 'ano'].map(k => `<button class="sm" data-pr="${k}">${{ mes: 'Este mês', mesant: 'Mês anterior', ano: 'Este ano' }[k]}</button>`).join('')}
    <input type="date" id="es-de" aria-label="De" value="${st0.de}" style="width:auto"> <input type="date" id="es-ate" aria-label="Até" value="${st0.ate}" style="width:auto"></div></div>${secTabs(SEC_REL, '#/estatisticas')}<div id="es-body"></div>`;
  const load = async () => {
    const de = $('#es-de').value, ate = $('#es-ate').value;
    view.dataset.p = JSON.stringify({ de, ate });
    const s = await GET(`estatisticas?de=${de}&ate=${ate}`);
    const k = s.kpi;
    $('#es-body').innerHTML = `<div class="facts">
      <div class="fact"><div class="l">Marcações</div><div class="v">${k.marcacoes}</div><div class="small muted">${k.faltas} faltas (${num(k.taxaFaltas, 1)}%)</div></div>
      <div class="fact"><div class="l">Faturado</div><div class="v">${eur(k.faturado)}</div></div>
      <div class="fact"><div class="l">Recebido</div><div class="v ok">${eur(k.recebido)}</div></div>
      <div class="fact"><div class="l">Novos pacientes</div><div class="v">${k.novos}</div><div class="small muted">Dívida total: ${eur(k.emDivida)}</div></div></div>
      <div class="grid g2">
        <div class="card"><h3>Marcações por estado</h3>${hbars(s.porEstado, { color: r => r.cor })}</div>
        <div class="card"><h3>Marcações por médico</h3>${table(s.porMedico, [{ h: 'Médico', f: r => `<span class="dot" style="background:${esc(r.cor)}"></span>${esc(r.nome)}` },
          { h: 'Total', cls: 'right', f: r => r.n }, { h: 'Realizadas', cls: 'right', f: r => r.realizadas }, { h: 'Faltas', cls: 'right', f: r => r.faltas }], { empty: 'Sem dados' })}</div>
        <div class="card"><h3>Faturação por médico e comissões</h3>${table(s.fatMedico, [{ h: 'Médico', f: r => esc(r.nome) }, { h: 'Faturado', cls: 'right', f: r => eur(r.total) },
          { h: '%', cls: 'right', f: r => num(r.comissao_pct || 0) + '%' }, { h: 'Comissão', cls: 'right', f: r => eur(r.comissao) }], { empty: 'Sem faturação' })}</div>
        <div class="card"><h3>Faturação mensal</h3>${s.fatMes.length ? `<div class="vbars">${s.fatMes.map(m => `<div class="vb" title="${eur(m.total)}"><div class="small">${eur(m.total).replace(/,\d+\s/, ' ')}</div><div class="fill" style="height:${(m.total / Math.max(...s.fatMes.map(x => x.total), 1)) * 140}px"></div><div>${MESES[Number(m.mes.slice(5)) - 1].slice(0, 3)}</div></div>`).join('')}</div>` : '<div class="empty">Sem faturação</div>'}</div>
        <div class="card"><h3>Tratamentos mais realizados</h3>${hbars(s.topServicos)}</div>
        <div class="card"><h3>Recebimentos por método</h3>${hbars(s.recebMetodo, { label: 'metodo', value: 'total', fmt: eur })}<h3 style="margin-top:16px">Razão da 1.ª visita (novos)</h3>${hbars(s.razoes)}</div>
      </div>`;
  };
  $$('[data-pr]', view).forEach(b => b.onclick = () => {
    const t = new Date(); let de, ate;
    if (b.dataset.pr === 'mes') { de = isoDate(new Date(t.getFullYear(), t.getMonth(), 1)); ate = isoDate(); }
    if (b.dataset.pr === 'mesant') { de = isoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)); ate = isoDate(new Date(t.getFullYear(), t.getMonth(), 0)); }
    if (b.dataset.pr === 'ano') { de = `${t.getFullYear()}-01-01`; ate = isoDate(); }
    $('#es-de').value = de; $('#es-ate').value = ate; load();
  });
  $('#es-de').onchange = load; $('#es-ate').onchange = load;
  await load();
});

// ---------- comunicação ----------
route('comunicacao', async (view, [sub = 'aniversarios']) => {
  view.innerHTML = `<div class="page-head"><h1>Comunicação</h1></div>
    <div class="subnav">${[['aniversarios', 'Aniversários'], ['faltas', 'Faltas recentes'], ['revisao', 'Sem consulta há 1 ano'], ['historico', 'Histórico de mensagens']].map(([k, l]) => `<button class="${k === sub ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="card" id="cm-body"></div>`;
  $$('.subnav button', view).forEach(b => b.onclick = () => go('#/comunicacao/' + b.dataset.s));
  const body = $('#cm-body');
  if (sub === 'historico') {
    const h = await GET('sms/historico');
    body.innerHTML = table(h, [{ h: 'Data', f: r => `<span class="num">${esc(r.data)}</span>` }, { h: 'Paciente', f: r => esc(r.paciente_nome) }, { h: 'Canal', f: r => r.canal === 'email' ? 'E-mail' : 'SMS' },
      { h: 'Destino', f: r => `<span class="num">${esc(r.telefone)}</span>` },
      { h: 'Mensagem', f: r => `<span class="small">${esc(r.texto).replace(/\n/g, '<br>')}</span>` }, { h: 'Estado', f: r => `<span class="st ${EST_MSG[r.estado] || ''}">${esc(r.estado)}</span>${r.erro ? `<div class="small danger">${esc(r.erro)}</div>` : ''}` },
      { h: '', f: r => r.estado === 'preparado' ? `<button class="sm" data-env="${r.id}">Marcar enviado</button>` : '' }], { empty: 'Sem mensagens' });
    $$('[data-env]', body).forEach(b => b.onclick = async () => { await POST('sms/marcar-enviado', { ids: [Number(b.dataset.env)] }); render(); });
    return;
  }
  let rows = [], modeloNome = '';
  if (sub === 'aniversarios') {
    const de = body.dataset.de || isoDate(), ate = body.dataset.ate || addDays(isoDate(), 7);
    rows = await GET(`aniversarios?de=${de}&ate=${ate}`); modeloNome = 'Aniversário';
    body.innerHTML = `<div class="row" style="margin-bottom:10px">${fld('De', `<input type="date" id="an-de" value="${de}">`)}${fld('Até', `<input type="date" id="an-ate" value="${ate}">`)}</div>`;
    $('#an-de').onchange = e => { body.dataset.de = e.target.value; render(); }; $('#an-ate').onchange = e => { body.dataset.ate = e.target.value; render(); };
  } else if (sub === 'faltas') {
    const ms = await GET(`agenda?de=${addDays(isoDate(), -30)}&ate=${isoDate()}`);
    const seen = new Set();
    rows = ms.filter(m => m.estado_categoria === 'FALTAS' && !seen.has(m.paciente_id) && seen.add(m.paciente_id))
      .map(m => ({ id: m.paciente_id, nome: m.paciente_nome, telemovel: m.paciente_telemovel, info: `Faltou a ${fmtDT(m.inicio)} (${m.medico_nome})` }));
    modeloNome = 'Falta à consulta'; body.innerHTML = '<p class="muted">Pacientes que faltaram nos últimos 30 dias.</p>';
  } else if (sub === 'revisao') {
    rows = (await GET('revisoes')).map(p => ({ ...p, info: 'Última consulta: ' + fmtDate(p.ultima) }));
    modeloNome = 'Revisão anual'; body.innerHTML = '<p class="muted">Pacientes cuja última consulta realizada foi há mais de um ano e sem marcação futura.</p>';
  }
  const modelos = ativos(L().sms_modelos);
  const mdef = modelos.find(m => m.nome === modeloNome) || modelos[0];
  body.insertAdjacentHTML('beforeend', `${table(rows, [{ h: '', f: r => `<input type="checkbox" data-p="${r.id}" checked>` }, { h: 'Paciente', f: r => `<a href="#/paciente/${r.id}">${esc(r.nome)}</a>` },
    { h: sub === 'aniversarios' ? 'Aniversário' : 'Info', f: r => r.data_nasc ? `${fmtDate(r.data_nasc).slice(0, 5)} (${idade(r.data_nasc) + (r.data_nasc.slice(5) > isoDate().slice(5) ? 1 : 0)} anos)` : esc(r.info) },
    { h: 'Telemóvel', f: r => esc(r.telemovel) }], { empty: 'Nenhum paciente encontrado' })}
    ${rows.length ? `<div class="row end" style="margin-top:10px"><button class="primary" id="cm-send">Enviar mensagem aos selecionados</button></div>` : ''}`);
  if (rows.length) $('#cm-send').onclick = async () => {
    const ids = $$('[data-p]:checked', body).map(c => Number(c.dataset.p));
    if (!ids.length) return toast('Selecione pacientes', true);
    enviarAviso({ paciente_ids: ids }, `Mensagem para ${ids.length} paciente(s)`, mdef?.nome);
  };
});
