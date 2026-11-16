// Generates payments for the last completed 10-day cycle and messages every farmer.
// Safe to run every day: a farmer's cycle is only created once.
// Windows: schedule "node scripts/run-cycle.js" daily in Task Scheduler. Linux/macOS: use cron.
const S = require('../src/services');
const { pool } = require('../src/db');

(async () => {
  const [start, end] = S.lastCompletedCycle(S.today());
  const made = await S.generateCycle(start, end);
  console.log(`Cycle ${start} to ${end}: ${made} new payment record(s) created.`);
  await pool.end();
})();
