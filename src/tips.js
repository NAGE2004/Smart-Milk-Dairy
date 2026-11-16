// Rule-based advice for farmers whose milk quantity has dropped.
function advice(milkType, dropPct = 0) {
  const ratio = milkType === 'buffalo' ? '1 kg for every 2 L of milk' : '1 kg for every 2.5 L of milk';
  const tips = [];
  if (dropPct >= 50)
    tips.push('Sudden big drop: have the animal checked by a vet first (fever, udder infection, foot or digestive problem).');
  tips.push(
    'Feed enough green fodder daily (maize, napier, lucerne) along with dry fodder.',
    `Give balanced concentrate feed as a thumb rule ${ratio}.`,
    'Give mineral mixture, about 50 g per animal per day.',
    'Keep clean, fresh water available all day - about 4 L of water for every 1 L of milk.',
    milkType === 'buffalo'
      ? 'In hot weather let buffaloes bathe or sprinkle water on them; heat stress cuts milk quickly.'
      : 'Keep the shed shaded, airy and dry; use fans or sprinkling in hot weather.',
    'Milk at fixed times, gently and completely; avoid noise and changing the milker.',
    'Check the udder for swelling, heat or clots (mastitis); keep the milking area clean and dip teats after milking.',
    'Follow the deworming and vaccination schedule your vet advises.');
  return tips;
}

function smsText(dairy, name, shift, qty, avg, pct, milkType) {
  const body = advice(milkType, pct).slice(0, 4).map((t, i) => `${i + 1}) ${t}`).join(' ');
  return `${dairy} | Dear ${name}, your ${shift} milk was ${qty} L, ${pct}% lower than your usual ` +
         `${avg.toFixed(1)} L. Tips to increase milk: ${body} More tips in your portal.`;
}

module.exports = { advice, smsText };
