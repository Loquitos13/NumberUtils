'use strict';
/* Arranque, menu, login e atalhos globais */
const NAV = [
  ['inicio', 'home', 'Início'], ['agenda', 'calendar', 'Agenda'], ['pacientes', 'users', 'Pacientes'], ['faturacao', 'receipt', 'Faturação'],
  ['proteses', 'tooth', 'Próteses'], ['stocks', 'box', 'Stocks'], ['listagens', 'chart', 'Relatórios'], ['comunicacao', 'mail', 'Comunicação'],
  'sep', ['config', 'settings', 'Configuração'],
];

async function startApp() {
  if (App.user.trocar_pw) {
    $('#login').classList.add('hidden'); $('#app').classList.add('hidden'); $('#trocar').classList.remove('hidden');
    $('#trocar-pw input[name=atual]').focus(); return;
  }
  $('#trocar').classList.add('hidden');
  await refreshLookups();
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#user-name').textContent = `${App.user.nome} (${{ admin: 'Admin', medico: 'Médico', rececao: 'Receção', assistente: 'Assistente' }[App.user.perfil] || App.user.perfil})`;
  $('#side-clinica').textContent = 'Gestão clínica';
  document.title = `${L().config.clinica_nome || 'Clínica'} — Gestão`;
  $('#nav').innerHTML = NAV.map(n => n === 'sep' ? '<div class="sep"></div>' : `<a href="#/${n[0]}" data-r="${n[0]}" title="${n[2]}"><span class="ico"><i data-ic="${n[1]}"></i></span><span class="lbl">${n[2]}</span></a>`).join('');
  render();
}

function showLoginScreen() { showLogin(); $('#login-form input[name=login]').focus(); }

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = readForm(e.target);
  $('#login-err').classList.add('hidden');
  try {
    App.user = await api('POST', 'login', { login: f.login, password: f.password });
    e.target.reset();
    await startApp();
  } catch (err) { $('#login-err').textContent = err.message; $('#login-err').classList.remove('hidden'); }
});
$('#trocar-pw').addEventListener('submit', async e => {
  e.preventDefault();
  const f = readForm(e.target); const err = $('#trocar-err'); err.classList.add('hidden');
  try {
    if (f.nova !== f.nova2) throw new Error('As palavras-passe não coincidem');
    await POST('password', f); e.target.reset();
    App.user = await GET('me'); await startApp(); toast('Palavra-passe definida');
  } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
});
$('#btn-logout').onclick = async () => { await POST('logout').catch(() => {}); App.user = null; showLoginScreen(); };
$('#btn-pass').onclick = () => modal({ title: 'Alterar palavra-passe', size: 'sm', body: `<form onsubmit="return false">
    ${fld('Palavra-passe atual', inp('atual', '', 'type="password"'))}${fld('Nova palavra-passe', inp('nova', '', 'type="password"'))}${fld('Repetir nova', inp('nova2', '', 'type="password"'))}</form>`,
  buttons: [{ label: 'Cancelar' }, { label: 'Alterar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body)); if (f.nova !== f.nova2) throw new Error('As palavras-passe não coincidem');
    await POST('password', f); toast('Palavra-passe alterada');
  } }] });
$('#btn-new-marc').onclick = () => openMarcacao({});
$('#btn-new-pac').onclick = () => editPaciente(null, p => go('#/paciente/' + p.id));
patientPicker($('#global-search'), p => { $('#global-search').value = ''; go('#/paciente/' + p.id); });
const visivel = el => el && el.getClientRects().length && !el.disabled && !el.matches('.danger'); // Ctrl+S nunca carrega num botão de apagar
// botão de guardar: o principal do modal de cima, ou o [data-save] / "Guardar…" principal da página
function botaoGuardar() {
  const m = $$('.modal-bg').pop();
  if (m) return 'semCtrlS' in m.dataset ? null : [...$$('[data-save]', m), ...$$('footer button.primary', m).reverse()].find(visivel);
  const view = $('#view'), form = document.activeElement && document.activeElement.closest('#view form');
  return [...$$('[data-save]', view), ...(form ? $$('button.primary', form) : []),
    ...$$('button.primary', view).filter(b => /^guardar/i.test(b.textContent.trim()))].find(visivel);
}
document.addEventListener('keydown', e => {
  if ($('#app').classList.contains('hidden')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#global-search').focus(); }
  else if (e.altKey && !mod && e.code === 'KeyN') { e.preventDefault(); if (!$('.modal-bg')) openMarcacao({}); }
  else if (mod && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const b = botaoGuardar(); if (!b) return;
    const a = document.activeElement;
    if (a && a.matches('input, select, textarea')) a.blur(); // dispara o change do campo que está a ser editado
    b.click();
  }
});

(async () => {
  try { App.user = await GET('me'); await startApp(); }
  catch { showLoginScreen(); }
})();
