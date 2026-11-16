const mysql = require('mysql2/promise');
const C = require('./config');

const pool = mysql.createPool({
  host: C.DB_HOST, user: C.DB_USER, password: C.DB_PASSWORD, database: C.DB_NAME,
  dateStrings: true,      // DATE columns come back as 'YYYY-MM-DD' text
  decimalNumbers: true,   // DECIMAL columns come back as numbers
  waitForConnections: true, connectionLimit: 10,
});

const query = async (sql, args = []) => (await pool.query(sql, args))[0];
const one = async (sql, args = []) => (await query(sql, args))[0] || null;
const exec = async (sql, args = []) => (await pool.query(sql, args))[0]; // insertId, affectedRows

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(async (sql, args = []) => (await conn.query(sql, args))[0]);
    await conn.commit();
    return out;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

module.exports = { pool, query, one, exec, tx };
