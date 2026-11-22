'use strict';
/* Desenho anatómico dos dentes (SVG próprio): vista vestibular (coroa + raízes) e vista oclusal (5 faces).
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

// geometria na orientação superior (raízes para cima, coroa em baixo). Caixa 40 x 84; colo (CEJ) em y=52.
const COROA = {
  i1: 'M7 52C6 64 6 74 8 81Q20 84.5 32 81C34 74 34 64 33 52Z',
  i2: 'M9 52C8 64 8 73 10 80Q20 83 30 80C32 73 32 64 31 52Z',
  c: 'M8 52C7 63 10 73 20 82C30 73 33 63 32 52Z',
  pm1: 'M8 52C6 62 8 72 13 79L20 74.5L27 79C32 72 34 62 32 52Z',
  pm2: 'M8 52C6 62 8 72 13.5 78.5L20 75.5L26.5 78.5C32 72 34 62 32 52Z',
  m: 'M4 52C2 62 4 73 9 79L14.5 74.5L20 79L25.5 74.5L31 79C36 73 38 62 36 52Z',
};
function raizes(tp) {
  const { t, sup, u, dec } = tp;
  if (t === 'i1') return ['M9 52C11 34 15 12 20 4C25 12 29 34 31 52Z'];
  if (t === 'i2') return ['M11 52C13 36 16 16 20 8C24 16 27 36 29 52Z'];
  if (t === 'c') return ['M10 52C11 30 15 6 20 0C25 6 29 30 30 52Z'];
  if (t === 'pm1' && sup) return ['M10 52C10 36 11 20 14 12C17 22 18 38 19.5 52Z', 'M20.5 52C22 38 23 22 26 12C29 20 30 36 30 52Z'];
  if (t === 'pm1' || t === 'pm2') return ['M11 52C12 34 16 14 20 8C24 14 28 34 29 52Z'];
  // molares
  const curto = u === 8 || dec ? 6 : 0;
  if (sup) return [`M15 52C15 36 17 ${18 + curto} 20 ${8 + curto}C23 ${18 + curto} 25 36 25 52Z`,
    `M5.5 52C5 38 6 ${22 + curto} 9 ${12 + curto}C12 ${22 + curto} 14 38 16 52Z`, `M24 52C26 38 28 ${22 + curto} 31 ${12 + curto}C34 ${22 + curto} 35 38 34.5 52Z`];
  return [`M5.5 52C5 36 7 ${18 + curto} 10 ${10 + curto}C13 ${18 + curto} 15 36 17 52Z`, `M23 52C25 36 27 ${18 + curto} 30 ${10 + curto}C33 ${18 + curto} 35 36 34.5 52Z`];
}
function canais(tp) {
  const { t, sup } = tp;
  if (t === 'i1' || t === 'i2') return 'M20 50L20 12';
  if (t === 'c') return 'M20 50L20 6';
  if (t === 'pm1' && sup) return 'M15 50L14.3 18M25 50L25.8 18';
  if (t === 'pm1' || t === 'pm2') return 'M20 50L20 14';
  return sup ? 'M10.5 50L9.3 18M29.5 50L30.8 18M20 50L20 14' : 'M11 50L10 16M29 50L30 16';
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
/* s = { faces: {O:'#cor',...}, marcas: [{sym, cor}], ausente: bool }
   Símbolos: canal, coroa, implante, extracao, faceta, ponte, protese, fratura, selante, mobilidade */
function desenhoDente(n, s) {
  const tp = tipoDente(n); const uid = 'd' + n + '_' + (++_uid);
  const sc = tp.dec ? 0.84 : 1;
  const tem = sym => s.marcas.filter(m => m.sym === sym);
  const implante = tem('implante');
  // ---- vista vestibular ----
  let lat = '';
  if (!implante.length) for (const r of raizes(tp)) lat += `<path class="raiz" d="${r}"/>`;
  else lat += implante.map(m => `<g style="color:${m.cor}"><rect x="15.5" y="10" width="9" height="42" rx="2" class="impl"/>${[16, 22, 28, 34, 40, 46].map(y => `<path d="M15.5 ${y}L24.5 ${y + 3}" class="impl-l"/>`).join('')}</g>`).join('');
  const coroa = COROA[tp.t];
  const cor = tem('coroa')[0], fac = tem('faceta')[0];
  lat += `<path class="coroa" d="${coroa}" ${cor ? `style="fill:${cor.cor};fill-opacity:.22;stroke:${cor.cor};stroke-width:2.4"` : ''}/>`;
  if (fac && !cor) lat += `<clipPath id="${uid}f"><path d="${coroa}"/></clipPath><rect x="0" y="60" width="40" height="30" clip-path="url(#${uid}f)" style="fill:${fac.cor};opacity:.45"/>`;
  lat += `<path class="colo" d="M${tp.t === 'm' ? 4 : 8} 52H${tp.t === 'm' ? 36 : 32}"/>`;
  for (const m of tem('canal')) if (!implante.length) lat += `<path d="${canais(tp)}" class="canal" style="stroke:${m.cor}"/>`;
  for (const m of tem('fratura')) lat += `<path d="M12 60L19 66L15 70L26 78" class="sym" style="stroke:${m.cor}"/>`;
  for (const m of [...tem('ponte'), ...tem('protese')]) lat += `<path d="M-1 66H41" class="sym" style="stroke:${m.cor};stroke-width:3.2"/>`;
  for (const m of tem('mobilidade')) lat += `<path d="M6 44H34M6 44l3-2.5M6 44l3 2.5M34 44l-3-2.5M34 44l-3 2.5" class="sym" style="stroke:${m.cor}"/>`;
  for (const m of tem('extracao')) lat += `<path d="M5 6L35 80M35 6L5 80" class="sym" style="stroke:${m.cor};stroke-width:3"/>`;
  const latG = tp.sup ? `<g transform="translate(${20 - 20 * sc} ${84 - 84 * sc}) scale(${sc})">${lat}</g>`
    : `<g transform="translate(${20 - 20 * sc} ${84 * sc}) scale(${sc} ${-sc})">${lat}</g>`;
  // ---- vista oclusal ----
  const oc = oclusalDe(tp.t); const pf = posFaces(tp);
  const fill = f => s.faces[f] ? `style="fill:${s.faces[f]}"` : '';
  const sel = tem('selante')[0];
  let ocl = `<clipPath id="${uid}o"><path d="${oc.o}"/></clipPath><g clip-path="url(#${uid}o)">
    <polygon data-f="${pf.top}" points="0,0 40,0 20,20" class="face" ${fill(pf.top)}/><polygon data-f="${pf.bottom}" points="0,40 40,40 20,20" class="face" ${fill(pf.bottom)}/>
    <polygon data-f="${pf.left}" points="0,0 0,40 20,20" class="face" ${fill(pf.left)}/><polygon data-f="${pf.right}" points="40,0 40,40 20,20" class="face" ${fill(pf.right)}/>
    <g data-f="O" class="face fo" ${s.faces.O ? `style="fill:${s.faces.O}"` : sel ? `style="fill:${sel.cor};fill-opacity:.5"` : ''}>${oc.c}</g></g>
    ${oc.g ? `<path d="${oc.g}" class="sulco"/>` : ''}<path d="${oc.o}" class="contorno"/>`;
  if (implante.length && !tem('coroa').length) ocl += `<circle cx="20" cy="20" r="5" style="fill:none;stroke:${implante[0].cor};stroke-width:2"/>`;
  for (const m of tem('extracao')) ocl += `<path d="M8 8L32 32M32 8L8 32" class="sym" style="stroke:${m.cor};stroke-width:3"/>`;
  const oclG = `<g transform="translate(${20 - 20 * sc} ${20 - 20 * sc}) scale(${sc})">${ocl}</g>`;
  // superior: vestibular em cima, oclusal em baixo; inferior: oclusal em cima, vestibular em baixo
  const body = tp.sup ? `<g class="lat">${latG}</g><g class="ocl" transform="translate(0 90)">${oclG}</g>`
    : `<g class="ocl">${oclG}</g><g class="lat" transform="translate(0 46)">${latG}</g>`;
  return `<svg viewBox="-2 -2 44 134" class="dente${s.ausente && !implante.length ? ' ausente' : ''}" aria-hidden="true">${body}</svg>`;
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
