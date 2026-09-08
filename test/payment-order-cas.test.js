const test = require('node:test');
const assert = require('node:assert/strict');

const { samePaymentState, resolvePaymentCas } = require('../lib/payment-order-cas');

test('payment CAS considera idempotente un retry que ya dejó exactamente el estado esperado', async () => {
  const order = {
    id: 7,
    status: 'pending',
    payment_id: null,
    payment_status: 'pending',
    payment_status_detail: null
  };
  const expected = {
    status: 'approved',
    payment_id: 'mp-7',
    payment_status: 'approved',
    payment_status_detail: 'accredited'
  };
  const sql = async strings => {
    const text = strings.join('?');
    assert.match(text, /SELECT status,payment_id,payment_status,payment_status_detail/);
    return [expected];
  };

  const result = await resolvePaymentCas(sql, order, expected, []);
  assert.equal(result.changed, false);
  assert.equal(result.duplicate, true);
  assert.equal(samePaymentState(result.current, expected), true);
});

test('payment CAS rechaza aprobación obsoleta si una cancelación manual ganó la carrera', async () => {
  const order = {
    id: 8,
    status: 'pending',
    payment_id: null,
    payment_status: 'pending',
    payment_status_detail: null
  };
  const expected = {
    status: 'approved',
    payment_id: 'mp-8',
    payment_status: 'approved',
    payment_status_detail: 'accredited'
  };
  const sql = async () => [{
    status: 'cancelled',
    payment_id: null,
    payment_status: 'pending',
    payment_status_detail: null
  }];

  await assert.rejects(
    () => resolvePaymentCas(sql, order, expected, []),
    error => error?.code === 'PAYMENT_ORDER_RACE' && error?.status === 409
  );
});

test('payment CAS rechaza regresión logística si Enviopack avanzó mientras el webhook procesaba', async () => {
  const order = {
    id: 9,
    status: 'processing',
    payment_id: 'mp-9',
    payment_status: 'approved',
    payment_status_detail: 'accredited'
  };
  const expected = { ...order };
  const sql = async () => [{
    status: 'shipped',
    payment_id: 'mp-9',
    payment_status: 'approved',
    payment_status_detail: 'accredited'
  }];

  await assert.rejects(
    () => resolvePaymentCas(sql, order, expected, []),
    error => error?.code === 'PAYMENT_ORDER_RACE'
  );
});

test('payment CAS acepta inmediatamente una escritura que ganó la comparación atómica', async () => {
  let reads = 0;
  const sql = async () => { reads += 1; return []; };
  const result = await resolvePaymentCas(sql, { id: 10 }, {
    status: 'refunded',
    payment_id: 'mp-10',
    payment_status: 'refunded',
    payment_status_detail: 'refunded'
  }, [{ id: 10 }]);
  assert.equal(result.changed, true);
  assert.equal(result.duplicate, false);
  assert.equal(reads, 0);
});
