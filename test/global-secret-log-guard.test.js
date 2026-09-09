const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const backendRoots = ['api', 'lib'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

const backendFiles = backendRoots
  .flatMap(name => walk(path.join(root, name)))
  .filter(file => /\.(?:js|mjs|cjs)$/.test(file));

const sensitiveNames = /(?:ENVIOPACK_(?:API|SECRET)_KEY|MERCADOPAGO_ACCESS_TOKEN|RESEND_API_KEY|DATABASE_URL|CRON_SECRET|ADMIN_(?:PASSWORD|SECRET)|access[_-]?token|refresh[_-]?token|api[-_]?key|secret[-_]?key|authorization|bearer|cookie)/i;
const rawObjectNames = /\b(?:headers?|cookies?|request\.body|req\.body|response\.body|res\.body|providerResponse|providerData)\b/i;
const rawError = /console\.(?:log|error|warn)\s*\([^\n]*(?:,\s*(?:error|err)\s*[),]|\(\s*(?:error|err)\s*\)|(?:error|err)\.(?:message|stack|cause))/i;

test('ningún log del backend imprime secretos, headers, bodies o errores completos', () => {
  const violations = [];

  for (const file of backendFiles) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (!/console\.(?:log|error|warn)/.test(line)) return;
      if (sensitiveNames.test(line) || rawObjectNames.test(line) || rawError.test(line)) {
        violations.push(`${relative(file)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(violations, []);
});

test('logs de integraciones nunca imprimen URLs completas que puedan contener tokens', () => {
  const violations = [];
  const integrationHints = /(?:enviopack|mercado\s*pago|mercadopago|resend)/i;
  const urlLike = /(?:https?:\/\/|\.url\b|\burl\b|requestUrl|responseUrl)/i;

  for (const file of backendFiles) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (!/console\.(?:log|error|warn)/.test(line)) return;
      if (integrationHints.test(line) && urlLike.test(line)) violations.push(`${relative(file)}:${index + 1}`);
    });
  }

  assert.deepEqual(violations, []);
});

test('ningún archivo .env queda trackeable dentro del proyecto', () => {
  const envFiles = walk(root)
    .map(relative)
    .filter(name => /(^|\/)\.env(?:\.|$)/.test(name));
  assert.deepEqual(envFiles, []);

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env\*$/m);
});

test('las integraciones sensibles sólo toman credenciales base desde process.env', () => {
  const shipping = fs.readFileSync(path.join(root, 'lib/shipping.js'), 'utf8');
  const payments = fs.readFileSync(path.join(root, 'lib/payments.js'), 'utf8');
  const notifications = fs.readFileSync(path.join(root, 'lib/notifications.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'lib/db.js'), 'utf8');

  assert.match(shipping, /process\.env\.ENVIOPACK_API_KEY/);
  assert.match(shipping, /process\.env\.ENVIOPACK_SECRET_KEY/);
  assert.match(payments, /process\.env\.MERCADOPAGO_ACCESS_TOKEN/);
  assert.match(notifications, /process\.env\.RESEND_API_KEY/);
  assert.match(db, /process\.env\.DATABASE_URL/);

  const productionSources = [shipping, payments, notifications, db].join('\n');
  assert.doesNotMatch(productionSources, /(?:ENVIOPACK_(?:API|SECRET)_KEY|MERCADOPAGO_ACCESS_TOKEN|RESEND_API_KEY|DATABASE_URL)\s*=\s*['"][^'"]+['"]/);
});
