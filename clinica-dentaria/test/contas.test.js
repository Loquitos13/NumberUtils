'use strict';
// totLinha (cliente) tem de dar o mesmo cêntimo que a fatura (calcLinha no servidor)
const test = require('node:test');
const assert = require('node:assert/strict');
const { totLinha } = require('../public/js/contas.js');

test('totLinha arredonda como a fatura', () => {
  const casos = [ // [linha, total feito à mão]
    [{ preco: 3, desconto_pct: 12.5, iva: 6 }, 2.79], // base 2,625→2,63; IVA 0,1578→0,16
    [{ preco: 2.5, iva: 23 }, 3.08], // IVA 0,575→0,58
    [{ preco: 50 }, 50],
    [{ preco: 10, qtd: 3, iva: 23 }, 36.9],
    [{ preco: 1.005 }, 1.01], // 100,49999… em binário
    [{ preco: 33.33, qtd: 3, desconto_pct: 10, iva: 6 }, 95.39], // base 89,991→89,99; IVA 5,3994→5,40
    [{ preco: 19.99, qtd: null, iva: 13 }, 22.59], // qtd vazia = 1; IVA 2,5987→2,60
    [{ preco: 100, desconto_pct: 100, iva: 23 }, 0],
    [{ preco: -10, iva: 23 }, -12.3], // estorno: arredonda para longe do zero
    [{ preco: '7.5', qtd: '2', desconto_pct: '', iva: '23' }, 18.45], // valores vindos de formulários
  ];
  for (const [l, esperado] of casos) assert.equal(totLinha(l), esperado, JSON.stringify(l));
});
