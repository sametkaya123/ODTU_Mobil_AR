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
import { SafeAreaView } from 'react-native-safe-area-context';
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
import type { Asset, AssetType } from '@/types/domain';
import { useTheme } from '@/lib/theme';

const TYPES: AssetType[] = ['traffic_signal', 'cabinet', 'bus_stop'];

const TYPE_LABEL: Record<AssetType, string> = {
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};

type SortMode = 'date-desc' | 'date-asc' | 'az' | 'za';
const SORT_LABEL: Record<SortMode, string> = {
  'date-desc': 'Tarih ↓',
  'date-asc': 'Tarih ↑',
  az: 'A-Z',
  za: 'Z-A',
};
const SORT_ORDER: SortMode[] = ['date-desc', 'date-asc', 'az', 'za'];

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
  const [sortMode, setSortMode] = useState<SortMode>('date-desc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const load = useCallback(async () => {
    const all = await storage.getAssetsByIntersection(ixId);
    setAssets(all);
  }, [ixId]);

  // Sort runs in useMemo off sortMode + assets so list re-orders without reload.
  const sortedAssets = useMemo(() => {
    const out = [...assets];
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
  }, [assets, sortMode]);

  useEffect(() => {
    if (!ixId) return;
    load().finally(() => setLoading(false));
  }, [ixId, load]);

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
      // Tip-bazlı alanlar: SADECE ilgili tip için yaz. Free-text alanlar
      // persist'ten önce slugify'dan geçer (TR chars + boşluk temizliği).
      // Cabinet_subtype chip zaten canonical döndürüyor; chip'ten gelmediyse null.
      if (form.type === 'traffic_signal') {
        a.signal_group_id = slugifyAssetId(form.signal_group_id.trim()) || null;
      }
      if (form.type === 'cabinet') {
        const sub = form.cabinet_subtype.trim();
        a.cabinet_subtype = (CABINET_SUBTYPES as readonly string[]).includes(sub)
          ? sub
          : null;
      }
      if (form.type === 'bus_stop') {
        a.durak_kodu = slugifyAssetId(form.durak_kodu.trim()) || null;
      }
      if (form.description.trim()) {
        a.description = form.description.trim();
      }
      await storage.addAsset(a);

      // Sayaç: SADECE ilgili tip için artar.
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
    // asset_id her zaman salt-okunur; mevcut değeri koru, form.asset_id'yi yok say.
    const updated: Asset = {
      ...existing,
      type: form.type,
    };
    if (form.lat !== undefined && form.lon !== undefined) {
      updated.lat = form.lat;
      updated.lon = form.lon;
    }
    // Tip-bazlı alanlar: SADECE ilgili tip için yaz. Tip değiştiyse eski
    // alanı sil, yeni tip için null ile başlat. Free-text alanlar slugify.
    if (form.type === 'traffic_signal') {
      updated.signal_group_id = slugifyAssetId(form.signal_group_id.trim()) || null;
      delete updated.cabinet_subtype;
      delete updated.durak_kodu;
    } else if (form.type === 'cabinet') {
      const sub = form.cabinet_subtype.trim();
      updated.cabinet_subtype = (CABINET_SUBTYPES as readonly string[]).includes(sub)
        ? sub
        : null;
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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{ixId}</Text>
          <Text style={styles.headerSub}>{assets.length} asset</Text>
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
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <FlatList
          data={sortedAssets}
          keyExtractor={(a) => a.asset_id}
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={styles.emptyTitle}>Bu kavşakta asset yok</Text>
              <Text style={styles.emptyBody}>
                Aşağıdan "+ Yeni Asset Ekle" ile başla.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() =>
                  router.push({
                    pathname: '/cekim',
                    params: { intersection_id: ixId, asset_id: item.asset_id },
                  })
                }
              >
                <View style={styles.rowIconBox}>
                  <Text style={styles.rowIcon}>{ASSET_TYPE_EMOJI[item.type]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.asset_id}</Text>
                  <Text style={styles.rowMeta}>
                    {TYPE_LABEL[item.type]}
                    {item.cabinet_subtype
                      ? ` · ${
                          (CABINET_SUBTYPE_LABEL as Record<string, string>)[
                            item.cabinet_subtype
                          ] ?? item.cabinet_subtype
                        }`
                      : ''}
                    {item.durak_kodu ? ` · ${item.durak_kodu}` : ''} ·{' '}
                    {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                  </Text>
                  {item.signal_group_id && (
                    <Text style={styles.rowMeta2}>SG: {item.signal_group_id}</Text>
                  )}
                  {item.description && (
                    <Text style={styles.rowMeta2}>📝 {item.description}</Text>
                  )}
                </View>
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
                  style={({ pressed }) => [
                    styles.iconBtn,
                    styles.iconBtnDanger,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => deleteAsset(item)}
                  hitSlop={6}
                >
                  <Text style={styles.iconBtnText}>×</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListFooterComponent={null}
        />

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
            onPress={openNew}
          >
            <Text style={styles.btnText}>+ Yeni Asset Ekle</Text>
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
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.formTitle}>
                  {editingId ? 'Asset Düzenle' : 'Yeni Asset'}
                </Text>
                <Pressable
                  onPress={cancelForm}
                  hitSlop={10}
                  style={({ pressed }) => [styles.modalClose, pressed && { opacity: 0.5 }]}
                >
                  <Text style={styles.modalCloseText}>×</Text>
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
                asset_id otomatik üretilir; tip değişimi sayaç + öneki günceller.
              </Text>

              <Text style={[styles.subLabel, styles.subLabelTop]}>Tip</Text>
              <View style={styles.chips}>
                {TYPES.map((tt) => (
                  <Pressable
                    key={tt}
                    style={[styles.chip, form.type === tt && styles.chipActive]}
                    onPress={async () => {
                      // Yeni formda (editingId yok) tip değişimi sayaç + öneki yeniler.
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
                  >
                    <Text
                      style={[styles.chipText, form.type === tt && styles.chipTextActive]}
                    >
                      {TYPE_LABEL[tt]}
                    </Text>
                  </Pressable>
                ))}
              </View>

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
                  <View style={styles.chips}>
                    {CABINET_SUBTYPES.map((st) => (
                      <Pressable
                        key={st}
                        style={[
                          styles.chip,
                          form.cabinet_subtype === st && styles.chipActive,
                        ]}
                        onPress={() => {
                          setForm((f) => ({
                            ...f,
                            cabinet_subtype: f.cabinet_subtype === st ? '' : st,
                          }));
                          Haptics.selectionAsync().catch(() => {});
                        }}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            form.cabinet_subtype === st && styles.chipTextActive,
                          ]}
                        >
                          {CABINET_SUBTYPE_LABEL[st]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
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
                style={styles.input}
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
                        <Text style={styles.btnText}>📡 Yeniden Tara</Text>
                      )}
                    </Pressable>
                  </View>
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
                  style={({ pressed }) => [
                    styles.btnSmall,
                    styles.btnSecondary,
                    pressed && styles.pressed,
                  ]}
                  onPress={cancelForm}
                >
                  <Text style={styles.btnText}>İptal</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

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
    warn: { color: t.warn, fontWeight: '600', fontSize: t.type.body },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: t.card,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
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
    headerTitle: { fontSize: t.type.title + 2, fontWeight: '700', color: t.text },
    headerSub: { fontSize: t.type.caption, color: t.textMuted, marginTop: 2 },
    row: {
      backgroundColor: t.card,
      marginHorizontal: 12,
      marginVertical: 6,
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
    rowMain: { flex: 1, padding: 14, flexDirection: 'row', alignItems: 'center' },
    rowIconBox: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    rowIcon: { fontSize: 26 },
    rowTitle: { fontSize: t.type.body + 1, fontWeight: '700', color: t.text },
    rowMeta: { fontSize: t.type.caption - 1, color: t.textMuted, marginTop: 2 },
    rowMeta2: { fontSize: t.type.caption - 1, color: t.primary, marginTop: 2, fontWeight: '500' },
    rowActions: { paddingRight: 10, gap: 6 },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    iconBtnDanger: { borderColor: t.danger },
    iconBtnText: { fontSize: t.type.icon, fontWeight: '700', color: t.text },
    empty: { alignItems: 'center', padding: 32, marginTop: 32 },
    emptyEmoji: { fontSize: 56, marginBottom: 8 },
    emptyTitle: { fontSize: t.type.title, fontWeight: '700', color: t.text, marginBottom: 6 },
    emptyBody: { fontSize: t.type.body - 1, color: t.textMuted, textAlign: 'center', lineHeight: 20 },
    footer: { padding: 12, backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.border },
    formCard: {
      backgroundColor: t.card,
      padding: 14,
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
      gap: 10,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'center',
    },
    modalScroll: { flex: 1 },
    modalScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
    modalCard: {
      backgroundColor: t.cardElevated,
      padding: 18,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 6,
      gap: 4,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    modalClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    modalCloseText: { fontSize: t.type.icon + 2, fontWeight: '900', color: t.text, lineHeight: 24 },
    formTitle: { fontSize: t.type.title, fontWeight: '700', color: t.text },
    subLabel: { fontSize: t.type.caption, fontWeight: '600', color: t.textMuted, marginBottom: 6, marginTop: 4 },
    subLabelTop: { marginTop: 14 },
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
    inputDisabled: {
      opacity: 0.6,
      fontFamily: 'monospace',
    },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    gpsBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.chipBg,
    },
    gpsCoords: {
      flex: 1,
      fontSize: t.type.body,
      fontFamily: 'monospace',
      color: t.text,
      fontWeight: '600',
    },
    gpsEmpty: { flex: 1, fontSize: t.type.body, color: t.textMuted, fontStyle: 'italic' },
    gpsBtn: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 40,
      minWidth: 110,
    },
    chip: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.chipBg,
    },
    chipActive: { backgroundColor: t.primary, borderColor: t.primary },
    chipText: { color: t.text, fontWeight: '500', fontSize: t.type.body - 1 },
    chipTextActive: { color: t.textInverse },
    help: { fontSize: t.type.caption - 1, color: t.textMuted, lineHeight: 18 },
    row2: { flexDirection: 'row', gap: 8, marginTop: 4 },
    btn: {
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 54,
      justifyContent: 'center',
    },
    btnSmall: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 10,
      alignItems: 'center',
      minHeight: 50,
      justifyContent: 'center',
    },
    btnPrimary: { backgroundColor: t.primary },
    btnSecondary: { backgroundColor: t.primaryAlt },
    btnDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
  });
}
