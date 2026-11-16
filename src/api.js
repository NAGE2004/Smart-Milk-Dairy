const express = require('express');
const bcrypt = require('bcryptjs');
const C = require('./config');
const { query, one, exec, tx } = require('./db');
const { sendMessage, providerLabel } = require('./notify');
const { advice } = require('./tips');
const S = require('./services');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- access control ----------
const staff = (...roles) => (req, res, next) => {
  const s = req.session;
  if (!s.userId) return bad(res, 'Please log in.', 401);
  if (s.role === 'farmer') return bad(res, 'Staff only.', 403);
  if (roles.length && !roles.includes(s.role) && s.role !== 'admin')
    return bad(res, 'You do not have access to that page.', 403);
  next();
};
const farmerOnly = (req, res, next) => {
  if (!req.session.userId) return bad(res, 'Please log in.', 401);
  if (req.session.role !== 'farmer') return bad(res, 'Farmers only.', 403);
  next();
};

// ---------- auth ----------
r.post('/login', wrap(async (req, res) => {
  const { username = '', password = '', loginType = 'admin' } = req.body;
  const u = await one('SELECT * FROM users WHERE username=?', [String(username).trim()]);
  if (!u || !(await bcrypt.compare(String(password), u.password_hash)))
    return bad(res, 'Invalid username or password.', 401);
  const isFarmer = u.role === 'farmer';
  if (loginType === 'farmer' && !isFarmer) return bad(res, 'That is an admin/staff account. Please use the Admin tab.', 403);
  if (loginType !== 'farmer' && isFarmer) return bad(res, 'That is a farmer account. Please use the Farmer tab.', 403);
  if (isFarmer) {
    const f = await one('SELECT active FROM farmers WHERE farmer_id=?', [u.farmer_id]);
    if (!f || !f.active) return bad(res, 'This farmer account is inactive. Contact the dairy.', 403);
  }
  req.session.regenerate((err) => {
    if (err) return bad(res, 'Could not start session.', 500);
    Object.assign(req.session, { userId: u.user_id, username: u.username, role: u.role, farmerId: u.farmer_id });
    res.json({ role: u.role });
  });
}));

r.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

r.get('/me', (req, res) => {
  const s = req.session;
  if (!s.userId) return bad(res, 'Please log in.', 401);
  res.json({ username: s.username, role: s.role, farmerId: s.farmerId, dairy: C.DAIRY_NAME });
});

r.post('/password', wrap(async (req, res) => {
  if (!req.session.userId) return bad(res, 'Please log in.', 401);
  const { current = '', newPassword = '', confirm = '' } = req.body;
  const u = await one('SELECT * FROM users WHERE user_id=?', [req.session.userId]);
  if (!(await bcrypt.compare(String(current), u.password_hash))) return bad(res, 'Current password is wrong.');
  if (String(newPassword).length < 6 || newPassword !== confirm)
    return bad(res, 'New password must be 6+ characters and match the confirmation.');
  await exec('UPDATE users SET password_hash=? WHERE user_id=?', [await bcrypt.hash(newPassword, 10), u.user_id]);
  res.json({ ok: true });
}));

// ---------- farmer portal ----------
r.get('/my', farmerOnly, wrap(async (req, res) => {
  const fid = req.session.farmerId;
  const farmer = await one('SELECT * FROM farmers WHERE farmer_id=?', [fid]);
  const t = S.today();
  const start = req.query.start || t.slice(0, 8) + '01';
  const end = req.query.end || t;
  const rows = await query(`SELECT * FROM milk_collections WHERE farmer_id=? AND collection_date BETWEEN ? AND ?
                            ORDER BY collection_date DESC, shift`, [fid, start, end]);
  const pays = await query('SELECT * FROM payments WHERE farmer_id=? ORDER BY payment_id DESC', [fid]);
  res.json({
    farmer, rows, start, end, pays,
    totals: { litres: rows.reduce((a, x) => a + x.quantity_litres, 0), amount: rows.reduce((a, x) => a + x.amount, 0) },
    pending: pays.filter((p) => p.status === 'pending').reduce((a, p) => a + p.net_amount, 0),
    msgs: await query('SELECT * FROM notifications WHERE farmer_id=? ORDER BY notification_id DESC LIMIT 20', [fid]),
    txns: await query('SELECT * FROM transactions WHERE farmer_id=? ORDER BY txn_id DESC LIMIT 30', [fid]),
    recentDrop: await one(`SELECT detail FROM alerts WHERE farmer_id=? AND kind='yield_drop'
                           AND created_at >= NOW() - INTERVAL 3 DAY ORDER BY alert_id DESC LIMIT 1`, [fid]),
    tips: advice(farmer.cattle_type === 'buffalo' ? 'buffalo' : 'cow'),
  });
}));

// ---------- dashboard ----------
r.get('/dashboard', staff(), wrap(async (req, res) => {
  const t = S.today();
  const today = await one(`SELECT COALESCE(SUM(quantity_litres),0) litres, COALESCE(SUM(amount),0) amount, COUNT(*) entries
                           FROM milk_collections WHERE collection_date=?`, [t]);
  const trend = await query(`SELECT collection_date d, SUM(quantity_litres) l FROM milk_collections
                             WHERE collection_date >= ? GROUP BY collection_date ORDER BY d`, [S.addDays(t, -6)]);
  const byDay = Object.fromEntries(trend.map((x) => [x.d, x.l]));
  const labels = [], values = [];
  for (let i = 6; i >= 0; i--) { const d = S.addDays(t, -i); labels.push(d.slice(5)); values.push(byDay[d] || 0); }
  res.json({
    today, labels, values,
    farmers: (await one('SELECT COUNT(*) c FROM farmers WHERE active=1')).c,
    pending: (await one(`SELECT COALESCE(SUM(net_amount),0) s FROM payments WHERE status='pending'`)).s,
    openAlerts: (await one('SELECT COUNT(*) c FROM alerts WHERE resolved=0')).c,
  });
}));

// ---------- farmers ----------
r.get('/farmers', staff('collector'), wrap(async (req, res) => {
  res.json(await query(`SELECT f.*, u.username FROM farmers f LEFT JOIN users u ON u.farmer_id = f.farmer_id
                        ORDER BY f.farmer_id DESC`));
}));

r.post('/farmers', staff('collector'), wrap(async (req, res) => {
  const { name = '', phone = '', village = '', bank_account = '', cattle_type = 'cow' } = req.body;
  if (!String(name).trim()) return bad(res, 'Farmer name is required.');
  if (!['cow', 'buffalo', 'mixed'].includes(cattle_type)) return bad(res, 'Invalid cattle type.');
  await exec('INSERT INTO farmers (name, phone, village, bank_account, cattle_type) VALUES (?,?,?,?,?)',
             [name.trim(), phone.trim(), village.trim(), bank_account.trim(), cattle_type]);
  res.json({ ok: true });
}));

r.post('/farmers/:id/login', staff('admin'), wrap(async (req, res) => {
  const fid = Number(req.params.id);
  const username = String(req.body.username || '').trim();
  const pw = String(req.body.password || '');
  if (!username || pw.length < 6) return bad(res, 'Enter a username and a password of at least 6 characters.');
  const hash = await bcrypt.hash(pw, 10);
  const existing = await one('SELECT user_id FROM users WHERE farmer_id=?', [fid]);
  try {
    if (existing) {
      await exec('UPDATE users SET username=?, password_hash=? WHERE user_id=?', [username, hash, existing.user_id]);
      return res.json({ ok: true, message: 'Farmer login updated.' });
    }
    await exec(`INSERT INTO users (username, password_hash, role, farmer_id) VALUES (?,?, 'farmer', ?)`, [username, hash, fid]);
    res.json({ ok: true, message: 'Farmer login created.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return bad(res, 'That username is already taken.', 409);
    throw e;
  }
}));

r.post('/farmers/:id/toggle', staff('admin'), wrap(async (req, res) => {
  await exec('UPDATE farmers SET active = NOT active WHERE farmer_id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- milk collection ----------
r.get('/collect/meta', staff('collector', 'accountant'), wrap(async (req, res) => {
  res.json({
    today: S.today(),
    farmers: await query('SELECT farmer_id, name, village FROM farmers WHERE active=1 ORDER BY name'),
    centers: await query('SELECT * FROM collection_centers'),
    recent: await query(`SELECT m.*, f.name FROM milk_collections m JOIN farmers f USING (farmer_id)
                         WHERE collection_date=? ORDER BY collection_id DESC`, [S.today()]),
  });
}));

r.post('/collections', staff('collector', 'accountant'), wrap(async (req, res) => {
  const b = req.body;
  const qty = num(b.qty), fat = num(b.fat), snf = num(b.snf);
  if (![qty, fat, snf].every((v) => v > 0)) return bad(res, 'Litres, Fat and SNF must be numbers above 0.');
  if (!['morning', 'evening'].includes(b.shift) || !['cow', 'buffalo'].includes(b.milk_type) || !b.farmer_id || !b.date)
    return bad(res, 'Please fill in all fields.');
  let cid;
  try {
    cid = (await exec(`INSERT INTO milk_collections (farmer_id, center_id, collected_by, collection_date, shift,
                         milk_type, quantity_litres, fat, snf, rate_per_litre) VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [b.farmer_id, b.center_id || 1, req.session.userId, b.date, b.shift, b.milk_type, qty, fat, snf])).insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return bad(res, 'An entry already exists for this farmer, date and shift.', 409);
    throw e;
  }
  const row = await one('SELECT rate_per_litre rate, amount FROM milk_collections WHERE collection_id=?', [cid]);
  const raised = await S.checkAlerts(cid);           // quality / yield alerts run for every entry
  const alerts = raised.map(([, d]) => d);
  if (row.rate === 0)
    return res.json({ ok: true, alerts, warning: 'Saved, but no rate matched this Fat/SNF. Add it in Rate Chart.' });
  const st = await S.notifyCollection(cid);
  res.json({ ok: true, rate: row.rate, amount: row.amount, message: S.statusLabel(st), alerts });
}));

// ---------- rate chart ----------
r.get('/rates', staff('accountant'), wrap(async (req, res) => {
  res.json({ today: S.today(), rows: await query('SELECT * FROM rate_chart ORDER BY milk_type, fat_min, snf_min') });
}));

r.post('/rates', staff('accountant'), wrap(async (req, res) => {
  const b = req.body;
  const v = [b.fat_min, b.fat_max, b.snf_min, b.snf_max, b.rate].map(num);
  if (v.some(Number.isNaN) || !['cow', 'buffalo'].includes(b.milk_type) || !b.effective_from)
    return bad(res, 'Please fill in all fields with valid numbers.');
  await exec(`INSERT INTO rate_chart (milk_type, fat_min, fat_max, snf_min, snf_max, rate_per_litre, effective_from)
              VALUES (?,?,?,?,?,?,?)`, [b.milk_type, ...v, b.effective_from]);
  res.json({ ok: true });
}));

r.delete('/rates/:id', staff('accountant'), wrap(async (req, res) => {
  await exec('DELETE FROM rate_chart WHERE rate_id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- payments ----------
r.get('/payments', staff('accountant'), wrap(async (req, res) => {
  const [cs, ce] = S.lastCompletedCycle(S.today());
  res.json({
    today: S.today(), cycle: { start: cs, end: ce },
    rows: await query(`SELECT p.*, f.name, f.bank_account FROM payments p
                       JOIN farmers f ON f.farmer_id = p.farmer_id ORDER BY payment_id DESC`),
  });
}));

r.post('/payments/generate', staff('accountant'), wrap(async (req, res) => {
  let { start, end } = req.body;
  if (!start || !end) [start, end] = S.lastCompletedCycle(S.today());
  res.json({ made: await S.generateCycle(start, end), start, end });
}));

r.post('/payments/:id/deduct', staff('accountant'), wrap(async (req, res) => {
  const d = num(req.body.deductions);
  if (!(d >= 0)) return bad(res, 'Enter a valid deduction amount.');
  await exec(`UPDATE payments SET deductions=?, net_amount=gross_amount-? WHERE payment_id=? AND status='pending'`,
             [d, d, req.params.id]);
  res.json({ ok: true });
}));

r.post('/payments/:id/pay', staff('accountant'), wrap(async (req, res) => {
  const p = await one(`SELECT p.*, f.name FROM payments p JOIN farmers f ON f.farmer_id = p.farmer_id
                       WHERE p.payment_id=? AND p.status='pending'`, [req.params.id]);
  if (!p) return bad(res, 'That payment is already paid or does not exist.', 409);
  const mode = ['cash', 'bank', 'upi'].includes(req.body.mode) ? req.body.mode : 'cash';
  const ref = String(req.body.reference || '').trim() || null;
  const t = S.today();
  await tx(async (q) => {
    await q(`UPDATE payments SET status='paid', paid_on=? WHERE payment_id=?`, [t, p.payment_id]);
    await q(`INSERT INTO transactions (payment_id, farmer_id, txn_date, amount, mode, reference, recorded_by)
             VALUES (?,?,?,?,?,?,?)`, [p.payment_id, p.farmer_id, t, p.net_amount, mode, ref, req.session.userId]);
  });
  const st = await S.notify(p.farmer_id, 'payment',
    `${C.DAIRY_NAME} | Dear ${p.name}, payment of Rs ${p.net_amount.toFixed(2)} for ${p.period_start} to ` +
    `${p.period_end} paid on ${t} via ${mode.toUpperCase()}${ref ? ' (ref ' + ref + ')' : ''}. ` +
    `Gross Rs ${p.gross_amount.toFixed(2)}, deductions Rs ${p.deductions.toFixed(2)}, litres ${p.total_litres}.`);
  res.json({ ok: true, message: S.statusLabel(st) });
}));

r.get('/transactions', staff('accountant'), wrap(async (req, res) => {
  const start = req.query.start || S.today(), end = req.query.end || S.today();
  const rows = await query(`SELECT t.*, f.name FROM transactions t JOIN farmers f ON f.farmer_id = t.farmer_id
                            WHERE t.txn_date BETWEEN ? AND ? ORDER BY t.txn_id DESC`, [start, end]);
  res.json({
    start, end, rows, grand: rows.reduce((a, x) => a + x.amount, 0),
    byDay: await query(`SELECT txn_date, COUNT(*) n, SUM(amount) total FROM transactions
                        WHERE txn_date BETWEEN ? AND ? GROUP BY txn_date ORDER BY txn_date DESC`, [start, end]),
    byMode: await query(`SELECT mode, SUM(amount) total FROM transactions WHERE txn_date BETWEEN ? AND ? GROUP BY mode`, [start, end]),
  });
}));

// ---------- messages (real SMS / WhatsApp) ----------
r.get('/messages', staff(), wrap(async (req, res) => {
  res.json({
    provider: providerLabel(),
    rows: await query(`SELECT n.*, f.name, f.phone FROM notifications n JOIN farmers f ON f.farmer_id = n.farmer_id
                       ORDER BY n.notification_id DESC LIMIT 100`),
  });
}));

r.post('/messages/test', staff('admin'), wrap(async (req, res) => {
  const [st, err] = await sendMessage(req.body.phone, `${C.DAIRY_NAME} | Test message. Phone messaging is working.`);
  if (st !== 'sent') return bad(res, `Test message not sent: ${err}`);
  res.json({ ok: true, message: 'Test message sent. Check the phone.' });
}));

r.post('/messages/broadcast', staff('admin'), wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return bad(res, 'Type a message first.');
  const c = { sent: 0, failed: 0, not_sent: 0 };
  for (const f of await query('SELECT farmer_id FROM farmers WHERE active=1'))
    c[await S.notify(f.farmer_id, 'announcement', `${C.DAIRY_NAME} | ${text}`)]++;
  res.json({ ok: true, ...c });
}));

r.post('/messages/:id/resend', staff('admin'), wrap(async (req, res) => {
  const n = await one(`SELECT n.*, f.phone FROM notifications n JOIN farmers f ON f.farmer_id = n.farmer_id
                       WHERE n.notification_id=?`, [req.params.id]);
  if (!n) return bad(res, 'Message not found.', 404);
  const [st, err] = await sendMessage(n.phone, n.message);
  await exec('UPDATE notifications SET sms_status=?, sms_error=? WHERE notification_id=?', [st, err, n.notification_id]);
  if (st !== 'sent') return bad(res, `Could not send: ${err}`);
  res.json({ ok: true });
}));

// ---------- sales & inventory ----------
r.get('/sales', staff('accountant'), wrap(async (req, res) => {
  res.json({
    products: await query('SELECT * FROM products'),
    rows: await query(`SELECT s.*, p.name, p.unit FROM sales s JOIN products p USING (product_id)
                       ORDER BY sale_id DESC LIMIT 30`),
  });
}));

r.post('/sales', staff('accountant'), wrap(async (req, res) => {
  const qty = num(req.body.quantity);
  if (!(qty > 0)) return bad(res, 'Enter a quantity above 0.');
  const p = await one('SELECT * FROM products WHERE product_id=?', [req.body.product_id]);
  if (!p) return bad(res, 'Product not found.', 404);
  if (qty > p.stock_qty) return bad(res, `Only ${p.stock_qty} ${p.unit} of ${p.name} in stock.`);
  await tx(async (q) => {
    await q('INSERT INTO sales (product_id, customer_name, quantity, total_price) VALUES (?,?,?,?)',
            [p.product_id, req.body.customer || '', qty, qty * p.price]);
    await q('UPDATE products SET stock_qty=stock_qty-? WHERE product_id=?', [qty, p.product_id]);
  });
  res.json({ ok: true });
}));

r.post('/products/:id/stock', staff('accountant'), wrap(async (req, res) => {
  const qty = num(req.body.qty);
  if (!(qty > 0)) return bad(res, 'Enter a quantity above 0.');
  await exec('UPDATE products SET stock_qty=stock_qty+? WHERE product_id=?', [qty, req.params.id]);
  res.json({ ok: true });
}));

// ---------- smart alerts ----------
r.get('/alerts', staff(), wrap(async (req, res) => {
  res.json(await query(`SELECT a.*, f.name, m.collection_date, m.shift, m.quantity_litres, m.fat, m.snf
                        FROM alerts a JOIN farmers f ON f.farmer_id = a.farmer_id
                        JOIN milk_collections m ON m.collection_id = a.collection_id
                        WHERE (? OR a.resolved = 0) ORDER BY a.alert_id DESC LIMIT 200`,
                       [req.query.all === '1' ? 1 : 0]));
}));

r.post('/alerts/:id/resolve', staff(), wrap(async (req, res) => {
  await exec('UPDATE alerts SET resolved=1 WHERE alert_id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- reports ----------
r.get('/reports', staff(), wrap(async (req, res) => {
  const t = S.today();
  const start = req.query.start || S.addDays(t, -9), end = req.query.end || t;
  const fid = req.query.farmer_id || '';
  let stmt = [], totals = null;
  if (fid) {
    stmt = await query(`SELECT * FROM milk_collections WHERE farmer_id=? AND collection_date BETWEEN ? AND ?
                        ORDER BY collection_date, shift`, [fid, start, end]);
    totals = { litres: stmt.reduce((a, x) => a + x.quantity_litres, 0), amount: stmt.reduce((a, x) => a + x.amount, 0) };
  }
  res.json({
    start, end, fid, stmt, totals,
    farmers: await query('SELECT farmer_id, name FROM farmers ORDER BY name'),
    daily: await query('SELECT * FROM v_daily_summary ORDER BY collection_date DESC, shift LIMIT 20'),
  });
}));

module.exports = r;
