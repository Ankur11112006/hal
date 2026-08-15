// Six rows, flat. Blueprint 17.
// Every row does something. A row that opens nothing is worse than no row,
// because the farmer learns that tapping things here is pointless.
//
// "मेरा सारा रिकॉर्ड मिटाएँ" is DPDP Act 2023 compliance and MUST report the
// real count of records deleted.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, T, D } from '../theme';
import { t, getLang, setLang, READY, L } from '../content';
import { Card, OutlineButton, PrimaryButton, SpeakButton } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as ml from '../ml';
import * as voice from '../voice';
import { seedDemo } from '../seed';
import { SLIDES, LANG_NAME } from './Onboarding';

const RATE_KEY = 'bahi.voice_rate';
const LANG_KEY = 'bahi.lang';
const RATE_ORDER = ['slow', 'normal', 'fast'];
const RATE_LABEL = {
  slow: 'settings.voiceSlow', normal: 'settings.voiceNormal', fast: 'settings.voiceFast',
};

export default function Settings({ navigation }) {
  const { farmer, setFarmer, isOnline, refresh } = useApp();
  const [msg, setMsg] = useState(null);
  const [rate, setRate] = useState('normal');
  const [sheet, setSheet] = useState(null);   // 'help' | 'about' | 'slides' | null

  useEffect(() => {
    AsyncStorage.getItem(RATE_KEY).then((v) => {
      if (v) { setRate(v); voice.setRate(v); }
    });
  }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2200); };

  const cycleRate = async () => {
    const next = RATE_ORDER[(RATE_ORDER.indexOf(rate) + 1) % RATE_ORDER.length];
    setRate(next);
    voice.setRate(next);
    await AsyncStorage.setItem(RATE_KEY, next);
    // Say it at the new speed, so the setting demonstrates itself.
    voice.speak(t('settings.voiceDemo'), getLang());
  };

  const rows = [
    {
      label: t('settings.language'),
      value: LANG_NAME[getLang()],
      onPress: () => Alert.alert(
        t('settings.language'), t('settings.languageBody'),
        [...READY.map((code) => ({
          text: LANG_NAME[code],
          onPress: async () => {
            setLang(code);
            await AsyncStorage.setItem(LANG_KEY, code);
            // Language is read at render, so the whole tree has to remount.
            setFarmer({ ...farmer, lang: code });
          },
        })), { text: t('common.cancel'), style: 'cancel' }]),
    },
    { label: t('settings.voiceSpeed'), value: t(RATE_LABEL[rate]), onPress: cycleRate },
    { label: t('settings.replaySlides'), onPress: () => setSheet('slides') },
    {
      label: t('settings.deleteData'), danger: true,
      onPress: () => Alert.alert(t('settings.deleteData'), t('settings.deleteConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.ok'), style: 'destructive',
          onPress: async () => {
            const n = await db.deleteEverything();
            flash(t('settings.deleted', { n }));
            setTimeout(() => setFarmer(null), 1600);
          },
        },
      ]),
    },
    { label: t('settings.help'), onPress: () => setSheet('help') },
    { label: t('settings.about'), onPress: () => setSheet('about') },
  ];

  if (farmer.is_demo) {
    rows.splice(3, 0, {
      label: t('settings.resetDemo'),
      onPress: async () => {
        await seedDemo();
        flash(t('common.done'));
        refresh();
      },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad }}>
        <Pressable onPress={() => navigation.goBack()}
          style={{ padding: 8, minWidth: 44 }} accessibilityLabel={t('common.back')}>
          <Text style={{ fontSize: 26 }}>←</Text>
        </Pressable>
        <Text style={T.title}>{t('settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: D.pad, paddingBottom: 40 }}>
        {msg && (
          <Card style={{ backgroundColor: C.greenSoft, borderColor: C.green }}>
            <Text style={[T.label, { color: C.green }]}>{msg}</Text>
          </Card>
        )}

        {rows.map((r) => (
          <Pressable key={r.label} onPress={r.onPress} accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: D.minTarget, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.outline,
              backgroundColor: pressed ? C.greenSoft : 'transparent',
            })}>
            <Text style={[T.body, { flex: 1 }, r.danger && { color: C.red }]}>{r.label}</Text>
            {!!r.value && <Text style={[T.body, { color: C.inkSoft }]}>{r.value}</Text>}
            <Text style={{ fontSize: 20, color: C.inkSoft, marginLeft: 10 }}>›</Text>
          </Pressable>
        ))}

        <Card style={{ marginTop: 24 }}>
          <Text style={[T.label, { marginBottom: 6 }]}>{t('app.name')}</Text>
          <Text style={[T.caption, { marginBottom: 10 }]}>{t('app.tagline')}</Text>
          <Text style={[T.caption, { color: isOnline ? C.green : C.inkSoft }]}>
            {isOnline ? t('settings.internetOn') : t('settings.internetOff')}
          </Text>
          <Text style={[T.caption, { marginTop: 6, color: ml.isReal() ? C.green : C.amber }]}>
            {ml.isReal() ? t('settings.modelOn') : t('settings.modelOff')}
          </Text>
          {!ml.isReal() && !!ml.loadErrorMessage() && (
            // Surfaced on purpose. This silently read "demo mode" for a whole
            // build because the failure was swallowed by a catch.
            <Text style={[T.caption, { marginTop: 4, color: C.inkSoft }]}>
              {ml.loadErrorMessage()}
            </Text>
          )}
          <Text style={[T.caption, { marginTop: 10 }]}>{t('settings.privacy')}</Text>
        </Card>
      </ScrollView>

      <InfoSheet which={sheet} onClose={() => setSheet(null)} />
    </SafeAreaView>
  );
}

function InfoSheet({ which, onClose }) {
  const [slide, setSlide] = useState(0);
  if (!which) return null;

  let body = null;
  if (which === 'help') {
    body = (
      <>
        <Row text={t('help.body')} />
        <Row text={t('help.offline')} />
        <Text style={[T.label, { marginTop: 12 }]}>{t('help.callKcc')}</Text>
        <Text style={[T.label, { marginTop: 4 }]}>{t('help.callVet')}</Text>
      </>
    );
  } else if (which === 'about') {
    body = (
      <>
        <Row text={t('about.body')} />
        <Row text={t('about.model')} />
        <Row text={t('about.honest')} />
      </>
    );
  } else {
    const s = SLIDES[slide];
    body = (
      <>
        {!!s.stat && (
          <Text style={{ fontSize: 40, color: C.green, fontFamily: T.title.fontFamily }}>
            {s.stat}
          </Text>
        )}
        <Text style={[T.cardTitle, { marginVertical: 8 }]}>{L(s.head)}</Text>
        <Text style={T.bodySoft}>{L(s.body)}</Text>
        {!!s.src && <Text style={[T.caption, { marginTop: 10 }]}>{t('onboard.source', { s: s.src })}</Text>}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: i === slide ? C.green : C.outline }} />
          ))}
        </View>
        {slide < SLIDES.length - 1 && (
          <PrimaryButton label={t('common.next')} style={{ marginTop: 14 }}
            onPress={() => setSlide(slide + 1)} />
        )}
      </>
    );
  }

  const title = which === 'help' ? t('help.title')
    : which === 'about' ? t('settings.about') : t('settings.replaySlides');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <ScrollView style={{ maxHeight: '85%' }}
          contentContainerStyle={{
            backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: D.pad, paddingBottom: 32,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Text style={[T.title, { flex: 1 }]}>{title}</Text>
            <SpeakButton text={which === 'help' ? t('help.body') : t('about.body')} size={44} />
            <Pressable onPress={onClose} style={{ padding: 10 }}
              accessibilityLabel={t('common.ok')}>
              <Text style={{ fontSize: 22 }}>×</Text>
            </Pressable>
          </View>
          {body}
          <OutlineButton label={t('common.ok')} onPress={onClose} style={{ marginTop: 20 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const Row = ({ text }) => <Text style={[T.body, { marginBottom: 12 }]}>{text}</Text>;
