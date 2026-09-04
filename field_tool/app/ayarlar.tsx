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
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { settings, suggestIntersectionId, type AppSettings } from '@/lib/settings';
import { useThemedAlert } from '@/components/Alert';
import type { AssetType } from '@/types/domain';
import { useTheme, useThemeMode, type ThemeMode } from '@/lib/theme';

const TYPES: AssetType[] = ['traffic_signal', 'cabinet', 'bus_stop'];

const TYPE_LABEL: Record<AssetType, string> = {
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
  { value: 'saha', label: 'Saha Modu (Güneş) ⚡' },
];

export default function AyarlarScreen() {
  const t = useTheme();
  const styles = makeStyles(t);
  const { alert } = useThemedAlert();
  const { mode, setMode } = useThemeMode();
  const [s, setS] = useState<AppSettings | null>(null);
  const [type, setType] = useState<AssetType>('traffic_signal');
  const [ixCounter, setIxCounter] = useState('');
  const [ixPrefix, setIxPrefix] = useState('');
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    settings.get().then((v) => {
      setS(v);
      setType(v.defaultType);
      setIxCounter(String(v.nextIntersectionCounter));
      setIxPrefix(v.intersectionIdPrefix);
      setProjectId(v.projectId);
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await settings.update({
      defaultType: type,
      nextIntersectionCounter: ixN,
      intersectionIdPrefix: ixPrefix.trim(),
      projectId: proj,
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
    await alert({ title: 'Sıfırlandı', message: 'Ayarlar varsayılana döndü.' });
  }, [alert]);

  if (!s) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.body}>Yükleniyor…</Text>
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
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Text style={styles.heroEmoji}>⚙️</Text>
            <Text style={styles.heroTitle}>Ayarlar</Text>
            <Text style={styles.heroSubtitle}>
              Yeni asset/kavşak eklerken varsayılan değerler
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Proje</Text>

            <Text style={styles.label}>Proje ID</Text>
            <TextInput
              style={styles.input}
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
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Kavşak ID ayarları</Text>

            <Text style={styles.label}>Kavşak öneki</Text>
            <TextInput
              style={styles.input}
              value={ixPrefix}
              onChangeText={setIxPrefix}
              placeholder="K"
              placeholderTextColor={t.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />

            <Text style={[styles.label, styles.labelTop]}>Sonraki kavşak numarası</Text>
            <TextInput
              style={styles.input}
              value={ixCounter}
              onChangeText={setIxCounter}
              keyboardType="number-pad"
              placeholderTextColor={t.textMuted}
            />
            <Text style={styles.help}>
              Sonraki kavşak:{' '}
              <Text style={styles.code}>{ixPreview}</Text>
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Asset sayaç durumu</Text>
            <Text style={styles.help}>
              Her tip kendi sayacından ilerler. Sayaçlar salt-okunur; yeni
              asset eklendikçe otomatik artar.
            </Text>
            <View style={styles.counterRow}>
              <Text style={styles.counterLabel}>Sinyal (SG)</Text>
              <Text style={styles.counterValue}>{s?.nextSgCounter ?? 1}</Text>
            </View>
            <View style={styles.counterRow}>
              <Text style={styles.counterLabel}>Pano (PN)</Text>
              <Text style={styles.counterValue}>{s?.nextPnCounter ?? 1}</Text>
            </View>
            <View style={styles.counterRow}>
              <Text style={styles.counterLabel}>Durak (STOP)</Text>
              <Text style={styles.counterValue}>{s?.nextStopCounter ?? 1}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Varsayılan asset tipi</Text>
            <View style={styles.chips}>
              {TYPES.map((tt) => (
                <Pressable
                  key={tt}
                  onPress={() => {
                    setType(tt);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={[styles.chip, type === tt && styles.chipActive]}
                >
                  <Text style={[styles.chipText, type === tt && styles.chipTextActive]}>
                    {TYPE_LABEL[tt]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Görünüm Teması</Text>
            <View style={styles.chips}>
              {THEME_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setMode(opt.value);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={[styles.chip, mode === opt.value && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, mode === opt.value && styles.chipTextActive]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.help}>
              Saha Modu yüksek kontrastlı, gündüz açık alanda okunabilirlik için.
              Gece çekiminde Koyu'ya dönün. Saha Modu açıkken parlaklık otomatik
              maximum'a çıkarılır.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}
            onPress={save}
          >
            <Text style={styles.btnText}>Kaydet</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              styles.btnDanger,
              styles.btnTopMargin,
              pressed && styles.btnPressed,
            ]}
            onPress={reset}
          >
            <Text style={styles.btnText}>Tüm Ayarları Sıfırla</Text>
          </Pressable>
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
    body: { color: t.text, fontSize: t.type.body },
    hero: { alignItems: 'center', paddingVertical: 16, marginBottom: 8 },
    heroEmoji: { fontSize: 56, marginBottom: 4 },
    heroTitle: { fontSize: t.type.hero - 4, fontWeight: '700', color: t.text },
    heroSubtitle: {
      fontSize: t.type.body,
      color: t.textMuted,
      marginTop: 6,
      textAlign: 'center',
    },
    card: {
      backgroundColor: t.card,
      padding: 16,
      borderRadius: 14,
      marginTop: 12,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.5,
      shadowRadius: 4,
      elevation: 2,
      borderWidth: 1,
      borderColor: t.border,
    },
    sectionTitle: {
      fontSize: t.type.caption,
      fontWeight: '700',
      color: t.primary,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    label: { fontSize: t.type.body, fontWeight: '600', color: t.text, marginBottom: 8 },
    labelTop: { marginTop: 12 },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: t.type.body,
      color: t.text,
      backgroundColor: t.chipBg,
    },
    help: { fontSize: t.type.caption, color: t.textMuted, marginTop: 8, lineHeight: 20 },
    code: {
      fontFamily: 'monospace',
      color: t.primary,
      fontWeight: '700',
    },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.chipBg,
    },
    chipActive: { backgroundColor: t.primary, borderColor: t.primary },
    chipText: { color: t.text, fontWeight: '500', fontSize: t.type.body },
    chipTextActive: { color: t.textInverse },
    btn: {
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 54,
      justifyContent: 'center',
      marginTop: 16,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnDanger: { backgroundColor: t.danger },
    btnTopMargin: { marginTop: 12 },
    btnPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    counterRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginTop: 6,
      backgroundColor: t.chipBg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    counterLabel: { fontSize: t.type.body, color: t.text, fontWeight: '600' },
    counterValue: {
      fontSize: t.type.body,
      fontFamily: 'monospace',
      color: t.primary,
      fontWeight: '700',
    },
  });
}
