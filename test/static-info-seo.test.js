const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const faq = fs.readFileSync(path.join(__dirname, '..', 'preguntas.html'), 'utf8');
const policies = fs.readFileSync(path.join(__dirname, '..', 'politicas.html'), 'utf8');

test('FAQ page has canonical and search description', () => {
  assert.match(faq, /<meta name="description" content="Preguntas frecuentes de Mititoys/);
  assert.match(faq, /<link rel="canonical" href="https:\/\/mititoys\.com\/preguntas\.html">/);
  assert.doesNotMatch(faq, /noindex/i);
});

test('purchase information page has canonical and search description', () => {
  assert.match(policies, /<meta name="description" content="Información de compra de Mititoys/);
  assert.match(policies, /<link rel="canonical" href="https:\/\/mititoys\.com\/politicas\.html">/);
  assert.doesNotMatch(policies, /noindex/i);
});
