'use strict';
// Configuração → Importar pacientes (CSV do NoviGest ou do Excel)

// campo da ficha → nomes de cabeçalho que o sugerem (sem acentos, só letras e números)
const IMP_CAMPOS = [
  ['numero', 'N.º de processo', ['processo', 'nprocesso', 'numprocesso', 'numero', 'n', 'nficha', 'ficha', 'codigo']],
  ['nome', 'Nome', ['nome', 'nomecompleto', 'paciente', 'utente']],
  ['data_nasc', 'Data de nascimento', ['datanascimento', 'datanasc', 'dtnascimento', 'dtnasc', 'nascimento']],
  ['genero', 'Género', ['genero', 'sexo']],
  ['nif', 'NIF', ['nif', 'contribuinte', 'ncontribuinte', 'numcontribuinte']],
  ['sns', 'N.º SNS', ['sns', 'nsns', 'utentesns', 'numutente']],
  ['cc', 'Cartão de cidadão', ['cc', 'cartaocidadao', 'bi', 'ncc']],
  ['telemovel', 'Telemóvel', ['telemovel', 'telem', 'movel', 'tlm', 'celular']],
  ['telefone', 'Telefone', ['telefone', 'tel', 'telefonefixo']],
  ['email', 'E-mail', ['email', 'correioeletronico', 'mail']],
  ['morada', 'Morada', ['morada', 'endereco', 'rua']],
  ['cod_postal', 'Código postal', ['codigopostal', 'codpostal', 'cp']],
  ['localidade', 'Localidade', ['localidade', 'cidade', 'concelho']],
  ['profissao', 'Profissão', ['profissao']],
  ['num_beneficiario', 'N.º beneficiário', ['beneficiario', 'nbeneficiario', 'numbeneficiario', 'apolice']],
  ['nacionalidade', 'Nacionalidade', ['nacionalidade']],
  ['contacto_emergencia', 'Contacto de emergência', ['contactoemergencia']],
  ['telefone_emergencia', 'Telefone de emergência', ['telefoneemergencia']],
  ['id_externo', 'ID externo', ['id', 'idexterno']],
  ['notas', 'Notas', ['notas', 'observacoes', 'obs']],
  // por nome: o servidor procura na tabela (os *_id só pela API)
  ['entidade', 'Entidade/seguro (nome)', ['entidade', 'seguro', 'seguradora', 'subsistema']],
  ['medico', 'Médico (nome)', ['medico', 'medicoassistente', 'dentista']],
  ['rgpd_consent', 'Consentimento RGPD', ['rgpd', 'consentimentorgpd', 'consentimento']],
  ['sms_ok', 'Aceita SMS', ['sms', 'aceitasms', 'smsconsent']],
  ['email_ok', 'Aceita e-mail', ['emailconsent', 'aceitaemail', 'consentimentoemail']],
  ['ativo', 'Ativo', ['ativo', 'activo']],
];
const impNorm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const impSugestao = h => (IMP_CAMPOS.find(c => c[2].includes(impNorm(h))) || [''])[0];

function importarSection(body, admin) {
  if (!admin) { body.innerHTML = '<div class="empty">Sem permissão</div>'; return; }
  body.innerHTML = `<h3>Importar pacientes</h3>
    <p class="muted small">Ficheiro CSV exportado do NoviGest ou do Excel (separado por ; ou ,). Associe cada coluna a um campo da ficha, simule e depois importe.
      Os pacientes que já existem (mesmo NIF ou n.º de processo) são ignorados. Datas em dd/mm/aaaa ou aaaa-mm-dd. Máximo 3,5 MB.</p>
    <div class="row"><input type="file" id="imp-file" aria-label="Ficheiro CSV de pacientes" accept=".csv,.txt,text/csv"><div class="spacer"></div>
      <button id="imp-sim" disabled>Simular</button><button class="primary" id="imp-go" disabled>Importar</button></div>
    <div id="imp-prev" style="margin-top:10px"></div><div id="imp-res" style="margin-top:10px"></div>`;
  let csv = '', linhas = [];
  const mapa = () => $$('#imp-prev select').map(s => s.value);
  const resultado = (r, simular) => {
    $('#imp-res').innerHTML = `<div class="alert">${simular ? 'Simulação: vão ser criados' : 'Importação concluída: criados'} <b>${r.criados}</b> pacientes;
      <b>${r.ignorados}</b> já existem e ${simular ? 'serão ignorados' : 'foram ignorados'}; <b>${r.erros.length}</b> linhas com erro.</div>
      ${r.erros.length ? `<div class="tbl-wrap">${table(r.erros, [{ h: 'Linha', f: e => e.linha, cls: 'right' }, { h: 'Motivo', f: e => esc(e.motivo) }])}</div>` : ''}`;
  };
  const enviar = async simular => {
    const r = await act(() => POST('importar/pacientes', { csv, mapa: mapa(), simular }), simular ? '' : 'Pacientes importados');
    resultado(r, simular);
    $('#imp-go').disabled = !simular; // só se importa depois de uma simulação com este mapa
  };
  $('#imp-file').onchange = async e => {
    const f = e.target.files[0]; $('#imp-res').innerHTML = ''; $('#imp-sim').disabled = $('#imp-go').disabled = true;
    if (!f) return;
    if (f.size > 3.5e6) return toast('Ficheiro demasiado grande (máx. 3,5 MB). Divida-o em partes.', true);
    const bytes = new Uint8Array(await f.arrayBuffer());
    let texto; try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { texto = new TextDecoder('windows-1252').decode(bytes); }
    try { linhas = parseCsv(texto); } catch (err) { $('#imp-prev').innerHTML = ''; return toast(err.message, true); } // parseCsv: js/csv.js, o mesmo do servidor
    if (linhas.length < 2) { $('#imp-prev').innerHTML = '<div class="empty">O ficheiro não tem linhas de dados</div>'; return; }
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    csv = btoa(bin); // o servidor deteta o encoding a partir dos bytes
    const cab = linhas[0];
    const optsCampos = h => optsArr([['', '— não importar —'], ...IMP_CAMPOS.map(c => [c[0], c[1]])], impSugestao(h));
    $('#imp-prev').innerHTML = `<p class="small muted">${linhas.length - 1} linhas. Primeiras linhas do ficheiro:</p>
      <div class="tbl-wrap"><table class="t"><thead><tr>${cab.map(h => `<th>${esc(h)}<br>${sel('', optsCampos(h))}</th>`).join('')}</tr></thead>
      <tbody>${linhas.slice(1, 6).map(l => `<tr>${cab.map((_, i) => `<td>${esc(l[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    $$('#imp-prev select').forEach(s => s.onchange = () => { $('#imp-go').disabled = true; });
    $('#imp-sim').disabled = false;
  };
  $('#imp-sim').onclick = () => {
    if (!mapa().includes('nome')) return toast('Associe uma coluna ao campo Nome', true);
    enviar(true);
  };
  $('#imp-go').onclick = async () => { if (await confirmDlg('Importar os pacientes deste ficheiro?', 'Importar')) enviar(false); };
}
