const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const productsApi = fs.readFileSync(path.join(root, 'api/productos.js'), 'utf8');
const orderApi = fs.readFileSync(path.join(root, 'api/estado-pedido.js'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'lib/notifications.js'), 'utf8');
const reviewPage = fs.readFileSync(path.join(root, 'opinar.html'), 'utf8');

test('tokens de opinión conservan 192 bits de entropía y enlaces nuevos usan fragmento', () => {
  assert.match(notifications, /randomBytes\(24\)\.toString\(['"]hex['"]\)/);
  assert.match(notifications, /opinar\.html#token=/);
  assert.doesNotMatch(notifications, /opinar\.html\?token=/);
  assert.match(orderApi, /opinar\.html#token=/);
  assert.doesNotMatch(orderApi, /opinar\.html\?token=/);
});

test('opinar retira el token del address bar y nunca lo envía en una URL de API', () => {
  assert.match(reviewPage, /location\.hash/);
  assert.match(reviewPage, /history\.replaceState\(null,['"]['"],location\.pathname\)/);
  assert.match(reviewPage, /action:['"]review_lookup['"]/);
  assert.match(reviewPage, /action:['"]review_submit['"]/);
  assert.match(reviewPage, /method:['"]POST['"]/);
  assert.match(reviewPage, /['"]Content-Type['"]:['"]application\/json['"]/);
  assert.doesNotMatch(reviewPage, /\/api\/productos\?review_token=/);
  assert.match(reviewPage, /name=['"]robots['"] content=['"]noindex,nofollow,noarchive['"]/);
});

test('lookup de review no devuelve nombre de cliente y exige compra financieramente elegible', () => {
  assert.match(productsApi, /action === ['"]review_lookup['"]/);
  assert.match(productsApi, /r\.status='invited'/);
  assert.match(productsApi, /r\.submitted_at IS NULL/);
  assert.match(productsApi, /o\.status='delivered'/);
  assert.match(productsApi, /o\.payment_status='approved'/);
  assert.match(productsApi, /multiple_approved_conflict/);
  assert.match(productsApi, /partially_refunded/);

  const lookupStart = productsApi.indexOf("if (action === 'review_lookup')");
  const submitStart = productsApi.indexOf("if (action !== 'review_submit')");
  assert.ok(lookupStart >= 0 && submitStart > lookupStart);
  const lookupBlock = productsApi.slice(lookupStart, submitStart);
  assert.doesNotMatch(lookupBlock, /customer_name/);
  assert.doesNotMatch(lookupBlock, /c\.name/);
});

test('publicación consume el bearer token de forma atómica y bloquea reuso', () => {
  assert.match(productsApi, /const replacementToken = crypto\.randomBytes\(24\)\.toString\(['"]hex['"]\)/);
  assert.match(productsApi, /review_token=\$\{replacementToken\}/);
  assert.match(productsApi, /AND r\.review_token=\$\{token\}/);
  assert.match(productsApi, /AND r\.status='invited'/);
  assert.match(productsApi, /AND r\.submitted_at IS NULL/);
  assert.match(productsApi, /status\(409\)/);
  assert.match(productsApi, /ya fue utilizado/);
});

test('POST de review es JSON privado/no-store y valida token hexadecimal de 48 caracteres', () => {
  assert.match(productsApi, /Cache-Control['"], ['"]private, no-store, max-age=0['"]/);
  assert.match(productsApi, /contentType !== ['"]application\/json['"]/);
  assert.match(productsApi, /status\(415\)/);
  assert.match(productsApi, /\^\[a-f0-9\]\{48\}\$/i);
});

test('seguimiento solo expone reviews todavía no consumidas', () => {
  assert.match(orderApi, /r\.status='invited'/);
  assert.match(orderApi, /r\.submitted_at IS NULL/);
  assert.match(orderApi, /review_links/);
});
