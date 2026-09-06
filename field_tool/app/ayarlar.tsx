// Ayarlar — proje, kavşak ve tip sayacı varsayılanları + tema seçimi.
// Stitch M3 teal paleti. Header + tab-bar _layout.tsx'ten geliyor.

import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { settings, suggestIntersectionId, type AppSettings, ASSET_TYPE_CODE } from '@/lib/settings';
import { useThemedAlert } from '@/components/Alert';
import { storage } from '@/lib/storage';
import { Card, SectionCard } from '@/components/Surface';
import { Chip, ChipRow } from '@/components/Chip';
import { Segmented, type SegmentedOption } from '@/components/Segmented';
import { IconSymbol } from '@/components/StatTile';
import { useTheme, useThemeMode, type ThemeMode } from '@/lib/theme';
import type { AssetType } from '@/types/domain';

const TYPES: AssetType[] = ['traffic_signal', 'cabinet', 'bus_stop'];

const TYPE_META: Record<AssetType, { label: string; code: string; icon: string; color: keyof import('@/lib/theme').ThemeColors }> = {
  traffic_signal: { label: 'Sinyal', code: 'SG', icon: '🚥', color: 'signal' },
  cabinet: { label: 'Pano', code: 'PN', icon: '⚡', color: 'cabinet' },
  bus_stop: { label: 'Durak', code: 'STOP', icon: '🚏', color: 'busStop' },
};

const THEME_OPTIONS: SegmentedOption<ThemeMode>[] = [
  { value: 'light', label: 'Açık', icon: 'light_mode' },
  { value: 'dark', label: 'Koyu', icon: 'dark_mode' },
  { value: 'saha', label: 'Saha', icon: 'wb_sunny' },
];

export default function AyarlarScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(t);
  const router = useRouter();
  const { alert } = useThemedAlert();
  const { mode, setMode } = useThemeMode();
  const [s, setS] = useState<AppSettings | null>(null);
  const [type, setType] = useState<AssetType>('traffic_signal');
  const [ixCounter, setIxCounter] = useState('');
  const [ixPrefix, setIxPrefix] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sgCounter, setSgCounter] = useState('1');
  const [pnCounter, setPnCounter] = useState('1');
  const [stopCounter, setStopCounter] = useState('1');

  useEffect(() => {
    settings.get().then((v) => {
      setS(v);
      setType(v.defaultType);
      setIxCounter(String(v.nextIntersectionCounter));
      setIxPrefix(v.intersectionIdPrefix);
      setProjectId(v.projectId);
      setSgCounter(String(v.nextSgCounter));
      setPnCounter(String(v.nextPnCounter));
      setStopCounter(String(v.nextStopCounter));
    });
  }, []);

  const save = useCallback(async () => {
    const ixN = parseInt(ixCounter, 10);
    if (Number.isNaN(ixN) || ixN < 1) {
      await alert({ title: 'Geçersiz', message: 'Kavşak sayaç 1 veya üstü olmalı.' });
      return;
    }
    if (ixPrefix.trim().length === 0) {
      await alert({ title: 'Geçersiz', message: 'Kavşak öneki boş olamaz.' });
      return;
    }
    const proj = projectId.trim();
    if (proj.length === 0) {
      await alert({ title: 'Geçersiz', message: 'Proje ID boş olamaz.' });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(proj)) {
      await alert({
        title: 'Geçersiz',
        message: 'Proje ID yalnızca harf, rakam, tire ve alt çizgi içerebilir.',
      });
      return;
    }

    const sgN = parseInt(sgCounter, 10);
    const pnN = parseInt(pnCounter, 10);
    const stopN = parseInt(stopCounter, 10);
    if (Number.isNaN(sgN) || sgN < 1 || Number.isNaN(pnN) || pnN < 1 || Number.isNaN(stopN) || stopN < 1) {
      await alert({ title: 'Geçersiz', message: 'Sayaç değerleri 1 veya üstü olmalı.' });
      return;
    }

    // Çakışma kontrolü: kullanıcının girdiği sayaç zaten bir asset_id
    // olarak mevcut mu? Varsa reddet — kullanıcı uyarıyı görsün, kayıt yapılmasın.
    const allAssets = await storage.getAssets();
    const conflictChecks: Array<{ type: AssetType; n: number }> = [
      { type: 'traffic_signal', n: sgN },
      { type: 'cabinet', n: pnN },
      { type: 'bus_stop', n: stopN },
    ];
    for (const { type: tt, n } of conflictChecks) {
      const code = ASSET_TYPE_CODE[tt];
      const suffix = `-${code}-${String(n).padStart(3, '0')}`;
      const hit = allAssets.find((a) => a.type === tt && a.asset_id.endsWith(suffix));
      if (hit) {
        await alert({
          title: 'Sayaç Çakışması',
          message: `${TYPE_META[tt].label} sayacı ${n} zaten kullanımda (${hit.asset_id}). Daha küçük bir değer gir.`,
        });
        return;
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await settings.update({
      defaultType: type,
      nextIntersectionCounter: ixN,
      intersectionIdPrefix: ixPrefix.trim(),
      projectId: proj,
      nextSgCounter: sgN,
      nextPnCounter: pnN,
      nextStopCounter: stopN,
    });
    setProjectId(proj);
    await alert({
      title: 'Kaydedildi',
      message: 'Yeni asset/kavşak eklerken bu değerler kullanılacak.',
    });
  }, [type, ixCounter, ixPrefix, projectId, alert]);

  const reset = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await settings.reset();
    setType('traffic_signal');
    setIxCounter('1');
    setIxPrefix('K');
    setProjectId('ODTU');
    setSgCounter('1');
    setPnCounter('1');
    setStopCounter('1');
    await alert({ title: 'Sıfırlandı', message: 'Ayarlar varsayılana döndü.' });
  }, [alert]);

  if (!s) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <IconSymbol name="settings" size={32} color={t.textMuted} />
          <Text style={[styles.body, { marginTop: 12 }]}>Yükleniyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ixPreview = suggestIntersectionId(
    parseInt(ixCounter, 10) || 1,
    ixPrefix || 'K',
    projectId || 'ODTU',
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back row (global header already shows brand + subtitle). */}
          <View style={styles.backRow}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Geri"
            >
              <IconSymbol name="arrow_back" size={20} color={t.text} />
              <Text style={styles.backLabel}>Geri</Text>
            </Pressable>
          </View>

          {/* Page hero. */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <IconSymbol name="tune" size={28} color={t.primary} />
            </View>
            <Text style={styles.heroTitle}>Ayarlar</Text>
            <Text style={styles.heroSubtitle}>
              Yeni kavşak/asset eklerken varsayılan değerler
            </Text>
          </View>

          {/* Project ID. */}
          <Card style={{ marginTop: 8 }}>
            <View style={styles.sectionHead}>
              <IconSymbol name="folder" size={20} color={t.primary} />
              <Text style={styles.sectionTitle}>Proje</Text>
            </View>

            <Text style={styles.label}>Proje ID</Text>
            <TextInput
              style={[styles.input, styles.inputMono]}
              value={projectId}
              onChangeText={setProjectId}
              placeholder="ODTU"
              placeholderTextColor={t.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={24}
            />
            <Text style={styles.help}>
              Her kavşak ID'si bu önekle başlar (örn. <Text style={styles.code}>{ixPreview}</Text>).
            </Text>
          </Card>

          {/* Kavşak ID. */}
          <Card>
            <View style={styles.sectionHead}>
              <IconSymbol name="tag" size={20} color={t.primary} />
              <Text style={styles.sectionTitle}>Kavşak ID ayarları</Text>
            </View>

            <Text style={styles.label}>Kavşak öneki</Text>
            <TextInput
              style={[styles.input, styles.inputMono]}
              value={ixPrefix}
              onChangeText={setIxPrefix}
              placeholder="K"
              placeholderTextColor={t.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Sonraki kavşak numarası</Text>
            <TextInput
              style={[styles.input, styles.inputMono]}
              value={ixCounter}
              onChangeText={setIxCounter}
              keyboardType="number-pad"
              placeholderTextColor={t.textMuted}
            />
            <Text style={styles.help}>
              Sonraki kavşak: <Text style={styles.code}>{ixPreview}</Text>
            </Text>
          </Card>

          {/* Per-type counters — editable, çakışma kontrolü kayıt sırasında. */}
          <Card>
            <View style={styles.sectionHead}>
              <IconSymbol name="counter_1" size={20} color={t.primary} />
              <Text style={styles.sectionTitle}>Asset sayaçları</Text>
            </View>
            <Text style={styles.help}>
              Her tip kendi sayacından ilerler. Yeni asset için kullanılacak
              sonraki numara. Mevcut bir asset_id ile çakışırsa kayıt reddedilir.
            </Text>
            {TYPES.map((tt) => {
              const meta = TYPE_META[tt];
              const value =
                tt === 'traffic_signal'
                  ? sgCounter
                  : tt === 'bus_stop'
                    ? stopCounter
                    : pnCounter;
              const setValue =
                tt === 'traffic_signal'
                  ? setSgCounter
                  : tt === 'bus_stop'
                    ? setStopCounter
                    : setPnCounter;
              return (
                <SectionCard key={tt} padded={false} style={styles.counterRow}>
                  <View style={styles.counterLeft}>
                    <View
                      style={[
                        styles.counterDot,
                        { backgroundColor: t[meta.color] as string },
                      ]}
                    />
                    <Text style={styles.counterLabel}>{meta.label}</Text>
                    <Text style={styles.counterCode}>({meta.code})</Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.inputMono, styles.counterEdit]}
                    value={value}
                    onChangeText={setValue}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                </SectionCard>
              );
            })}
          </Card>

          {/* Default asset type. */}
          <Card>
            <View style={styles.sectionHead}>
              <IconSymbol name="category" size={20} color={t.primary} />
              <Text style={styles.sectionTitle}>Varsayılan asset tipi</Text>
            </View>
            <ChipRow gap={8}>
              {TYPES.map((tt) => {
                const meta = TYPE_META[tt];
                return (
                  <Chip
                    key={tt}
                    active={type === tt}
                    leading={meta.icon}
                    onPress={() => {
                      setType(tt);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                  >
                    {meta.label}
                  </Chip>
                );
              })}
            </ChipRow>
            <Text style={[styles.help, { marginTop: 10 }]}>
              Yeni kavşak eklendiğinde bu tip seçili olarak gelir.
            </Text>
          </Card>

          {/* Theme. */}
          <Card>
            <View style={styles.sectionHead}>
              <IconSymbol name="palette" size={20} color={t.primary} />
              <Text style={styles.sectionTitle}>Görünüm Teması</Text>
            </View>
            <Segmented<ThemeMode>
              options={THEME_OPTIONS}
              value={mode}
              onChange={(v) => {
                setMode(v);
                Haptics.selectionAsync().catch(() => {});
              }}
            />
            <Text style={styles.help}>
              Saha Modu yüksek kontrastlı, gündüz açık alanda okunabilirlik için.
              Gece çekiminde Koyu'ya dönün. Saha Modu açıkken parlaklık otomatik
              maximum'a çıkarılır.
            </Text>
          </Card>

          {/* Action buttons. */}
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}
            onPress={save}
          >
            <IconSymbol name="save" size={18} color={t.textInverse} />
            <Text style={styles.btnText}>Kaydet</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.btnPressed]}
            onPress={reset}
          >
            <IconSymbol name="restart_alt" size={18} color={t.textInverse} />
            <Text style={styles.btnText}>Tüm Ayarları Sıfırla</Text>
          </Pressable>

          <View style={styles.footer}>
            <IconSymbol name="info" size={14} color={t.textMuted} />
            <Text style={styles.footerText}>
              Ayarlar cihazda yerel saklanır, sunucuya gönderilmez.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 16, paddingBottom: 40 },
    body: { color: t.text, fontSize: t.type.bodyMd },

    backRow: { flexDirection: 'row', marginBottom: 4 },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    backLabel: {
      color: t.text,
      fontSize: t.type.bodyMd,
      fontWeight: '600',
    },

    hero: { alignItems: 'center', paddingVertical: 12, marginBottom: 8 },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: t.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    heroTitle: {
      fontSize: t.type.headlineLg,
      fontWeight: '700',
      color: t.text,
    },
    heroSubtitle: {
      fontSize: t.type.bodyMd,
      color: t.textMuted,
      marginTop: 6,
      textAlign: 'center',
    },

    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: t.type.titleMd,
      fontWeight: '700',
      color: t.text,
    },
    label: { fontSize: t.type.labelLg, fontWeight: '600', color: t.text, marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: t.type.bodyLg,
      color: t.text,
      backgroundColor: t.chipBg,
    },
    inputMono: {
      fontFamily: 'monospace',
      letterSpacing: 0.5,
    },
    help: { fontSize: t.type.bodySm, color: t.textMuted, marginTop: 8, lineHeight: 20 },
    code: {
      fontFamily: 'monospace',
      color: t.primary,
      fontWeight: '700',
    },

    counterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 8,
    },
    counterLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    counterDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    counterLabel: { fontSize: t.type.bodyMd, color: t.text, fontWeight: '600' },
    counterCode: {
      fontSize: t.type.labelSm,
      color: t.textMuted,
      fontFamily: 'monospace',
      letterSpacing: 0.5,
    },
    counterValue: {
      fontSize: t.type.dataMonoLg,
      fontFamily: 'monospace',
      color: t.primary,
      fontWeight: '700',
    },
    counterEdit: {
      width: 96,
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
    },

    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
      minHeight: 52,
      marginTop: 16,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnDanger: { backgroundColor: t.danger },
    btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    btnText: {
      color: t.textInverse,
      fontWeight: '700',
      fontSize: t.type.btn,
    },

    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      justifyContent: 'center',
      marginTop: 16,
    },
    footerText: {
      fontSize: t.type.bodySm,
      color: t.textMuted,
    },
  });
}
