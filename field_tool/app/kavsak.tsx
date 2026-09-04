import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { storage } from '@/lib/storage';
import { settings, suggestIntersectionId } from '@/lib/settings';
import { useThemedAlert } from '@/components/Alert';
import type { Asset, Intersection, ReferenceImage } from '@/types/domain';
import { useTheme } from '@/lib/theme';

interface Row {
  intersection: Intersection;
  assetCount: number;
  shotCount: number;
}

type SortMode = 'date-desc' | 'date-asc' | 'az' | 'za';
const SORT_LABEL: Record<SortMode, string> = {
  'date-desc': 'Tarih ↓',
  'date-asc': 'Tarih ↑',
  az: 'A-Z',
  za: 'Z-A',
};
const SORT_ORDER: SortMode[] = ['date-desc', 'date-asc', 'az', 'za'];

export default function KavsakScreen() {
  const router = useRouter();
  const t = useTheme();
  const styles = makeStyles(t);
  const { confirm, alert } = useThemedAlert();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('date-desc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [form, setForm] = useState<{ id: string; intersection_name: string }>({
    id: '',
    intersection_name: '',
  });

  const load = useCallback(async () => {
    const [intersections, assets, shots] = await Promise.all([
      storage.getIntersections(),
      storage.getAssets(),
      storage.getShots(),
    ]);
    const assetByIx = new Map<string, Asset[]>();
    for (const a of assets) {
      const list = assetByIx.get(a.intersection_id) ?? [];
      list.push(a);
      assetByIx.set(a.intersection_id, list);
    }
    const shotCountByAsset = new Map<string, number>();
    for (const s of shots as ReferenceImage[]) {
      shotCountByAsset.set(s.asset_id, (shotCountByAsset.get(s.asset_id) ?? 0) + 1);
    }
    const shotByIx = new Map<string, number>();
    for (const a of assets) {
      const c = shotCountByAsset.get(a.asset_id) ?? 0;
      shotByIx.set(a.intersection_id, (shotByIx.get(a.intersection_id) ?? 0) + c);
    }
    setRows(
      intersections.map((i) => ({
        intersection: i,
        assetCount: assetByIx.get(i.intersection_id)?.length ?? 0,
        shotCount: shotByIx.get(i.intersection_id) ?? 0,
      })),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
    }, [load]),
  );

  // Sort applied here so user can flip modes without a fresh fetch.
  const sortedRows = useMemo(() => {
    const out = [...rows];
    switch (sortMode) {
      case 'date-desc':
        out.sort((a, b) => b.intersection.created_at.localeCompare(a.intersection.created_at));
        break;
      case 'date-asc':
        out.sort((a, b) => a.intersection.created_at.localeCompare(b.intersection.created_at));
        break;
      case 'az':
        out.sort((a, b) =>
          a.intersection.intersection_id.localeCompare(b.intersection.intersection_id),
        );
        break;
      case 'za':
        out.sort((a, b) =>
          b.intersection.intersection_id.localeCompare(a.intersection.intersection_id),
        );
        break;
    }
    return out;
  }, [rows, sortMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const openNew = useCallback(async () => {
    const s = await settings.get();
    const id = suggestIntersectionId(s.nextIntersectionCounter, s.intersectionIdPrefix, s.projectId);
    setForm({ id, intersection_name: '' });
    setEditingId(null);
    setAdding(true);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const openEdit = useCallback((r: Row) => {
    setForm({
      id: r.intersection.intersection_id,
      intersection_name: r.intersection.intersection_name ?? '',
    });
    setEditingId(r.intersection.intersection_id);
    setAdding(true);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const cancelForm = useCallback(() => {
    setAdding(false);
    setEditingId(null);
    setForm({ id: '', intersection_name: '' });
  }, []);

  const save = useCallback(async () => {
    const id = form.id.trim();
    if (!id) return;
    const intersection_name = form.intersection_name.trim() || undefined;
    if (editingId) {
      const existing = await storage.getIntersections();
      const ix = existing.find((x) => x.intersection_id === editingId);
      if (!ix) {
        cancelForm();
        return;
      }
      const updated: Intersection = { ...ix, ...(intersection_name ? { intersection_name } : {}) };
      if (!intersection_name) delete updated.intersection_name;
      const others = existing.filter((x) => x.intersection_id !== editingId);
      await storage.setIntersections([...others, updated]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      cancelForm();
      await load();
      return;
    }
    await storage.addIntersection({
      intersection_id: id,
      ...(intersection_name ? { intersection_name } : {}),
      created_at: new Date().toISOString(),
    } as Intersection);
    const s = await settings.get();
    await settings.update({ nextIntersectionCounter: s.nextIntersectionCounter + 1 });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    cancelForm();
    await load();
  }, [form, editingId, cancelForm, load]);

  const deleteKavsak = useCallback(
    (r: Row) => {
      confirm({
        title: 'Kavşak Sil',
        message: `"${r.intersection.intersection_id}" ve ${r.assetCount} asset + ${r.shotCount} foto silinsin mi?`,
        destructive: true,
        confirmText: 'Sil',
      }).then(async (ok) => {
        if (!ok) return;
        const allAssets = await storage.getAssets();
        const targets = allAssets.filter(
          (a) => a.intersection_id === r.intersection.intersection_id,
        );
        for (const a of targets) {
          await storage.removeAsset(a.asset_id);
        }
        const allIx = await storage.getIntersections();
        await storage.setIntersections(
          allIx.filter((x) => x.intersection_id !== r.intersection.intersection_id),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        await load();
      });
    },
    [confirm, load],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlatList
          data={sortedRows}
          keyExtractor={(r) => r.intersection.intersection_id}
          contentContainerStyle={
            rows.length === 0 ? styles.emptyWrap : { paddingBottom: 12 }
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />
          }
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <View style={styles.heroRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTitle}>Kavşaklar</Text>
                  <Text style={styles.heroSub}>{rows.length} kavşak</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.sortBtn, pressed && styles.pressed]}
                  onPress={() => {
                    setSortMenuOpen(true);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  hitSlop={6}
                >
                  <Text style={styles.sortBtnLabel}>{SORT_LABEL[sortMode]}</Text>
                  <Text style={styles.sortBtnChevron}>▾</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  onPress={() => router.push('/ayarlar')}
                  hitSlop={6}
                >
                  <Text style={styles.iconBtnText}>⚙︎</Text>
                </Pressable>
              </View>
              <Pressable
                style={({ pressed }) => [styles.mapCard, pressed && styles.pressed]}
                onPress={() => router.push('/harita')}
              >
                <Text style={styles.mapEmoji}>🗺️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mapTitle}>Tüm Konumları Haritada Gör</Text>
                  <Text style={styles.mapSub}>Asset pinleri — tıkla → detay</Text>
                </View>
                <Text style={styles.mapChevron}>›</Text>
              </Pressable>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🛣️</Text>
              <Text style={styles.emptyTitle}>Henüz kavşak yok</Text>
              <Text style={styles.emptyBody}>
                Aşağıdan "+ Yeni Kavşak Ekle" ile başla.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() =>
                  router.push({
                    pathname: '/asset',
                    params: { intersection_id: item.intersection.intersection_id },
                  })
                }
              >
                <Text style={styles.rowTitle}>{item.intersection.intersection_id}</Text>
                {item.intersection.intersection_name && (
                  <Text style={styles.rowSubtitle}>{item.intersection.intersection_name}</Text>
                )}
                <Text style={styles.rowMeta}>
                  {item.assetCount} asset · {item.shotCount} foto
                </Text>
              </Pressable>
              <View style={styles.rowActions}>
                <Pressable
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  onPress={() => openEdit(item)}
                  hitSlop={6}
                >
                  <Text style={styles.iconBtnText}>✎</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  onPress={() => deleteKavsak(item)}
                  hitSlop={6}
                >
                  <Text style={[styles.iconBtnText, { color: t.danger }]}>×</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListFooterComponent={
            adding ? (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>
                  {editingId ? 'Kavşak Düzenle' : 'Yeni Kavşak'}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="intersection_id"
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!editingId}
                  value={form.id}
                  onChangeText={(v) => setForm((f) => ({ ...f, id: v }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="intersection_name (örn. Gelişyolu Kavşağı)"
                  placeholderTextColor={t.textMuted}
                  value={form.intersection_name}
                  onChangeText={(v) => setForm((f) => ({ ...f, intersection_name: v }))}
                />
                <View style={styles.row2}>
                  <Pressable
                    style={({ pressed }) => [styles.btnSmall, styles.btnPrimary, pressed && styles.pressed]}
                    onPress={save}
                  >
                    <Text style={styles.btnText}>Kaydet</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.btnSmall, styles.btnSecondary, pressed && styles.pressed]}
                    onPress={cancelForm}
                  >
                    <Text style={styles.btnText}>İptal</Text>
                  </Pressable>
                </View>
              </View>
            ) : null
          }
        />

        <View style={styles.footer}>
          {!adding && (
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
              onPress={openNew}
            >
              <Text style={styles.btnText}>+ Yeni Kavşak Ekle</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.btn,
              styles.btnSecondary,
              styles.btnTopMargin,
              pressed && styles.pressed,
            ]}
            onPress={() => router.push('/disa_aktar')}
          >
            <Text style={styles.btnText}>Dışa Aktar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSortMenuOpen(false)}>
          <Pressable style={styles.sortMenuCard} onPress={() => {}}>
            <Text style={styles.sortMenuTitle}>Sıralama</Text>
            {SORT_ORDER.map((m) => (
              <Pressable
                key={m}
                style={[styles.sortMenuRow, sortMode === m && styles.sortMenuRowActive]}
                onPress={() => {
                  setSortMode(m);
                  setSortMenuOpen(false);
                  Haptics.selectionAsync().catch(() => {});
                }}
              >
                <Text
                  style={[
                    styles.sortMenuRowText,
                    sortMode === m && styles.sortMenuRowTextActive,
                  ]}
                >
                  {SORT_LABEL[m]}
                </Text>
                {sortMode === m ? <Text style={styles.sortMenuCheck}>✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
    },
    heroTitle: { fontSize: t.type.hero, fontWeight: '800', color: t.text },
    heroSub: { fontSize: t.type.body, color: t.textMuted, marginTop: 2 },
    iconBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    iconBtnText: { fontSize: t.type.icon, fontWeight: '700', color: t.text },
    sortBar: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.chipBg,
    },
    sortBtnLabel: { color: t.text, fontSize: t.type.caption, fontWeight: '700' },
    sortBtnChevron: { color: t.textMuted, fontSize: t.type.caption, fontWeight: '700' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'center',
    },
    sortMenuCard: {
      backgroundColor: t.cardElevated,
      marginHorizontal: 32,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      paddingVertical: 8,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 6,
    },
    sortMenuTitle: {
      fontSize: t.type.caption,
      fontWeight: '700',
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    sortMenuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 14,
      minHeight: 48,
    },
    sortMenuRowActive: { backgroundColor: t.chipBg },
    sortMenuRowText: { color: t.text, fontSize: t.type.body, fontWeight: '500' },
    sortMenuRowTextActive: { color: t.primary, fontWeight: '700' },
    sortMenuCheck: { color: t.primary, fontSize: t.type.body, fontWeight: '900' },
    mapCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.card,
      marginHorizontal: 12,
      marginTop: 6,
      marginBottom: 6,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.primary,
      gap: 12,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4,
      shadowRadius: 4,
      elevation: 2,
    },
    mapEmoji: { fontSize: 32 },
    mapTitle: { fontSize: t.type.body, fontWeight: '700', color: t.text },
    mapSub: { fontSize: t.type.caption, color: t.textMuted, marginTop: 2 },
    mapChevron: { fontSize: 32, color: t.primary, fontWeight: '300' },
    row: {
      backgroundColor: t.card,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginVertical: 6,
      marginHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      flexDirection: 'row',
      alignItems: 'center',
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.4,
      shadowRadius: 3,
      elevation: 1,
    },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: t.type.title, fontWeight: '700', color: t.text },
    rowSubtitle: { fontSize: t.type.caption, color: t.textMuted, marginTop: 1, fontStyle: 'italic' },
    rowMeta: { fontSize: t.type.caption, color: t.textMuted, marginTop: 2 },
    rowActions: { flexDirection: 'row', gap: 6, paddingRight: 4 },
    emptyWrap: { flexGrow: 1, justifyContent: 'center' },
    empty: { alignItems: 'center', padding: 24 },
    emptyEmoji: { fontSize: 64, marginBottom: 8 },
    emptyTitle: { fontSize: t.type.title, fontWeight: '700', color: t.text, marginBottom: 6 },
    emptyBody: { fontSize: t.type.body, color: t.textMuted, textAlign: 'center', lineHeight: 22 },
    footer: { padding: 12, backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.border },
    formCard: {
      backgroundColor: t.card,
      padding: 14,
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      gap: 10,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    formTitle: { fontSize: t.type.title - 2, fontWeight: '700', color: t.text },
    btn: {
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 54,
      justifyContent: 'center',
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 3,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnSecondary: { backgroundColor: t.primaryAlt },
    btnTopMargin: { marginTop: 10 },
    btnSmall: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 10,
      alignItems: 'center',
      minHeight: 50,
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    row2: { flexDirection: 'row', gap: 8 },
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
  });
}
