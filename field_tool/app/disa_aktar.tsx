import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { storage } from '@/lib/storage';
import { settings } from '@/lib/settings';
import {
  ensureExportDir,
  exportDirUri,
  mirrorPhotosForExport,
} from '@/lib/filesystem';
import { zipFolder } from '@/lib/zip';
import { buildManifest } from '@/lib/manifest';
import { slugify } from '@/lib/text';
import { Card, SectionCard } from '@/components/Surface';
import { ProgressBar } from '@/components/ProgressBar';
import { IconSymbol } from '@/components/StatTile';
import { useThemedAlert } from '@/components/Alert';
import type { Asset, Intersection, ReferenceImage } from '@/types/domain';
import { useTheme } from '@/lib/theme';

type Step = 'idle' | 'manifest' | 'mirroring' | 'zipping' | 'done';

const STEP_TEXT: Record<Step, string> = {
  idle: 'Hazır',
  manifest: 'Manifest yazılıyor…',
  mirroring: 'Fotoğraflar kopyalanıyor…',
  zipping: 'Zip oluşturuluyor…',
  done: 'Tamamlandı',
};

const STEP_PROGRESS: Record<Step, number> = {
  idle: 0,
  manifest: 25,
  mirroring: 55,
  zipping: 90,
  done: 100,
};

const PHOTO_BYTES_ESTIMATE = 1.5 * 1024 * 1024; // ~1.5 MB per shot.

function buildZipBaseName(intersection: Intersection): string {
  const id = intersection.intersection_id;
  const slug = slugify(intersection.intersection_name ?? '', { collapse: true, case: 'keep' })
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `${id}_${slug}` : id;
}

function formatBytes(bytes: number): { value: string; unit: string } {
  if (bytes >= 1024 * 1024 * 1024) {
    return { value: (bytes / (1024 * 1024 * 1024)).toFixed(2), unit: 'GB' };
  }
  return { value: (bytes / (1024 * 1024)).toFixed(0), unit: 'MB' };
}

interface DoneState {
  intersectionId: string;
  zipName: string;
  zipPath: string;
}

interface Counts {
  ixTotal: number;
  assetTotal: number;
  shotTotal: number;
}

export default function DisaAktarScreen() {
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(t);
  const { alert } = useThemedAlert();
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [shots, setShots] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [done, setDone] = useState<DoneState | null>(null);

  const load = useCallback(async () => {
    const [xs, as, ss] = await Promise.all([
      storage.getIntersections(),
      storage.getAssets(),
      storage.getShots(),
    ]);
    xs.sort((a, b) => a.intersection_id.localeCompare(b.intersection_id));
    setIntersections(xs);
    setAssets(as);
    setShots(ss);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const counts: Counts = useMemo(
    () => ({
      ixTotal: intersections.length,
      assetTotal: assets.length,
      shotTotal: shots.length,
    }),
    [intersections.length, assets.length, shots.length],
  );

  const size = useMemo(
    () => formatBytes(shots.length * PHOTO_BYTES_ESTIMATE),
    [shots.length],
  );

  const doExport = useCallback(async () => {
    if (!selected) return;
    setStep('manifest');
    setProgress(STEP_PROGRESS.manifest);
    try {
      const intersection = intersections.find((i) => i.intersection_id === selected);
      if (!intersection) {
        await alert({ title: 'Hata', message: 'Kavşak bulunamadı.' });
        setStep('idle');
        setProgress(0);
        return;
      }

      const ixAssets = assets.filter((a) => a.intersection_id === selected);
      const assetIds = ixAssets.map((a) => a.asset_id);

      const s = await settings.get();
      const manifest = buildManifest(intersection, ixAssets, shots, s.projectId);

      const dir = await ensureExportDir(selected);
      const manifestPath = `${dir}/manifest.json`;
      const tmp = `${manifestPath}.tmp`;
      const json = JSON.stringify(manifest, null, 2);
      await FS.writeAsStringAsync(tmp, json, { encoding: 'utf8' });
      try {
        await FS.deleteAsync(manifestPath, { idempotent: true });
      } catch {
        /* ok */
      }
      await FS.moveAsync({ from: tmp, to: manifestPath });

      setStep('mirroring');
      setProgress(STEP_PROGRESS.mirroring);
      await mirrorPhotosForExport(selected, assetIds);

      setStep('zipping');
      setProgress(STEP_PROGRESS.zipping);
      const zipBaseName = buildZipBaseName(intersection);
      const zipPath = `${FS.documentDirectory ?? ''}${zipBaseName}.zip`;
      const finalZipPath = await zipFolder(dir, zipPath);

      setStep('done');
      setProgress(STEP_PROGRESS.done);
      setDone({ intersectionId: selected, zipName: zipBaseName, zipPath: finalZipPath });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert({ title: 'Hata', message: `Dışa aktarım başarısız: ${msg}` });
      setStep('idle');
      setProgress(0);
    }
  }, [selected, intersections, assets, shots, alert]);

  const openShare = useCallback(async () => {
    if (!done) return;
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        await alert({ title: 'Paylaşılamadı', message: `Zip konumu: ${done.zipPath}` });
        return;
      }
      await Sharing.shareAsync(done.zipPath, {
        mimeType: 'application/zip',
        dialogTitle: `${done.zipName} referans paketini paylaş`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert({ title: 'Hata', message: `Paylaşım başarısız: ${msg}` });
    }
  }, [done, alert]);

  const reset = useCallback(() => {
    setStep('idle');
    setProgress(0);
    setDone(null);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (intersections.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.body}>Henüz kavşak yok. Önce Kavşak ekranından ekleyin.</Text>
          <Pressable
            style={[styles.btnPrimary, styles.btnTopMargin]}
            onPress={() => router.replace('/kavsak')}
          >
            <Text style={styles.btnText}>Kavşak Ekranına Dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const busy = step !== 'idle' && step !== 'done';
  const showDonePanel = step === 'done' && done !== null;
  const canExport = !!selected && !busy;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}>
        {/* 1. Hero summary bento */}
        <Card>
          <View style={styles.bentoHeader}>
            <View style={styles.bentoTitleRow}>
              <View style={styles.bentoIcon}>
                <IconSymbol name="analytics" size={20} color={t.primary} />
              </View>
              <Text style={styles.bentoTitle}>Aktarıma Hazır Veri Özeti</Text>
            </View>
            <IconSymbol name="check_circle" size={20} color={t.textMuted} />
          </View>
          <View style={styles.bentoGrid}>
            <BentoTile
              icon="hub"
              label="Kavşak"
              value={counts.ixTotal}
            />
            <BentoTile
              icon="database"
              label="Asset"
              value={counts.assetTotal}
            />
            <BentoTile
              icon="photo_camera"
              label="Fotoğraf"
              value={counts.shotTotal}
            />
            <BentoTile
              icon="folder_zip"
              label="Tahmini Boyut"
              value={`~${size.value}`}
              unit={size.unit}
              highlight
            />
          </View>
        </Card>

        {/* 2. Selection list */}
        <Card style={styles.sectionGap}>
          <Text style={styles.sectionLabel}>Dışa Aktarmak İstediğin Kavşağı Seç</Text>
          <View style={styles.list}>
            {intersections.map((i) => {
              const ixAssetsForRow = assets.filter((a) => a.intersection_id === i.intersection_id);
              const ixAssetCount = ixAssetsForRow.length;
              const assetIds = new Set(ixAssetsForRow.map((a) => a.asset_id));
              const ixShotCount = shots.filter((s) => assetIds.has(s.asset_id)).length;
              const active = selected === i.intersection_id;
              return (
                <Pressable
                  key={i.intersection_id}
                  onPress={() => !busy && setSelected(i.intersection_id)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    busy && styles.rowDisabled,
                    pressed && { opacity: 0.92 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={styles.rowLeft}>
                    <Text style={[styles.rowId, active && styles.rowTextActive]} numberOfLines={1}>
                      {i.intersection_id}
                    </Text>
                    <Text style={[styles.rowMeta, active && styles.rowTextActive]} numberOfLines={1}>
                      {ixAssetCount} asset · {ixShotCount} foto
                    </Text>
                  </View>
                  {active ? (
                    <IconSymbol name="check_circle" size={18} color={t.textInverse} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* 3. Primary action */}
        {!showDonePanel && (
          <Pressable
            onPress={doExport}
            disabled={!canExport}
            style={({ pressed }) => [
              styles.btnPrimary,
              styles.btnTopMargin,
              !canExport && styles.btnDisabled,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={t.textInverse} />
            ) : (
              <>
                <IconSymbol name="ios_share" size={20} color={t.textInverse} />
                <Text style={styles.btnText}>ZIP Oluştur</Text>
              </>
            )}
          </Pressable>
        )}

        {/* 4. Progress section */}
        {step !== 'idle' && (
          <View style={styles.progressWrap}>
            <ProgressBar
              value={progress}
              label={STEP_TEXT[step]}
              caption={`${progress}%`}
              tone={step === 'done' ? 'success' : 'primary'}
            />
          </View>
        )}

        {/* 5. Done panel */}
        {showDonePanel && (
          <Card style={styles.sectionGap}>
            <View style={styles.doneHeader}>
              <View style={styles.doneIcon}>
                <IconSymbol name="check_circle" size={22} color={t.textInverse} />
              </View>
              <Text style={styles.doneTitle}>Zip hazır</Text>
            </View>
            <Text style={styles.doneZipName} numberOfLines={1}>
              {done.zipName}.zip
            </Text>

            <Pressable
              onPress={openShare}
              style={({ pressed }) => [styles.btnPrimary, styles.btnTopMargin, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
            >
              <IconSymbol name="ios_share" size={20} color={t.textInverse} />
              <Text style={styles.btnText}>Paylaşım Menüsünü Aç</Text>
            </Pressable>

            <Pressable
              onPress={reset}
              style={({ pressed }) => [
                styles.btnSecondary,
                styles.btnTopMargin,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityRole="button"
            >
              <IconSymbol name="cloud_upload" size={20} color={t.primary} />
              <Text style={styles.btnSecondaryText}>Yeni Dışa Aktarım</Text>
            </Pressable>
          </Card>
        )}

        {/* 6. Helper note */}
        <View style={styles.helperRow}>
          <IconSymbol name="folder_zip" size={16} color={t.textMuted} />
          <Text style={styles.helper}>
            manifest.json + foto klasörleri zip'lenip paylaşım menüsü açılır.
          </Text>
        </View>

        {selected && step === 'idle' && !showDonePanel && (
          <Text style={styles.preview}>
            Hedef klasör: {exportDirUri(selected).replace(FS.documentDirectory ?? '', '')}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface BentoTileProps {
  icon: string;
  label: string;
  value: number | string;
  unit?: string;
  highlight?: boolean;
}

function BentoTile({ icon, label, value, unit, highlight }: BentoTileProps) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <SectionCard style={styles.tile}>
      <View style={styles.tileHeader}>
        <IconSymbol name={icon} size={16} color={t.textMuted} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, highlight && { color: t.primary }]}>{value}</Text>
        {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      </View>
    </SectionCard>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingBottom: 96, gap: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { color: t.text, fontSize: t.type.bodyMd, textAlign: 'center' },

    bentoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    bentoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    bentoIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bentoTitle: {
      fontSize: t.type.headlineSm,
      fontWeight: '700',
      color: t.text,
      flexShrink: 1,
    },
    bentoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },

    tile: {
      width: '48.5%',
      padding: 12,
    },
    tileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    tileLabel: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.2,
    },
    tileValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
    },
    tileValue: {
      fontSize: t.type.headlineSm,
      fontWeight: '700',
      color: t.text,
      letterSpacing: -0.5,
    },
    tileUnit: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.textMuted,
    },

    sectionGap: { marginTop: 0 },
    sectionLabel: {
      fontSize: t.type.labelLg,
      fontWeight: '700',
      color: t.text,
      marginBottom: 10,
    },
    list: { gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.cardLowest,
      minHeight: 52,
    },
    rowActive: {
      backgroundColor: t.primaryContainer,
      borderColor: t.primaryContainer,
    },
    rowDisabled: { opacity: 0.5 },
    rowLeft: { flex: 1, minWidth: 0, gap: 2 },
    rowId: {
      fontSize: t.type.bodyMd,
      fontWeight: '700',
      color: t.primary,
      fontFamily: 'monospace',
    },
    rowMeta: {
      fontSize: t.type.labelMd,
      color: t.textMuted,
    },
    rowTextActive: { color: t.textInverse },

    btnPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.primary,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      minHeight: 54,
    },
    btnSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.chipBg,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      minHeight: 54,
      borderWidth: 1,
      borderColor: t.border,
    },
    btnDisabled: { opacity: 0.4 },
    btnTopMargin: { marginTop: 4 },
    btnText: {
      color: t.textInverse,
      fontWeight: '700',
      fontSize: t.type.btn,
    },
    btnSecondaryText: {
      color: t.primary,
      fontWeight: '700',
      fontSize: t.type.btn,
    },

    progressWrap: { marginTop: 0 },

    doneHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
    },
    doneIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.ok,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneTitle: {
      fontSize: t.type.headlineMd,
      fontWeight: '700',
      color: t.text,
    },
    doneZipName: {
      fontSize: t.type.labelMd,
      color: t.textMuted,
      fontFamily: 'monospace',
      marginTop: 2,
    },

    helperRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 4,
    },
    helper: {
      flex: 1,
      fontSize: t.type.bodySm,
      color: t.textMuted,
      lineHeight: 18,
    },
    preview: {
      fontSize: t.type.labelMd,
      color: t.textMuted,
      fontFamily: 'monospace',
      paddingHorizontal: 4,
    },
  });
}