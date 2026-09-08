const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');

test('backend exige pago apto antes de obtener una etiqueta de Enviopack', () => {
  const start = admin.indexOf("if(req.method==='GET' && query.get('action')==='label')");
  const end = admin.indexOf("if(req.method==='GET')", start + 1);
  assert.ok(start >= 0 && end > start, 'No se encontró el endpoint de etiqueta.');
  const block = admin.slice(start, end);

  assert.match(block, /SELECT order_number,enviopack_shipment_id,shipping_label_ready,status,payment_status,payment_status_detail FROM orders/);
  assert.match(block, /order\.payment_status!=='approved'/);
  assert.match(block, /requiresPaymentReview\(order\)/);
  assert.match(block, /\['cancelled','refunded'\]\.includes\(String\(order\.status\|\|''\)\)/);
  assert.match(block, /SHIPMENT_LABEL_PAYMENT_REVIEW/);

  const guard = block.indexOf("order.payment_status!=='approved'");
  const provider = block.indexOf('getShipmentLabel(order.enviopack_shipment_id)');
  assert.ok(guard >= 0 && provider > guard, 'La validación financiera debe ocurrir antes de consultar la etiqueta al proveedor.');
});

test('el bloqueo de etiqueta cubre conflictos y reembolsos sin depender de la UI', () => {
  const start = admin.indexOf("if(req.method==='GET' && query.get('action')==='label')");
  const end = admin.indexOf("if(req.method==='GET')", start + 1);
  const block = admin.slice(start, end);
  assert.match(block, /requiresPaymentReview/);
  assert.match(block, /payment_status/);
  assert.match(block, /cancelled/);
  assert.match(block, /refunded/);
  assert.match(block, /return res\.status\(409\)/);
});
