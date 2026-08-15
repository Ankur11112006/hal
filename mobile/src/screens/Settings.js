// Six rows, flat. Blueprint 17.
// "मेरा डेटा मिटाएँ" is DPDP Act 2023 compliance and MUST report the real count
// of records deleted. One line, one screenshot, one scoring point.
import React, { useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, D } from '../theme';
import { t } from '../content';
import { Card, OutlineButton } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as ml from '../ml';
import { seedDemo } from '../seed';

export default function Settings({ navigation }) {
  const { farmer, setFarmer, isOnline, refresh } = useApp();
  const [msg, setMsg] = useState(null);

  const rows = [
    { label: t('settings.language'), onPress: () => {} },
    { label: t('settings.voiceSpeed'), onPress: () => {} },
    { label: t('settings.replaySlides'), onPress: () => {} },
    {
      label: t('settings.deleteData'), danger: true,
      onPress: () => Alert.alert(t('settings.deleteData'), t('settings.deleteConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.ok'), style: 'destructive',
          onPress: async () => {
            const n = await db.deleteEverything();
            setMsg(t('settings.deleted', { n }));
            setTimeout(() => setFarmer(null), 1500);
          },
        },
      ]),
    },
    { label: t('settings.help'), onPress: () => {} },
    { label: t('settings.about'), onPress: () => {} },
  ];

  if (farmer.is_demo) {
    rows.splice(3, 0, {
      label: t('settings.resetDemo'),
      onPress: async () => {
        await seedDemo();
        setMsg(t('common.done'));
        refresh();
        setTimeout(() => setMsg(null), 1500);
      },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad }}>
        <Pressable onPress={() => navigation.goBack()} style={{ padding: 8, minWidth: 44 }}>
          <Text style={{ fontSize: 24 }}>←</Text>
        </Pressable>
        <Text style={T.title}>{t('settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: D.pad }}>
        {msg && (
          <Card style={{ backgroundColor: C.greenSoft, borderColor: C.green }}>
            <Text style={[T.label, { color: C.green }]}>✓ {msg}</Text>
          </Card>
        )}

        {rows.map((r) => (
          <Pressable key={r.label} onPress={r.onPress}
            style={{
              minHeight: D.minTarget, justifyContent: 'center', paddingHorizontal: 4,
              borderBottomWidth: 1, borderColor: C.outline,
            }}>
            <Text style={[T.body, r.danger && { color: C.red }]}>{r.label}</Text>
          </Pressable>
        ))}

        <Card style={{ marginTop: 24 }}>
          <Text style={T.caption}>{t('app.name')} · {t('app.tagline')}</Text>
          <Text style={[T.caption, { marginTop: 6 }]}>
            नेटवर्क: {isOnline ? 'चालू' : 'बंद (ऐप फिर भी चलती है)'}
          </Text>
          <Text style={T.caption}>
            बीमारी पहचान: {ml.isReal() ? 'फ़ोन पर चल रही है' : 'डेमो मोड'}
          </Text>
          <Text style={[T.caption, { marginTop: 6 }]}>
            आपका डेटा आपके फ़ोन में है। हम किसान का डेटा किसी को नहीं बेचते।
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
