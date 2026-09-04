import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useThemedAlert } from '@/components/Alert';
import type { Intersection } from '@/types/domain';
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

// Build a friendly zip filename: "<ixId>[_<description-slug>].zip".
// Falls back to id-only when intersection_name is missing or slugifies empty.
function buildZipBaseName(intersection: Intersection): string {
  const id = intersection.intersection_id;
  const slug = slugify(intersection.intersection_name ?? '', { collapse: true, case: 'keep' })
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `${id}_${slug}` : id;
}

interface DoneState {
  intersectionId: string;
  zipName: string;
  zipPath: string;
}

export default function DisaAktarScreen() {
  const router = useRouter();
  const t = useTheme();
  const styles = makeStyles(t);
  const { alert } = useThemedAlert();
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [done, setDone] = useState<DoneState | null>(null);

  const loadIntersections = useCallback(async () => {
    const xs = await storage.getIntersections();
    xs.sort((a, b) => a.intersection_id.localeCompare(b.intersection_id));
    setIntersections(xs);
    setLoading(false);
  }, []);

  // Refresh on focus; never auto-re-run export — user must tap explicitly.
  useFocusEffect(
    useCallback(() => {
      loadIntersections();
    }, [loadIntersections]),
  );

  const doExport = useCallback(async () => {
    if (!selected) return;
    setStep('manifest');
    setProgress(STEP_PROGRESS.manifest);
    try {
      const [allAssets, allShots, intersection] = await Promise.all([
        storage.getAssets(),
        storage.getShots(),
        Promise.resolve(intersections.find((i) => i.intersection_id === selected)),
      ]);
      if (!intersection) {
        await alert({ title: 'Hata', message: 'Kavşak bulunamadı.' });
        setStep('idle');
        setProgress(0);
        return;
      }

      const ixAssets = allAssets.filter((a) => a.intersection_id === selected);
      const assetIds = ixAssets.map((a) => a.asset_id);

      const s = await settings.get();
      const manifest = buildManifest(intersection, ixAssets, allShots, s.projectId);

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
  }, [selected, intersections, alert]);

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
            style={[styles.btn, styles.btnTopMargin]}
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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.help}>
          Dışa aktarmak istediğin kavşağı seç. manifest.json + foto klasörleri
          zip'lenip paylaşım menüsü açılır.
        </Text>

        <View style={styles.list}>
          {intersections.map((i) => (
            <Pressable
              key={i.intersection_id}
              style={[
                styles.row,
                selected === i.intersection_id && styles.rowActive,
                busy && styles.rowDisabled,
              ]}
              onPress={() => !busy && setSelected(i.intersection_id)}
              disabled={busy}
            >
              <Text
                style={[
                  styles.rowText,
                  selected === i.intersection_id && styles.rowTextActive,
                ]}
              >
                {i.intersection_id}
              </Text>
            </Pressable>
          ))}
        </View>

        {!showDonePanel && (
          <Pressable
            style={[
              styles.btn,
              (!selected || busy) && styles.btnDisabled,
              styles.btnTopMargin,
            ]}
            onPress={doExport}
            disabled={!selected || busy}
          >
            {busy ? (
              <ActivityIndicator color={t.textInverse} />
            ) : (
              <Text style={styles.btnText}>Dışa Aktar</Text>
            )}
          </Pressable>
        )}

        {step !== 'idle' && (
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.progressMeta}>
              <Text style={styles.progressText}>{STEP_TEXT[step]}</Text>
              <Text style={styles.progressPct}>{progress}%</Text>
            </View>
          </View>
        )}

        {showDonePanel && (
          <View style={styles.donePanel}>
            <Text style={styles.doneTitle}>✓ Zip hazır</Text>
            <Text style={styles.doneSubtitle} numberOfLines={2}>
              {done.zipPath.replace(FS.documentDirectory ?? '', '')}
            </Text>

            <Pressable style={[styles.btn, styles.btnTopMargin]} onPress={openShare}>
              <Text style={styles.btnText}>Paylaşım Menüsünü Aç</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnSecondary, styles.btnTopMargin]}
              onPress={reset}
            >
              <Text style={styles.btnText}>Yeni Dışa Aktarım</Text>
            </Pressable>
          </View>
        )}

        {selected && step === 'idle' && (
          <Text style={styles.preview}>
            Hedef klasör: {exportDirUri(selected).replace(FS.documentDirectory ?? '', '')}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { color: t.text, fontSize: t.type.body, textAlign: 'center' },
    help: { fontSize: t.type.body, color: t.textMuted, marginBottom: 12, lineHeight: 22 },
    list: { gap: 10 },
    row: {
      backgroundColor: t.card,
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    rowActive: { backgroundColor: t.primary, borderColor: t.primary },
    rowDisabled: { opacity: 0.5 },
    rowText: { fontSize: t.type.body + 1, color: t.primary, fontWeight: '700' },
    rowTextActive: { color: t.textInverse },
    btn: {
      backgroundColor: t.primary,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 54,
      justifyContent: 'center',
    },
    btnSecondary: { backgroundColor: t.primaryAlt },
    btnDisabled: { opacity: 0.4 },
    btnTopMargin: { marginTop: 16 },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    progressWrap: { marginTop: 18 },
    progressBg: {
      height: 10,
      backgroundColor: t.progressBg,
      borderRadius: 5,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: t.primary,
      borderRadius: 5,
    },
    progressMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    progressText: { fontSize: t.type.body, color: t.text, fontWeight: '500' },
    progressPct: { fontSize: t.type.body, color: t.textMuted, fontWeight: '700' },
    donePanel: {
      marginTop: 18,
      padding: 16,
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    doneTitle: { fontSize: t.type.title, fontWeight: '700', color: t.ok },
    doneSubtitle: {
      fontSize: t.type.caption - 1,
      color: t.textMuted,
      marginTop: 6,
      fontFamily: 'monospace',
    },
    preview: {
      marginTop: 12,
      fontSize: t.type.caption - 1,
      color: t.textMuted,
      fontFamily: 'monospace',
    },
  });
}
