const C = require('./config');
const { query, one, exec } = require('./db');
const { sendMessage } = require('./notify');
const { evaluate } = require('./alerts');
const { smsText } = require('./tips');

const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toLocaleDateString('en-CA');           // YYYY-MM-DD (local)
function addDays(str, n) {
  const d = new Date(str + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dairy pay cycles: 1-10, 11-20, 21-end of month.
function cycleBounds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ym = `${y}-${pad(m)}`;
  if (d <= 10) return [`${ym}-01`, `${ym}-10`];
  if (d <= 20) return [`${ym}-11`, `${ym}-20`];
  return [`${ym}-21`, `${ym}-${pad(new Date(y, m, 0).getDate())}`];
}
const lastCompletedCycle = (t) => cycleBounds(addDays(cycleBounds(t)[0], -1));

const statusLabel = (s) => ({
  sent: "sent to farmer's phone",
  failed: 'phone delivery failed (saved in farmer portal)',
  not_sent: 'saved in farmer portal (phone messaging off or no number)',
}[s]);

// Saves the message for the farmer portal and sends it to the phone.
async function notify(farmerId, kind, message) {
  const f = await one('SELECT phone FROM farmers WHERE farmer_id=?', [farmerId]);
  const [status, err] = await sendMessage(f ? f.phone : null, message);
  await exec('INSERT INTO notifications (farmer_id, kind, message, sms_status, sms_error) VALUES (?,?,?,?,?)',
             [farmerId, kind, message, status, err]);
  return status;
}

async function notifyCollection(cid) {
  const r = await one(`SELECT m.*, f.name FROM milk_collections m
                       JOIN farmers f ON f.farmer_id = m.farmer_id WHERE m.collection_id=?`, [cid]);
  const day = await one(`SELECT SUM(quantity_litres) l, SUM(amount) a FROM milk_collections
                         WHERE farmer_id=? AND collection_date=?`, [r.farmer_id, r.collection_date]);
  const [cs] = cycleBounds(r.collection_date);
  const cyc = await one(`SELECT SUM(quantity_litres) l, SUM(amount) a FROM milk_collections
                         WHERE farmer_id=? AND collection_date BETWEEN ? AND ?`,
                        [r.farmer_id, cs, r.collection_date]);
  const msg = `${C.DAIRY_NAME} | Dear ${r.name}, ${r.collection_date} ${r.shift}: ` +
    `${r.quantity_litres.toFixed(2)} L ${r.milk_type} milk, Fat ${r.fat.toFixed(1)}, SNF ${r.snf.toFixed(1)}, ` +
    `Rate Rs ${r.rate_per_litre.toFixed(2)}/L, Amount Rs ${r.amount.toFixed(2)}. ` +
    `Day total: ${day.l.toFixed(2)} L, Rs ${day.a.toFixed(2)}. ` +
    `Cycle so far (${cs} onwards): ${cyc.l.toFixed(2)} L, Rs ${cyc.a.toFixed(2)}.`;
  return notify(r.farmer_id, 'collection', msg);
}

// Compare a saved entry with the farmer's last 7 same-shift entries; store any alerts.
async function checkAlerts(cid) {
  const r = await one('SELECT * FROM milk_collections WHERE collection_id=?', [cid]);
  const h = await one(`SELECT AVG(q) a, COUNT(*) n FROM (
                         SELECT quantity_litres q FROM milk_collections
                         WHERE farmer_id=? AND shift=? AND collection_date < ?
                         ORDER BY collection_date DESC LIMIT 7) t`,
                      [r.farmer_id, r.shift, r.collection_date]);
  const found = evaluate(r.milk_type, r.quantity_litres, r.fat, r.snf, h.a, h.n);
  for (const [kind, detail] of found)
    await exec('INSERT INTO alerts (collection_id, farmer_id, kind, detail) VALUES (?,?,?,?)',
               [cid, r.farmer_id, kind, detail]);
  if (found.some(([k]) => k === 'yield_drop')) {
    const f = await one('SELECT name FROM farmers WHERE farmer_id=?', [r.farmer_id]);
    const avg = Number(h.a), qty = Number(r.quantity_litres);
    const pct = Math.round((avg - qty) / avg * 100);
    await notify(r.farmer_id, 'advice', smsText(C.DAIRY_NAME, f.name, r.shift, qty, avg, pct, r.milk_type));
  }
  return found;
}

// Create payment records for [start, end] and send each farmer a statement.
async function generateCycle(start, end) {
  const sums = await query(`SELECT m.farmer_id, f.name, SUM(m.quantity_litres) l, SUM(m.amount) a,
                                   COUNT(DISTINCT m.collection_date) days,
                                   SUM(m.quantity_litres*m.fat)/SUM(m.quantity_litres) fat,
                                   SUM(m.quantity_litres*m.snf)/SUM(m.quantity_litres) snf
                            FROM milk_collections m JOIN farmers f ON f.farmer_id = m.farmer_id
                            WHERE m.collection_date BETWEEN ? AND ?
                            GROUP BY m.farmer_id, f.name`, [start, end]);
  let made = 0;
  for (const s of sums) {
    // skip if this farmer already has a payment that overlaps these dates (avoids paying the same milk twice)
    const dup = await one('SELECT 1 x FROM payments WHERE farmer_id=? AND period_start<=? AND period_end>=?',
                          [s.farmer_id, end, start]);
    if (dup) continue;
    await exec(`INSERT INTO payments (farmer_id, period_start, period_end, total_litres, gross_amount, net_amount)
                VALUES (?,?,?,?,?,?)`, [s.farmer_id, start, end, s.l, s.a, s.a]);
    await notify(s.farmer_id, 'statement',
      `${C.DAIRY_NAME} | Dear ${s.name}, milk statement ${start} to ${end}: ${s.days} days, ` +
      `${s.l.toFixed(2)} L, avg Fat ${Number(s.fat).toFixed(1)}, avg SNF ${Number(s.snf).toFixed(1)}, ` +
      `amount Rs ${s.a.toFixed(2)}. Deductions, if any, will be settled at payment.`);
    made++;
  }
  return made;
}

module.exports = { today, addDays, cycleBounds, lastCompletedCycle, statusLabel, notify,
                   notifyCollection, checkAlerts, generateCycle };
