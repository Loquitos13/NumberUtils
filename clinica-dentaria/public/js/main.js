'use strict';
/* Arranque, menu, login e atalhos globais */
const NAV = [
  ['inicio', '🏠', 'Início'], ['agenda', '📅', 'Agenda'], ['pacientes', '👥', 'Pacientes'], ['faturacao', '🧾', 'Faturação'],
  ['orcamentos', '📄', 'Orçamentos'], ['proteses', '🦷', 'Próteses'], ['stocks', '📦', 'Stocks'], ['estatisticas', '📊', 'Estatísticas'],
  ['comunicacao', '✉', 'Comunicação'], 'sep', ['config', '⚙', 'Configuração'],
];

async function startApp() {
  await refreshLookups();
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#user-name').textContent = `${App.user.nome} (${{ admin: 'Admin', medico: 'Médico', rececao: 'Receção', assistente: 'Assistente' }[App.user.perfil] || App.user.perfil})`;
  $('#side-clinica').textContent = L().config.clinica_nome || '';
  document.title = `${L().config.clinica_nome || 'Clínica'} — Gestão`;
  $('#nav').innerHTML = NAV.map(n => n === 'sep' ? '<div class="sep"></div>' : `<a href="#/${n[0]}" data-r="${n[0]}" title="${n[2]}"><span class="ico">${n[1]}</span><span class="lbl">${n[2]}</span></a>`).join('');
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
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#global-search').focus(); }
});

(async () => {
  try { App.user = await GET('me'); await startApp(); }
  catch { showLoginScreen(); }
})();
