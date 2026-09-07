const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'database',
  'migrations',
  '20260907_product_shipping_guard.sql'
);

const migration = fs.readFileSync(migrationPath, 'utf8');

test('la migración conserva una barrera DB contra borrar logística válida', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.protect_product_shipping_data\(\)/);
  assert.match(migration, /NEW\.weight_kg IS NULL OR NEW\.weight_kg <= 0/);
  assert.match(migration, /NEW\.package_length_cm IS NULL OR NEW\.package_length_cm <= 0/);
  assert.match(migration, /NEW\.package_width_cm IS NULL OR NEW\.package_width_cm <= 0/);
  assert.match(migration, /NEW\.package_height_cm IS NULL OR NEW\.package_height_cm <= 0/);
  assert.match(migration, /CREATE TRIGGER trg_protect_product_shipping_data/);
});

test('la migración mantiene historial de cambios e intentos bloqueados', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.product_shipping_history/);
  assert.match(migration, /blocked_invalid_clear/);
  assert.match(migration, /CREATE TRIGGER trg_audit_product_shipping_data/);
  assert.match(migration, /event_type/);
});
