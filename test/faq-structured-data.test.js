const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'preguntas.html'), 'utf8');

test('FAQ page exposes structured data matching visible questions', () => {
  assert.match(html, /"@type":"FAQPage"/);
  for (const question of ['¿Cómo pago?','¿Cómo recibo mi pedido?','¿Cómo consulto mi pedido?','¿Las figuras incluyen caja?','¿Necesitás ayuda?']) {
    assert.ok(html.includes(`"name":"${question}"`), `${question} must be present in FAQ structured data`);
    assert.ok(html.includes(`<h2>${question}</h2>`), `${question} must remain visible on the page`);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/mititoys\.com\/preguntas\.html">/);
});
