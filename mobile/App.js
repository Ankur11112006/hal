import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';

import { C, T, D } from './src/theme';
import { t, setLang } from './src/content';
import * as db from './src/db';
import * as api from './src/api';
import * as ml from './src/ml';
import { syncReminders } from './src/notify';
import { Loading } from './src/components/ui';

import FirstRun from './src/screens/Onboarding';
import Home from './src/screens/Home';
import Crop from './src/screens/Crop';
import Livestock from './src/screens/Livestock';
import Records from './src/screens/Records';
import Camera from './src/screens/Camera';
import ScanResult from './src/screens/ScanResult';
import AnimalDetail from './src/screens/AnimalDetail';
import SymptomChecker from './src/screens/SymptomChecker';
import Advisory from './src/screens/Advisory';
import Settings from './src/screens/Settings';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

// ---------------------------------------------------------------- app state
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function TabBar({ state, navigation }) {
  const items = [
    { key: 'Home', label: t('nav.home') },
    { key: 'Crop', label: t('nav.crop') },
    { key: '__scan', label: t('nav.scan') },
    { key: 'Livestock', label: t('nav.livestock') },
    { key: 'Records', label: t('nav.records') },
  ];
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.surface }}>
      <View style={s.bar}>
        {items.map((it) => {
          if (it.key === '__scan') {
            // Largest, brightest element on screen. Most-used action, and the
            // demo's opening move.
            return (
              <Pressable key="scan" accessibilityLabel={it.label}
                onPress={() => navigation.navigate('Camera')} style={s.fabWrap}>
                <View style={s.fab}>
                  {/* A plain camera shutter drawn as a shape, not an emoji:
                      emoji render differently on every Android skin. */}
                  <View style={{ width: 30, height: 30, borderRadius: 6,
                                 borderWidth: 3, borderColor: '#fff' }} />
                </View>
                <Text style={[T.caption, { color: C.scanOrange }]}>{it.label}</Text>
              </Pressable>
            );
          }
          const active = state.routes[state.index].name === it.key;
          return (
            <Pressable key={it.key} accessibilityLabel={it.label}
              onPress={() => navigation.navigate(it.key)} style={s.tab}>
              <Text style={[T.label, { fontSize: 16, color: active ? C.green : C.inkSoft }]}>
                {it.label}
              </Text>
              <View style={{ height: 3, width: 22, marginTop: 5, borderRadius: 2,
                             backgroundColor: active ? C.green : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="Home" component={Home} />
      <Tabs.Screen name="Crop" component={Crop} />
      <Tabs.Screen name="Livestock" component={Livestock} />
      <Tabs.Screen name="Records" component={Records} />
    </Tabs.Navigator>
  );
}

export default function App() {
  const [fonts] = useFonts({
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  });
  const [farmer, setFarmer] = useState(undefined);   // undefined = still loading
  const [isOnline, setOnline] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    (async () => {
      await db.open();
      await api.loadApiBase();                       // Settings override, if any
      const saved = await AsyncStorage.getItem('bahi.lang');
      if (saved) setLang(saved);
      ml.load();                                     // warm the interpreter early
      const f = (await db.anyFarmer()) || null;
      if (f?.lang && !saved) setLang(f.lang);
      setFarmer(f);
    })();
  }, []);

  // Reminders are rebuilt from local due dates, so they keep firing offline.
  //
  // Deliberately delayed. Requesting the notification permission during the
  // first paint pops a system dialog that takes focus away from Home, which
  // cancels its in-flight query and leaves "nothing urgent today" on screen
  // over a farm that has three overdue vaccines. It also asks for permission
  // before showing any reason to grant it, which is how you get denied.
  useEffect(() => {
    if (!farmer) return;
    const id = setTimeout(() => syncReminders(farmer.id).catch(() => {}), 2500);
    return () => clearTimeout(id);
  }, [farmer?.id, tick]);

  // Drain the queue whenever we can reach the server. The UI never waits on it.
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      const up = await api.online();
      if (!alive) return;
      setOnline(up);
      if (up) { try { await api.flush(farmer); } catch {} }
    };
    beat();
    const id = setInterval(beat, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [tick, farmer?.id]);

  if (!fonts || farmer === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 44, color: C.green, fontWeight: '700' }}>{t('app.name')}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Ctx.Provider value={{ farmer, setFarmer, isOnline, refresh, tick }}>
        <StatusBar style="dark" backgroundColor={C.bg} />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
            {!farmer ? (
              <Stack.Screen name="FirstRun" component={FirstRun} />
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="Camera" component={Camera} />
                <Stack.Screen name="ScanResult" component={ScanResult} />
                <Stack.Screen name="AnimalDetail" component={AnimalDetail} />
                <Stack.Screen name="SymptomChecker" component={SymptomChecker} />
                <Stack.Screen name="Settings" component={Settings} />
                <Stack.Screen name="Advisory" component={Advisory}
                  options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </Ctx.Provider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: C.outline, backgroundColor: C.surface,
    paddingTop: 6, paddingBottom: 4,
  },
  tab: { alignItems: 'center', minWidth: D.minTarget, minHeight: D.minTarget, justifyContent: 'center' },
  fabWrap: { alignItems: 'center', marginTop: -26 },
  fab: {
    width: D.fab, height: D.fab, borderRadius: D.fab / 2, backgroundColor: C.scanOrange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 6, marginBottom: 2,
  },
});
