// The main entry point for livestock. SPEC.md B3.
//
// A rule-based decision tree, no ML. One image model covers one disease; this
// covers 20+ conditions, works without a camera, works offline, is fully
// explainable, and can be validated by an actual vet.
//
// "Asking is the interaction, and the answer is automatically the record."
// This is why milk logging could be cut without losing the clinical value:
// the farmer never fills in a form, and history still accumulates.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, D, TIER } from '../theme';
import { t, symptomTree as tree, L } from '../content';
import { BigYesNo, TierCard, CallButton, OutlineButton, SpeakButton, Card } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as voice from '../voice';
import { symptomStep, symptomAnswer } from '../domain';

const URGENCY_TIER = {
  urgent: TIER.EXPERT,      // red skin: this needs a human now
  soon: TIER.VERIFY,
  monitor: TIER.AUTO,
};

export default function SymptomChecker({ route, navigation }) {
  const { animal } = route.params;
  const { farmer, refresh } = useApp();
  const [id, setId] = useState(tree.root);
  const [path, setPath] = useState([]);
  const [saved, setSaved] = useState(false);

  const step = symptomStep(tree, id);

  // Questions are read aloud automatically. A farmer who cannot read must be
  // able to run this whole wizard by ear.
  useEffect(() => {
    if (!step.done) voice.speak(L(step.node.q), 'hi');
    return () => voice.stop();
  }, [id]);

  useEffect(() => {
    if (!step.done || saved) return;
    (async () => {
      const r = step.result;
      await db.logEvent({
        farmer_id: farmer.id, animal_id: animal.id, type: 'symptom_flagged',
        at: new Date().toISOString(),
        data: {
          likely: L(r.likely), action: L(r.action), urgency: r.urgency,
          needs_vet: !!r.needs_vet, canonical_id: r.canonical_id,
          notifiable: !!r.notifiable, answers: path.length,
        },
      });
      setSaved(true);
      refresh();
    })();
  }, [step.done]);

  const answer = (yes) => {
    setPath([...path, { id, yes }]);
    setId(symptomAnswer(tree, id, yes));
  };

  const back = () => {
    if (!path.length) return navigation.goBack();
    const prev = path[path.length - 1];
    setPath(path.slice(0, -1));
    setId(prev.id);
  };

  // ---------------------------------------------------------------- result
  if (step.done) {
    const r = step.result;
    const tier = URGENCY_TIER[r.urgency];
    const speak = `${L(r.likely)}. ${L(r.action)}`;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flex: 1, padding: D.pad }}>
          <Text style={[T.caption, { marginBottom: 8 }]}>{animal.name}</Text>
          <TierCard tier={tier} title={L(r.likely)} speakText={speak}>
            <Text style={[T.caption, { marginBottom: 4 }]}>{t('symptom.action')}</Text>
            <Text style={T.body}>{L(r.action)}</Text>
            {r.notifiable && (
              <Text style={[T.caption, { marginTop: 10, color: C.red }]}>
                {t('symptom.notifiable')}
              </Text>
            )}
          </TierCard>

          {/* Any urgent branch surfaces 1962 as the single primary action. */}
          {r.needs_vet && <CallButton which="vet" label={t('symptom.callVet')} />}

          {r.photo_assist && (
            <Card style={{ marginTop: 12 }}>
              <Text style={[T.caption]}>
                {t('symptom.photoAssist')}
              </Text>
            </Card>
          )}

          <View style={{ flex: 1 }} />
          {saved && (
            <Text style={[T.caption, { textAlign: 'center', marginBottom: 10 }]}>
              {t('symptom.saved')}
            </Text>
          )}
          <OutlineButton label={t('common.back')} onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------- question
  const total = path.length + 3;   // honest-ish progress on a branching tree
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, padding: D.pad }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={back} style={{ padding: 10, minWidth: 44 }}>
            <Text style={{ fontSize: 24 }}>←</Text>
          </Pressable>
          <Text style={[T.caption, { flex: 1 }]}>
            {animal.name} · {t('symptom.step', { n: path.length + 1, total })}
          </Text>
        </View>

        <View style={{ height: 6, backgroundColor: C.outline, borderRadius: 3, marginVertical: 12 }}>
          <View style={{
            height: 6, borderRadius: 3, backgroundColor: C.green,
            width: `${Math.min(90, ((path.length + 1) / total) * 100)}%`,
          }} />
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={[T.display, { flex: 1 }]}>{L(step.node.q)}</Text>
            <SpeakButton text={L(step.node.q)} />
          </View>
        </View>

        <BigYesNo onYes={() => answer(true)} onNo={() => answer(false)} />
      </View>
    </SafeAreaView>
  );
}
