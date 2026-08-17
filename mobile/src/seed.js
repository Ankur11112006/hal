// SPEC.md 10.1. Build this, the demo fails without it.
//
// The pitch depends on the advisory saying "पिछले साल भी इसी प्लॉट में झुलसा आई थी".
// A profile created live in front of a judge HAS NO LAST YEAR: the prompt gets
// an empty timeline and the entire differentiator evaporates.
//
// Two seeded facts carry the whole pitch:
//   1. Sep 2025 blight on Plot A  -> "पिछले साल भी" is literally true
//   2. Dec 2025 FMD on गौरी       -> 180-day interval makes it overdue today
//
// Everything is flagged is_demo = 1 so resetDemo() can wipe it between runs,
// and blueprint 4.5 requires the account to be labelled डेमो खाता on screen.
import { addFarmer, addPlot, addAnimal, logEvent, resetDemo, animals, generateSchedule } from './db';
import { toHectares } from './domain';

const F = 'demo-ramesh';

/**
 * `lang` is whatever the user just chose on the first screen. It used to be
 * hardcoded 'hi' here, so a judge who picked English and then tapped the demo
 * button got a Hindi app back on the next launch: App.js falls back to the
 * farmer row's language, and the farmer row said Hindi no matter what.
 */
export async function seedDemo(lang = 'hi') {
  await resetDemo();

  await addFarmer({
    id: F, phone: '9000000000', name: 'रमेश वर्मा', village: 'बाराबंकी',
    pincode: '225001', state: 'UP', lang, gender: 'male',
    does: 'dono', is_demo: 1,
  });

  const plotA = await addPlot({
    id: 'demo-plot-a', farmer_id: F, name: 'नदी वाला',
    area_local_value: 2.0, area_local_unit: 'bigha',
    area_ha: toHectares(2.0, 'bigha', 'UP'),
    lat: 26.9254, lng: 81.1861, current_crop: 'maize', soil_type: 'दोमट', is_demo: 1,
  });
  const plotB = await addPlot({
    id: 'demo-plot-b', farmer_id: F, name: 'घर वाला',
    area_local_value: 1.2, area_local_unit: 'bigha',
    area_ha: toHectares(1.2, 'bigha', 'UP'),
    lat: 26.9231, lng: 81.1904, current_crop: 'wheat', soil_type: 'बलुई दोमट', is_demo: 1,
  });

  // addAnimal fires the Day Zero generator, so each animal writes its own
  // vaccination and breeding calendar without any of it being hardcoded here.
  const gauri = await addAnimal({
    id: 'demo-gauri', farmer_id: F, name: 'गौरी', species: 'cow', breed: 'साहीवाल',
    dob: '2021-04-10', sex: 'female', last_calving: '2026-02-14', is_demo: 1,
  });
  await addAnimal({
    id: 'demo-kali', farmer_id: F, name: 'काली', species: 'cow', breed: 'संकर',
    dob: '2019-06-02', sex: 'female', is_demo: 1,
  });
  await addAnimal({
    id: 'demo-moti', farmer_id: F, name: 'मोती', species: 'buffalo', breed: 'मुर्रा',
    dob: '2020-09-20', sex: 'female', is_demo: 1,
  });

  const ev = (at, type, data, extra = {}) =>
    logEvent({ farmer_id: F, type, at, data, is_demo: 1, ...extra });

  // ---- last kharif on Plot A: THE payoff row --------------------------
  await ev('2025-06-20', 'sowing', { crop: 'maize', area_ha: 0.5058 }, { plot_id: plotA });
  await ev('2025-09-08', 'disease_detected', {
    label: 'maize__northern_leaf_blight', name: 'मक्का का झुलसा रोग',
    confidence: 0.89, severity: 2,
  }, { plot_id: plotA, confidence: 0.89 });
  await ev('2025-09-08', 'spray', { what: 'मैंकोज़ेब', dose: '2.5 ग्राम/लीटर', cost_inr: 380 },
    { plot_id: plotA });
  await ev('2025-10-24', 'harvest', { crop: 'maize', qtl: 6.8 }, { plot_id: plotA });

  // ---- rabi on Plot B -------------------------------------------------
  await ev('2025-11-18', 'sowing', { crop: 'wheat', area_ha: 0.3035 }, { plot_id: plotB });
  await ev('2025-12-30', 'irrigation', { note: 'पहली सिंचाई' }, { plot_id: plotB });
  await ev('2026-01-22', 'fertilizer', { what: 'यूरिया', qty_kg: 25, cost_inr: 340 },
    { plot_id: plotB });
  await ev('2026-04-06', 'harvest', { crop: 'wheat', qtl: 8.2 }, { plot_id: plotB });

  // ---- animals --------------------------------------------------------
  // Dec 2025 FMD + 180-day interval = overdue on demo day. This is the row the
  // cross-domain line fires from.
  await ev('2025-12-02', 'vaccination', { vaccine: 'FMD', label: { hi: 'खुरपका-मुँहपका' } },
    { animal_id: 'demo-gauri' });
  await ev('2025-12-02', 'vaccination', { vaccine: 'FMD', label: { hi: 'खुरपका-मुँहपका' } },
    { animal_id: 'demo-kali' });
  await ev('2026-01-15', 'deworming', { what: 'पेट के कीड़े की दवा' }, { animal_id: 'demo-kali' });
  await ev('2026-02-14', 'calving', { note: 'बछिया हुई' }, { animal_id: 'demo-gauri' });
  await ev('2026-05-20', 'vaccination', { vaccine: 'HS', label: { hi: 'गलघोंटू' } },
    { animal_id: 'demo-moti' });
  await ev('2026-07-02', 'symptom_flagged', {
    likely: 'गर्मी का असर', urgency: 'monitor', canonical_id: 'condition.cattle.heat_stress',
  }, { animal_id: 'demo-moti' });

  // ---- this season on Plot A -----------------------------------------
  await ev('2026-06-18', 'sowing', { crop: 'maize', area_ha: 0.5058 }, { plot_id: plotA });
  await ev('2026-07-04', 'irrigation', { note: 'पहली सिंचाई' }, { plot_id: plotA });
  await ev('2026-07-21', 'fertilizer', { what: 'यूरिया', qty_kg: 20, cost_inr: 280 },
    { plot_id: plotA });
  await ev('2026-08-02', 'irrigation', { note: 'दूसरी सिंचाई' }, { plot_id: plotA });
  await ev('2026-08-09', 'expense', { what: 'मज़दूरी', amount: 600 }, { plot_id: plotA });

  // addAnimal generated each calendar from the animal's DOB alone, because the
  // vaccination history did not exist yet. Regenerate now that it does, so the
  // FMD row reads "overdue since May" instead of "due at first dose in 2021".
  for (const a of await animals(F)) await generateSchedule(a);

  return { farmer_id: F, gauri: gauri.id };
}

export const DEMO_FARMER_ID = F;
