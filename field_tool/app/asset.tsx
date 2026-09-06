import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { storage } from '@/lib/storage';
import { medianPosition } from '@/lib/geo';
import {
  ASSET_TYPE_CODE,
  ASSET_TYPE_EMOJI,
  CABINET_SUBTYPES,
  CABINET_SUBTYPE_LABEL,
  nextCounterKey,
  settings,
  suggestAssetId,
} from '@/lib/settings';
import { slugifyAssetId } from '@/lib/text';
import { deletePhoto } from '@/lib/filesystem';
import { useThemedAlert } from '@/components/Alert';
import { Card, SectionCard } from '@/components/Surface';
import { Chip, ChipRow } from '@/components/Chip';
import { IconSymbol } from '@/components/StatTile';
import { Segmented } from '@/components/Segmented';
import type { Asset, AssetType } from '@/types/domain';
import { useTheme } from '@/lib/theme';

const TYPES: AssetType[] = ['traffic_signal', 'cabinet', 'bus_stop'];

const TYPE_LABEL: Record<AssetType, string> = {
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};

const TYPE_ACCENT: Record<AssetType, string> = {
  traffic_signal: 'signal', // pulled from theme below
  cabinet: 'cabinet',
  bus_stop: 'busStop',
};

type FilterType = 'all' | AssetType;
type SortMode = 'date-desc' | 'date-asc' | 'az' | 'za';
const SORT_LABEL: Record<SortMode, string> = {
  'date-desc': 'Tarih ↓',
  'date-asc': 'Tarih ↑',
  az: 'A-Z',
  za: 'Z-A',
};
const SORT_ORDER: SortMode[] = ['date-desc', 'date-asc', 'az', 'za'];

const FILTER_LABEL: Record<FilterType, string> = {
  all: 'Tümü',
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};
const FILTER_OPTIONS: FilterType[] = ['all', 'traffic_signal', 'cabinet', 'bus_stop'];

interface FormState {
  asset_id: string;
  type: AssetType;
  signal_group_id: string;
  cabinet_subtype: string;
  durak_kodu: string;
  description: string;
  lat?: number;
  lon?: number;
}

export default function AssetScreen() {
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(t);
  const { confirm, alert } = useThemedAlert();
  const { intersection_id } = useLocalSearchParams<{ intersection_id: string }>();
  const ixId = String(intersection_id ?? '');

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    asset_id: '',
    type: 'traffic_signal',
    signal_group_id: '',
    cabinet_subtype: '',
    durak_kodu: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [gpsRefreshing, setGpsRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [shotsByAsset, setShotsByAsset] = useState<Record<string, number>>({});
  const [menuAsset, setMenuAsset] = useState<Asset | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('date-desc');
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const openFilterModal = useCallback(() => setFilterModalOpen(true), []);
  const closeFilterModal = useCallback(() => setFilterModalOpen(false), []);
  const chooseFilter = useCallback(
    (f: FilterType) => {
      setFilter(f);
      Haptics.selectionAsync().catch(() => {});
      setFilterModalOpen(false);
    },
    [],
  );

  const load = useCallback(async () => {
    const [all, shots] = await Promise.all([
      storage.getAssetsByIntersection(ixId),
      storage.getShots(),
    ]);
    setAssets(all);
    const counts: Record<string, number> = {};
    for (const s of shots) {
      counts[s.asset_id] = (counts[s.asset_id] ?? 0) + 1;
    }
    setShotsByAsset(counts);
  }, [ixId]);

  useEffect(() => {
    if (!ixId) return;
    load().finally(() => setLoading(false));
  }, [ixId, load]);

  // Counts per type — drives filter chips.
  const counts = useMemo(() => {
    const c: Record<AssetType, number> = {
      traffic_signal: 0,
      cabinet: 0,
      bus_stop: 0,
    };
    for (const a of assets) c[a.type]++;
    return c;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = assets.filter((a) => {
      if (filter !== 'all' && a.type !== filter) return false;
      if (!q) return true;
      const hay =
        a.asset_id +
        ' ' +
        (a.signal_group_id ?? '') +
        ' ' +
        (a.cabinet_subtype ?? '') +
        ' ' +
        (CABINET_SUBTYPE_LABEL as Record<string, string>)[a.cabinet_subtype ?? ''] +
        ' ' +
        (a.durak_kodu ?? '') +
        ' ' +
        (a.description ?? '');
      return hay.toLowerCase().includes(q);
    });
    const out = [...matched];
    switch (sortMode) {
      case 'date-desc':
        out.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case 'date-asc':
        out.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'az':
        out.sort((a, b) => a.asset_id.localeCompare(b.asset_id));
        break;
      case 'za':
        out.sort((a, b) => b.asset_id.localeCompare(a.asset_id));
        break;
    }
    return out;
  }, [assets, filter, query, sortMode]);

  const cycleSort = useCallback(() => {
    setSortMode((m) => SORT_ORDER[(SORT_ORDER.indexOf(m) + 1) % SORT_ORDER.length]);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const openNew = useCallback(async () => {
    const s = await settings.get();
    const ck = nextCounterKey(s.defaultType);
    const suggested = suggestAssetId(ixId, ASSET_TYPE_CODE[s.defaultType], s[ck]);
    setForm({
      asset_id: suggested,
      type: s.defaultType,
      signal_group_id: '',
      cabinet_subtype: '',
      durak_kodu: '',
      description: '',
    });
    setEditingId(null);
    setAdding(true);
    Haptics.selectionAsync().catch(() => {});
  }, [ixId]);

  const openEdit = useCallback((a: Asset) => {
    setForm({
      asset_id: a.asset_id,
      type: a.type,
      signal_group_id: a.signal_group_id ?? '',
      cabinet_subtype: a.cabinet_subtype ?? '',
      durak_kodu: a.durak_kodu ?? '',
      description: a.description ?? '',
      lat: a.lat,
      lon: a.lon,
    });
    setEditingId(a.asset_id);
    setAdding(true);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const cancelForm = useCallback(() => {
    setAdding(false);
    setEditingId(null);
    setForm({
      asset_id: '',
      type: 'traffic_signal',
      signal_group_id: '',
      cabinet_subtype: '',
      durak_kodu: '',
      description: '',
    });
  }, []);

  const refreshGps = useCallback(async () => {
    setGpsRefreshing(true);
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await medianPosition();
      if (!r) {
        await alert({ title: 'GPS Hatası', message: 'Konum alınamadı. GPS açık mı?' });
        return;
      }
      setForm((f) => ({ ...f, lat: r.lat, lon: r.lon }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      setGpsRefreshing(false);
    }
  }, [alert]);

  const saveNew = useCallback(async () => {
    const id = form.asset_id.trim();
    if (!id) {
      await alert({ title: 'Eksik', message: 'asset_id giriniz.' });
      return;
    }
    if (!ixId) return;
    setSaving(true);
    try {
      const reading = await medianPosition();
      if (!reading) {
        await alert({ title: 'GPS Hatası', message: 'Konum alınamadı. GPS açık mı? Asset kaydedilmedi.' });
        return;
      }
      const a: Asset = {
        intersection_id: ixId,
        asset_id: id,
        type: form.type,
        lat: reading.lat,
        lon: reading.lon,
        created_at: new Date().toISOString(),
      };
      if (form.type === 'traffic_signal') {
        a.signal_group_id = slugifyAssetId(form.signal_group_id.trim()) || null;
      }
      if (form.type === 'cabinet') {
        const sub = form.cabinet_subtype.trim();
        a.cabinet_subtype = (CABINET_SUBTYPES as readonly string[]).includes(sub) ? sub : null;
      }
      if (form.type === 'bus_stop') {
        a.durak_kodu = slugifyAssetId(form.durak_kodu.trim()) || null;
      }
      if (form.description.trim()) {
        a.description = form.description.trim();
      }
      await storage.addAsset(a);

      if (!editingId) {
        const ck = nextCounterKey(form.type);
        const s = await settings.get();
        await settings.update({ [ck]: s[ck] + 1 } as Partial<typeof s>);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      cancelForm();
      await load();
    } finally {
      setSaving(false);
    }
  }, [form, ixId, load, editingId, cancelForm, alert]);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const existing = assets.find((a) => a.asset_id === editingId);
    if (!existing) return;
    const updated: Asset = {
      ...existing,
      type: form.type,
    };
    if (form.lat !== undefined && form.lon !== undefined) {
      updated.lat = form.lat;
      updated.lon = form.lon;
    }
    if (form.type === 'traffic_signal') {
      updated.signal_group_id = slugifyAssetId(form.signal_group_id.trim()) || null;
      delete updated.cabinet_subtype;
      delete updated.durak_kodu;
    } else if (form.type === 'cabinet') {
      const sub = form.cabinet_subtype.trim();
      updated.cabinet_subtype = (CABINET_SUBTYPES as readonly string[]).includes(sub) ? sub : null;
      delete updated.signal_group_id;
      delete updated.durak_kodu;
    } else if (form.type === 'bus_stop') {
      updated.durak_kodu = slugifyAssetId(form.durak_kodu.trim()) || null;
      delete updated.signal_group_id;
      delete updated.cabinet_subtype;
    }
    if (form.description.trim()) {
      updated.description = form.description.trim();
    } else {
      delete updated.description;
    }
    await storage.updateAsset(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    cancelForm();
    await load();
  }, [form, editingId, assets, cancelForm, load]);

  const deleteAsset = useCallback(
    (a: Asset) => {
      confirm({
        title: 'Asset Sil',
        message: `"${a.asset_id}" ve tüm fotoğrafları silinsin mi? Bu geri alınamaz.`,
        destructive: true,
        confirmText: 'Sil',
      }).then(async (ok) => {
        if (!ok) return;
        const shots = await storage.getShotsByAsset(a.asset_id);
        await Promise.all(
          shots.map((s) => deletePhoto(a.intersection_id, a.asset_id, s.file_index)),
        );
        await storage.removeAsset(a.asset_id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        await load();
      });
    },
    [confirm, load],
  );

  const goCapture = useCallback(
    (a: Asset) => {
      router.push({
        pathname: '/cekim',
        params: { intersection_id: ixId, asset_id: a.asset_id },
      });
    },
    [router, ixId],
  );

  const openAssetMenu = useCallback((a: Asset) => {
    setMenuAsset(a);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const closeAssetMenu = useCallback(() => setMenuAsset(null), []);

  if (!ixId) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.warn}>intersection_id eksik.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Breadcrumb (app shell owns the Stack header; this anchors the screen). */}
      <View style={styles.crumbs}>
        <IconSymbol name="chevron_right" size={14} color={t.textMuted} />
        <Text style={styles.crumbsLabel}>Kavşak</Text>
        <IconSymbol name="chevron_right" size={14} color={t.textMuted} />
        <Text style={styles.crumbsId} numberOfLines={1}>{ixId}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlatList
          data={filteredAssets}
          keyExtractor={(a) => a.asset_id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 112 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.headerStack}>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.search, styles.searchInput]}
                  placeholder="asset ara…"
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={query}
                  onChangeText={setQuery}
                />
                <Pressable
                  style={({ pressed }) => [styles.filterBtn, pressed && { opacity: 0.85 }]}
                  onPress={openFilterModal}
                  hitSlop={6}
                  accessibilityLabel="Filtre"
                  accessibilityRole="button"
                >
                  <IconSymbol name="filter_alt" size={18} color={t.onPrimaryContainer} />
                  <Text style={styles.filterBtnText}>{FILTER_LABEL[filter]}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.sortBtn, pressed && { opacity: 0.6 }]}
                  onPress={cycleSort}
                  hitSlop={6}
                  accessibilityLabel="Sıralama"
                >
                  <Text style={styles.sortBtnLabel}>{SORT_LABEL[sortMode]}</Text>
                  <IconSymbol name="swap_vert" size={16} color={t.textMuted} />
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={t.primary} />
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>📍</Text>
                <Text style={styles.emptyTitle}>
                  {query || filter !== 'all' ? 'Eşleşen asset yok' : 'Bu kavşakta asset yok'}
                </Text>
                <Text style={styles.emptyBody}>
                  {query || filter !== 'all'
                    ? 'Arama veya filtreyi değiştir.'
                    : 'Aşağıdan "+ Yeni Asset" ile başla.'}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <AssetCard
              item={item}
              shotsCount={shotsByAsset[item.asset_id] ?? 0}
              onPress={() => goCapture(item)}
              onMenu={() => openAssetMenu(item)}
            />
          )}
        />

        <Modal
          visible={menuAsset !== null}
          transparent
          animationType="fade"
          onRequestClose={closeAssetMenu}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeAssetMenu}>
            <Pressable style={styles.menuCard} onPress={() => {}}>
              {menuAsset ? (
                <>
                  <Text style={styles.menuTitle} numberOfLines={1}>{menuAsset.asset_id}</Text>
                  <Text style={styles.menuSub}>{TYPE_LABEL[menuAsset.type]}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                    onPress={() => {
                      const a = menuAsset;
                      closeAssetMenu();
                      openEdit(a);
                    }}
                  >
                    <IconSymbol name="edit" size={20} color={t.text} />
                    <Text style={styles.menuRowText}>Düzenle</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.menuRow, styles.menuRowDanger, pressed && styles.pressed]}
                    onPress={() => {
                      const a = menuAsset;
                      closeAssetMenu();
                      deleteAsset(a);
                    }}
                  >
                    <IconSymbol name="delete" size={20} color={t.danger} />
                    <Text style={[styles.menuRowText, { color: t.danger }]}>Sil</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                    onPress={closeAssetMenu}
                  >
                    <Text style={[styles.menuRowText, { color: t.textMuted }]}>İptal</Text>
                  </Pressable>
                </>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Filter modal — Tümü / Sinyal / Pano / Durak radios */}
        <Modal
          visible={filterModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeFilterModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeFilterModal}>
            <Pressable
              style={[styles.modalSheet, { marginBottom: insets.bottom + 72, paddingBottom: 20 }]}
              onPress={() => {}}
            >
              <View style={styles.dragBar} />
              <Text style={styles.modalTitle}>Filtre</Text>
              <Text style={styles.modalSubtitle}>Listelemek istediğin asset tipini seç</Text>

              {FILTER_OPTIONS.map((opt) => {
                const active = opt === filter;
                const dotKey: AssetType | null = opt === 'all' ? null : opt;
                const dotColor = dotKey ? (t[TYPE_ACCENT[dotKey] as keyof typeof t] as string) : t.primaryContainer;
                const countKey = opt === 'all' ? 'all' : opt;
                const count =
                  opt === 'all' ? assets.length : counts[opt as AssetType];
                return (
                  <Pressable
                    key={opt}
                    onPress={() => chooseFilter(opt)}
                    style={({ pressed }) => [
                      styles.filterOption,
                      active && styles.filterOptionActive,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.filterOptionRadio, active && styles.filterOptionRadioActive]}>
                      {active ? <View style={styles.filterOptionRadioDot} /> : null}
                    </View>
                    {dotKey ? (
                      <View style={[styles.filterOptionDot, { backgroundColor: dotColor }]} />
                    ) : (
                      <View
                        style={[
                          styles.filterOptionDot,
                          { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.textMuted },
                        ]}
                      />
                    )}
                    <Text
                      style={[
                        styles.filterOptionLabel,
                        active && { fontWeight: '800', color: '#fff' },
                      ]}
                      numberOfLines={1}
                    >
                      {FILTER_LABEL[opt]}
                    </Text>
                    <View
                      style={[
                        styles.filterOptionCount,
                        active && { backgroundColor: 'rgba(255,255,255,0.25)' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterOptionCountText,
                          active && { color: '#fff' },
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>

        <View style={[styles.footer, { bottom: insets.bottom + 72 + 12 }]}>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            onPress={openNew}
          >
            <IconSymbol name="add" size={22} color={t.textInverse} />
            <Text style={styles.btnText}>Yeni Asset</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={adding}
        transparent
        animationType="fade"
        onRequestClose={cancelForm}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={cancelForm} />
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <SectionCard style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editingId ? 'Asset Düzenle' : 'Yeni Asset'}
                </Text>
                <Pressable
                  onPress={cancelForm}
                  hitSlop={10}
                  style={({ pressed }) => [styles.modalClose, pressed && { opacity: 0.5 }]}
                >
                  <IconSymbol name="close" size={22} color={t.text} />
                </Pressable>
              </View>

              <Text style={styles.subLabel}>asset_id</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                placeholder="asset_id"
                placeholderTextColor={t.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={false}
                value={form.asset_id}
              />
              <Text style={styles.help}>
                Otomatik üretilir; tip değişimi sayaç + öneki günceller.
              </Text>

              <Text style={[styles.subLabel, styles.subLabelTop]}>Tip</Text>
              <Segmented
                options={TYPES.map((tt) => ({ value: tt, label: TYPE_LABEL[tt] }))}
                value={form.type}
                onChange={async (tt) => {
                  if (!editingId) {
                    const s = await settings.get();
                    const ck = nextCounterKey(tt);
                    setForm((f) => ({
                      ...f,
                      type: tt,
                      asset_id: suggestAssetId(ixId, ASSET_TYPE_CODE[tt], s[ck]),
                    }));
                  } else {
                    setForm((f) => ({ ...f, type: tt }));
                  }
                  Haptics.selectionAsync().catch(() => {});
                }}
              />

              {form.type === 'traffic_signal' && (
                <>
                  <Text style={[styles.subLabel, styles.subLabelTop]}>Sinyal Grubu</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="signal_group_id (örn. SG01, opsiyonel)"
                    placeholderTextColor={t.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={form.signal_group_id}
                    onChangeText={(v) => setForm((f) => ({ ...f, signal_group_id: v }))}
                  />
                </>
              )}

              {form.type === 'cabinet' && (
                <>
                  <Text style={[styles.subLabel, styles.subLabelTop]}>Pano alt tipi</Text>
                  <ChipRow>
                    {CABINET_SUBTYPES.map((st) => (
                      <Chip
                        key={st}
                        active={form.cabinet_subtype === st}
                        size="sm"
                        onPress={() => {
                          setForm((f) => ({
                            ...f,
                            cabinet_subtype: f.cabinet_subtype === st ? '' : st,
                          }));
                          Haptics.selectionAsync().catch(() => {});
                        }}
                      >
                        {CABINET_SUBTYPE_LABEL[st]}
                      </Chip>
                    ))}
                  </ChipRow>
                </>
              )}

              {form.type === 'bus_stop' && (
                <>
                  <Text style={[styles.subLabel, styles.subLabelTop]}>Durak Kodu</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="durak_kodu (örn. AVL'den, opsiyonel)"
                    placeholderTextColor={t.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={form.durak_kodu}
                    onChangeText={(v) => setForm((f) => ({ ...f, durak_kodu: v }))}
                  />
                </>
              )}

              <Text style={[styles.subLabel, styles.subLabelTop]}>Açıklama</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder={
                  form.type === 'cabinet'
                    ? 'örn. KKC panosu, sağ köşe'
                    : form.type === 'bus_stop'
                    ? 'örn. kapalı durak, hasarlı'
                    : 'örn. sağa dönüş sinyali'
                }
                placeholderTextColor={t.textMuted}
                value={form.description}
                onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
                multiline
              />

              {editingId && (
                <>
                  <Text style={[styles.subLabel, styles.subLabelTop]}>Konum (GPS)</Text>
                  <Card padded={false} style={styles.gpsCard}>
                    <View style={styles.gpsBox}>
                      {form.lat !== undefined && form.lon !== undefined ? (
                        <Text style={styles.gpsCoords}>
                          {form.lat.toFixed(6)}, {form.lon.toFixed(6)}
                        </Text>
                      ) : (
                        <Text style={styles.gpsEmpty}>konum yok</Text>
                      )}
                      <Pressable
                        style={({ pressed }) => [
                          styles.gpsBtn,
                          pressed && styles.pressed,
                          gpsRefreshing && styles.btnDisabled,
                        ]}
                        onPress={refreshGps}
                        disabled={gpsRefreshing}
                      >
                        {gpsRefreshing ? (
                          <ActivityIndicator color={t.textInverse} />
                        ) : (
                          <>
                            <IconSymbol name="my_location" size={18} color={t.textInverse} />
                            <Text style={styles.btnText}>Yeniden Tara</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </Card>
                </>
              )}

              {!editingId && (
                <Text style={styles.help}>
                  Kaydet'e basınca GPS'ten 3 okuma alınıp medyanı yazılır.
                </Text>
              )}

              <View style={styles.row2}>
                <Pressable
                  style={({ pressed }) => [
                    styles.btnSmall,
                    styles.btnPrimary,
                    pressed && styles.pressed,
                    saving && styles.btnDisabled,
                  ]}
                  onPress={editingId ? saveEdit : saveNew}
                  disabled={saving}
                >
                  <Text style={styles.btnText}>
                    {saving ? 'GPS okunuyor…' : editingId ? 'Güncelle' : 'Kaydet'}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.btnSmall, styles.btnSecondary, pressed && styles.pressed]}
                  onPress={cancelForm}
                >
                  <Text style={styles.btnText}>İptal</Text>
                </Pressable>
              </View>
            </SectionCard>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// --- subcomponents ---------------------------------------------------------

function AssetCard({
  item,
  shotsCount,
  onPress,
  onMenu,
}: {
  item: Asset;
  shotsCount: number;
  onPress: () => void;
  onMenu: () => void;
}) {
  const t = useTheme();
  const styles = makeStyles(t);
  const accent = t[TYPE_ACCENT[item.type] as keyof typeof t] as string;

  const subtitle =
    item.type === 'traffic_signal'
      ? item.signal_group_id
        ? `Sinyal Grubu: ${item.signal_group_id}`
        : 'Sinyal Grubu: —'
      : item.type === 'cabinet'
      ? `Pano Tipi: ${
          (CABINET_SUBTYPE_LABEL as Record<string, string>)[item.cabinet_subtype ?? ''] ??
          '—'
        }`
      : item.durak_kodu
      ? `Durak Kodu: ${item.durak_kodu}`
      : 'Durak Kodu: —';

  const lastShot = item.created_at ? formatDate(item.created_at) : '—';
  const badge = badgeStyle(item.type, t);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.asset_id} çekim alanına git`}
      style={({ pressed }) => [styles.assetCardWrap, pressed && { opacity: 0.95 }]}
    >
      <Card style={styles.assetCard}>
        <View style={styles.assetHead}>
          <View style={styles.assetHeadLeft}>
            <View style={styles.assetIconBox}>
              <Text style={styles.assetIconEmoji}>{ASSET_TYPE_EMOJI[item.type]}</Text>
              <View style={[styles.assetIconCorner, { backgroundColor: accent }]} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.assetTitleRow}>
                <Text style={styles.assetTitle} numberOfLines={1}>{item.asset_id}</Text>
                <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.typeBadgeText, { color: badge.fg }]}>
                    {TYPE_LABEL[item.type].toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.assetSubtitle} numberOfLines={1}>{subtitle}</Text>
              <View style={styles.gpsRow}>
                <IconSymbol name="location_on" size={14} color={t.textMuted} />
                <Text style={styles.gpsCoordsCard}>
                  {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                </Text>
              </View>
              {item.description ? (
                <Text style={styles.assetDescription} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onMenu();
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Asset seçenekleri"
          >
            <IconSymbol name="more_vert" size={22} color={t.textMuted} />
          </Pressable>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <IconSymbol name="photo_camera" size={18} color={t.primary} />
            <Text style={styles.cardFooterText}>{shotsCount} foto</Text>
          </View>
          <View style={styles.cardFooterRight}>
            <Text style={styles.cardFooterTime}>{lastShot}</Text>
            <IconSymbol name="chevron_right" size={16} color={t.primary} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

// --- helpers ---------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function badgeStyle(
  type: AssetType,
  t: ReturnType<typeof useTheme>,
): { bg: string; fg: string } {
  switch (type) {
    case 'traffic_signal':
      return { bg: t.dangerContainer, fg: t.onDangerContainer };
    case 'cabinet':
      return { bg: t.cardHigh, fg: t.primary };
    case 'bus_stop':
      return { bg: t.tertiaryContainer, fg: t.onTertiaryContainer };
  }
}

// --- styles ----------------------------------------------------------------

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    warn: { color: t.warn, fontWeight: '600', fontSize: t.type.bodyMd },

    crumbs: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
    },
    crumbsLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    crumbsId: {
      flex: 1,
      fontFamily: 'monospace',
      fontSize: 13,
      fontWeight: '700',
      color: t.primary,
    },

    headerStack: { gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
    searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    searchInput: { flex: 1 },
    search: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      fontFamily: 'monospace',
      color: t.text,
      backgroundColor: t.chipBg,
    },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: t.chipBg,
      borderWidth: 1,
      borderColor: t.border,
    },
    sortBtnLabel: { fontSize: 12, fontWeight: '700', color: t.text },
    filterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: t.primaryContainer,
    },
    filterBtnText: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.onPrimaryContainer,
      letterSpacing: 0.3,
    },

    assetCardWrap: { marginHorizontal: 16, marginVertical: 6 },
    assetCard: { padding: 14, gap: 12 },
    assetHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    assetHeadLeft: { flex: 1, flexDirection: 'row', gap: 12, minWidth: 0 },
    assetIconBox: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: t.cardHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assetIconEmoji: { fontSize: 22 },
    assetIconCorner: {
      position: 'absolute',
      top: -3,
      left: -3,
      width: 12,
      height: 12,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: t.bg,
    },
    assetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    assetTitle: {
      fontFamily: 'monospace',
      fontSize: t.type.dataMonoLg,
      fontWeight: '700',
      color: t.text,
      letterSpacing: -0.3,
    },
    typeBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    typeBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
    assetSubtitle: { fontSize: 13, color: t.textMuted, marginTop: 4 },
    gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    gpsCoordsCard: {
      fontFamily: 'monospace',
      fontSize: 12,
      color: t.textMuted,
    },
    assetDescription: { fontSize: 13, color: t.text, marginTop: 6, lineHeight: 18 },
    menuBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: t.chipBg,
    },
    cardFooterLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardFooterText: { fontSize: 13, fontWeight: '700', color: t.primary },
    cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardFooterTime: {
      fontFamily: 'monospace',
      fontSize: 11,
      color: t.textMuted,
      fontWeight: '600',
    },

    menuCard: {
      backgroundColor: t.cardElevated,
      marginHorizontal: 32,
      marginTop: 'auto',
      marginBottom: 80,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      paddingVertical: 8,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 6,
    },
    menuTitle: {
      fontFamily: 'monospace',
      fontSize: 16,
      fontWeight: '700',
      color: t.text,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 2,
    },
    menuSub: {
      fontSize: 11,
      color: t.textMuted,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      minHeight: 48,
    },
    menuRowDanger: {},
    menuRowText: { fontSize: 15, fontWeight: '600', color: t.text },

    empty: { alignItems: 'center', padding: 32, marginTop: 32 },
    emptyEmoji: { fontSize: 56, marginBottom: 8 },
    emptyTitle: { fontSize: t.type.titleMd, fontWeight: '700', color: t.text, marginBottom: 6 },
    emptyBody: { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 20 },

    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: 12,
      paddingBottom: 20,
      backgroundColor: t.bg,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      minHeight: 50,
      backgroundColor: t.primary,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 2,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnSecondary: { backgroundColor: t.primaryAlt },
    btnSmall: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      minHeight: 46,
    },
    btnDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: 15 },

    modalBackdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'center',
    },
    modalSheet: {
      backgroundColor: t.cardLowest,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 8,
    },
    dragBar: {
      alignSelf: 'center',
      width: 48,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.outlineVariant,
      marginBottom: 6,
    },
    modalTitle: {
      fontSize: t.type.headlineMd,
      fontWeight: '700',
      color: t.text,
      marginTop: 6,
    },
    modalSubtitle: {
      fontSize: t.type.bodySm,
      color: t.textMuted,
      marginTop: 4,
      marginBottom: 12,
    },
    filterOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.cardHigh,
      marginBottom: 8,
      borderWidth: 1.5,
      borderColor: t.border,
    },
    filterOptionActive: {
      backgroundColor: t.primaryContainer,
      borderColor: t.primaryContainer,
    },
    filterOptionRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: t.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterOptionRadioActive: { borderColor: '#fff' },
    filterOptionRadioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: '#fff',
    },
    filterOptionDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    filterOptionLabel: {
      flex: 1,
      fontSize: t.type.bodyMd,
      fontWeight: '600',
      color: t.text,
    },
    filterOptionCount: {
      minWidth: 28,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 9999,
      backgroundColor: t.cardLowest,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterOptionCountText: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
    },
    modalScroll: { flex: 1 },
    modalScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
    modalCard: { padding: 18, gap: 8 },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    modalClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },

    subLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 6,
      marginTop: 4,
    },
    subLabelTop: { marginTop: 14 },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 14,
      color: t.text,
      backgroundColor: t.chipBg,
    },
    inputDisabled: { opacity: 0.6, fontFamily: 'monospace' },
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    help: { fontSize: 12, color: t.textMuted, lineHeight: 16, marginTop: 2 },
    row2: { flexDirection: 'row', gap: 8, marginTop: 12 },

    gpsCard: { marginTop: 6 },
    gpsBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
    },
    gpsCoords: {
      flex: 1,
      fontFamily: 'monospace',
      fontSize: 13,
      color: t.text,
      fontWeight: '700',
    },
    gpsEmpty: { flex: 1, fontSize: 13, color: t.textMuted, fontStyle: 'italic' },
    gpsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: t.primary,
      minWidth: 130,
    },
  });
}
