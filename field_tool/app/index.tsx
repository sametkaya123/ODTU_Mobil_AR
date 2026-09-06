// Orchestrator: first-run gates onboarding, then runs the camera+location
// permission flow. Skipping is allowed when permissions are partial / denied.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { useTheme } from '@/lib/theme';
import { ONBOARDING_FLAG } from './onboarding';

type PermState = 'checking' | 'granted' | 'partial' | 'denied';

export default function PermissionsGate() {
  const router = useRouter();
  const t = useTheme();
  const styles = makeStyles(t);
  const [state, setState] = useState<PermState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await AsyncStorage.getItem(ONBOARDING_FLAG).catch(() => null);
      if (cancelled || seen !== '1') {
        if (!cancelled) router.replace('/onboarding' as never);
        return;
      }
      const [camRes, locRes] = await Promise.all([
        Camera.requestCameraPermissionsAsync(),
        Location.requestForegroundPermissionsAsync(),
      ]);
      if (cancelled) return;
      const cam = camRes.status === 'granted';
      const loc = locRes.status === 'granted';
      if (cam && loc) setState('granted');
      else if (cam || loc) setState('partial');
      else setState('denied');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (state === 'granted') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/kavsak');
    }
  }, [state, router]);

  const skip = () => router.replace('/kavsak');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.inner}>
        <Text style={styles.logo}>📸</Text>
        <Text style={styles.title}>Saha Referans</Text>
        <Text style={styles.subtitle}>Trafik varlıkları için referans foto toplama</Text>

        {state === 'checking' && (
          <View style={styles.statusBox}>
            <ActivityIndicator color={t.primary} />
            <Text style={styles.body}>Konum ve kamera izinleri kontrol ediliyor…</Text>
          </View>
        )}
        {state === 'granted' && (
          <View style={styles.statusBox}>
            <Text style={styles.ok}>✓ İzinler verildi</Text>
            <Text style={styles.body}>Yönlendiriliyor…</Text>
          </View>
        )}
        {state === 'partial' && (
          <View style={styles.warnBox}>
            <Text style={styles.warn}>⚠ Bazı izinler reddedildi</Text>
            <Text style={styles.body}>
              Uygulama yine de kullanılabilir; kamera izni olmadan çekim yapılamaz,
              konum izni olmadan yeni asset eklenemez.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
              onPress={skip}
            >
              <Text style={styles.btnText}>Devam Et</Text>
            </Pressable>
            <Pressable style={styles.skipBtn} onPress={skip}>
              <Text style={styles.skipText}>Geç</Text>
            </Pressable>
          </View>
        )}
        {state === 'denied' && (
          <View style={styles.warnBox}>
            <Text style={styles.warn}>✕ Konum ve kamera izinleri reddedildi</Text>
            <Text style={styles.body}>
              Ayarlardan izin vererek tekrar deneyin veya mevcut verilerle devam edin.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
              onPress={skip}
            >
              <Text style={styles.btnText}>Yine de Devam Et</Text>
            </Pressable>
            <Pressable style={styles.skipBtn} onPress={skip}>
              <Text style={styles.skipText}>Geç</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    inner: { flex: 1, padding: 24, justifyContent: 'center' },
    logo: { fontSize: 72, textAlign: 'center', marginBottom: 12 },
    title: { fontSize: t.type.hero, fontWeight: '800', color: t.text, textAlign: 'center' },
    subtitle: { fontSize: t.type.body, color: t.textMuted, textAlign: 'center', marginTop: 6 },
    statusBox: {
      marginTop: 32,
      padding: 16,
      backgroundColor: t.card,
      borderRadius: 14,
      alignItems: 'center',
      gap: 8,
    },
    warnBox: {
      marginTop: 32,
      padding: 16,
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    body: { fontSize: t.type.body, color: t.text, lineHeight: 22, textAlign: 'center' },
    warn: { fontSize: t.type.title, color: t.warn, fontWeight: '700', marginBottom: 8 },
    ok: { fontSize: t.type.title, color: t.ok, fontWeight: '700' },
    btn: {
      marginTop: 16,
      backgroundColor: t.primary,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 52,
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    skipBtn: {
      marginTop: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    skipText: {
      color: t.textMuted,
      fontWeight: '600',
      fontSize: t.type.labelLg,
    },
  });
}
