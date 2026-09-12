const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const faq = fs.readFileSync(path.join(__dirname, '..', 'preguntas.html'), 'utf8');
const policies = fs.readFileSync(path.join(__dirname, '..', 'politicas.html'), 'utf8');

function assertSocialMetadata(html, canonicalPath, titlePrefix) {
  assert.match(html, new RegExp(`<meta property="og:type" content="website">`));
  assert.match(html, new RegExp(`<meta property="og:locale" content="es_AR">`));
  assert.match(html, new RegExp(`<meta property="og:site_name" content="Mititoys coleccionables">`));
  assert.match(html, new RegExp(`<meta property="og:title" content="${titlePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(html, new RegExp(`<meta property="og:url" content="https://mititoys\\.com/${canonicalPath}">`));
  assert.match(html, /<meta property="og:image" content="https:\/\//);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\//);
}

test('FAQ page has canonical, search description and social metadata', () => {
  assert.match(faq, /<meta name="description" content="Preguntas frecuentes de Mititoys/);
  assert.match(faq, /<link rel="canonical" href="https:\/\/mititoys\.com\/preguntas\.html">/);
  assert.doesNotMatch(faq, /noindex/i);
  assertSocialMetadata(faq, 'preguntas.html', 'Preguntas frecuentes');
});

test('purchase information page has canonical, search description and social metadata', () => {
  assert.match(policies, /<meta name="description" content="Información de compra de Mititoys/);
  assert.match(policies, /<link rel="canonical" href="https:\/\/mititoys\.com\/politicas\.html">/);
  assert.doesNotMatch(policies, /noindex/i);
  assertSocialMetadata(policies, 'politicas.html', 'Información de compra');
});
