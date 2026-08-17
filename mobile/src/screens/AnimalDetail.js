// 2x2 grid of large tiles, then recent events. Blueprint 14.
//
// The vaccination row is the highest impact-to-effort feature in the whole app:
// the vaccine is free and the government administers it, so cost is not the
// barrier, knowing the due date is. One date per animal and a WHERE clause.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, D } from '../theme';
import { t, L, vaccineName } from '../content';
import {
  Card, PrimaryButton, OutlineButton, TimelineRow, SpeakButton, CallButton,
} from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';

export default function AnimalDetail({ route, navigation }) {
  const { id } = route.params;
  const { farmer, refresh, tick } = useApp();
  const [animal, setAnimal] = useState(null);
  const [events, setEvents] = useState([]);
  const [toast, setToast] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const list = await db.animals(farmer.id);
      const a = list.find((x) => x.id === id);
      const ev = await db.animalEvents(id);
      if (alive) { setAnimal(a); setEvents(ev); }
    })();
    return () => { alive = false; };
  }, [id, farmer.id, tick]));

  if (!animal) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} />;

  const today = new Date().toISOString().slice(0, 10);
  const dueRows = events
    .filter((e) => e.type === 'vaccine_due')
    .map((e) => ({ ...e, daysLeft: Math.round((new Date(e.at) - new Date(today)) / 86400000) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const breedRows = events.filter((e) =>
    ['expected_heat', 'expected_calving', 'dry_off', 'transition_feed', 'pd_check'].includes(e.type)
    && e.at.slice(0, 10) >= today);
  const history = events.filter((e) =>
    !['vaccine_due', 'expected_heat', 'expected_calving', 'dry_off', 'transition_feed', 'pd_check']
      .includes(e.type));

  const markDone = async (vaccine) => {
    const next = await db.markVaccineDone({ ...animal, farmer_id: farmer.id }, vaccine);
    setToast(next ? t('vaccine.marked', { date: next.due }) : t('common.done'));
    setTimeout(() => setToast(null), 2500);
    refresh();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad }}>
        <Pressable onPress={() => navigation.goBack()} style={{ padding: 8, minWidth: 44 }}>
          <Text style={{ fontSize: 24 }}>←</Text>
        </Pressable>
        
        <View style={{ flex: 1 }}>
          <Text style={T.title}>{animal.name}</Text>
          <Text style={T.caption}>{animal.breed || ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: D.pad, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <Tile label={t('animal.checkSymptoms')}
            onPress={() => navigation.navigate('SymptomChecker',
              { animal: { ...animal, farmer_id: farmer.id } })} />
          <Tile label={t('animal.vaccine')} />
          <Tile label={t('animal.breeding')} />
          <Tile label={t('animal.history')} />
        </View>

        {toast && (
          <View style={{ backgroundColor: C.greenSoft, borderRadius: D.btnRadius, padding: 14, marginBottom: 12 }}>
            <Text style={[T.label, { color: C.green }]}>{toast}</Text>
          </View>
        )}

        <Text style={[T.label, { marginBottom: 8 }]}>{t('vaccine.title')}</Text>
        {dueRows.length === 0 ? (
          <Card><Text style={T.bodySoft}>{t('vaccine.none')}</Text></Card>
        ) : dueRows.map((v) => {
          const overdue = v.daysLeft < 0;
          const line = v.data.no_record
            ? t('vaccine.noRecord')
            : overdue ? t('vaccine.overdue', { days: Math.abs(v.daysLeft) })
              : v.daysLeft === 0 ? t('vaccine.dueToday') : t('vaccine.due', { days: v.daysLeft });
          const name = vaccineName(v.data);
          return (
            <Card key={v.id} style={overdue ? { borderColor: C.red, borderWidth: 2 } : null}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={T.cardTitle}>{name}</Text>
                  <Text style={[T.body, { color: overdue ? C.red : C.inkSoft }]}>{line}</Text>
                  {!!L(v.data.why) && <Text style={[T.caption, { marginTop: 4 }]}>{L(v.data.why)}</Text>}
                </View>
                <SpeakButton text={`${name}. ${line}. ${L(v.data.why)}`} size={40} />
              </View>
              <PrimaryButton label={t('vaccine.markDone')} style={{ marginTop: 12 }}
                onPress={() => markDone(v.data.vaccine)} />
            </Card>
          );
        })}

        {breedRows.length > 0 && (
          <>
            <Text style={[T.label, { marginTop: 16, marginBottom: 8 }]}>{t('breeding.title')}</Text>
            {breedRows.map((b) => (
              <Card key={b.id} style={{ paddingVertical: 12 }}>
                <Text style={T.body}>{t('breeding.' + b.type)}</Text>
                <Text style={T.caption}>{b.at.slice(0, 10)}</Text>
                {!!L(b.data.window) && (
                  <Text style={[T.caption, { marginTop: 4 }]}>{L(b.data.window)}</Text>
                )}
              </Card>
            ))}
          </>
        )}

        <Text style={[T.label, { marginTop: 16, marginBottom: 8 }]}>{t('animal.history')}</Text>
        {history.length === 0
          ? <Card><Text style={T.bodySoft}>{t('records.emptyPast')}</Text></Card>
          : history.map((e) => <TimelineRow key={e.id} e={{ ...e, animal_name: animal.name }} />)}

        <View style={{ height: 16 }} />
        <CallButton which="vet" label={t('symptom.callVet')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label}
      style={{
        width: '47%', height: D.tile, borderRadius: D.cardRadius,
        borderWidth: 1, borderColor: C.outline, backgroundColor: C.surface,
        alignItems: 'center', justifyContent: 'center',
      }}>
      <Text style={[T.caption, { marginTop: 4 }]}>{label}</Text>
    </Pressable>
  );
}
