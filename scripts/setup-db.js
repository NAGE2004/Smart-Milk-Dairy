// Creates the database, tables, trigger, view and sample data from database/schema.sql.
// Usage: npm run setup-db
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const C = require('../src/config');

// Splits the SQL file into statements, understanding "DELIMITER //" blocks (used for the trigger).
function split(sql) {
  const out = []; let delim = ';', buf = '';
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^\s*DELIMITER\s+(\S+)/i);
    if (m) { delim = m[1]; continue; }
    buf += line + '\n';
    if (buf.trimEnd().endsWith(delim)) {
      const stmt = buf.trimEnd().slice(0, -delim.length).trim();
      if (stmt.replace(/^\s*--.*$/gm, '').trim()) out.push(stmt);
      buf = '';
    }
  }
  return out;
}

(async () => {
  const conn = await mysql.createConnection({ host: C.DB_HOST, user: C.DB_USER, password: C.DB_PASSWORD });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${C.DB_NAME}\``);
  await conn.query(`USE \`${C.DB_NAME}\``);
  const [t] = await conn.query('SHOW TABLES');
  if (t.length) { console.log(`Database '${C.DB_NAME}' already has tables. Nothing changed.`); return conn.end(); }
  const sql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8')
    .replace(/^\s*CREATE DATABASE.*$/mi, '').replace(/^\s*USE .*$/mi, '');
  for (const s of split(sql)) await conn.query(s);
  console.log(`Database '${C.DB_NAME}' is ready. Next: npm run create-admin -- admin admin123 admin`);
  await conn.end();
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
