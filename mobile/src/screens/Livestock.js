import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, D } from '../theme';
import { t } from '../content';
import { Card, PrimaryButton, OutlineButton, EmptyState } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';

export default function Livestock({ navigation }) {
  const { farmer, refresh, tick } = useApp();
  const [list, setList] = useState([]);
  const [due, setDue] = useState([]);
  const [adding, setAdding] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const [a, d] = await Promise.all([db.animals(farmer.id), db.dueVaccines(farmer.id)]);
      if (alive) { setList(a); setDue(d); }
    })();
    return () => { alive = false; };
  }, [farmer.id, tick]));

  const statusOf = (a) => {
    const overdue = due.find((v) => v.animal_id === a.id && v.daysLeft <= 0);
    const soon = due.find((v) => v.animal_id === a.id && v.daysLeft <= 14);
    if (overdue) return { text: t('animal.statusVaccineDue'), color: C.red, fill: C.redSoft };
    if (soon) return { text: t('animal.statusVaccineDue'), color: C.amber, fill: C.amberSoft };
    return { text: t('animal.statusOk'), color: C.green, fill: C.greenSoft };
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad }}>
        <Text style={[T.title, { flex: 1 }]}>{t('nav.livestock')}</Text>
        <Pressable onPress={() => setAdding(true)} style={{ padding: 10 }}>
          <Text style={[T.label, { color: C.green }]}>+ {t('common.add')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: D.pad, paddingBottom: 110 }}>
        {list.length === 0 ? (
          <EmptyState text={t('animal.empty')} action={t('dayzero.addAnimal')}
            onAction={() => setAdding(true)} />
        ) : list.map((a) => {
          const st = statusOf(a);
          return (
            <Card key={a.id} onPress={() => navigation.navigate('AnimalDetail', { id: a.id })}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[T.title, { width: 44, height: 44, lineHeight: 44, marginRight: 12,
                    textAlign: 'center', borderRadius: 22, overflow: 'hidden',
                    backgroundColor: C.greenSoft, color: C.green }]}>
                  {a.name.slice(0, 1)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={T.cardTitle}>{a.name}</Text>
                  <Text style={T.caption}>
                    {a.breed || (a.species === 'buffalo' ? t('animal.buffalo') : t('animal.cow'))}
                    {a.dob ? ` · ${age(a.dob)}` : ''}
                  </Text>
                </View>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                  backgroundColor: st.fill, borderWidth: 1, borderColor: st.color,
                }}>
                  <Text style={[T.caption, { color: st.color }]}>{st.text}</Text>
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <AddAnimal visible={adding} onClose={() => setAdding(false)}
        farmer={farmer} onAdded={() => { setAdding(false); refresh(); }} />
    </SafeAreaView>
  );
}

function age(dob) {
  const y = (Date.now() - new Date(dob)) / (365.25 * 86400000);
  return y < 1 ? t('unit.months', { n: Math.round(y * 12) }) : t('unit.years', { n: Math.floor(y) });
}

// Adding one animal writes its whole vaccination and breeding calendar into the
// timeline immediately (blueprint 4.1). The toast is the proof: the record
// starts full, before the farmer has typed anything else.
function AddAnimal({ visible, onClose, farmer, onAdded }) {
  const [f, setF] = useState({ name: '', species: 'cow', breed: '', years: '', sex: 'female' });
  const [msg, setMsg] = useState(null);

  const save = async () => {
    const dob = f.years
      ? new Date(Date.now() - Number(f.years) * 365.25 * 86400000).toISOString().slice(0, 10)
      : null;
    const { generated } = await db.addAnimal({
      farmer_id: farmer.id, name: f.name.trim(), species: f.species,
      breed: f.breed.trim() || null, dob, sex: f.sex,
    });
    setMsg(t('dayzero.filled', { n: generated }));
    setTimeout(() => { setMsg(null); setF({ name: '', species: 'cow', breed: '', years: '', sex: 'female' }); onAdded(); }, 1600);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: D.pad }}>
          <Text style={[T.title, { marginBottom: 16 }]}>{t('dayzero.addAnimal')}</Text>
          <In label={t('animal.name')} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Choice label={t('animal.species')} value={f.species} onChange={(v) => setF({ ...f, species: v })}
            options={[['cow', t('animal.cow')], ['buffalo', t('animal.buffalo')]]} />
          <In label={t('animal.breed')} value={f.breed} onChange={(v) => setF({ ...f, breed: v })} />
          <In label={t('animal.age')} value={f.years} keyboard="number-pad"
            onChange={(v) => setF({ ...f, years: v.replace(/[^0-9]/g, '') })} />
          <Choice label={t('animal.sex')} value={f.sex} onChange={(v) => setF({ ...f, sex: v })}
            options={[['female', t('animal.female')], ['male', t('animal.male')]]} />

          {msg ? (
            <View style={{ backgroundColor: C.greenSoft, borderRadius: D.btnRadius, padding: 14, marginTop: 8 }}>
              <Text style={[T.label, { color: C.green, textAlign: 'center' }]}>{msg}</Text>
            </View>
          ) : (
            <>
              <PrimaryButton label={t('common.save')} disabled={!f.name.trim()} onPress={save}
                style={{ marginTop: 8 }} />
              <OutlineButton label={t('common.cancel')} onPress={onClose} style={{ marginTop: 10 }} />
            </>
          )}
          <View style={{ height: 20 }} />
        </View>
      </View>
    </Modal>
  );
}

export function In({ label, value, onChange, keyboard = 'default' }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[T.caption, { marginBottom: 4 }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboard}
        style={{
          borderWidth: 1, borderColor: C.outline, borderRadius: D.btnRadius,
          backgroundColor: C.surface, paddingHorizontal: 14, height: D.minTarget,
          fontSize: 18, fontFamily: T.body.fontFamily, color: C.ink,
        }} />
    </View>
  );
}

export function Choice({ label, value, onChange, options }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[T.caption, { marginBottom: 6 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {options.map(([k, lbl]) => (
          <Pressable key={k} onPress={() => onChange(k)}
            style={{
              paddingHorizontal: 18, minHeight: D.minTarget, justifyContent: 'center',
              borderRadius: D.btnRadius, borderWidth: 2,
              borderColor: value === k ? C.green : C.outline,
              backgroundColor: value === k ? C.greenSoft : C.surface,
            }}>
            <Text style={T.label}>{lbl}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
