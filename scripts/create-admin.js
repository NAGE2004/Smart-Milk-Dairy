// Usage: node scripts/create-admin.js <username> <password> [role]
//   role: admin (default), collector or accountant
const bcrypt = require('bcryptjs');
const { exec, pool } = require('../src/db');

(async () => {
  const [username, password, role = 'admin'] = process.argv.slice(2);
  if (!username || !password || !['admin', 'collector', 'accountant'].includes(role)) {
    console.log('Usage: node scripts/create-admin.js <username> <password> [admin|collector|accountant]');
    process.exit(1);
  }
  try {
    await exec('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)',
               [username, await bcrypt.hash(password, 10), role]);
    console.log(`User '${username}' created with role '${role}'.`);
  } catch (e) {
    console.log(e.code === 'ER_DUP_ENTRY' ? `Username '${username}' already exists.` : 'Error: ' + e.message);
  }
  await pool.end();
})();
