'use strict';
/* Contas de linhas: arredonda exatamente como calcLinha do servidor (lista = fatura) */
// meio cêntimo para longe do zero; toPrecision(15) apaga o erro binário (1,005 → 1,01)
const r2 = n => { const v = Number(n) || 0; return Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toPrecision(15))) / 100 || 0; };
// total da linha com IVA: base arredondada + IVA arredondado sobre a base
function totLinha({ preco, qtd = 1, desconto_pct = 0, iva = 0 } = {}) {
  const q = qtd == null || qtd === '' ? 1 : Number(qtd);
  const base = r2(q * (Number(preco) || 0) * (1 - (Number(desconto_pct) || 0) / 100));
  return r2(base + r2(base * (Number(iva) || 0) / 100));
}
if (typeof module !== 'undefined') module.exports = { r2, totLinha };
