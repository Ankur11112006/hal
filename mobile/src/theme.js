// HAL design tokens. Blueprint section 6.
// The confidence system IS the colour system: green means the app is sure,
// amber means it is checking, red means it will not guess.
export const C = {
  green: '#1B5E20',
  greenDark: '#0F3D14',
  greenSoft: '#DCEFD8',
  scanOrange: '#D84315',      // camera FAB only. One bright thing, one job.
  amber: '#B26A00',
  amberSoft: '#FFF3DC',
  red: '#B3261E',
  redSoft: '#FCEBEA',
  bg: '#FAF8F3',              // warm off-white, less glare than pure white
  surface: '#FFFFFF',
  outline: '#D6D3CB',
  ink: '#171512',
  inkSoft: '#4B4740',         // never lighter: fails 4.5:1 in sunlight
};

// Noto Sans Devanagari for everything including Latin. Mixing a Latin display
// face with a Devanagari body face is how Indian-language apps end up broken.
export const F = {
  regular: 'NotoSansDevanagari_400Regular',
  semibold: 'NotoSansDevanagari_600SemiBold',
  bold: 'NotoSansDevanagari_700Bold',
};

export const T = {
  display: { fontFamily: F.bold, fontSize: 32, lineHeight: 40, color: C.ink },
  title: { fontFamily: F.bold, fontSize: 24, lineHeight: 32, color: C.ink },
  cardTitle: { fontFamily: F.semibold, fontSize: 20, lineHeight: 28, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 18, lineHeight: 27, color: C.ink },
  bodySoft: { fontFamily: F.regular, fontSize: 18, lineHeight: 27, color: C.inkSoft },
  label: { fontFamily: F.semibold, fontSize: 17, lineHeight: 24, color: C.ink },
  caption: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.inkSoft },
};

export const D = {
  pad: 16, cardRadius: 16, btnRadius: 12,
  minTarget: 56, primaryBtnH: 64, fab: 72, tile: 96, border: 1,
};

// Three tiers, one place. Calibration changes must never touch a screen.
// SPEC.md A1: below 0.60 the app shows no diagnosis at all, not even a guess.
export const TIER = { AUTO: 'auto', VERIFY: 'verify', EXPERT: 'expert' };

export function routeConfidence(confidence) {
  if (confidence > 0.85) return TIER.AUTO;
  if (confidence >= 0.60) return TIER.VERIFY;
  return TIER.EXPERT;
}

// Blueprint law 4: colour never carries meaning alone. The WORD is the
// non-colour signal, which is why there is no icon here. A farmer who cannot
// read still gets the spoken version; a farmer who can read gets plain Hindi
// rather than a symbol they have to decode.
export const TIER_STYLE = {
  [TIER.AUTO]: { border: C.green, fill: C.greenSoft, wordKey: 'tier.word.auto' },
  [TIER.VERIFY]: { border: C.amber, fill: C.amberSoft, wordKey: 'tier.word.verify' },
  [TIER.EXPERT]: { border: C.red, fill: C.redSoft, wordKey: 'tier.word.expert' },
};

export const HELPLINE = { vet: '1962', kcc: '1800-180-1551' };
