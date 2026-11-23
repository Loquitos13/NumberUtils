'use strict';
/* Odontograma: imagens renderizadas de modelos 3D reais (BodyParts3D, CC BY 4.0) em vista vestibular e oclusal,
   com faces clicáveis e símbolos sobrepostos.
   Notação FDI. Símbolos: vermelho = necessário, azul = feito. */

const COR_NEC = '#d22d3d', COR_FEITO = '#2b58c4';

// tipo anatómico a partir do número FDI
function tipoDente(n) {
  const q = Math.floor(n / 10), u = n % 10, dec = q >= 5;
  const sup = q === 1 || q === 2 || q === 5 || q === 6;
  let t;
  if (dec) t = u <= 2 ? (u === 1 ? 'i1' : 'i2') : u === 3 ? 'c' : 'm';
  else t = ['', 'i1', 'i2', 'c', 'pm1', 'pm2', 'm', 'm', 'm'][u];
  return { t, sup, dec, u, mesialDir: (q === 1 || q === 4 || q === 5 || q === 8) ? 1 : -1 };
}

// vista oclusal (caixa 40x40)
const OCLUSAL = {
  i: { o: 'M5 20C5 13 12 11.5 20 11.5C28 11.5 35 13 35 20C35 27 28 28.5 20 28.5C12 28.5 5 27 5 20Z', c: '<ellipse cx="20" cy="20" rx="8" ry="3.2"/>', g: '' },
  c: { o: 'M7 20C7 12 14 8.5 20 7.5C26 8.5 33 12 33 20C33 28 26 32.5 20 32.5C14 32.5 7 28 7 20Z', c: '<ellipse cx="20" cy="20" rx="6" ry="6"/>', g: 'M14 20L20 15L26 20' },
  pm: { o: 'M8 20C8 10 13 6 20 6C27 6 32 10 32 20C32 30 27 34 20 34C13 34 8 30 8 20Z', c: '<ellipse cx="20" cy="20" rx="6.5" ry="8"/>', g: 'M14.5 20L25.5 20' },
  m: { o: 'M5 12C5 7 8 5 13 5L27 5C32 5 35 7 35 12L35 28C35 33 32 35 27 35L13 35C8 35 5 33 5 28Z', c: '<rect x="12" y="12" width="16" height="16" rx="3"/>', g: 'M13 20L27 20M20 13L20 27M15 15L18 18M25 15L22 18M15 25L18 22M25 25L22 22' },
};
function oclusalDe(t) { return t === 'i1' || t === 'i2' ? OCLUSAL.i : t === 'c' ? OCLUSAL.c : t.startsWith('pm') ? OCLUSAL.pm : OCLUSAL.m; }

// faces na vista oclusal: topo / fundo / esquerda / direita (no ecrã)
function posFaces(tp) {
  return { top: tp.sup ? 'V' : 'L', bottom: tp.sup ? 'L' : 'V', left: tp.mesialDir === 1 ? 'D' : 'M', right: tp.mesialDir === 1 ? 'M' : 'D' };
}

let _uid = 0;
// ---- imagens renderizadas dos modelos 3D (BodyParts3D, CC BY 4.0) ----
// moldura vestibular 16 x 33,6 mm = 40 x 84 unidades (2,5 un/mm); oclusal 16 x 16 mm = 40 x 40
const UN_MM = 2.5;
const COROA_MM = { sup: { i1: 10.5, i2: 9, c: 10, pm1: 8.5, pm2: 8, m: 7.5 }, inf: { i1: 9, i2: 9.5, c: 11, pm1: 8, pm2: 8, m: 7.5 } };
const COMP_MM = { 11: 28.4, 12: 30.3, 13: 32.1, 14: 28.7, 15: 26.2, 16: 24.5, 17: 23.2, 21: 28.5, 22: 30.4, 23: 32.1, 24: 28.8, 25: 26.3, 26: 24.6, 27: 23.2,
  31: 30.8, 32: 29.9, 33: 30.1, 34: 25.2, 35: 25.4, 36: 22.3, 37: 22.5, 41: 30.8, 42: 29.9, 43: 30.1, 44: 25.2, 45: 25.4, 46: 22.3, 47: 22.5 };
// dente com imagem própria e escala (sisos e decíduos reutilizam o modelo mais próximo)
function fonteImagem(n) {
  const q = Math.floor(n / 10), u = n % 10;
  if (q <= 4) return u === 8 ? { src: q * 10 + 7, esc: 0.9 } : { src: n, esc: 1 };
  const qp = q - 4; const up = u <= 3 ? u : u === 4 ? 4 : 6;
  return { src: qp * 10 + up, esc: u <= 3 ? 0.78 : 0.8 };
}

/* s = { faces: {O:'#cor',...}, marcas: [{sym, cor}], ausente: bool }
   Símbolos: canal, coroa, implante, extracao, faceta, ponte, protese, fratura, selante, mobilidade */
function desenhoDente(n, s) {
  const tp = tipoDente(n); const uid = 'd' + n + '_' + (++_uid);
  const { src, esc } = fonteImagem(n);
  const tem = sym => s.marcas.filter(m => m.sym === sym);
  const implante = tem('implante'), coroaM = tem('coroa')[0], facM = tem('faceta')[0];
  // geometria na orientação "superior" (coroa em baixo, y=84); nos inferiores é espelhada verticalmente
  const crown = (COROA_MM[tp.sup ? 'sup' : 'inf'][tp.t] || 8) * esc;
  const cej = 84 - (crown + 0.6) * UN_MM;
  const apex = Math.max(2, 84 - ((COMP_MM[src] || 25) * esc + 0.6) * UN_MM);
  const meio = (cej + 84) / 2;
  const flip = t => tp.sup ? t : `<g transform="translate(0 84) scale(1 -1)">${t}</g>`;
  const imgV = `<image href="img/dentes/${src}-v.webp" x="0" y="0" width="40" height="84" preserveAspectRatio="none"/>`;
  // escala dos sisos/decíduos ancorada na coroa
  const escV = t => esc === 1 ? t : `<g transform="translate(20 ${tp.sup ? 84 : 0}) scale(${esc}) translate(-20 ${tp.sup ? -84 : 0})">${t}</g>`;
  let lat = '';
  lat += `<defs><mask id="${uid}mv" style="mask-type:alpha">${escV(imgV)}</mask>
    <clipPath id="${uid}cc"><rect x="0" width="40" ${tp.sup ? `y="${cej}" height="${84 - cej}"` : `y="0" height="${84 - cej}"`}/></clipPath></defs>`;
  lat += implante.length ? `<g clip-path="url(#${uid}cc)">${escV(imgV)}</g>` : escV(imgV);
  // tingidos pela silhueta real do dente
  if (coroaM) lat += `<g mask="url(#${uid}mv)"><rect x="0" width="40" ${tp.sup ? `y="${cej}" height="${84 - cej}"` : `y="0" height="${84 - cej}"`} style="fill:${coroaM.cor};opacity:.42"/></g>`;
  else if (facM) lat += `<g mask="url(#${uid}mv)"><rect x="0" width="40" ${tp.sup ? `y="${cej + (84 - cej) * 0.2}" height="${(84 - cej) * 0.8}"` : `y="0" height="${(84 - cej) * 0.8}"`} style="fill:${facM.cor};opacity:.35"/></g>`;
  let sym = '';
  for (const m of implante) sym += `<g style="color:${m.cor}"><rect x="16" y="${cej - 30}" width="8" height="30" rx="2" class="impl"/>${[0, 5, 10, 15, 20, 25].map(k => `<path d="M16 ${cej - 28 + k}L24 ${cej - 25 + k}" class="impl-l"/>`).join('')}</g>`;
  if (!implante.length) for (const m of tem('canal')) {
    const top = apex + 4, bot = cej + 2;
    const linhas = tp.t === 'm' ? (tp.sup ? [[15, 12], [25, 28], [20, 20]] : [[16, 13.5], [24, 26.5]]) : tp.t === 'pm1' && tp.sup ? [[18.5, 17], [21.5, 23]] : [[20, 20]];
    sym += linhas.map(([x0, x1]) => `<path d="M${x0} ${bot}L${x1} ${top}" class="canal" style="stroke:${m.cor}"/>`).join('');
  }
  for (const m of tem('fratura')) sym += `<path d="M13 ${cej + 4}L19 ${meio}L15 ${meio + 3}L26 ${82}" class="sym" style="stroke:${m.cor}"/>`;
  for (const m of [...tem('ponte'), ...tem('protese')]) sym += `<path d="M-1 ${meio}H41" class="sym" style="stroke:${m.cor};stroke-width:3.2"/>`;
  for (const m of tem('mobilidade')) sym += `<path d="M6 ${cej - 6}H34M6 ${cej - 6}l3-2.5M6 ${cej - 6}l3 2.5M34 ${cej - 6}l-3-2.5M34 ${cej - 6}l-3 2.5" class="sym" style="stroke:${m.cor}"/>`;
  for (const m of tem('extracao')) sym += `<path d="M5 ${apex + 2}L35 82M35 ${apex + 2}L5 82" class="sym" style="stroke:${m.cor};stroke-width:3"/>`;
  lat += flip(sym);
  // ---- vista oclusal ----
  const oc = oclusalDe(tp.t); const pf = posFaces(tp);
  const imgO = `<image href="img/dentes/${src}-o.webp" x="0" y="0" width="40" height="40" preserveAspectRatio="none"/>`;
  const escO = t => esc === 1 ? t : `<g transform="translate(20 20) scale(${esc}) translate(-20 -20)">${t}</g>`;
  const fill = f => s.faces[f] ? `style="fill:${s.faces[f]};fill-opacity:.62"` : '';
  const selM = tem('selante')[0];
  let ocl = `<defs><mask id="${uid}mo" style="mask-type:alpha">${escO(imgO)}</mask></defs>${escO(imgO)}
    <g mask="url(#${uid}mo)">
      <polygon data-f="${pf.top}" points="0,0 40,0 20,20" class="face" ${fill(pf.top)}/><polygon data-f="${pf.bottom}" points="0,40 40,40 20,20" class="face" ${fill(pf.bottom)}/>
      <polygon data-f="${pf.left}" points="0,0 0,40 20,20" class="face" ${fill(pf.left)}/><polygon data-f="${pf.right}" points="40,0 40,40 20,20" class="face" ${fill(pf.right)}/>
      <g data-f="O" class="face fo" ${s.faces.O ? `style="fill:${s.faces.O};fill-opacity:.62"` : selM ? `style="fill:${selM.cor};fill-opacity:.4"` : ''}><g transform="translate(20 20) scale(${0.8 * esc}) translate(-20 -20)">${oc.c}</g></g>
      ${coroaM ? `<rect width="40" height="40" style="fill:${coroaM.cor};opacity:.3"/>` : ''}
    </g>`;
  if (implante.length && !coroaM) ocl += `<circle cx="20" cy="20" r="5" style="fill:none;stroke:${implante[0].cor};stroke-width:2"/>`;
  for (const m of tem('extracao')) ocl += `<path d="M8 8L32 32M32 8L8 32" class="sym" style="stroke:${m.cor};stroke-width:3"/>`;
  const body = tp.sup ? `<g class="lat">${lat}</g><g class="ocl" transform="translate(0 90)">${ocl}</g>`
    : `<g class="ocl">${ocl}</g><g class="lat" transform="translate(0 46)">${lat}</g>`;
  return `<svg viewBox="-2 -2 44 134" class="dente real${s.ausente && !implante.length ? ' ausente' : ''}" aria-hidden="true">${body}</svg>`;
}

// símbolo a desenhar para um serviço (configurável; inferido do nome quando vazio)
function simboloServico(sv, descricao) {
  if (sv && sv.simbolo) return sv.simbolo;
  const t = ((sv && sv.nome) || descricao || '').toLowerCase();
  if (/endodont|desvitaliz|canal/.test(t)) return 'canal';
  if (/extra[cç]/.test(t)) return 'extracao';
  if (/implante/.test(t) && !/coroa/.test(t)) return 'implante';
  if (/coroa|onlay|inlay/.test(t)) return 'coroa';
  if (/faceta/.test(t)) return 'faceta';
  if (/ponte/.test(t)) return 'ponte';
  if (/pr[oó]tese/.test(t)) return 'protese';
  if (/selante/.test(t)) return 'selante';
  if (/restaura|comp[oó]sito|amálgama|obtura/.test(t)) return 'face';
  return '';
}
const SIMBOLOS = [['', 'Nenhum (não desenha)'], ['face', 'Faces (restauração)'], ['canal', 'Canal (endodontia)'], ['coroa', 'Coroa'], ['implante', 'Implante'],
  ['extracao', 'Extração'], ['faceta', 'Faceta'], ['ponte', 'Ponte'], ['protese', 'Prótese'], ['selante', 'Selante']];
