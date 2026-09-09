const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cleanup de cotizaciones exige CRON_SECRET y no-store', () => {
  const api = read('api/cleanup-shipping-quotes.js');
  assert.match(api, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(api, /process\.env\.CRON_SECRET/);
  assert.match(api, /req\.headers\.authorization !== `Bearer \$\{process\.env\.CRON_SECRET\}`/);
  assert.match(api, /status\(401\)/);
});

test('cleanup solo elimina cotizaciones vencidas, nunca usadas y sin pedido', () => {
  const api = read('api/cleanup-shipping-quotes.js');
  assert.match(api, /DELETE FROM shipping_quotes/);
  assert.match(api, /used_at IS NULL/);
  assert.match(api, /order_id IS NULL/);
  assert.match(api, /expires_at < NOW\(\) - INTERVAL '24 hours'/);
  assert.doesNotMatch(api, /DELETE FROM orders/);
  assert.doesNotMatch(api, /DELETE FROM inventory_movements/);
});

test('Vercel programa limpieza diaria separada del cron de envíos', () => {
  const config = JSON.parse(read('vercel.json'));
  const envios = config.crons.find(cron => cron.path === '/api/envios?action=automation');
  const cleanup = config.crons.find(cron => cron.path === '/api/cleanup-shipping-quotes');
  assert.equal(envios?.schedule, '0 * * * *');
  assert.equal(cleanup?.schedule, '17 5 * * *');
});
