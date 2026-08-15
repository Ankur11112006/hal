// Answers exactly one question: मुझे आज क्या करना है?
// Not a dashboard. No charts. Blueprint 10.
//
// If nothing crossed a threshold, NO card appears. An empty urgent section is
// a feature: it is what prevents the alert fatigue that kills generic SMS
// advisory (SPEC.md D2).
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, D } from '../theme';
import { t, L, getLang } from '../content';
import { LANG_NAME } from './Onboarding';
import {
  Card, PrimaryButton, TimelineRow, OfflineChip, DemoChip, SpeakButton, EmptyState,
} from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as api from '../api';
import { rainNote } from '../alerts';

export default function Home({ navigation }) {
  const { farmer, isOnline, tick } = useApp();
  const [due, setDue] = useState([]);
  const [recent, setRecent] = useState([]);
  const [weather, setWeather] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const [d, r, plots] = await Promise.all([
        db.dueVaccines(farmer.id), db.timeline(farmer.id, 4), db.plots(farmer.id),
      ]);
      if (!alive) return;
      setDue(d.filter((x) => x.daysLeft <= 14));
      setRecent(r);
      setLoaded(true);
      const p = plots.find((x) => x.lat);
      if (p && isOnline) {
        try { setWeather(await api.weather(p.lat, p.lng)); } catch {}
      }
    })();
    return () => { alive = false; };
  }, [farmer.id, isOnline, tick]));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad, paddingBottom: 8 }}>
        <Text style={[T.caption, { flex: 1 }]}>{LANG_NAME[getLang()]}</Text>
        <Text style={T.title}>{t('app.name')}</Text>
        <Pressable onPress={() => navigation.navigate('Settings')}
          style={{ flex: 1, alignItems: 'flex-end', minHeight: 44, justifyContent: 'center' }}>
          <Text style={[T.caption, { color: C.green }]}>{t('settings.title')}</Text>
        </Pressable>
      </View>

      {/* Scrollable, and padded past the mic pill and the tab bar. With three
          urgent cards the recent-ledger section sat underneath both and there
          was no way to reach it. */}
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: D.pad, paddingBottom: 96 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <OfflineChip visible={!isOnline} />
          {farmer.is_demo ? <DemoChip /> : null}
        </View>

        {weather?.available && (
          <Card style={{ paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[T.body, { flex: 1 }]}>
                {Math.round(weather.now_c)}° · {rainNote(weather)}
              </Text>
              <SpeakButton text={t('weather.spoken', { t: Math.round(weather.now_c), note: rainNote(weather) })} size={40} />
            </View>
          </Card>
        )}

        <Text style={[T.label, { marginTop: 8, marginBottom: 8 }]}>{t('home.todayImportant')}</Text>
        {!loaded ? (
          <Card><Text style={T.bodySoft}>{t('common.loading')}</Text></Card>
        ) : due.length === 0 ? (
          <Card><Text style={T.bodySoft}>{t('home.nothingUrgent')}</Text></Card>
        ) : (
          due.slice(0, 3).map((v) => {
            const overdue = v.overdue && !v.noRecord;
            const line = v.noRecord
              ? t('vaccine.noRecord')
              : overdue
                ? t('vaccine.overdue', { days: Math.abs(v.daysLeft) })
                : v.daysLeft === 0 ? t('vaccine.dueToday') : t('vaccine.due', { days: v.daysLeft });
            const title = `${v.animal_name} · ${L(v.data.label) || v.data.vaccine}`;
            return (
              <Card key={v.id} style={{ borderColor: overdue ? C.red : C.amber, borderWidth: 2,
                                        backgroundColor: overdue ? C.redSoft : C.amberSoft }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[T.cardTitle, { flex: 1 }]}>{title}</Text>
                  <SpeakButton text={`${title}, ${line}. ${L(v.data.funding)}`} size={40} />
                </View>
                <Text style={[T.body, { color: overdue ? C.red : C.amber, marginTop: 2 }]}>{line}</Text>
                {!!L(v.data.funding) && (
                  <Text style={[T.caption, { marginTop: 6 }]}>{t('vaccine.free')}</Text>
                )}
                <PrimaryButton
                  label={t('vaccine.markDone')} tone={overdue ? 'red' : 'amber'}
                  style={{ marginTop: 12 }}
                  onPress={() => navigation.navigate('AnimalDetail', { id: v.animal_id })} />
              </Card>
            );
          })
        )}

        <Text style={[T.label, { marginTop: 16, marginBottom: 8 }]}>{t('home.recent')}</Text>
        {!loaded ? null : recent.length === 0 ? (
          <EmptyState text={t('records.emptyPast')} action={t('records.addOld')}
            onAction={() => navigation.navigate('Crop')} />
        ) : (
          <>
            {recent.map((e) => <TimelineRow key={e.id} e={e} />)}
            <Pressable onPress={() => navigation.navigate('Records')} style={{ padding: 8 }}>
              <Text style={[T.label, { color: C.green }]}>{t('common.seeAll')} →</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Advisory is a pill, not a tab. You invoke it, you don't browse it. */}
      <Pressable onPress={() => navigation.navigate('Advisory')} style={{
        position: 'absolute', left: D.pad, right: D.pad, bottom: 12, height: D.minTarget,
        borderRadius: D.minTarget / 2, backgroundColor: C.green,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6,
      }}>
        <Text style={[T.label, { color: '#fff' }]}>{t('home.askAnything')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}
