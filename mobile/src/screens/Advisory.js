// The closing demo moment. Blueprint 16, SPEC.md D1.
//
// "Every agri app in India can do 9:30 AM. Not one of them can do 8:30 PM."
//
// What makes the answer impossible for a competitor is not the model, it is the
// prompt: the farmer's OWN timeline goes in, crops and animals together, from
// one table. Plantix cannot produce this sentence because it does not know the
// farmer owns cattle.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { C, T, D } from '../theme';
import { t } from '../content';
import { Card, PrimaryButton, OutlineButton, Row, SpeakButton, Loading, CallButton } from '../components/ui';
import { useApp } from '../../App';
import * as api from '../api';
import * as db from '../db';
import * as voice from '../voice';

const SUGGESTIONS = [
  'अब मुझे क्या करना चाहिए?',
  'मक्का में झुलसा लग गया है, क्या करूँ?',
  'गौरी का टीका कब लगेगा?',
];

export default function Advisory({ navigation }) {
  const { farmer, isOnline, refresh } = useApp();
  const [q, setQ] = useState('');
  const [state, setState] = useState('idle');   // idle | thinking | answer | queued
  const [ans, setAns] = useState(null);

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question) return;
    setQ(question);

    if (!isOnline) {
      // Styled as success, not error. Offline is a state, not a failure.
      await db.logEvent({ farmer_id: farmer.id, type: 'note',
        at: new Date().toISOString(), data: { queued_question: question } });
      setState('queued');
      return;
    }

    setState('thinking');
    try {
      const a = await api.advise(farmer.id, question);
      setAns(a);
      setState('answer');
      voice.speak([a.action, a.quantity, a.timing, a.cost_benefit].filter(Boolean).join('. '), 'hi');
    } catch {
      setState('queued');
    }
    refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
      <Pressable style={{ flex: 1 }} onPress={() => { voice.stop(); navigation.goBack(); }} />
      <View style={{
        backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: D.pad, paddingBottom: 32, maxHeight: '86%',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 26, marginRight: 10 }}>🎤</Text>
          <Text style={[T.title, { flex: 1 }]}>{t('home.askAnything')}</Text>
          <Pressable onPress={() => { voice.stop(); navigation.goBack(); }} style={{ padding: 10 }}>
            <Text style={{ fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          {state === 'idle' && (
            <>
              {/* A keyboard toggle exists for literate users and, practically,
                  for demoing in a noisy hall. */}
              <TextInput
                value={q} onChangeText={setQ} multiline placeholder="यहाँ लिखें या बोलें"
                placeholderTextColor={C.inkSoft}
                style={{
                  borderWidth: 1, borderColor: C.outline, borderRadius: D.btnRadius,
                  backgroundColor: C.surface, padding: 14, minHeight: 90,
                  fontSize: 18, fontFamily: T.body.fontFamily, color: C.ink, marginBottom: 12,
                }} />
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => ask(s)}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: C.outline }}>
                  <Text style={[T.body, { color: C.green }]}>“{s}”</Text>
                </Pressable>
              ))}
              <PrimaryButton label={t('common.next')} disabled={!q.trim()}
                onPress={() => ask()} style={{ marginTop: 16 }} />
            </>
          )}

          {state === 'thinking' && (
            <>
              <Text style={[T.caption, { marginBottom: 4 }]}>{t('advisory.youSaid')}</Text>
              <Text style={[T.body, { marginBottom: 20 }]}>{q}</Text>
              <Loading label={t('advisory.thinking')} />
            </>
          )}

          {state === 'queued' && (
            <Card style={{ backgroundColor: C.greenSoft, borderColor: C.green }}>
              <Text style={[T.body, { color: C.green }]}>✓ {t('advisory.queued')}</Text>
              <Text style={[T.caption, { marginTop: 8 }]}>{q}</Text>
            </Card>
          )}

          {state === 'answer' && ans && (
            <>
              <Text style={[T.caption, { marginBottom: 4 }]}>{t('advisory.youSaid')}</Text>
              <Text style={[T.bodySoft, { marginBottom: 12 }]}>{q}</Text>

              <Card style={{ borderColor: ans.escalate ? C.amber : C.green, borderWidth: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={[T.body, { flex: 1 }]}>{ans.action}</Text>
                  <SpeakButton text={[ans.action, ans.quantity, ans.timing, ans.cost_benefit]
                    .filter(Boolean).join('. ')} size={40} />
                </View>
                {!!ans.quantity && <Row label={t('tier.howMuch')} value={ans.quantity} />}
                {!!ans.timing && <Row label={t('tier.when')} value={ans.timing} />}
                {!!ans.cost_benefit && <Row label={t('tier.cost')} value={ans.cost_benefit} />}
                {/* Source citation builds trust. Farmers trust institutions far
                    more than anonymous AI. */}
                <Text style={[T.caption, { marginTop: 10 }]}>
                  {t('advisory.source', { s: ans.source })}
                  {ans.fallback ? ' · स्रोत से सीधा उद्धरण' : ''}
                </Text>
              </Card>

              {ans.escalate && <CallButton which="kcc" label={`📞 ${t('tier.callKcc')}`} />}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12, alignItems: 'center' }}>
                <Text style={T.caption}>{t('advisory.helpful')}</Text>
                <Pressable style={{ padding: 10 }}><Text style={{ fontSize: 22 }}>👍</Text></Pressable>
                <Pressable style={{ padding: 10 }}><Text style={{ fontSize: 22 }}>👎</Text></Pressable>
              </View>

              <OutlineButton label={t('common.ok')} style={{ marginTop: 12 }}
                onPress={() => { voice.stop(); navigation.goBack(); }} />
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
