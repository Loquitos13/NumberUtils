'use strict';
/* Ficheiros do paciente: RX, fotos, consentimentos, relatórios */
const ANX_CATS = ['RX', 'Foto intraoral', 'Consentimento', 'Relatório', 'Outro'];
const anxUrl = a => `/api/anexos/${a.id}/ficheiro`;

async function tabAnexos(el, p, cat = '') {
  const lista = await GET(`t/anexos?paciente_id=${p.id}${cat ? '&categoria=' + encodeURIComponent(cat) : ''}`);
  el.innerHTML = `<div class="card"><div class="row between" style="margin-bottom:10px">
    <div class="seg">${['', ...ANX_CATS].map(c => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c || 'Todos')}</button>`).join('')}</div>
    <button class="primary" id="anx-new">Carregar ficheiro</button></div>
    ${lista.length ? `<div class="anx-grid">${lista.map(a => `<figure class="anx" data-id="${a.id}" tabindex="0" title="${esc(a.nome_original)}">
      ${a.mime.startsWith('image/') ? `<img src="${anxUrl(a)}" alt="${esc(a.descricao || a.nome_original)}" loading="lazy">` : '<div class="anx-pdf">PDF</div>'}
      <figcaption><b>${esc(a.categoria)}</b>${a.dente ? ' · dente ' + esc(a.dente) : ''}<br><span class="muted small">${esc(fmtDate(a.data || a.criado_em))} ${esc(a.descricao || a.nome_original)}</span></figcaption>
      <button class="ghost sm icon" data-del="${a.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button></figure>`).join('')}</div>`
    : '<div class="empty">Sem ficheiros</div>'}</div>`;
  $$('[data-cat]', el).forEach(b => b.onclick = () => tabAnexos(el, p, b.dataset.cat));
  $('#anx-new', el).onclick = () => carregarAnexo(p, () => tabAnexos(el, p, cat));
  $$('.anx', el).forEach(f => {
    const a = byId(lista, f.dataset.id);
    const abrir = () => a.mime === 'application/pdf' ? window.open(anxUrl(a), '_blank') : verAnexo(a);
    f.onclick = e => { if (!e.target.closest('[data-del]')) abrir(); };
    f.onkeydown = e => { if (e.key === 'Enter') abrir(); };
  });
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    if (!await confirmDlg('Eliminar este ficheiro? Não é possível recuperá-lo.', 'Eliminar', true)) return;
    await act(() => DEL('t/anexos/' + b.dataset.del), 'Ficheiro eliminado'); tabAnexos(el, p, cat);
  });
}

function carregarAnexo(p, done) {
  let file = null;
  modal({ title: 'Carregar ficheiro', body: `<div class="anx-drop" tabindex="0">Arraste o ficheiro para aqui ou <u>clique para escolher</u><br>
      <span class="muted small">JPG, PNG, WebP ou PDF, até 20 MB</span><div id="anx-nome" class="bold"></div></div>
    <input type="file" id="anx-file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
    <div class="grid g3" style="margin-top:10px">${fld('Categoria', sel('categoria', optsArr(ANX_CATS, 'RX')))}${fld('Dente', inp('dente', '', 'placeholder="ex.: 16" maxlength="2"'))}${fld('Data', inp('data', isoDate(), 'type="date"'))}</div>
    ${fld('Descrição', inp('descricao', ''))}`,
  onOpen: c => {
    const drop = $('.anx-drop', c.body), input = $('#anx-file', c.body);
    const escolher = f => { file = f; $('#anx-nome', c.body).textContent = f ? `${f.name} (${num(f.size / 1048576, 1)} MB)` : ''; };
    drop.onclick = () => input.click();
    drop.onkeydown = e => { if (e.key === 'Enter') input.click(); };
    input.onchange = () => escolher(input.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); escolher(e.dataTransfer.files[0]); };
  },
  buttons: [{ label: 'Cancelar' }, { label: 'Carregar', cls: 'primary', onClick: async c => {
    if (!file) throw new Error('Escolha um ficheiro');
    if (file.size > 20 * 1048576) throw new Error('O ficheiro excede 20 MB');
    const f = readForm(c.body);
    const qs = new URLSearchParams({ nome: file.name });
    for (const k of ['categoria', 'dente', 'data', 'descricao']) if (f[k]) qs.set(k, f[k]);
    const r = await fetch(`/api/pacientes/${p.id}/anexos?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `Erro ${r.status}`);
    toast('Ficheiro carregado'); done();
  } }] });
}

function verAnexo(a) {
  let z = 1;
  const c = modal({ title: `${a.categoria}${a.dente ? ' · dente ' + a.dente : ''} — ${a.descricao || a.nome_original}`, size: 'lg',
    body: `<div class="row" style="margin-bottom:8px"><button data-z="-1" class="icon" aria-label="Reduzir">−</button><button data-z="0">Ajustar</button><button data-z="1" class="icon" aria-label="Ampliar">+</button>
      <span class="spacer"></span><a class="btn" href="${anxUrl(a)}" download="${esc(a.nome_original)}">Descarregar</a></div>
      <div class="anx-view"><img src="${anxUrl(a)}" alt="${esc(a.descricao || a.nome_original)}"></div>` });
  const img = $('img', c.body), box = $('.anx-view', c.body);
  const zoom = n => { z = n ? Math.min(8, Math.max(0.25, z * (n > 0 ? 1.25 : 0.8))) : 1; img.style.width = z === 1 ? '' : `${z * 100}%`; img.style.maxWidth = z === 1 ? '100%' : 'none'; };
  $$('[data-z]', c.body).forEach(b => b.onclick = () => zoom(Number(b.dataset.z)));
  box.onwheel = e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(-e.deltaY); } };
}
