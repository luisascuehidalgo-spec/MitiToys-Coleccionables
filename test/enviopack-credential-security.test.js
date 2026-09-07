const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const providerFiles = ['lib/shipping.js', 'api/envios.js', 'api/admin.js'];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('ningún log de Enviopack puede imprimir credenciales, tokens o headers sensibles', () => {
  const forbidden = /process\.env|access[_-]?token|refresh[_-]?token|api[-_]?key|secret[-_]?key|authorization|bearer|cookie|headers|request\.body|response\.body|error\.message/i;
  const violations = [];

  for (const file of providerFiles) {
    read(file).split(/\r?\n/).forEach((line, index) => {
      if (/console\.(?:log|error|warn)/.test(line) && forbidden.test(line)) {
        violations.push(`${file}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(violations, []);
});

test('credenciales base de Enviopack se leen exclusivamente desde variables de entorno', () => {
  const shipping = read('lib/shipping.js');

  assert.match(shipping, /process\.env\.ENVIOPACK_API_KEY/);
  assert.match(shipping, /process\.env\.ENVIOPACK_SECRET_KEY/);
  assert.doesNotMatch(shipping, /['"]api-key['"]\s*:\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(shipping, /['"]secret-key['"]\s*:\s*['"][^'"]+['"]/i);
});

test('archivos .env permanecen excluidos del repositorio', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^\.env\*$/m);
  const trackedRootFiles = fs.readdirSync(root);
  assert.deepEqual(trackedRootFiles.filter(name => /^\.env(?:\.|$)/.test(name)), []);
});

test('regresión histórica cubre explícitamente refresh_token y api-key', () => {
  const securityTests = read('test/security-logs.test.js');
  const existingForbiddenMatch = securityTests.match(/const forbidden = \/(.+?)\/i;/);
  assert.ok(existingForbiddenMatch, 'No se encontró la barrera de logs sensible existente.');
  const pattern = existingForbiddenMatch[1];

  assert.match(pattern, /access_token/);
  // Este test obliga a mantener también las variantes exactas del incidente histórico.
  // Si cambia la expresión del test principal, refresh_token y api-key deben seguir cubiertos.
  assert.ok(/refresh_token|refresh\[_-\]\?token/.test(pattern), 'Falta cubrir refresh_token en el guard principal.');
  assert.ok(/api.*key/.test(pattern), 'Falta cubrir api-key en el guard principal.');
});
