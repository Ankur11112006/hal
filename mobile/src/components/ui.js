// Blueprint 7. Build these first, everything after is assembly.
//
// Seven UI laws enforced here by construction:
//   1 no control without a text label   -> every Pressable has one
//   2 one primary action per screen     -> PrimaryButton
//   3 every advisory block can be heard -> SpeakButton
//   4 colour never carries meaning alone -> TierCard prints the tier WORD
//   5 no empty state without an action  -> EmptyState
//   7 offline is a state, not an error  -> OfflineChip is green
import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Linking, StyleSheet,
} from 'react-native';
import { C, T, D, TIER_STYLE, HELPLINE } from '../theme';
import { t, L } from '../content';
import * as voice from '../voice';

export function Screen({ title, children, right, scroll = true }) {
  const Body = scroll ? ScrollView : View;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {title !== undefined && (
        <View style={s.header}>
          <Text style={T.title} numberOfLines={1}>{title}</Text>
          {right}
        </View>
      )}
      <Body style={{ flex: 1 }} contentContainerStyle={scroll ? { padding: D.pad, paddingBottom: 120 } : undefined}>
        {children}
      </Body>
    </View>
  );
}

export function Card({ children, style, onPress }) {
  const Wrap = onPress ? Pressable : View;
  return <Wrap onPress={onPress} style={[s.card, style]}>{children}</Wrap>;
}

export function PrimaryButton({ label, onPress, disabled, tone = 'green', style }) {
  const bg = { green: C.green, red: C.red, amber: C.amber }[tone] || C.green;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.primary,
        { backgroundColor: bg, opacity: disabled ? 0.38 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={[T.label, { color: '#fff', textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}

export function OutlineButton({ label, onPress, style }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.primary, s.outlineBtn, { opacity: pressed ? 0.7 : 1 }, style]}>
      <Text style={[T.label, { color: C.green, textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}

export function SpeakButton({ text, lang = 'hi', size = 48 }) {
  const [on, setOn] = useState(false);
  if (!text) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.listen')}
      onPress={() => {
        if (on) { voice.stop(); setOn(false); return; }
        setOn(true);
        voice.speak(text, lang, () => setOn(false));
      }}
      style={[s.speak, { width: size, height: size, borderRadius: size / 2 },
              on && { backgroundColor: C.greenSoft }]}
    >
      <Text style={{ fontSize: size * 0.42, color: C.green }}>{on ? '॥' : '▶'}</Text>
    </Pressable>
  );
}

export function OfflineChip({ visible }) {
  if (!visible) return null;
  // Law 7: styled green. Offline is normal in a field, not a failure.
  return (
    <View style={s.chip}>
      <Text style={[T.caption, { color: C.green }]}>{t('common.offline')}</Text>
    </View>
  );
}

export function DemoChip() {
  return (
    <View style={[s.chip, { backgroundColor: C.amberSoft, borderColor: C.amber }]}>
      <Text style={[T.caption, { color: C.amber }]}>{t('common.demoAccount')}</Text>
    </View>
  );
}

// Law 5: an empty state always carries its own action.
export function EmptyState({ text, action, onAction }) {
  return (
    <Card>
      <Text style={[T.bodySoft, { marginBottom: 12 }]}>{text}</Text>
      {action ? <PrimaryButton label={action} onPress={onAction} /> : null}
    </Card>
  );
}

export function BigYesNo({ onYes, onNo }) {
  return (
    <View style={{ gap: 12 }}>
      <PrimaryButton label={t('common.yes')} onPress={onYes} style={{ height: D.tile }} />
      <OutlineButton label={t('common.no')} onPress={onNo} style={{ height: D.tile }} />
    </View>
  );
}

export function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={[T.caption, { width: 84 }]}>{label}</Text>
      <Text style={[T.body, { flex: 1 }]}>{value}</Text>
    </View>
  );
}

/**
 * The most important component in the app. Three variants, one enum.
 * Colour is never the only signal: each tier also prints its word in Hindi.
 */
export function TierCard({ tier, title, badge, children, action, onAction, speakText }) {
  const st = TIER_STYLE[tier];
  return (
    <View style={[s.card, { borderColor: st.border, borderWidth: 2, backgroundColor: st.fill }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Text style={[T.cardTitle, { flex: 1 }]}>{title}</Text>
        {badge ? (
          <View style={[s.badge, { backgroundColor: st.border }]}>
            <Text style={[T.caption, { color: '#fff' }]}>{badge}</Text>
          </View>
        ) : null}
        <SpeakButton text={speakText} size={40} />
      </View>
      <Text style={[T.caption, { color: st.border, marginTop: 2, marginBottom: 10 }]}>{t(st.wordKey)}</Text>
      {children}
      {action ? <PrimaryButton label={action} onPress={onAction} style={{ marginTop: 14 }} /> : null}
    </View>
  );
}

// Every escalation ends at a real, dialable number (blueprint 9).
export function CallButton({ which = 'kcc', label }) {
  const number = HELPLINE[which];
  return (
    <PrimaryButton
      tone="red"
      label={label || number}
      onPress={() => Linking.openURL(`tel:${number.replace(/-/g, '')}`)}
    />
  );
}

export function TimelineRow({ e, onPress }) {
  const isCrop = !!e.plot_id;
  const who = e.plot_name || e.animal_name || '';
  const crop = e.current_crop ? ` (${t('label.crop.' + e.current_crop)})` : '';
  return (
    <Pressable onPress={onPress}
      style={[s.tlRow, isCrop && { backgroundColor: C.greenSoft }]}>
      <Text style={[T.caption, { width: 58 }]}>{fmtDate(e.at)}</Text>
      <View style={{ width: 8, height: 34, borderRadius: 4, marginRight: 6,
                     backgroundColor: isCrop ? C.green : C.amber }} />
      <View style={{ flex: 1 }}>
        <Text style={[T.label]} numberOfLines={1}>{who}{crop}</Text>
        <Text style={[T.caption]} numberOfLines={1}>{describe(e)}</Text>
      </View>
    </Pressable>
  );
}

export function Loading({ label }) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={C.green} size="large" />
      <Text style={[T.bodySoft, { marginTop: 12 }]}>{label || t('common.loading')}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- helpers


export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${t('month.short')[d.getMonth()]}`;
}

export function describe(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'disease_detected':
      return `${d.name || d.label || ''} ${d.confidence ? Math.round(d.confidence * 100) + '%' : ''}`.trim();
    case 'symptom_flagged':
      return d.likely || t('event.symptom_flagged');
    case 'vaccine_due':
      return `${L(d.label) || d.vaccine} ${t('event.vaccine_due')}`;
    case 'vaccination':
      return `${L(d.label) || d.vaccine} ${t('event.vaccination')}`;
    case 'sowing':
      return `${t('event.sowing')}${d.crop ? ' · ' + t('label.crop.' + d.crop) : ''}`;
    case 'harvest':
      return `${t('event.harvest')}${d.qtl ? ' · ' + d.qtl + ' ' + t('unit.quintal') : ''}`;
    case 'spray':
      return `${t('event.spray')}${d.what ? ' · ' + d.what : ''}${d.cost_inr ? ' · ₹' + d.cost_inr : ''}`;
    case 'expense':
      return `${t('event.expense')} ₹${d.amount || 0}`;
    default:
      return t('event.' + e.type);
  }
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: D.pad, paddingTop: 8, paddingBottom: 12,
  },
  card: {
    backgroundColor: C.surface, borderRadius: D.cardRadius, borderWidth: D.border,
    borderColor: C.outline, padding: D.pad, marginBottom: 12,
  },
  primary: {
    height: D.primaryBtnH, borderRadius: D.btnRadius,
    alignItems: 'center', justifyContent: 'center', width: '100%',
  },
  outlineBtn: { backgroundColor: C.surface, borderWidth: 2, borderColor: C.green },
  tile: {
    minWidth: D.minTarget, minHeight: D.minTarget,
    alignItems: 'center', justifyContent: 'center', padding: 8,
  },
  speak: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.outline, backgroundColor: C.surface,
  },
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1, borderColor: C.green,
    backgroundColor: C.greenSoft, marginBottom: 8,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  tlRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
    borderColor: C.outline, padding: 12, marginBottom: 8,
  },
});
