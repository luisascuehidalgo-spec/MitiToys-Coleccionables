from pathlib import Path

p = Path('api/envios.js')
s = p.read_text()
old = """    if (preference) {
  const recovered = await persistPreferenceIdentity(sql, { orderId: order.id, preferenceId: preference.id, paymentUrl: preference.init_point });
  if (!recovered.ok) {
    const marked = await sql`UPDATE orders SET payment_status_detail='preference_ownership_conflict',updated_at=NOW() WHERE id=${order.id} AND payment_status_detail IS DISTINCT FROM 'preference_ownership_conflict' RETURNING id`;
    if (marked.length) await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${order.id},'payment.preference_ownership_conflict','pending',${JSON.stringify({ preference_id: preference.id, conflict_order_id: recovered.conflictOrderId || null })}::jsonb)`;
    continue;
  }
  await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${order.id},'payment.preference_recovered','pending',${JSON.stringify({ preference_id: preference.id })}::jsonb)`;
  preferencesRecovered += 1;
  continue;
}
"""
new = """    if (preference) {
      const recovered = await persistPreferenceIdentity(sql, {
        orderId: order.id,
        preferenceId: preference.id,
        paymentUrl: preference.init_point,
        pendingUnlinkedOnly: true
      });
      if (!recovered.ok) {
        if (recovered.skipped) continue;
        const marked = await sql`
          UPDATE orders SET payment_status_detail='preference_ownership_conflict',updated_at=NOW()
          WHERE id=${order.id} AND payment_status_detail IS DISTINCT FROM 'preference_ownership_conflict'
          RETURNING id
        `;
        if (marked.length) {
          await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${order.id},'payment.preference_ownership_conflict','pending',${JSON.stringify({ preference_id: preference.id, conflict_order_id: recovered.conflictOrderId || null })}::jsonb)`;
        }
        continue;
      }
      await sql`INSERT INTO order_events(order_id,event_type,new_status,payload) VALUES(${order.id},'payment.preference_recovered','pending',${JSON.stringify({ preference_id: preference.id })}::jsonb)`;
      preferencesRecovered += 1;
      continue;
    }
"""
if old not in s:
    raise SystemExit('current preference reconciliation block not found')
p.write_text(s.replace(old, new, 1))
