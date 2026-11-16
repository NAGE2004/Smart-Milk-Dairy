const C = require('./config');

// Returns a list of [kind, detail] for one collection entry. No database access.
function evaluate(milkType, qty, fat, snf, avgQty, nHistory) {
  qty = Number(qty); fat = Number(fat); snf = Number(snf);
  const found = [];
  if (snf < C.MIN_SNF[milkType])
    found.push(['low_snf', `SNF ${snf} is below ${C.MIN_SNF[milkType]} for ${milkType} milk - possible water mixing`]);
  if (fat < C.MIN_FAT[milkType])
    found.push(['low_fat', `Fat ${fat} is below ${C.MIN_FAT[milkType]} for ${milkType} milk - check quality`]);
  if (avgQty !== null && avgQty !== undefined && nHistory >= 3) {
    const avg = Number(avgQty);
    if (avg > 0 && qty < avg * (1 - C.YIELD_DROP_PCT / 100)) {
      const pct = Math.round((avg - qty) / avg * 100);
      found.push(['yield_drop', `${qty} L is ${pct}% below the recent average of ${avg.toFixed(1)} L - cattle health or feed issue?`]);
    } else if (avg > 0 && qty > avg * (1 + C.YIELD_SPIKE_PCT / 100)) {
      const pct = Math.round((qty - avg) / avg * 100);
      found.push(['yield_spike', `${qty} L is ${pct}% above the recent average of ${avg.toFixed(1)} L - verify the weighing`]);
    }
  }
  return found;
}

module.exports = { evaluate };
