// बही. The record IS the product, and the tab is named after the app on purpose.
//
// Three zones, and `सब` is the permanent default filter: the merged view is
// the differentiator, and splitting it by default hides the one thing no
// competitor has. Crop rows tinted, animal rows white: enough to read the mix
// at a glance, not enough to look like two lists.
//
// Demo note: scroll this slowly. The interleaving is the point.
import React, { useCallback, useState } from 'react';
import { View, Text, SectionList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, D } from '../theme';
import { t } from '../content';
import { TimelineRow, EmptyState, DemoChip } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';

const FILTERS = [
  { key: 'all', label: t('records.all') },
  { key: 'crop', label: t('nav.crop') },
  { key: 'animal', label: t('nav.livestock') },
];

export default function Records({ navigation }) {
  const { farmer, tick } = useApp();
  const [zones, setZones] = useState({ upcoming: [], today: [], past: [] });
  const [filter, setFilter] = useState('all');

  useFocusEffect(useCallback(() => {
    let alive = true;
    db.timelineZones(farmer.id).then((z) => alive && setZones(z));
    return () => { alive = false; };
  }, [farmer.id, tick]));

  const keep = (e) =>
    filter === 'all' || (filter === 'crop' ? !!e.plot_id : !!e.animal_id);

  const sections = [
    { title: t('records.upcoming'), data: zones.upcoming.filter(keep) },
    { title: t('records.today'), data: zones.today.filter(keep) },
    { title: t('records.past'), data: zones.past.filter(keep) },
  ].filter((s) => s.data.length);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: D.pad, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[T.title, { flex: 1 }]}>{t('records.title')}</Text>
          {farmer.is_demo ? <DemoChip /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)}
              style={{
                paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
                borderWidth: 1, borderColor: filter === f.key ? C.green : C.outline,
                backgroundColor: filter === f.key ? C.green : C.surface,
              }}>
              <Text style={[T.caption, filter === f.key && { color: '#fff' }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {sections.length === 0 ? (
        <View style={{ padding: D.pad }}>
          <EmptyState text={t('records.emptyPast')} action={t('records.addOld')}
            onAction={() => navigation.navigate('Crop')} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: D.pad, paddingBottom: 100 }}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={{ backgroundColor: C.bg, paddingVertical: 8 }}>
              <Text style={[T.label, { color: C.inkSoft }]}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TimelineRow e={item}
              onPress={() => item.animal_id && navigation.navigate('AnimalDetail', { id: item.animal_id })} />
          )}
        />
      )}
    </SafeAreaView>
  );
}
