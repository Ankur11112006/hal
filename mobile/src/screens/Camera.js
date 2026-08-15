// Full-bleed camera. A green guide frame, one instruction line, a shutter,
// nothing else. No filters, no zoom UI, no ratio picker. Blueprint 11.
//
// There is deliberately NO blur detection here. SPEC.md A1: a blurry photo
// produces a low confidence score, which the gate already routes to escalation.
// The confidence gate IS the quality check. Linking OpenCV for this would be
// native C++ for a job the model already does.
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { C, T, D } from '../theme';
import { t } from '../content';
import { PrimaryButton, Card } from '../components/ui';
import { useApp } from '../../App';
import * as db from '../db';
import * as ml from '../ml';

export default function Camera({ navigation }) {
  const { farmer } = useApp();
  const [perm, requestPerm] = useCameraPermissions();
  const [plots, setPlots] = useState([]);
  const [plot, setPlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    db.plots(farmer.id).then((ps) => {
      setPlots(ps);
      if (ps.length === 1) setPlot(ps[0]);
    });
  }, [farmer.id]);

  if (!perm) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!perm.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: D.pad, justifyContent: 'center' }}>
        <Card>
          <Text style={[T.body, { marginBottom: 16 }]}>
            पत्ते की फ़ोटो लेने के लिए कैमरे की इजाज़त चाहिए।
          </Text>
          <PrimaryButton label={t('common.ok')} onPress={requestPerm} />
        </Card>
      </SafeAreaView>
    );
  }

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await ref.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      const r = await ml.classify(photo.uri, plot?.current_crop || null);
      navigation.replace('ScanResult', { result: r, plotId: plot?.id || null });
    } catch (e) {
      console.warn('[camera]', e);
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={ref} style={{ flex: 1 }} facing="back">
        <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={{ padding: D.pad }}>
            <Pressable onPress={() => navigation.goBack()}
              style={{ alignSelf: 'flex-start', padding: 10 }}>
              <Text style={{ fontSize: 26, color: '#fff' }}>✕</Text>
            </Pressable>
          </View>

          <View style={{ alignItems: 'center' }}>
            <View style={{
              width: 260, height: 260, borderRadius: 24,
              borderWidth: 3, borderColor: C.greenSoft,
            }} />
            <Text style={[T.label, { color: '#fff', marginTop: 14 }]}>{t('scan.hint')}</Text>
          </View>

          <View style={{ padding: D.pad, alignItems: 'center' }}>
            {/* Crop-conditioned inference needs to know the plot. If the plot
                is registered the model picks among ~5 classes, not 30. */}
            {plots.length > 1 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {plots.map((p) => (
                  <Pressable key={p.id} onPress={() => setPlot(plot?.id === p.id ? null : p)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
                      backgroundColor: plot?.id === p.id ? C.green : 'rgba(0,0,0,0.55)',
                      borderWidth: 1, borderColor: '#fff',
                    }}>
                    <Text style={[T.caption, { color: '#fff' }]}>
                      {p.name}{p.current_crop ? ` · ${t('label.crop.' + p.current_crop)}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable onPress={shoot} disabled={busy} accessibilityLabel={t('scan.shutter')}
              style={{
                width: D.fab, height: D.fab, borderRadius: D.fab / 2,
                backgroundColor: busy ? C.inkSoft : C.scanOrange,
                borderWidth: 4, borderColor: '#fff',
                alignItems: 'center', justifyContent: 'center',
              }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 30 }}>📷</Text>}
            </Pressable>
            <Text style={[T.caption, { color: '#fff', marginTop: 8 }]}>
              {busy ? t('scan.checking') : t('scan.shutter')}
            </Text>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}
