from pathlib import Path

# Correct the internal error code introduced by the main patch.
admin_path = Path('api/admin.js')
admin = admin_path.read_text()
old_code = "ENVI0PACK_ORDER_MISSING"
new_code = "ENVIOPACK_ORDER_MISSING"
if old_code not in admin:
    raise SystemExit('Enviopack order missing code target not found')
admin_path.write_text(admin.replace(old_code, new_code, 1))

# Update the existing ownership regression to accept the broader terminal guard
# while continuing to require SHIPMENT_OWNERSHIP_CONFLICT to be blocked.
test_path = Path('test/external-identity-conflicts.test.js')
test = test_path.read_text()
old_assertion = "  assert.match(admin, /if \\(error\\?\\.code === 'SHIPMENT_OWNERSHIP_CONFLICT'\\) throw error/);"
new_assertion = "  assert.match(admin, /\\['SHIPMENT_OWNERSHIP_CONFLICT','SHIPMENT_PROVIDER_MULTIPLE_MATCHES'\\]\\.includes\\(error\\?\\.code\\)/);"
if old_assertion not in test:
    raise SystemExit('stale shipment ownership assertion target not found')
test_path.write_text(test.replace(old_assertion, new_assertion, 1))
