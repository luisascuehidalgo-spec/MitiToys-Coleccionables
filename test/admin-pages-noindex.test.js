const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['admin.html', 'admin-envios.html']) {
  test(`${file} declares robots noindex`, () => {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(
      html,
      /<meta\s+name=["']robots["']\s+content=["']noindex,nofollow,noarchive["']\s*\/?\s*>/i
    );
  });
}
