// Trigger-based alerts, not scheduled newsletters. SPEC.md D2.
//
//   bad  "Rain expected tomorrow"
//   good "कल बारिश है, आज छिड़काव करो वरना धुल जाएगा"
//
// Every alert answers what / when / how much / why, and only fires when a
// threshold is actually crossed. Scheduled messaging causes alert fatigue,
// which is why generic SMS advisory has low engagement.
export function rainNote(w) {
  if (!w?.available) return '';
  const p = w.rain_chance_tomorrow ?? 0;
  const mm = w.rain_mm_tomorrow ?? 0;
  if (p >= 60 || mm >= 5) return 'कल बारिश';
  if (p >= 30) return 'कल हल्की बारिश हो सकती है';
  return 'बारिश नहीं';
}

export function rainExpected(w) {
  return !!w?.available && ((w.rain_chance_tomorrow ?? 0) >= 60 || (w.rain_mm_tomorrow ?? 0) >= 5);
}

/**
 * Adjust a treatment's timing line for the actual forecast. This is the
 * difference between "spray Mancozeb" and "spray before 4pm today, because it
 * rains tomorrow and you would be spraying money onto the ground".
 */
export function timingFor(plan, weather) {
  if (!plan || plan.healthy) return null;
  if (rainExpected(weather)) {
    return 'कल बारिश है, इसलिए आज शाम 4 बजे से पहले छिड़काव कर लें, वरना दवा धुल जाएगी।';
  }
  return plan.when?.hi || null;
}

export function costBenefit(plan) {
  if (!plan || plan.healthy) return null;
  return `₹${plan.cost_inr} ख़र्च, लगभग ₹${plan.saves_inr} का नुक़सान बचेगा`;
}
