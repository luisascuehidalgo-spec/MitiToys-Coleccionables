const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ROBOTS_VALUE = 'noindex, nofollow, noarchive';
const adminPages = ['admin.html', 'admin-envios.html'];

for (const file of adminPages) {
  test(`${file} declares robots noindex`, () => {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(
      html,
      /<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow,\s*noarchive["']\s*\/?\s*>/i
    );
  });
}

test('Vercel keeps X-Robots-Tag and no-store on both admin pages', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

  for (const source of ['/admin.html', '/admin-envios.html']) {
    const rule = config.headers.find((entry) => entry.source === source);
    assert.ok(rule, `missing Vercel header rule for ${source}`);

    const headers = Object.fromEntries(
      rule.headers.map(({ key, value }) => [key.toLowerCase(), value])
    );

    assert.equal(headers['x-robots-tag'], ROBOTS_VALUE);
    assert.match(headers['cache-control'] || '', /(?:^|,\s*)private(?:,|$)/i);
    assert.match(headers['cache-control'] || '', /(?:^|,\s*)no-store(?:,|$)/i);
  }
});

test('public home remains indexable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.doesNotMatch(html, /<meta\s+name=["']robots["'][^>]*\bnoindex\b/i);

  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const homeRule = config.headers.find((entry) => entry.source === '/');
  if (!homeRule) return;

  const robotsHeader = homeRule.headers.find(
    ({ key }) => key.toLowerCase() === 'x-robots-tag'
  );
  assert.ok(!robotsHeader || !/\bnoindex\b/i.test(robotsHeader.value));
});
