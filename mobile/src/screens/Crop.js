// खेत. Plot cards -> a sheet of six chips. Blueprint 13.
//
// Soil type is NOT a form field. It is derived from the plot's GPS via the Soil
// Health Card, then a district soil map. SPEC.md A2 design principle: never ask
// what you can derive. Every extra field is a farmer who abandons onboarding.
//
// Area is entered in the farmer's own unit and stored in HECTARES. A bigha is
// not a fixed area in India, so a hard-coded conversion silently makes every
// dose and cost figure wrong by up to 3x (SPEC.md E1b).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { C, T, D } from '../theme';
import { t } from '../content';
import { Card, PrimaryButton, OutlineButton, EmptyState, TimelineRow } from '../components/ui';
import { In, Choice } from './Livestock';
import { useApp } from '../../App';
import * as db from '../db';
import { toHectares, unitsFor } from '../domain';

const CROPS = ['rice', 'wheat', 'maize', 'tomato', 'potato', 'cotton'];
const LOG_TYPES = [
  ['irrigation', '💧'], ['spray', '🧪'], ['fertilizer', '🌾'],
  ['harvest', '🚜'], ['expense', '₹'], ['sowing', '🌱'],
];

export default function Crop({ navigation }) {
  const { farmer, refresh, tick } = useApp();
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [logFor, setLogFor] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    db.plots(farmer.id).then((p) => alive && setList(p));
    return () => { alive = false; };
  }, [farmer.id, tick]));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: D.pad }}>
        <Text style={[T.title, { flex: 1 }]}>{t('nav.crop')}</Text>
        <Pressable onPress={() => setAdding(true)} style={{ padding: 10 }}>
          <Text style={[T.label, { color: C.green }]}>+ {t('common.add')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: D.pad, paddingBottom: 110 }}>
        {list.length === 0 ? (
          <EmptyState text={t('plot.empty')} action={t('dayzero.addPlot')}
            onAction={() => setAdding(true)} />
        ) : list.map((p) => (
          <Card key={p.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 30, marginRight: 12 }}>🌱</Text>
              <View style={{ flex: 1 }}>
                <Text style={T.cardTitle}>{p.name}</Text>
                <Text style={T.caption}>
                  {p.area_local_value ? `${p.area_local_value} ${p.area_local_unit}` : ''}
                  {p.area_ha ? ` (${p.area_ha.toFixed(2)} हे.)` : ''}
                  {p.current_crop ? ` · ${t('label.crop.' + p.current_crop)}` : ''}
                </Text>
                {!!p.soil_type && <Text style={T.caption}>मिट्टी: {p.soil_type}</Text>}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <OutlineButton label={t('nav.scan')} style={{ flex: 1, height: D.minTarget }}
                onPress={() => navigation.navigate('Camera')} />
              <PrimaryButton label={t('common.add')} style={{ flex: 1, height: D.minTarget }}
                onPress={() => setLogFor(p)} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <AddPlot visible={adding} farmer={farmer} onClose={() => setAdding(false)}
        onAdded={() => { setAdding(false); refresh(); }} />
      <LogSheet plot={logFor} farmer={farmer} onClose={() => setLogFor(null)}
        onLogged={() => { setLogFor(null); refresh(); }} />
    </SafeAreaView>
  );
}

function AddPlot({ visible, farmer, onClose, onAdded }) {
  const state = farmer.state || 'UP';
  const units = unitsFor(state);
  const [f, setF] = useState({ name: '', area: '', unit: units.includes('bigha') ? 'bigha' : 'acre', crop: 'maize' });
  const [gps, setGps] = useState(null);
  const [msg, setMsg] = useState(null);

  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const l = await Location.getCurrentPositionAsync({});
    setGps({ lat: l.coords.latitude, lng: l.coords.longitude });
  };

  const save = async () => {
    const value = Number(f.area) || 0;
    await db.addPlot({
      farmer_id: farmer.id, name: f.name.trim(),
      area_local_value: value, area_local_unit: f.unit,
      area_ha: toHectares(value, f.unit, state),      // hectares in the DB, always
      lat: gps?.lat ?? null, lng: gps?.lng ?? null,
      current_crop: f.crop, sown_on: new Date().toISOString().slice(0, 10),
    });
    setMsg(true);
    setTimeout(() => { setMsg(null); setF({ ...f, name: '', area: '' }); onAdded(); }, 1200);
  };

  return (
    <Sheet visible={visible} title={t('dayzero.addPlot')} onClose={onClose}>
      <In label={t('plot.name')} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
      <In label={t('plot.area')} value={f.area} keyboard="decimal-pad"
        onChange={(v) => setF({ ...f, area: v.replace(/[^0-9.]/g, '') })} />
      <Choice label={t('plot.unit')} value={f.unit} onChange={(v) => setF({ ...f, unit: v })}
        options={units.map((u) => [u, u])} />
      <Choice label={t('plot.crop')} value={f.crop} onChange={(v) => setF({ ...f, crop: v })}
        options={CROPS.map((c) => [c, t('label.crop.' + c)])} />

      <OutlineButton label={gps ? `✓ ${t('plot.gpsTaken')}` : `📍 ${t('plot.useGps')}`}
        onPress={locate} style={{ marginBottom: 10 }} />
      <Text style={[T.caption, { marginBottom: 12 }]}>{t('plot.soilDerived')}</Text>

      {msg ? (
        <Text style={[T.label, { color: C.green, textAlign: 'center' }]}>✓ {t('common.done')}</Text>
      ) : (
        <PrimaryButton label={t('common.save')} disabled={!f.name.trim() || !f.area} onPress={save} />
      )}
    </Sheet>
  );
}

function LogSheet({ plot, farmer, onClose, onLogged }) {
  const [type, setType] = useState(null);
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  if (!plot) return null;

  const save = async () => {
    const data = {};
    if (what) data.what = what;
    if (amount) {
      const n = Number(amount);
      if (type === 'harvest') data.qtl = n;
      else if (type === 'expense') data.amount = n;
      else data.cost_inr = n;
    }
    await db.logEvent({
      farmer_id: farmer.id, plot_id: plot.id, type,
      at: new Date().toISOString(), data,
    });
    setType(null); setWhat(''); setAmount('');
    onLogged();
  };

  return (
    <Sheet visible={!!plot} title={plot.name} onClose={onClose}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {LOG_TYPES.map(([k, icon]) => (
          <Pressable key={k} onPress={() => setType(k)}
            style={{
              paddingHorizontal: 14, minHeight: D.minTarget, justifyContent: 'center',
              borderRadius: D.btnRadius, borderWidth: 2,
              borderColor: type === k ? C.green : C.outline,
              backgroundColor: type === k ? C.greenSoft : C.surface,
            }}>
            <Text style={T.label}>{icon} {t('event.' + k)}</Text>
          </Pressable>
        ))}
      </View>
      {type && (
        <>
          <In label="क्या" value={what} onChange={setWhat} />
          <In label={type === 'harvest' ? 'कितने क्विंटल' : 'कितना ₹'} value={amount}
            keyboard="decimal-pad" onChange={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} />
          <PrimaryButton label={t('common.save')} onPress={save} />
        </>
      )}
    </Sheet>
  );
}

export function Sheet({ visible, title, children, onClose }) {
  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <ScrollView style={{ maxHeight: '88%' }}
          contentContainerStyle={{ backgroundColor: C.bg, borderTopLeftRadius: 24,
                                   borderTopRightRadius: 24, padding: D.pad, paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Text style={[T.title, { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} style={{ padding: 10 }}>
              <Text style={{ fontSize: 22 }}>✕</Text>
            </Pressable>
          </View>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
