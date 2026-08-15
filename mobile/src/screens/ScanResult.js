// The most important screen in the app. Blueprint 12.
//
// Tier 2 shows NO treatment plan. A dosage at 72% confidence is exactly the
// failure this product exists to prevent.
// Tier 3 shows NO disease name. Not even a guess.
//
// Demo instruction: tier 3, not tier 1, is the highest-scoring moment.
// "It refuses to guess. That refusal is why a farmer trusts it the second time."
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, D, TIER } from '../theme';
import { t, treatments } from '../content';
import {
  TierCard, Row, PrimaryButton, OutlineButton, CallButton, Card, OfflineChip,
} from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as api from '../api';
import { caseNumber } from '../domain';
import { timingFor, costBenefit } from '../alerts';

export default function ScanResult({ route, navigation }) {
  const { result, plotId } = route.params;
  const { farmer, isOnline, refresh } = useApp();
  const [saved, setSaved] = useState(false);
  const [caseNo] = useState(() => caseNumber());
  const [weather, setWeather] = useState(null);

  const plan = treatments[result.label];
  const name = plan?.name?.hi || result.label;
  const pct = Math.round(result.confidence * 100);

  useEffect(() => {
    (async () => {
      if (!isOnline || !plotId) return;
      const p = (await db.plots(farmer.id)).find((x) => x.id === plotId);
      if (p?.lat) { try { setWeather(await api.weather(p.lat, p.lng)); } catch {} }
    })();
  }, [isOnline, plotId, farmer.id]);

  // Every tier writes an event immediately, offline, before any network call.
  useEffect(() => {
    (async () => {
      await db.logEvent({
        farmer_id: farmer.id, plot_id: plotId, type: 'disease_detected',
        at: new Date().toISOString(), confidence: result.confidence,
        photo_uri: result.uri,
        data: {
          label: result.tier === TIER.EXPERT ? null : result.label,
          name: result.tier === TIER.EXPERT ? null : name,
          confidence: result.confidence, tier: result.tier,
          crop_conditioned: result.cropConditioned,
          case_no: result.tier === TIER.AUTO ? null : caseNo,
          stub: result.stub || undefined,
        },
      });
      if (result.tier !== TIER.AUTO && isOnline) {
        try {
          await api.escalate(farmer.id, null,
            result.tier === TIER.VERIFY ? 'vlae' : 'expert',
            `scan confidence ${result.confidence.toFixed(2)}`);
        } catch {}
      }
      refresh();
    })();
  }, []);

  const timing = timingFor(plan, weather);
  const speak = plan && !plan.healthy
    ? `${name}. ${plan.what.hi}. ${plan.dose.hi}. ${timing || plan.when.hi}. ${costBenefit(plan)}`
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, padding: D.pad }}>
        <OfflineChip visible={!isOnline} />

        {result.tier === TIER.AUTO && (
          <TierCard tier={TIER.AUTO} title={name} badge={`${pct}%`} speakText={speak}
            action={saved ? undefined : t('scan.addToLedger')}
            onAction={() => setSaved(true)}>
            {plan?.healthy ? (
              <Text style={T.body}>{t('tier.healthy')}</Text>
            ) : plan ? (
              <>
                <Row label={t('tier.whatToDo')} value={plan.what.hi} />
                <Row label={t('tier.howMuch')} value={plan.dose.hi} />
                <Row label={t('tier.when')} value={timing || plan.when.hi} />
                <Row label={t('tier.cost')} value={`₹${plan.cost_inr}`} />
                <Row label={t('tier.saves')} value={t('tier.savesValue', { n: plan.saves_inr })} />
                {!!plan.also?.hi && (
                  <Text style={[T.caption, { marginTop: 10 }]}>💡 {plan.also.hi}</Text>
                )}
              </>
            ) : null}
          </TierCard>
        )}

        {result.tier === TIER.VERIFY && (
          <TierCard tier={TIER.VERIFY} title={`शायद ${name}`} badge={`${pct}%`}
            speakText={`${t('tier.verifyBody')} ${t('tier.caseNo', { n: caseNo })}`}
            action={t('common.ok')} onAction={() => navigation.navigate('Main')}>
            <Text style={T.body}>{t('tier.verifyBody')}</Text>
            <Text style={[T.label, { marginTop: 10 }]}>{t('tier.caseNo', { n: caseNo })}</Text>
            {/* No treatment plan at this confidence. Deliberate. */}
          </TierCard>
        )}

        {result.tier === TIER.EXPERT && (
          <TierCard tier={TIER.EXPERT} title={t('tier.expertTitle')}
            speakText={`${t('tier.expertBody')} ${t('tier.callKcc')}`}>
            <Text style={T.body}>{t('tier.expertBody')}</Text>
            <Text style={[T.caption, { marginTop: 8 }]}>
              फ़ोटो पास से और अच्छी रोशनी में दोबारा लेने पर पहचान बेहतर हो सकती है।
            </Text>
            <View style={{ height: 14 }} />
            <CallButton which="kcc" label={`📞 ${t('tier.callKcc')}`} />
            <View style={{ height: 10 }} />
            <OutlineButton label={t('scan.retake')} onPress={() => navigation.replace('Camera')} />
          </TierCard>
        )}

        {result.cropConditioned && (
          <Card style={{ backgroundColor: C.greenSoft, borderColor: C.green }}>
            <Text style={T.caption}>
              🎯 {t('tier.cropKnown', { crop: t('label.crop.' + result.label.split('__')[0]) })}
            </Text>
          </Card>
        )}

        {result.stub && (
          <Card style={{ borderColor: C.amber }}>
            <Text style={[T.caption, { color: C.amber }]}>
              डेमो मोड: मॉडल अभी बंडल में नहीं है, यह नमूना नतीजा है।
            </Text>
          </Card>
        )}

        <View style={{ flex: 1 }} />
        {saved && <Text style={[T.caption, { textAlign: 'center', marginBottom: 8 }]}>
          ✓ {t('scan.added')}
        </Text>}
        <OutlineButton label={t('common.back')} onPress={() => navigation.navigate('Main')} />
      </View>
    </SafeAreaView>
  );
}
