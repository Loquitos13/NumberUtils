'use strict';
/* Faturação, recibos, conta corrente e orçamentos */
const METODOS = ['Numerário', 'Multibanco', 'MB Way', 'Transferência', 'Cheque', 'Cartão de crédito'];
const TIPO_NOME = { FT: 'Fatura', FS: 'Fatura Simplificada', FR: 'Fatura-Recibo', ND: 'Nota de Débito', NC: 'Nota de Crédito', RC: 'Recibo', PF: 'Fatura Pró-forma', OR: 'Orçamento' };
const TIPOS_EMITIR = [['FR', 'Fatura-Recibo · pago no ato'], ['FT', 'Fatura · paga depois'], ['FS', 'Fatura Simplificada · até 100 €'], ['PF', 'Fatura Pró-forma · sem valor fiscal']];
const DEBITO = ['FT', 'FS', 'FR', 'ND'];
function docChip(tipo) { return `<span class="dt dt-${esc(tipo)}" title="${esc(TIPO_NOME[tipo] || tipo)}">${esc(tipo)}</span>`; }

// estado de um tratamento ao longo do circuito: necessário → orçamentado → feito → faturado → pago
const ESTADOS_TRAT = [['nec', 'Necessário'], ['orc', 'Orçamentado'], ['real', 'Feito · por faturar'], ['fat', 'Faturado · por pagar'], ['pago', 'Pago']];
function estadoTrat(t) {
  if (t.documento_id) return (t.documento_pago || 0) >= (t.documento_total || 0) - 0.005 ? { k: 'pago', l: 'Pago', d: t.documento_numero } : { k: 'fat', l: 'Por pagar', d: t.documento_numero };
  if (t.estado === 'realizado') return { k: 'real', l: 'Feito', d: 'por faturar' };
  if (t.orcamento_id && t.orcamento_estado !== 'recusado') return { k: 'orc', l: 'Orçamentado', d: t.orcamento_numero };
  return { k: 'nec', l: 'Necessário', d: '' };
}
function estadoChip(t) { const e = estadoTrat(t); return `<span class="st st-${e.k}">${e.l}</span>${e.d ? ` <span class="muted small num">${esc(e.d)}</span>` : ''}`; }
const AVISO_CERT = 'Documento processado por programa não certificado pela AT. Para efeitos fiscais utilize software de faturação certificado.';

// ---------- editor de linhas (documentos e orçamentos) ----------
function linhasEditor(root, linhas, onChange) {
  const lk = L();
  const draw = () => {
    root.innerHTML = `<div class="tbl-wrap" style="max-height:none"><table class="t"><thead><tr><th style="width:28%">Serviço</th><th>Descrição</th><th style="width:70px">Dente</th>
      <th style="width:60px">Qtd</th><th style="width:90px">Preço</th><th style="width:70px">Desc.%</th><th style="width:120px">IVA</th><th class="right" style="width:90px">Total</th><th></th></tr></thead>
      <tbody>${linhas.map((l, i) => `<tr data-i="${i}">
        <td>${sel('servico_id', opts(ativos(lk.servicos), l.servico_id, { empty: '—', label: s => `${s.codigo || ''} ${s.nome}` }))}</td>
        <td>${inp('descricao', l.descricao)}</td><td>${inp('dente', l.dente)}</td>
        <td>${inp('qtd', l.qtd ?? 1, 'type="number" step="1" min="0"')}</td><td>${inp('preco', l.preco ?? 0, 'type="number" step="0.01"')}</td>
        <td>${inp('desconto_pct', l.desconto_pct ?? 0, 'type="number" step="0.01"')}</td><td>${sel('iva_id', ivaOpts(ivaFix(l).iva_id))}</td>
        <td class="right bold" data-tot></td><td>${l.tratamento_id ? '<span title="Tratamento associado" class="muted"><i data-ic="tooth"></i></span>' : ''}<button type="button" class="ghost sm icon" data-rm aria-label="Remover linha"><i data-ic="x"></i></button></td></tr>`).join('')}</tbody></table></div>
      <div class="row between" style="margin-top:8px"><button type="button" class="sm" data-add>Adicionar linha</button>
      <div id="le-tot" class="right"></div></div>`;
    $$('tr[data-i]', root).forEach(tr => {
      const i = Number(tr.dataset.i);
      $$('input, select', tr).forEach(inpEl => inpEl.addEventListener(inpEl.tagName === 'SELECT' ? 'change' : 'input', () => {
        const l = linhas[i];
        l[inpEl.name] = inpEl.type === 'number' ? Number(inpEl.value) : inpEl.value;
        if (inpEl.name === 'servico_id') {
          const s = byId(lk.servicos, inpEl.value);
          if (s) { l.servico_id = s.id; l.descricao = s.nome; l.preco = s.preco; l.iva_id = s.iva_id; l.iva = s.iva; ivaFix(l); draw(); return; }
        }
        if (inpEl.name === 'iva_id') { l.iva_id = Number(inpEl.value); l.iva = byId(lk.ivas, l.iva_id)?.taxa ?? 0; }
        totals();
      }));
      $('[data-rm]', tr).onclick = () => { linhas.splice(i, 1); draw(); };
    });
    $('[data-add]', root).onclick = () => { linhas.push(ivaFix({ qtd: 1, preco: 0, desconto_pct: 0 })); draw(); };
    totals();
  };
  const totals = () => {
    let base = 0, iva = 0;
    $$('tr[data-i]', root).forEach(tr => {
      const l = linhas[Number(tr.dataset.i)];
      const b = (Number(l.qtd) || 0) * (Number(l.preco) || 0) * (1 - (Number(l.desconto_pct) || 0) / 100);
      const v = b * (Number(l.iva) || 0) / 100;
      base += b; iva += v; $('[data-tot]', tr).textContent = eur(b + v);
    });
    $('#le-tot', root).innerHTML = `Base: ${eur(base)} · IVA: ${eur(iva)} · <b style="font-size:1.15rem">Total: ${eur(base + iva)}</b>`;
    onChange && onChange(base + iva);
  };
  draw();
}

// ---------- emitir fatura / fatura-recibo / nota de crédito ----------
async function emitirDocumento({ paciente, tratamentos = [], linhas, tipo = 'FR', ref, onDone } = {}) {
  const lk = L();
  const ent = paciente ? byId(lk.entidades, paciente.entidade_id) : null;
  linhas = linhas || tratamentos.map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco,
    desconto_pct: t.desconto_pct ?? ent?.desconto_pct ?? 0, iva: t.iva ?? 0, iva_id: t.iva_id }));
  if (!linhas.length) linhas.push(ivaFix({ qtd: 1, preco: 0, desconto_pct: ent?.desconto_pct || 0 }));
  let total = 0;
  const medDefault = tratamentos[0]?.medico_id || paciente?.medico_id || App.user.medico_id;
  const fixo = tipo === 'NC' || tipo === 'ND';
  modal({ title: fixo ? `${TIPO_NOME[tipo]}${ref ? ' — ref. ' + ref.numero : ''}` : 'Emitir documento', size: 'lg', body: `<form class="form-grid" onsubmit="return false">
    <div class="s2">${pacField('paciente_id', paciente?.id, paciente?.nome)}</div>
    ${fld('Tipo de documento', sel('tipo', fixo ? optsArr([[tipo, TIPO_NOME[tipo]]]) : optsArr(TIPOS_EMITIR, tipo)))}
    ${fld('Data', inp('data', isoDate(), 'type="date"'))}
    ${fld('Médico', sel('medico_id', opts(lk.medicos, medDefault, { empty: '—', only: x => x.ativo })), 's2')}
    ${fld('Método de pagamento', sel('metodo', optsArr(METODOS)), 's2" id="ed-met')}
    <div class="s4" id="ed-linhas"></div>
    ${fld('Observações', inp('notas', ref ? `Referente a ${ref.numero}` : ''), 's4')}
    <div class="s4 small muted">${esc(AVISO_CERT)}</div></form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Emitir', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.paciente_id) throw new Error('Escolha o paciente');
    const ls = linhas.filter(l => l.descricao);
    if (!ls.length) throw new Error('Adicione pelo menos uma linha com descrição');
    if (!(total > 0)) throw new Error('O total do documento deve ser superior a zero');
    if (f.tipo === 'FS' && total > 100) throw new Error('A fatura simplificada só pode ser usada até 100 € em prestações de serviços (art. 40.º do CIVA). Use fatura-recibo.');
    if (!await confirmDlg(`Emitir ${TIPO_NOME[f.tipo]} no valor de ${eur(total)}?${f.tipo === 'PF' ? '' : ' Depois de emitido só pode ser anulado.'}`, 'Emitir')) return false;
    const d = await POST('documentos', { ...f, paciente_id: Number(f.paciente_id), medico_id: f.medico_id ? Number(f.medico_id) : null, linhas: ls, ref_documento_id: ref?.id,
      entidade_id: paciente?.entidade_id || null });
    toast(`${d.tipo_nome} ${d.numero} emitido(a)`);
    onDone && onDone(d); verDocumento(d.id);
  } }],
  onOpen: c => {
    const form = $('form', c.body);
    bindPacField(form, 'paciente_id', p => { paciente = p; });
    linhasEditor($('#ed-linhas', c.body), linhas, t => { total = t; });
    const met = () => $('#ed-met', c.body).classList.toggle('hidden', !['FR', 'FS'].includes(form.tipo.value));
    form.tipo.onchange = met; met();
  } });
}

// ---------- recibo (liquida uma ou várias faturas) ----------
async function emitirRecibo({ paciente, documento, documentos: preSel, onDone } = {}) {
  const sel0 = new Set((preSel || (documento ? [documento.id] : null) || []).map(Number));
  modal({ title: 'Receber pagamento', size: 'lg', body: `<form class="form-grid" onsubmit="return false">
    <div class="s4">${pacField('paciente_id', paciente?.id, paciente?.nome)}</div>
    <div class="s4" id="rc-docs"></div>
    ${fld('Valor recebido (€)', inp('valor', '', 'type="number" step="0.01" min="0"'))}
    ${fld('Meio de pagamento', sel('metodo', optsArr(METODOS)))}${fld('Data', inp('data', isoDate(), 'type="date"'))}<div></div>
    ${fld('Notas', inp('notas', ''), 's4')}</form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Emitir recibo', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.paciente_id) throw new Error('Escolha o paciente');
    const ids = $$('[data-rcd]:checked', c.body).map(x => Number(x.dataset.rcd));
    const d = await POST('recibos', { ...f, paciente_id: Number(f.paciente_id), documento_ids: ids });
    toast(`Recibo ${d.numero} emitido`); onDone && onDone(d); verDocumento(d.id);
  } }],
  onOpen: c => {
    const form = $('form', c.body);
    const carregar = async pid => {
      const docs = await GET(`pacientes/${pid}/em-aberto`);
      const box = $('#rc-docs', c.body);
      if (!sel0.size) docs.forEach(d => sel0.add(d.id));
      box.innerHTML = docs.length ? `<label class="f">Documentos em aberto</label><div class="tbl-wrap" style="max-height:220px">${table(docs, [
        { h: '', f: d => `<input type="checkbox" data-rcd="${d.id}" ${sel0.has(d.id) ? 'checked' : ''}>` }, { h: 'Documento', f: d => `${docChip(d.tipo)} <b class="num">${esc(d.numero)}</b>` },
        { h: 'Data', f: d => fmtDate(d.data) }, { h: 'Total', cls: 'right', f: d => eur(d.total) }, { h: 'Em dívida', cls: 'right', f: d => `<b class="danger">${eur(d.em_divida)}</b>` }])}</div>`
        : '<div class="alert info">Sem faturas em aberto: o valor fica como pagamento por conta (adiantamento).</div>';
      const soma = () => { form.valor.value = docs.filter(d => $(`[data-rcd="${d.id}"]`, box)?.checked).reduce((s, d) => s + d.em_divida, 0).toFixed(2); };
      $$('[data-rcd]', box).forEach(x => x.onchange = soma); if (docs.length) soma();
    };
    bindPacField(form, 'paciente_id', p => { sel0.clear(); carregar(p.id); });
    if (paciente) carregar(paciente.id);
  } });
}

// ---------- visualizar / imprimir documento ----------
function docHTML(d) {
  return `<div class="doc"><div class="dh">${cabecalhoClinica()}<div class="right"><h2 style="margin:0">${esc(d.tipo_nome)}</h2><div style="font-size:15px;font-weight:700">${esc(d.numero)}</div>
    <div>Data: ${fmtDate(d.data)}</div>${d.ref_numero ? `<div>Ref.: ${esc(d.ref_numero)}</div>` : ''}${d.estado === 'anulado' ? '<div style="color:#c00;font-weight:700;font-size:16px">ANULADO</div>' : ''}</div></div>
    ${d.tipo === 'PF' ? '<p style="border:1px solid #000;padding:4px 8px;text-align:center;font-weight:700">Este documento não serve de fatura</p>' : ''}
    <p><b>${esc(d.paciente_nome)}</b> (proc. ${esc(d.paciente_numero)})<br>${esc(d.paciente_morada || '')} ${esc(d.paciente_cp || '')} ${esc(d.paciente_localidade || '')}<br>NIF: ${esc(d.paciente_nif || 'Consumidor final')}
    ${d.entidade_nome ? '<br>Entidade: ' + esc(d.entidade_nome) : ''}${d.medico_nome ? '<br>Médico: ' + esc(d.medico_nome) : ''}</p>
    <table><tr><th>Descrição</th><th>Dente</th><th class="right">Qtd</th><th class="right">Preço</th><th class="right">Desc.</th><th class="right">IVA</th><th class="right">Total</th></tr>
    ${d.linhas.map(l => `<tr><td>${esc(l.descricao)}</td><td>${esc(l.dente)}</td><td class="right">${num(l.qtd)}</td><td class="right">${eur(l.preco)}</td><td class="right">${l.desconto_pct ? num(l.desconto_pct) + '%' : ''}</td><td class="right">${num(l.iva)}%</td><td class="right">${eur(l.total)}</td></tr>`).join('')}</table>
    <table class="tot"><tr><td>Base tributável</td><td class="right">${eur(d.total_base)}</td></tr><tr><td>IVA</td><td class="right">${eur(d.total_iva)}</td></tr>
    <tr><td><b>Total</b></td><td class="right"><b>${eur(d.total)}</b></td></tr>${d.em_divida > 0 ? `<tr><td>Em dívida</td><td class="right">${eur(d.em_divida)}</td></tr>` : ''}</table>
    ${[...new Set(d.linhas.filter(l => l.isencao_cod).map(l => `${l.isencao_cod} — ${l.isencao_motivo || ''}`))].map(m => `<p>Motivo de isenção de IVA: ${esc(m)}</p>`).join('')}
    ${d.pagamentos.length ? `<p>Pagamento: ${d.pagamentos.map(p => `${esc(p.metodo)} ${eur(p.valor)} (${fmtDate(p.data)})`).join(', ')}</p>` : ''}
    ${d.notas ? `<p>${esc(d.notas).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="foot">${esc(L().config.doc_rodape || '')}<br>${esc(AVISO_CERT)}<br>Emitido por ${esc(d.user_nome || '')}</div></div>`;
}
async function verDocumento(id) {
  const d = await GET('documentos/' + id);
  const buttons = [];
  if (d.estado === 'emitido') buttons.push({ label: 'Anular', cls: 'danger', left: true, onClick: async () => {
    const motivo = await promptDlg('Anular documento', 'Motivo da anulação'); if (motivo === null) return false;
    await POST(`documentos/${d.id}/anular`, { motivo }); toast('Documento anulado'); render();
  } });
  if (d.em_divida > 0) buttons.push({ label: 'Receber', onClick: () => emitirRecibo({ paciente: { id: d.paciente_id, nome: d.paciente_nome }, documento: d, onDone: () => render() }) });
  if (d.estado === 'emitido' && DEBITO.includes(d.tipo)) {
    buttons.push({ label: 'Nota de crédito', onClick: async () => {
      const p = await GET('t/pacientes/' + d.paciente_id);
      emitirDocumento({ paciente: p, tipo: 'NC', ref: d, linhas: d.linhas.map(l => ({ ...l, tratamento_id: l.tratamento_id })), onDone: () => render() });
    } });
    buttons.push({ label: 'Nota de débito', onClick: async () => {
      const p = await GET('t/pacientes/' + d.paciente_id);
      emitirDocumento({ paciente: p, tipo: 'ND', ref: d, linhas: [ivaFix({ qtd: 1, preco: 0, descricao: `Acerto ao documento ${d.numero}` })], onDone: () => render() });
    } });
  }
  if (d.tipo === 'PF' && d.estado === 'emitido') buttons.push({ label: 'Converter em fatura-recibo', onClick: async () => {
    const p = await GET('t/pacientes/' + d.paciente_id);
    emitirDocumento({ paciente: p, tipo: 'FR', linhas: d.linhas.map(l => ({ servico_id: l.servico_id, tratamento_id: l.tratamento_id, descricao: l.descricao, dente: l.dente, qtd: l.qtd, preco: l.preco, desconto_pct: l.desconto_pct, iva: l.iva, iva_id: l.iva_id })), onDone: () => render() });
  } });
  buttons.push({ label: 'Paciente', onClick: () => go(`#/paciente/${d.paciente_id}/cc`) });
  buttons.push({ label: 'Imprimir', cls: 'primary', onClick: () => { printHTML(docHTML(d)); return false; } });
  modal({ title: `${d.tipo_nome} ${d.numero}`, size: 'lg', body: docHTML(d), buttons });
}

// ---------- conta corrente (ficha do paciente) ----------
async function tabContaCorrente(el, p) {
  const cc = await GET(`pacientes/${p.id}/contacorrente`);
  el.innerHTML = `<div class="facts">
    <div class="fact"><div class="l">Faturado</div><div class="v">${eur(cc.faturado)}</div></div>
    <div class="fact"><div class="l">Notas de crédito</div><div class="v">${eur(cc.creditos)}</div></div>
    <div class="fact"><div class="l">Pago</div><div class="v ok">${eur(cc.pago)}</div></div>
    <div class="fact"><div class="l">Saldo</div><div class="v ${cc.saldo > 0 ? 'danger' : ''}">${eur(cc.saldo)}</div></div></div>
    <div class="card"><div class="row" style="margin-bottom:10px"><button class="primary" id="cc-fr">Novo documento</button><button id="cc-rc">Receber pagamento</button>
      <div class="spacer"></div><button id="cc-print">Extrato</button></div>
    ${table(cc.movimentos, [
      { h: 'Data', f: m => fmtDate(m.data) }, { h: 'Documento', f: m => `<a href="#" data-doc="${m.documento_id}">${esc(m.numero)}</a>` },
      { h: 'Descrição', f: m => esc(m.descricao) + (m.anulado ? ' <span class="badge danger">anulado</span>' : '') },
      { h: 'Débito', cls: 'right', f: m => m.debito ? eur(m.debito) : '' }, { h: 'Crédito', cls: 'right', f: m => m.credito ? eur(m.credito) : '' },
      { h: 'Saldo', cls: 'right bold', f: m => eur(m.saldo) },
    ], { rowCls: m => m.anulado ? 'off' : '', empty: 'Sem movimentos' })}</div>`;
  $$('[data-doc]', el).forEach(a => a.onclick = e => { e.preventDefault(); verDocumento(Number(a.dataset.doc)); });
  $('#cc-fr').onclick = () => emitirDocumento({ paciente: p, onDone: () => render() });
  $('#cc-rc').onclick = () => emitirRecibo({ paciente: p, onDone: () => render() });
  $('#cc-print').onclick = () => printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Extrato de conta corrente</h2>${fmtDate(isoDate())}</div></div>
    <p><b>${esc(p.nome)}</b> · Processo ${esc(p.numero)} · NIF ${esc(p.nif || '')}</p><table><tr><th>Data</th><th>Documento</th><th>Descrição</th><th class="right">Débito</th><th class="right">Crédito</th><th class="right">Saldo</th></tr>
    ${cc.movimentos.filter(m => !m.anulado).map(m => `<tr><td>${fmtDate(m.data)}</td><td>${esc(m.numero)}</td><td>${esc(m.descricao)}</td><td class="right">${m.debito ? eur(m.debito) : ''}</td><td class="right">${m.credito ? eur(m.credito) : ''}</td><td class="right">${eur(m.saldo)}</td></tr>`).join('')}</table>
    <p class="right"><b>Saldo: ${eur(cc.saldo)}</b></p></div>`);
}

// ---------- página de faturação ----------
route('faturacao', async (view, [sub = 'documentos']) => {
  view.innerHTML = `<div class="page-head"><h1>Faturação</h1><div class="spacer"></div>
    <button id="fx-rc">Receber pagamento</button><button class="primary" id="fx-new">Novo documento</button></div>
    ${secTabs(SEC_FAT, sub === 'documentos' ? '#/faturacao' : '#/faturacao/' + sub)}
    <div id="fx-body"></div>`;
  $('#fx-new').onclick = () => emitirDocumento({ onDone: () => render() });
  $('#fx-rc').onclick = () => emitirRecibo({ onDone: () => render() });
  const body = $('#fx-body');
  if (sub === 'devedores') {
    const rows = await GET('devedores');
    const cols = [{ h: 'N.º', f: r => esc(r.numero) }, { h: 'Paciente', f: r => `<b>${esc(r.nome)}</b>` }, { h: 'Telemóvel', f: r => esc(r.telemovel) },
      { h: 'Faturado', cls: 'right', f: r => eur(r.faturado) }, { h: 'Pago', cls: 'right', f: r => eur(r.pago) },
      { h: 'Saldo', cls: 'right', f: r => `<b class="${r.saldo > 0 ? 'danger' : 'ok'}">${eur(r.saldo)}</b>` }];
    body.innerHTML = `<div class="card"><div class="row end" style="margin-bottom:8px"><span class="muted">Total em dívida: <b class="danger">${eur(rows.filter(r => r.saldo > 0).reduce((s, r) => s + r.saldo, 0))}</b></span><button class="sm" id="dv-csv">Exportar</button></div>
      ${table(rows, cols, { onClick: r => go(`#/paciente/${r.id}/cc`), empty: 'Nenhum paciente com saldo pendente' })}</div>`;
    $('#dv-csv').onclick = () => downloadCSV('saldos-pacientes', rows, cols);
    return;
  }
  if (sub === 'caixa') {
    const de = body.dataset.de || isoDate();
    const docs = await GET(`documentos?de=${de}&ate=${de}`);
    const st = await GET(`estatisticas?de=${de}&ate=${de}`);
    body.innerHTML = `<div class="card"><div class="row">${fld('Dia', `<input type="date" id="cx-d" value="${de}">`)}<div class="spacer"></div><button id="cx-print">Imprimir fecho</button></div>
      <div class="facts"><div class="fact"><div class="l">Faturado</div><div class="v">${eur(st.kpi.faturado)}</div></div>
      <div class="fact"><div class="l">Recebido</div><div class="v ok">${eur(st.kpi.recebido)}</div></div>
      <div class="fact"><div class="l">Documentos</div><div class="v">${docs.length}</div></div></div>
      <h3>Recebimentos por método</h3>${hbars(st.recebMetodo, { label: 'metodo', value: 'total', fmt: eur })}
      <h3 style="margin-top:16px">Documentos do dia</h3>${docsTable(docs)}</div>`;
    $('#cx-d').onchange = e => { body.dataset.de = e.target.value; render(); };
    bindDocsTable(body);
    $('#cx-print').onclick = () => printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Fecho de caixa</h2>${fmtDate(de)}</div></div>
      <p>Faturado: <b>${eur(st.kpi.faturado)}</b> · Recebido: <b>${eur(st.kpi.recebido)}</b></p>
      <table><tr><th>Método</th><th class="right">Valor</th></tr>${st.recebMetodo.map(r => `<tr><td>${esc(r.metodo)}</td><td class="right">${eur(r.total)}</td></tr>`).join('')}</table>
      <table><tr><th>Documento</th><th>Paciente</th><th class="right">Total</th><th>Estado</th></tr>${docs.map(d => `<tr><td>${esc(d.numero)}</td><td>${esc(d.paciente_nome)}</td><td class="right">${eur(d.total)}</td><td>${esc(d.estado)}</td></tr>`).join('')}</table></div>`);
    return;
  }
  const f = JSON.parse(body.dataset.f || 'null') || { de: isoDate().slice(0, 8) + '01', ate: isoDate(), tipo: '' };
  body.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px">${fld('De', `<input type="date" id="fx-de" value="${f.de}">`)}${fld('Até', `<input type="date" id="fx-ate" value="${f.ate}">`)}
    ${fld('Tipo', `<select id="fx-tipo">${optsArr([['', 'Todos'], ...Object.entries(TIPO_NOME)], f.tipo)}</select>`)}<div class="spacer"></div><button id="fx-csv">Exportar</button></div><div id="fx-list"></div></div>`;
  const load = async () => {
    const q = { de: $('#fx-de').value, ate: $('#fx-ate').value, tipo: $('#fx-tipo').value };
    body.dataset.f = JSON.stringify(q);
    const docs = await GET(`documentos?de=${q.de}&ate=${q.ate}&tipo=${q.tipo}`);
    const ativos = docs.filter(d => d.estado === 'emitido');
    const tot = ativos.reduce((s, d) => s + (DEBITO.includes(d.tipo) ? d.total : d.tipo === 'NC' ? -d.total : 0), 0);
    $('#fx-list').innerHTML = docsTable(docs) + `<div class="row end" style="margin-top:8px"><span>${docs.length} documento(s) · Total faturado (líq. NC): <b>${eur(tot)}</b></span></div>`;
    bindDocsTable($('#fx-list'));
    $('#fx-csv').onclick = () => downloadCSV('documentos', docs, DOC_COLS);
  };
  ['#fx-de', '#fx-ate', '#fx-tipo'].forEach(s => $(s).onchange = load);
  await load();
});
const DOC_COLS = [
  { h: 'Data', f: d => fmtDate(d.data) }, { h: 'Documento', f: d => `${docChip(d.tipo)} <b class="num">${esc(d.numero)}</b>`, csv: d => d.numero }, { h: 'Tipo', f: d => esc(TIPO_NOME[d.tipo]) },
  { h: 'Paciente', f: d => esc(d.paciente_nome) }, { h: 'NIF', f: d => esc(d.paciente_nif) }, { h: 'Total', cls: 'right', f: d => eur(d.total), csv: d => String(d.total).replace('.', ',') },
  { h: 'Situação', f: d => d.estado === 'anulado' ? '<span class="st st-anul">Anulado</span>' : !DEBITO.includes(d.tipo) ? '<span class="muted small">—</span>'
      : (d.pago || 0) >= d.total - 0.005 ? '<span class="st st-pago">Pago</span>' : `<span class="st st-fat">Por pagar</span> <span class="small danger num">${eur(d.total - (d.pago || 0))}</span>`,
    csv: d => d.estado === 'anulado' ? 'anulado' : !DEBITO.includes(d.tipo) ? '' : (d.pago || 0) >= d.total - 0.005 ? 'pago' : 'por pagar' },
];
function docsTable(docs) { return `<div class="tbl-wrap">${table(docs, DOC_COLS, { rowCls: d => d.estado === 'anulado' ? 'off' : '', onClick: () => {} }).replace('<table', `<table data-docs='${esc(JSON.stringify(docs.map(d => d.id)))}'`)}</div>`; }
function bindDocsTable(root) {
  $$('table[data-docs]', root).forEach(t => {
    const ids = JSON.parse(t.dataset.docs);
    t.addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) verDocumento(ids[Number(tr.dataset.i)]); });
  });
}

// ---------- orçamentos ----------
const ORC_EST = { aberto: ['Em aberto', 'warn'], aceite: ['Aceite', 'ok'], recusado: ['Recusado', 'danger'] };
const ORC_COLS = [
  { h: 'Número', f: o => `<b>${esc(o.numero)}</b>` }, { h: 'Data', f: o => fmtDate(o.data) }, { h: 'Paciente', f: o => esc(o.paciente_nome) },
  { h: 'Médico', f: o => esc(o.medico_nome) }, { h: 'Validade', f: o => `${fmtDate(o.validade)}${o.estado === 'aberto' && o.validade < isoDate() ? ' <span class="badge danger">expirado</span>' : ''}` },
  { h: 'Total', cls: 'right', f: o => eur(o.total) }, { h: 'Estado', f: o => `<span class="badge ${ORC_EST[o.estado]?.[1]}">${ORC_EST[o.estado]?.[0] || esc(o.estado)}</span>` },
];
route('orcamentos', async (view) => {
  view.innerHTML = `<div class="page-head"><h1>Faturação</h1><div class="spacer"></div>
    <select id="or-est" style="width:auto">${optsArr([['', 'Todos'], ['aberto', 'Em aberto'], ['aceite', 'Aceites'], ['recusado', 'Recusados']], 'aberto')}</select>
    <button class="primary" id="or-new">Novo orçamento</button></div>${secTabs(SEC_FAT, '#/orcamentos')}<div class="card" id="or-list"></div>`;
  const load = async () => {
    const rows = await GET('orcamentos?estado=' + $('#or-est').value);
    $('#or-list').innerHTML = table(rows, ORC_COLS, { onClick: o => verOrcamento(o.id), empty: 'Sem orçamentos' });
  };
  $('#or-est').onchange = load;
  $('#or-new').onclick = () => editOrcamento(null, {});
  await load();
});
async function tabOrcamentosPac(el, p) {
  const rows = await GET('orcamentos?paciente_id=' + p.id);
  el.innerHTML = `<div class="card"><div class="row end" style="margin-bottom:10px"><button class="primary" id="op-new">Novo orçamento</button></div>${table(rows, ORC_COLS, { onClick: o => verOrcamento(o.id), empty: 'Sem orçamentos' })}</div>`;
  $('#op-new', el).onclick = () => editOrcamento(null, { paciente: p });
}
async function editOrcamento(id, { paciente, linhas } = {}) {
  const lk = L();
  const o = id ? await GET('orcamentos/' + id) : { data: isoDate(), medico_id: paciente?.medico_id || App.user.medico_id, linhas: linhas || [] };
  const ls = o.linhas.map(l => ({ ...l }));
  if (!ls.length) ls.push(ivaFix({ qtd: 1, preco: 0, desconto_pct: byId(lk.entidades, paciente?.entidade_id)?.desconto_pct || 0 }));
  modal({ title: id ? `Orçamento ${o.numero}` : 'Novo orçamento', size: 'lg', body: `<form class="form-grid" onsubmit="return false">
    <div class="s2">${pacField('paciente_id', o.paciente_id ?? paciente?.id, o.paciente_nome ?? paciente?.nome)}</div>
    ${fld('Médico', sel('medico_id', opts(lk.medicos, o.medico_id, { empty: '—', only: x => x.ativo })))}${fld('Data', inp('data', o.data, 'type="date"'))}
    <div class="s4" id="oe-linhas"></div>${fld('Observações / condições', txt('notas', o.notas), 's4')}</form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.paciente_id) throw new Error('Escolha o paciente');
    const payload = { ...f, paciente_id: Number(f.paciente_id), medico_id: f.medico_id ? Number(f.medico_id) : null, linhas: ls.filter(l => l.descricao) };
    if (!payload.linhas.length) throw new Error('Adicione pelo menos uma linha');
    const r = id ? await PUT('orcamentos/' + id, { ...payload, estado: o.estado }) : await POST('orcamentos', payload);
    toast('Orçamento guardado'); verOrcamento(r.id); if (['orcamentos', 'paciente'].includes(App.current)) render();
  } }],
  onOpen: c => { bindPacField($('form', c.body), 'paciente_id'); linhasEditor($('#oe-linhas', c.body), ls); } });
}
function orcHTML(o) {
  return `<div class="doc"><div class="dh">${cabecalhoClinica()}<div class="right"><h2 style="margin:0">Orçamento</h2><div style="font-weight:700">${esc(o.numero)}</div>
    <div>Data: ${fmtDate(o.data)}</div><div>Válido até: ${fmtDate(o.validade)}</div></div></div>
    <p><b>${esc(o.paciente_nome)}</b> (proc. ${esc(o.paciente_numero)})<br>${esc(o.paciente_morada || '')} ${esc(o.paciente_cp || '')} ${esc(o.paciente_localidade || '')}<br>NIF: ${esc(o.paciente_nif || '')}${o.medico_nome ? '<br>Médico: ' + esc(o.medico_nome) : ''}</p>
    <table><tr><th>Tratamento</th><th>Dente</th><th class="right">Qtd</th><th class="right">Preço</th><th class="right">Desc.</th><th class="right">Total</th></tr>
    ${o.linhas.map(l => { const t = l.qtd * l.preco * (1 - (l.desconto_pct || 0) / 100) * (1 + (l.iva || 0) / 100); return `<tr><td>${esc(l.descricao)}</td><td>${esc(l.dente)}</td><td class="right">${num(l.qtd)}</td><td class="right">${eur(l.preco)}</td><td class="right">${l.desconto_pct ? num(l.desconto_pct) + '%' : ''}</td><td class="right">${eur(t)}</td></tr>`; }).join('')}</table>
    <table class="tot"><tr><td><b>Total</b></td><td class="right"><b>${eur(o.total)}</b></td></tr></table>
    ${o.notas ? `<p>${esc(o.notas).replace(/\n/g, '<br>')}</p>` : ''}
    <div style="margin-top:50px;display:flex;justify-content:space-between"><div>O(A) Médico(a)<br><br>______________________</div><div>Tomei conhecimento e aceito<br><br>______________________</div></div></div>`;
}
async function verOrcamento(id) {
  const o = await GET('orcamentos/' + id);
  const buttons = [{ label: 'Eliminar', cls: 'danger', left: true, onClick: async () => {
    if (!await confirmDlg('Eliminar este orçamento?', 'Eliminar', true)) return false;
    await DEL('orcamentos/' + id); toast('Orçamento eliminado'); render();
  } }];
  if (o.estado === 'aberto') {
    buttons.push({ label: 'Editar', onClick: () => editOrcamento(id) });
    buttons.push({ label: 'Recusar', onClick: async () => { await POST(`orcamentos/${id}/recusar`); toast('Orçamento recusado'); render(); } });
    buttons.push({ label: 'Aceitar (criar plano)', onClick: async () => {
      await POST(`orcamentos/${id}/aceitar`); toast('Orçamento aceite: tratamentos adicionados ao plano'); go(`#/paciente/${o.paciente_id}/tratamentos`);
    } });
  }
  buttons.push({ label: 'Imprimir', cls: 'primary', onClick: () => { printHTML(orcHTML(o)); return false; } });
  modal({ title: `Orçamento ${o.numero} — ${ORC_EST[o.estado]?.[0] || o.estado}`, size: 'lg', body: orcHTML(o), buttons });
}
