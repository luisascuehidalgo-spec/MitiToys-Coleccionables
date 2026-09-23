const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.join(__dirname, '..', 'catalogo-dinamico.js'), 'utf8');

test('catalog search analytics waits for a settled query', () => {
  assert.match(catalog, /let searchAnalyticsTimer = null;/);
  assert.match(catalog, /clearTimeout\(searchAnalyticsTimer\);/);
  assert.match(catalog, /setTimeout\(\(\) => \{/);
  assert.match(catalog, /\}, 600\);/);
  assert.match(catalog, /settledQuery === lastTrackedSearch/);
  assert.equal((catalog.match(/track\('catalog_search'/g) || []).length, 1);
});

test('catalog search analytics never sends free-form search text', () => {
  const event = catalog.match(/track\('catalog_search',\s*\{([^}]*)\}\)/s);
  assert.ok(event, 'catalog_search analytics event must exist');
  assert.doesNotMatch(event[1], /\bquery\s*:/);
  assert.doesNotMatch(event[1], /settledQuery/);
  assert.match(event[1], /query_length\s*:/);
  assert.match(event[1], /results_count\s*:/);
});
