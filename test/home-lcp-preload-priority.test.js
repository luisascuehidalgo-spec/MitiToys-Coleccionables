const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function headerValue(source, name) {
  const rule = config.headers.find(entry => entry.source === source);
  return rule?.headers?.find(header => header.key.toLowerCase() === name.toLowerCase())?.value || '';
}

test('homepage LCP image preload and hero use high fetch priority', () => {
  const link = headerValue('/', 'Link');
  const match = link.match(/^<([^>]+)>; rel=preload; as=image; fetchpriority=high$/);
  assert.ok(match, 'home image preload must explicitly use high fetch priority');
  assert.match(home, new RegExp(`<img src="${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+fetchpriority="high"`));
});
