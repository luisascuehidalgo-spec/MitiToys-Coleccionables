const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const heroUrl = 'https://user30281.na.imgto.link/public/20260906/chatgpt-image-4-sept-2026-05-57-01-p-m-3.avif';

test('home response preloads the same hero image used for the high-priority LCP candidate', () => {
  const rootRule = vercel.headers.find(rule => rule.source === '/');
  assert.ok(rootRule, 'root header rule should exist');
  const link = rootRule.headers.find(header => header.key.toLowerCase() === 'link');
  assert.ok(link, 'root should expose a Link preload header');
  assert.match(link.value, new RegExp(heroUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(link.value, /rel=preload/);
  assert.match(link.value, /as=image/);
  assert.match(index, new RegExp(`src="${heroUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*fetchpriority="high"`));
});
