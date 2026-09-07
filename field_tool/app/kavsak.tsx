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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { storage } from '@/lib/storage';
import { settings, suggestIntersectionId } from '@/lib/settings';
import { AppHeader } from '@/components/AppHeader';
import { Card } from '@/components/Surface';
import { ProgressBar } from '@/components/ProgressBar';
import { IconSymbol } from '@/components/StatTile';
import { useThemedAlert } from '@/components/Alert';
import type { Asset, AssetType, Intersection, ReferenceImage } from '@/types/domain';
import { useTheme } from '@/lib/theme';

type SortMode = 'date-desc' | 'date-asc' | 'az' | 'za';

const SORT_LABEL: Record<SortMode, string> = {
  'date-desc': 'Tarih ↓',
  'date-asc': 'Tarih ↑',
  az: 'A-Z',
  za: 'Z-A',
};
const SORT_ORDER: SortMode[] = ['date-desc', 'date-asc', 'az', 'za'];

const TYPE_LABEL: Record<AssetType, string> = {
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};
const TYPE_DOT: Record<AssetType, 'signal' | 'cabinet' | 'busStop'> = {
  traffic_signal: 'signal',
  cabinet: 'cabinet',
  bus_stop: 'busStop',
};

// Ideal shots per asset — drives the completion percentage.
// ponytail: hard-coded 16 — covers the 4 angles × 2 lights × 2 postures start
// set without forcing a separate settings round-trip.
const SHOTS_PER_ASSET_TARGET = 16;

interface RowState {
  intersection: Intersection;
  assetCount: number;
  typeCounts: Record<AssetType, number>;
  shotCount: number;
  perAssetShots: number[];
  completed: boolean; // every asset has ≥1 shot
}

export default function KavsakScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = makeStyles(t);
  const { confirm } = useThemedAlert();
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date-desc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    const shotCountByAsset = new Map<string, number>();
    for (const s of shots as ReferenceImage[]) {
      shotCountByAsset.set(s.asset_id, (shotCountByAsset.get(s.asset_id) ?? 0) + 1);
    }
    const assetsByIx = new Map<string, Asset[]>();
    for (const a of assets) {
      const list = assetsByIx.get(a.intersection_id) ?? [];
      list.push(a);
      assetsByIx.set(a.intersection_id, list);
    }
    setRows(
      intersections.map((i) => {
        const a = assetsByIx.get(i.intersection_id) ?? [];
        const typeCounts: Record<AssetType, number> = {
          traffic_signal: 0,
          cabinet: 0,
          bus_stop: 0,
        };
        const perAssetShots: number[] = [];
        let shotCount = 0;
        for (const x of a) {
          typeCounts[x.type] += 1;
          const c = shotCountByAsset.get(x.asset_id) ?? 0;
          perAssetShots.push(c);
          shotCount += c;
        }
        const completed = a.length > 0 && perAssetShots.every((c) => c >= 1);
        return {
          intersection: i,
          assetCount: a.length,
          typeCounts,
          shotCount,
          perAssetShots,
          completed,
        };
      }),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
    }, [load]),
  );

  // Summary counts — used by per-row progress.
  const counts = useMemo(() => {
    let all = 0;
    let completed = 0;
    for (const r of rows) {
      all += 1;
      if (r.completed) completed += 1;
    }
    return { all, completed };
  }, [rows]);
  void counts;

  const visibleRows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    let out = rows;
    if (q) {
      out = out.filter((r) => {
        const id = r.intersection.intersection_id.toLocaleLowerCase('tr');
        const name = (r.intersection.intersection_name ?? '').toLocaleLowerCase('tr');
        return id.includes(q) || name.includes(q);
      });
    }
    const arr = [...out];
    switch (sortMode) {
      case 'date-desc':
        arr.sort((a, b) => b.intersection.created_at.localeCompare(a.intersection.created_at));
        break;
      case 'date-asc':
        arr.sort((a, b) => a.intersection.created_at.localeCompare(b.intersection.created_at));
        break;
      case 'az':
        arr.sort((a, b) =>
          a.intersection.intersection_id.localeCompare(b.intersection.intersection_id),
        );
        break;
      case 'za':
        arr.sort((a, b) =>
          b.intersection.intersection_id.localeCompare(a.intersection.intersection_id),
        );
        break;
    }
    return arr;
  }, [rows, query, sortMode]);

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
    const id = suggestIntersectionId(
      s.nextIntersectionCounter,
      s.intersectionIdPrefix,
      s.projectId,
    );
    setForm({ id, intersection_name: '' });
    setEditingId(null);
    setAdding(true);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const openEdit = useCallback((r: RowState) => {
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
      const ix = await storage.getIntersection(editingId);
      if (!ix) {
        cancelForm();
        return;
      }
      const updated: Intersection = { ...ix, ...(intersection_name ? { intersection_name } : {}) };
      if (!intersection_name) delete updated.intersection_name;
      await storage.updateIntersection(updated);
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
    (r: RowState) => {
      confirm({
        title: 'Kavşak Sil',
        message: `"${r.intersection.intersection_id}" ve ${r.assetCount} asset + ${r.shotCount} foto silinsin mi?`,
        destructive: true,
        confirmText: 'Sil',
      }).then(async (ok) => {
        if (!ok) return;
        const targets = await storage.getAssetsByIntersection(r.intersection.intersection_id);
        for (const a of targets) {
          await storage.removeAsset(a);
        }
        await storage.removeIntersection(r.intersection.intersection_id);
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
          data={visibleRows}
          keyExtractor={(r) => r.intersection.intersection_id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />
          }
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              {/* Search */}
              <View style={styles.searchBox}>
                <IconSymbol
                  name="search"
                  size={22}
                  color={t.textMuted}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Kavşak ID veya adı ile ara…"
                  placeholderTextColor={t.textMuted}
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>

              {/* Sort toolbar */}
              <View style={styles.toolbarRow}>
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
              </View>

              {/* Add-new shortcut row — kept compact; primary entry stays the bottom sticky button. */}
              <Pressable
                style={({ pressed }) => [styles.addShortcut, pressed && styles.pressed]}
                onPress={openNew}
                accessibilityLabel="Yeni Kavşak Ekle"
              >
                <IconSymbol name="add_circle" size={20} color={t.primary} />
                <Text style={styles.addShortcutText}>Yeni Kavşak Ekle</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            visibleRows.length === 0 && rows.length > 0 ? (
              <View style={styles.emptyInline}>
                <IconSymbol name="search_off" size={28} color={t.primary} />
                <Text style={styles.emptyTitle}>Eşleşen kavşak yok</Text>
                <Text style={styles.emptyBody}>Aramayı değiştir.</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Card padded style={styles.row}>
              <Pressable
                style={styles.cardMain}
                onPress={() =>
                  router.push({
                    pathname: '/asset',
                    params: {
                      intersection_id: item.intersection.intersection_id,
                    },
                  })
                }
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.idMono}>
                    {item.intersection.intersection_id}
                  </Text>
                  <View style={styles.assetPill}>
                    <Text style={styles.assetPillText}>
                      {item.assetCount} Asset
                    </Text>
                  </View>
                </View>
                {item.intersection.intersection_name ? (
                  <Text style={styles.title}>
                    {item.intersection.intersection_name}
                  </Text>
                ) : null}
                <View style={styles.typesRow}>
                  {(['traffic_signal', 'cabinet', 'bus_stop'] as AssetType[]).map(
                    (ty) => (
                      <View key={ty} style={styles.typeItem}>
                        <View
                          style={[
                            styles.typeDot,
                            { backgroundColor: t[TYPE_DOT[ty]] },
                          ]}
                        />
                        <Text style={styles.typeLabel}>
                          {item.typeCounts[ty]} {TYPE_LABEL[ty]}
                        </Text>
                      </View>
                    ),
                  )}
                </View>
                <ProgressRow row={item} />
              </Pressable>
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => openEdit(item)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
                >
                  <IconSymbol name="edit" size={18} color={t.text} />
                </Pressable>
                <Pressable
                  onPress={() => deleteKavsak(item)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
                >
                  <IconSymbol name="delete" size={18} color={t.danger} />
                </Pressable>
              </View>
            </Card>
          )}
        />

        {/* Bottom — sticky CTA + empty helper card. Replaced by inline form when adding. */}
        {adding ? (
          <Modal visible animationType="slide" transparent onRequestClose={cancelForm}>
            <KeyboardAvoidingView
              style={styles.formBackdrop}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
            >
              <View style={[styles.formSheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>
                    {editingId ? 'Kavşak Düzenle' : 'Yeni Kavşak'}
                  </Text>
                  <Pressable
                    onPress={cancelForm}
                    hitSlop={10}
                    style={({ pressed }) => [styles.formClose, pressed && styles.pressed]}
                  >
                    <IconSymbol name="close" size={22} color={t.text} />
                  </Pressable>
                </View>
                <TextInput
                  style={[styles.input, editingId && styles.inputDisabled]}
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
                <View style={styles.formBtnRow}>
                  <Pressable
                    style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
                    onPress={save}
                  >
                    <Text style={styles.btnText}>Kaydet</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
                    onPress={cancelForm}
                  >
                    <Text style={styles.btnText}>İptal</Text>
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        ) : (
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.stickyBtn, pressed && { opacity: 0.85 }]}
              onPress={openNew}
            >
              <IconSymbol name="add" size={22} color={t.textInverse} />
              <Text style={styles.stickyBtnText}>Yeni Kavşak Ekle</Text>
            </Pressable>
          </View>
        )}
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
                {sortMode === m ? (
                  <IconSymbol name="check" size={20} color={t.primary} />
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ProgressRow({ row }: { row: RowState }) {
  const t = useTheme();
  const styles = progressStyles(t);
  const target = row.assetCount * SHOTS_PER_ASSET_TARGET;
  const pct = target === 0 ? 0 : Math.min(100, Math.round((row.shotCount / target) * 100));

  if (row.assetCount === 0) {
    return (
      <View style={styles.headerRow}>
        <Text style={styles.muted}>Asset ekleyince ilerleme görünecek.</Text>
      </View>
    );
  }

  if (pct >= 100) {
    return (
      <View style={styles.completeRow}>
        <View style={styles.completeBadge}>
          <IconSymbol name="check_circle" size={18} color={t.primary} />
          <Text style={styles.completeBadgeText}>%100 Tamamlandı</Text>
        </View>
        <View style={styles.syncRow}>
          <IconSymbol name="cloud_done" size={16} color={t.tertiary} />
          <Text style={styles.syncText}>Senkronize</Text>
        </View>
      </View>
    );
  }

  if (pct < 50) {
    return (
      <View>
        <View style={styles.headerRow}>
          <View style={styles.warnLabelBox}>
            <IconSymbol name="warning" size={16} color={t.warn} />
            <Text style={styles.warnLabel}>%{pct} Çekim (Eksik açılar)</Text>
          </View>
          <Text style={styles.counts}>
            {row.shotCount} / {target} foto
          </Text>
        </View>
        <ProgressBar value={pct} tone="warning" height={6} />
      </View>
    );
  }

  return (
    <ProgressBar
      value={pct}
      label={`%${pct} Çekim Tamamlandı`}
      caption={`${row.shotCount} / ${target} foto`}
      tone="primary"
      height={6}
    />
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerWrap: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.cardLowest,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 14,
      minHeight: 48,
    },
    searchIcon: { marginRight: 10 },
    searchInput: {
      flex: 1,
      fontSize: t.type.bodyMd,
      color: t.text,
      paddingVertical: 0,
    },
    toolbarRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    addShortcut: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: t.chipBg,
      borderWidth: 1,
      borderColor: t.border,
    },
    addShortcutText: {
      fontSize: t.type.labelLg,
      fontWeight: '700',
      color: t.primary,
    },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.cardLowest,
    },
    sortBtnLabel: { color: t.text, fontSize: 11, fontWeight: '700' },
    sortBtnChevron: { color: t.textMuted, fontSize: 11, fontWeight: '700' },
    emptyInline: { alignItems: 'center', padding: 24, gap: 6 },
    emptyTitle: { fontSize: t.type.headlineSm, fontWeight: '700', color: t.text },
    emptyBody: {
      fontSize: t.type.bodySm,
      color: t.textMuted,
      textAlign: 'center',
    },
    row: { marginVertical: 6 },
    cardMain: { flex: 1, gap: 8 },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    idMono: {
      fontSize: t.type.dataMonoLg,
      fontWeight: '700',
      color: t.primary,
      fontFamily: 'monospace',
      letterSpacing: -0.5,
      flexShrink: 1,
    },
    assetPill: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 9999,
      backgroundColor: t.cardHighest,
    },
    assetPillText: { fontSize: 11, fontWeight: '700', color: t.text },
    title: { fontSize: t.type.titleMd, fontWeight: '600', color: t.text },
    typesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: t.chipBg,
      borderRadius: 8,
    },
    typeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    typeDot: { width: 8, height: 8, borderRadius: 4 },
    typeLabel: { fontSize: t.type.labelMd, fontWeight: '600', color: t.text },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 6,
      marginTop: 8,
    },
    actionBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.chipBg,
      borderWidth: 1,
      borderColor: t.border,
    },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    footer: { padding: 12, gap: 12, backgroundColor: t.bg },
    emptyHint: {
      backgroundColor: t.chipBg,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      gap: 6,
    },
    emptyHintIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.cardHighest,
    },
    emptyHintTitle: {
      fontSize: t.type.headlineSm,
      fontWeight: '600',
      color: t.text,
    },
    emptyHintBody: {
      fontSize: t.type.bodySm,
      color: t.textMuted,
      textAlign: 'center',
      maxWidth: 280,
    },
    emptyHintLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
    },
    emptyHintLinkText: {
      fontSize: t.type.labelLg,
      fontWeight: '600',
      color: t.primary,
    },
    stickyBtn: {
      height: 50,
      borderRadius: 12,
      backgroundColor: t.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 6,
    },
    stickyBtnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.labelLg },
    formWrap: {
      padding: 12,
      backgroundColor: t.cardLowest,
      borderTopWidth: 1,
      borderTopColor: t.border,
      gap: 8,
    },
    formBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.overlay,
    },
    formSheet: {
      backgroundColor: t.cardLowest,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 16,
      gap: 12,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowOffset: { width: 0, height: -4 },
      shadowRadius: 12,
      elevation: 8,
    },
    formHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    formTitle: { fontSize: t.type.titleMd, fontWeight: '700', color: t.text },
    formClose: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.chipBg,
      borderWidth: 1,
      borderColor: t.border,
    },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: t.type.bodyMd,
      color: t.text,
      backgroundColor: t.chipBg,
    },
    inputDisabled: { opacity: 0.6, fontFamily: 'monospace' },
    formBtnRow: { flexDirection: 'row', gap: 8 },
    btn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      minHeight: 50,
      justifyContent: 'center',
    },
    btnPrimary: { backgroundColor: t.primary },
    btnSecondary: { backgroundColor: t.primaryAlt },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.labelLg },
    modalBackdrop: { flex: 1, backgroundColor: t.overlay, justifyContent: 'center' },
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
      fontSize: 11,
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
    sortMenuRowText: { color: t.text, fontSize: t.type.bodyMd, fontWeight: '500' },
    sortMenuRowTextActive: { color: t.primary, fontWeight: '700' },
  });
}

function progressStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    muted: { fontSize: 11, color: t.textMuted },
    warnLabelBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    warnLabel: { fontSize: 11, fontWeight: '600', color: t.danger },
    counts: { fontSize: 11, color: t.textMuted, fontFamily: 'monospace' },
    completeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    completeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 9999,
      backgroundColor: t.tertiaryContainer,
    },
    completeBadgeText: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.primary,
    },
    syncRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    syncText: { fontSize: 11, color: t.tertiary, fontWeight: '600' },
  });
}
