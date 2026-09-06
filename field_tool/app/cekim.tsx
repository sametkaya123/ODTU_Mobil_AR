import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { storage } from '@/lib/storage';
import { deletePhoto, nextFileIndex, photoPath, savePhoto } from '@/lib/filesystem';
import {
  ANGLE_LABELS,
  ANGLE_SLUGS,
  LIGHT_LABELS,
  LIGHT_SLUGS,
  POSTURE_LABELS,
  POSTURE_SLUGS,
} from '@/lib/slugs';
import { doneKeys } from '@/types/domain';
import { useTheme } from '@/lib/theme';
import { useThemedAlert } from '@/components/Alert';
import { Card, SectionCard } from '@/components/Surface';
import { Chip } from '@/components/Chip';
import { ProgressBar } from '@/components/ProgressBar';
import { IconSymbol } from '@/components/StatTile';
import type {
  AngleSlug,
  Asset,
  AssetType,
  DistanceM,
  LightSlug,
  PostureSlug,
  ReferenceImage,
} from '@/types/domain';

const DISTANCES: readonly DistanceM[] = [5, 10, 15, 20, 30];

type Phase = 'IDLE' | 'PREVIEW' | 'CAPTURING' | 'SAVED';

const TYPE_COLOR: Record<AssetType, string> = {
  traffic_signal: 'signal',
  cabinet: 'cabinet',
  bus_stop: 'busStop',
} as const;

export default function CekimScreen() {
  const t = useTheme();
  const styles = makeStyles(t);
  const { alert, confirm } = useThemedAlert();
  const { intersection_id, asset_id } = useLocalSearchParams<{
    intersection_id: string;
    asset_id: string;
  }>();
  const ixId = String(intersection_id ?? '');
  const aId = String(asset_id ?? '');

  const [perm, requestPerm] = useCameraPermissions();
  const [distance, setDistance] = useState<DistanceM | null>(null);
  const [angle, setAngle] = useState<AngleSlug | null>(null);
  const [light, setLight] = useState<LightSlug | null>(null);
  const [posture, setPosture] = useState<PostureSlug | null>(null);
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [shots, setShots] = useState<ReferenceImage[]>([]);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [peekOpen, setPeekOpen] = useState(true);
  const [flashVisible, setFlashVisible] = useState(false);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  type FullscreenTarget =
    | { kind: 'preview' }
    | { kind: 'shot'; shot: ReferenceImage };
  const [fullscreen, setFullscreen] = useState<FullscreenTarget | null>(null);
  const camRef = useRef<CameraView>(null);

  const loadShots = useCallback(async () => {
    if (!aId) return;
    setShots(await storage.getShotsByAsset(aId));
  }, [aId]);

  // Load asset to derive type-colored dot + signal_group subtitle.
  useEffect(() => {
    if (!aId) return;
    let live = true;
    storage.getAssets().then((all) => {
      if (!live) return;
      setAsset(all.find((a) => a.asset_id === aId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [aId]);

  useEffect(() => {
    loadShots();
  }, [loadShots]);

  useEffect(() => {
    if (distance && angle && light && posture && phase === 'IDLE') setPhase('PREVIEW');
    if ((!distance || !angle || !light || !posture) && phase === 'PREVIEW') setPhase('IDLE');
  }, [distance, angle, light, posture, phase]);

  // Live GPS + heading for the telemetry strip. Subscribed while on screen.
  const [liveFix, setLiveFix] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1500 },
          (pos) => {
            if (cancelled) return;
            setLiveFix({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              acc: pos.coords.accuracy ?? 0,
            });
          },
        );
        // Compass heading (trueHeading preferred; fall back to magHeading).
        headingSub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setHeadingDeg(deg);
        });
      } catch {
        /* GPS / compass unavailable — strip shows placeholders */
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      headingSub?.remove();
    };
  }, []);

  const capture = useCallback(async () => {
    if (!perm?.granted) {
      await requestPerm();
      return;
    }
    if (!distance || !angle || !light || !posture) return;
    if (!camRef.current) return;
    setPhase('CAPTURING');
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error('Foto alınamadı.');
      const idx = await nextFileIndex(ixId, aId);
      const finalUri = await savePhoto(photo.uri, ixId, aId, idx);
      setPendingIdx(idx);
      setPendingUri(finalUri);
      setPhase('SAVED');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert({ title: 'Hata', message: `Çekim başarısız: ${msg}` });
      setPhase('PREVIEW');
    }
  }, [perm, requestPerm, distance, angle, light, posture, ixId, aId, alert]);

  const onShutter = useCallback(async () => {
    // Quick white flash overlay on press for tactile feedback.
    setFlashVisible(true);
    setTimeout(() => setFlashVisible(false), 120);
    await capture();
  }, [capture]);

  const saveAndContinue = useCallback(async () => {
    if (pendingIdx == null || !distance || !angle || !light || !posture) return;
    const rec: ReferenceImage = {
      asset_id: aId,
      file_index: pendingIdx,
      distance_m: distance,
      angle,
      light,
      posture,
      captured_at: new Date().toISOString(),
    };
    await storage.appendShot(rec);
    setPendingIdx(null);
    setPendingUri(null);
    setPhase('PREVIEW');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await loadShots();
  }, [pendingIdx, distance, angle, light, posture, aId, loadShots]);

  const retake = useCallback(async () => {
    if (pendingIdx == null) return;
    await deletePhoto(ixId, aId, pendingIdx);
    setPendingIdx(null);
    setPendingUri(null);
    setPhase(distance && angle && light && posture ? 'PREVIEW' : 'IDLE');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [pendingIdx, ixId, aId, distance, angle, light, posture]);

  const removeShotCompletely = useCallback(
    async (s: ReferenceImage) => {
      setShots((prev) =>
        prev.filter((x) => !(x.asset_id === s.asset_id && x.file_index === s.file_index)),
      );
      const diskOk = await deletePhoto(ixId, aId, s.file_index);
      if (!diskOk) {
        await alert({
          title: 'Silinemedi',
          message: 'Dosya diskten silinemedi. Lütfen tekrar deneyin.',
        });
        await loadShots();
        return false;
      }
      await storage.removeShot(aId, s.file_index);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      await loadShots();
      return true;
    },
    [ixId, aId, loadShots, alert],
  );

  const deleteShot = useCallback(
    (s: ReferenceImage) => {
      confirm({
        title: 'Foto Sil',
        message: `${s.distance_m}m · ${ANGLE_LABELS[s.angle]} · ${LIGHT_LABELS[s.light]} · ${POSTURE_LABELS[s.posture]} silinsin mi?`,
        destructive: true,
        confirmText: 'Sil',
      }).then((ok) => {
        if (ok) removeShotCompletely(s);
      });
    },
    [confirm, removeShotCompletely],
  );

  // Total combos = 5 dist × 6 angle × 4 light × 4 posture = 480.
  const totalCombos = useMemo(
    () => DISTANCES.length * ANGLE_SLUGS.length * LIGHT_SLUGS.length * POSTURE_SLUGS.length,
    [],
  );
  const done = useMemo(() => doneKeys(shots, aId), [shots, aId]);
  const doneCount = done.size;
  const pct = totalCombos > 0 ? Math.min(100, Math.round((doneCount / totalCombos) * 100)) : 0;

  // Checklist grid is 5×6 (distance×angle). A cell counts as filled if
  // ANY posture variant exists at that cell — keeps the visual matrix stable.
  const doneCells = useMemo(() => {
    const set = new Set<string>();
    for (const s of shots) {
      if (s.asset_id === aId) set.add(`${s.distance_m}|${s.angle}`);
    }
    return set;
  }, [shots, aId]);

  // Highlight the just-captured (not yet saved) combo so the user sees which
  // distance×angle cell the pending shot will fill. Cleared on save or retake.
  const candidateKey = useMemo(() => {
    if (phase !== 'SAVED' || pendingIdx == null) return null;
    if (!distance || !angle) return null;
    return `${distance}|${angle}`;
  }, [phase, pendingIdx, distance, angle]);

  // Asset badge: type-colored pulse dot + asset_id + signal_group subtitle.
  const typeColorKey = asset ? TYPE_COLOR[asset.type] : 'primary';
  const dotColor =
    typeColorKey === 'signal'
      ? t.signal
      : typeColorKey === 'cabinet'
        ? t.cabinet
        : typeColorKey === 'busStop'
          ? t.busStop
          : t.primary;
  const signalGroupSubtitle =
    asset?.type === 'traffic_signal' && asset.signal_group_id
      ? ` (Sinyal Grubu ${asset.signal_group_id})`
      : '';

  // Last 6 shots for the mini preview grid.
  const last6 = useMemo(
    () =>
      shots
        .slice()
        .sort((a, b) => b.file_index - a.file_index)
        .slice(0, 6),
    [shots],
  );

  if (perm == null) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!perm.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.warn}>Kamera izni yok.</Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            onPress={requestPerm}
          >
            <Text style={styles.btnText}>İzin Ver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: 112 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 2. Asset telemetry + progress */}
          <Card padded style={styles.telemetryCard}>
            <View style={styles.telemetryTopRow}>
              <View style={styles.assetPill}>
                <PulseDot color={dotColor} />
                <Text style={styles.assetPillText} numberOfLines={1}>
                  {aId}
                  {signalGroupSubtitle}
                </Text>
              </View>
              <View style={styles.rtkRow}>
                <IconSymbol name="sensors" size={16} color={t.primary} />
                <Text style={styles.rtkText}>
                  {liveFix
                    ? liveFix.acc <= 0
                      ? 'GPS —'
                      : `GPS ±${liveFix.acc.toFixed(1)}m`
                    : 'GPS aranıyor…'}
                </Text>
              </View>
            </View>
            <SectionCard padded={false}>
              <ProgressBar
                value={pct}
                label="Kapsam İlerlemesi"
                caption={`${doneCount} / ${totalCombos} Kombinasyon (%${pct})`}
                tone="primary"
              />
            </SectionCard>
          </Card>

          {/* 3. Tag selectors matrix (4 horizontal rows) */}
          <Card padded style={styles.tagCard}>
            <TagRow
              label="Mesafe"
              options={DISTANCES.map((d) => ({ key: String(d), label: `${d}m` }))}
              activeKey={distance == null ? null : String(distance)}
              onSelect={(k) => setDistance(Number(k) as DistanceM)}
            />
            <TagRow
              label="Açı"
              options={ANGLE_SLUGS.map((a) => ({ key: a, label: ANGLE_LABELS[a] }))}
              activeKey={angle}
              onSelect={(k) => setAngle(k as AngleSlug)}
            />
            <TagRow
              label="Işık"
              options={LIGHT_SLUGS.map((l) => ({
                key: l,
                label: LIGHT_LABELS[l],
                leading: LIGHT_EMOJI[l],
              }))}
              activeKey={light}
              onSelect={(k) => setLight(k as LightSlug)}
            />
            <TagRow
              label="Poz"
              options={POSTURE_SLUGS.map((p) => ({ key: p, label: POSTURE_LABELS[p] }))}
              activeKey={posture}
              onSelect={(k) => setPosture(k as PostureSlug)}
              last
            />
          </Card>

          {/* 4. Camera viewfinder (Card padding=0, aspect 16:9, dark bg) */}
          <Card padded={false} style={styles.viewfinderCard}>
            <View style={styles.viewfinder}>
              {phase === 'SAVED' && pendingUri ? (
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setFullscreen({ kind: 'preview' })}
                >
                  <Image
                    source={{ uri: pendingUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                </Pressable>
              ) : (
                <CameraView
                  ref={camRef}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                />
              )}

              {/* Top telemetry strip — reflects real recording parameters. */}
              <View style={styles.topStrip} pointerEvents="none">
                <View style={styles.topStripDot} />
                <Text style={styles.stripText}>
                  {perm?.granted ? `1080p · JPEG · q=0.85` : 'Kamera izni yok'}
                </Text>
              </View>

              {/* Bottom GPS + compass strip */}
              <View style={styles.bottomStrip} pointerEvents="none">
                <View style={styles.stripSide}>
                  <IconSymbol name="location_on" size={14} color={t.tertiaryFixed} />
                  <Text style={styles.stripText}>
                    {liveFix
                      ? `${liveFix.lat.toFixed(6)}° N · ${liveFix.lon.toFixed(6)}° E`
                      : 'GPS aranıyor…'}
                  </Text>
                </View>
                <View style={styles.stripSide}>
                  <IconSymbol name="explore" size={14} color="#b4c5ff" />
                  <Text style={styles.stripText}>
                    {headingDeg !== null ? `${Math.round(headingDeg)}°` : '—°'}
                  </Text>
                </View>
              </View>

              {/* Center reticle */}
              <View style={styles.reticle} pointerEvents="none">
                <View style={styles.reticleLine} />
                <View style={styles.reticleDot} />
              </View>

              {/* Quick white flash overlay on shutter */}
              {flashVisible && (
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]}
                  pointerEvents="none"
                />
              )}
            </View>
          </Card>

          {/* 5. Capture controls */}
          <Card padded={false} style={styles.controlsCard}>
            <View style={styles.controlsRow}>
              <Pressable
                onPress={() => Haptics.selectionAsync().catch(() => {})}
                style={({ pressed }) => [styles.flashBtn, pressed && styles.pressed]}
                accessibilityLabel="Flaş ve Poz Kilidi"
              >
                <IconSymbol name="flash_auto" size={24} color={t.text} />
              </Pressable>

              <Pressable
                onPress={onShutter}
                disabled={
                  phase === 'CAPTURING' ||
                  phase === 'SAVED' ||
                  !distance ||
                  !angle ||
                  !light ||
                  !posture
                }
                style={({ pressed }) => [
                  styles.shutterOuter,
                  (phase === 'CAPTURING' ||
                    phase === 'SAVED' ||
                    !distance ||
                    !angle ||
                    !light ||
                    !posture) &&
                    styles.shutterDisabled,
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                accessibilityLabel={
                  !distance || !angle || !light || !posture
                    ? 'Önce Mesafe, Açı, Işık ve Poz seç'
                    : 'Fotoğraf Çek'
                }
              >
                <View style={styles.shutterInner}>
                  <View style={styles.shutterCore}>
                    <IconSymbol name="photo_camera" size={28} color={t.textInverse} />
                  </View>
                </View>
              </Pressable>

              <Pressable
                onPress={() => setPeekOpen((v) => !v)}
                style={({ pressed }) => [styles.miniGridBtn, pressed && styles.pressed]}
                accessibilityLabel="Son Çekimleri Gör"
              >
                <View style={styles.miniGrid}>
                  {[0, 1, 2, 3, 4, 5].map((i) => {
                    const shot = last6[i];
                    return (
                      <View key={i} style={styles.miniCell}>
                        {shot ? (
                          <Image
                            source={{ uri: photoPath(ixId, aId, shot.file_index) }}
                            style={StyleSheet.absoluteFill}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </Pressable>
            </View>

            {/* Save / retake after capture */}
            {phase === 'SAVED' && (
              <View style={styles.captureActions}>
                <Pressable
                  style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
                  onPress={saveAndContinue}
                >
                  <Text style={styles.btnText}>Yeni Ekle (aynı parametre)</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnDanger,
                    styles.btnTopMargin,
                    pressed && styles.pressed,
                  ]}
                  onPress={retake}
                >
                  <Text style={styles.btnText}>Sil, Tekrar Çek</Text>
                </Pressable>
              </View>
            )}
          </Card>

          {/* 6. Bottom peek sheet — collapsible list of saved shots */}
          <Card padded style={styles.peekCard}>
            <Pressable
              onPress={() => setPeekOpen((v) => !v)}
              style={styles.peekHandle}
              accessibilityRole="button"
              accessibilityLabel="Son çekimleri aç/kapat"
            >
              <View style={styles.dragHandle} />
            </Pressable>
            <View style={styles.peekHeader}>
              <View style={styles.peekHeaderLeft}>
                <IconSymbol name="dataset" size={20} color={t.primary} />
                <Text style={styles.peekTitle}>Son Çekilen Kombinasyonlar</Text>
                <View style={styles.peekBadge}>
                  <Text style={styles.peekBadgeText}>{shots.length}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => setPeekOpen((v) => !v)}
                hitSlop={8}
              >
                <Text style={styles.peekToggle}>{peekOpen ? 'Kapat' : 'Genişlet'}</Text>
              </Pressable>
            </View>
            {peekOpen && (
              <View style={styles.peekList}>
                {shots.length === 0 ? (
                  <Text style={styles.peekEmpty}>Henüz kaydedilmiş çekim yok.</Text>
                ) : (
                  shots
                    .slice()
                    .sort((a, b) => b.file_index - a.file_index)
                    .map((s) => (
                      <PeekRow
                        key={`${s.file_index}-${s.captured_at}`}
                        shot={s}
                        ixId={ixId}
                        assetId={aId}
                        onDelete={() => deleteShot(s)}
                        onPreview={() => setFullscreen({ kind: 'shot', shot: s })}
                      />
                    ))
                )}
              </View>
            )}
          </Card>

          {/* 7. Checklist grid (kept — task permits) */}
          <Card padded style={styles.checklistCard}>
            <Text style={styles.checklistLabel}>
              Eksik kombinasyonlar ({doneCells.size}/30)
            </Text>
            <Checklist done={doneCells} candidateKey={candidateKey} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={fullscreen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(null)}
      >
        {fullscreen ? (
          <FullscreenViewer
            uri={
              fullscreen.kind === 'preview'
                ? (pendingUri ?? '')
                : photoPath(ixId, aId, fullscreen.shot.file_index)
            }
            meta={
              fullscreen.kind === 'preview'
                ? 'Bu çekim (henüz kaydedilmedi)'
                : `${fullscreen.shot.distance_m}m · ${ANGLE_LABELS[fullscreen.shot.angle]} · ${LIGHT_LABELS[fullscreen.shot.light]} · ${POSTURE_LABELS[fullscreen.shot.posture]}`
            }
            showDelete={fullscreen.kind === 'shot'}
            onClose={() => setFullscreen(null)}
            onDelete={
              fullscreen.kind === 'shot'
                ? () => {
                    const s = fullscreen.shot;
                    setFullscreen(null);
                    setTimeout(() => deleteShot(s), 50);
                  }
                : undefined
            }
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Tag selector row: 56px label + horizontal scroll of single-select chips.
// ---------------------------------------------------------------------------

interface TagOption {
  key: string;
  label: string;
  leading?: string;
}

function TagRow({
  label,
  options,
  activeKey,
  onSelect,
  last,
}: {
  label: string;
  options: readonly TagOption[];
  activeKey: string | null;
  onSelect: (k: string) => void;
  last?: boolean;
}) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <View style={[styles.tagRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.tagLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tagScroll}
      >
        {options.map((o) => (
          <Chip
            key={o.key}
            active={activeKey === o.key}
            onPress={() => onSelect(o.key)}
            leading={o.leading}
          >
            {o.label}
          </Chip>
        ))}
      </ScrollView>
    </View>
  );
}

const LIGHT_EMOJI: Record<LightSlug, string> = {
  gunesli: '☀',
  bulutlu: '⛅',
  golge: '🌲',
  gece: '🌙',
};

// ---------------------------------------------------------------------------
// Pulse dot — animated opacity loop on the asset telemetry badge.
// ---------------------------------------------------------------------------

function PulseDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles_inline.dot, { backgroundColor: color, opacity }]} />;
}

const styles_inline = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
});

// ---------------------------------------------------------------------------
// Peek sheet row — saved combo summary + delete.
// ---------------------------------------------------------------------------

function PeekRow({
  shot,
  ixId,
  assetId,
  onDelete,
  onPreview,
}: {
  shot: ReferenceImage;
  ixId: string;
  assetId: string;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const t = useTheme();
  const styles = makeStyles(t);
  const hh = String(new Date(shot.captured_at).getHours()).padStart(2, '0');
  const mm = String(new Date(shot.captured_at).getMinutes()).padStart(2, '0');
  const ss = String(new Date(shot.captured_at).getSeconds()).padStart(2, '0');
  const slug = `${shot.distance_m}m_${shot.angle}`;
  return (
    <View style={styles.peekRow}>
      <Pressable
        onPress={onPreview}
        hitSlop={4}
        style={styles.peekRowThumbWrap}
        accessibilityLabel="Fotoğrafı Tam Ekran Gör"
      >
        <Image
          source={{ uri: photoPath(ixId, assetId, shot.file_index) }}
          style={styles.peekRowThumb}
          resizeMode="cover"
        />
        <View style={styles.peekRowThumbScrim} pointerEvents="none">
          <IconSymbol name="open_in_full" size={12} color="#fff" />
        </View>
      </Pressable>
      <View style={styles.peekRowBody}>
        <Text style={styles.peekRowTitle} numberOfLines={1}>
          {shot.distance_m}m · {ANGLE_LABELS[shot.angle]} · {LIGHT_LABELS[shot.light]} ·{' '}
          {POSTURE_LABELS[shot.posture]}
        </Text>
        <Text style={styles.peekRowMeta} numberOfLines={1}>
          {hh}:{mm}:{ss} · {assetId}_{slug}.jpg
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [styles.peekDelBtn, pressed && styles.pressed]}
        accessibilityLabel="Kaydı Sil"
      >
        <IconSymbol name="delete" size={20} color={t.danger} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen viewer — pinch / pan / double-tap zoom (preserved from original).
// ---------------------------------------------------------------------------

function FullscreenViewer({
  uri,
  meta,
  showDelete,
  onClose,
  onDelete,
}: {
  uri: string;
  meta: string;
  showDelete: boolean;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const t = useTheme();
  const styles = makeStyles(t);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const lastTapTime = useRef(0);
  const baseDistance = useRef<number | null>(null);
  const baseScale = useRef(1);
  const baseTranslate = useRef({ x: 0, y: 0 });

  const reset = useCallback(() => {
    scaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    baseDistance.current = null;
    baseScale.current = 1;
    baseTranslate.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    reset();
  }, [uri, reset]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          baseDistance.current = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY,
          );
          baseScale.current = scaleRef.current;
        } else if (touches.length === 1) {
          const now = Date.now();
          if (now - lastTapTime.current < 300) {
            if (scaleRef.current > 1) reset();
            else {
              scaleRef.current = 2;
              setScale(2);
            }
            lastTapTime.current = 0;
          } else {
            lastTapTime.current = now;
            baseTranslate.current = translateRef.current;
          }
        }
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2 && baseDistance.current) {
          const d = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY,
          );
          const newScale = Math.max(1, Math.min(4, baseScale.current * (d / baseDistance.current)));
          scaleRef.current = newScale;
          setScale(newScale);
        } else if (touches.length === 1 && scaleRef.current > 1) {
          translateRef.current = {
            x: baseTranslate.current.x + g.dx,
            y: baseTranslate.current.y + g.dy,
          };
          setTranslate(translateRef.current);
        }
      },
      onPanResponderRelease: () => {
        baseDistance.current = null;
        if (scaleRef.current < 1.05) reset();
      },
    }),
  ).current;

  const hint = scale > 1
    ? `${Math.round(scale * 100)}% — sürükle, çift dokun sıfırla`
    : 'Pinch to zoom · çift dokun';

  return (
    <View style={styles.fsRoot}>
      <View {...panResponder.panHandlers} style={styles.fsImgWrap}>
        <Image
          source={{ uri }}
          style={[
            styles.fsImg,
            {
              transform: [
                { scale },
                { translateX: translate.x },
                { translateY: translate.y },
              ],
            },
          ]}
          resizeMode="contain"
        />
      </View>
      <View style={styles.fsMeta} pointerEvents="none">
        <Text style={styles.fsMetaText}>{meta}</Text>
      </View>
      <View style={styles.fsHint} pointerEvents="none">
        <Text style={styles.fsHintText}>{hint}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.fsCloseBtn, pressed && { opacity: 0.5 }]}
        onPress={onClose}
        hitSlop={12}
      >
        <Text style={styles.fsCloseText}>×</Text>
      </Pressable>
      {showDelete && onDelete ? (
        <Pressable
          style={({ pressed }) => [styles.fsDelBtn, pressed && { opacity: 0.7 }]}
          onPress={onDelete}
        >
          <Text style={styles.fsDelText}>Fotoğrafı Sil</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Distance × angle checklist (5×6 cells, kept below peek sheet per spec).
// ---------------------------------------------------------------------------

function Checklist({
  done,
  candidateKey,
}: {
  done: Set<string>;
  candidateKey: string | null;
}) {
  const t = useTheme();
  const styles = makeStyles(t);
  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.checklistHeaderRow}>
        <View style={{ width: 110 }} />
        {DISTANCES.map((d) => (
          <Text key={d} style={styles.checklistColHeader}>
            {d}m
          </Text>
        ))}
      </View>
      {ANGLE_SLUGS.map((a) => (
        <View key={a} style={styles.checklistRow}>
          <Text style={styles.checklistRowLabel}>{ANGLE_LABELS[a]}</Text>
          {DISTANCES.map((d) => {
            const key = `${d}|${a}`;
            const hit = done.has(key);
            const pending = !hit && candidateKey === key;
            const dup = hit && candidateKey === key;
            return (
              <View
                key={d}
                style={[
                  styles.checklistCell,
                  dup && { backgroundColor: t.warn, borderColor: t.warn },
                  hit && !dup && { backgroundColor: t.ok, borderColor: t.ok },
                  pending && { backgroundColor: t.danger, borderColor: t.danger },
                  !hit && !pending && !dup && {
                    backgroundColor: t.missingBg,
                    borderColor: t.border,
                  },
                ]}
              >
                <Text style={styles.checklistCellText}>
                  {dup ? '!' : hit || pending ? '✓' : '·'}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Style table.
// ---------------------------------------------------------------------------

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    warn: { fontSize: t.type.titleMd, color: t.warn, marginBottom: 12, fontWeight: '700' },
    scroll: { padding: 12, paddingBottom: 32, gap: 12 },

    // Telemetry card
    telemetryCard: { gap: 10 },
    telemetryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    assetPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 9999,
      backgroundColor: t.cardHigh,
      flex: 1,
      minWidth: 0,
    },
    assetPillText: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.text,
      letterSpacing: 0.2,
      flexShrink: 1,
    },
    rtkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rtkText: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: t.type.dataMonoMd,
      fontWeight: '700',
      color: t.primary,
    },

    // Tag selectors matrix
    tagCard: { padding: 8, gap: 4 },
    tagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    tagLabel: {
      width: 56,
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    tagScroll: {
      gap: 6,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },

    // Viewfinder
    viewfinderCard: { padding: 0, overflow: 'hidden' },
    viewfinder: {
      width: '100%',
      aspectRatio: 3 / 4,
      backgroundColor: t.previewBg,
      overflow: 'hidden',
    },
    topStrip: {
      position: 'absolute',
      top: 8,
      left: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: 'rgba(0,0,0,0.75)',
    },
    topStripDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.tertiary,
    },
    stripText: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: 11,
      color: '#fff',
      fontWeight: '600',
    },
    bottomStrip: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      right: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: 'rgba(0,0,0,0.8)',
    },
    stripSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    reticle: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reticleLine: {
      width: 64,
      height: 2,
      backgroundColor: t.tertiaryFixedDim,
      shadowColor: '#000',
      shadowOpacity: 0.8,
      shadowRadius: 2,
    },
    reticleDot: {
      position: 'absolute',
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.tertiaryFixed,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.4)',
    },

    // Capture controls
    controlsCard: { padding: 12 },
    controlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    flashBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.cardHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterOuter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 6,
    },
    shutterInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterCore: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterDisabled: { opacity: 0.4 },
    miniGridBtn: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: t.cardHigh,
      overflow: 'hidden',
      padding: 2,
    },
    miniGrid: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 2,
    },
    miniCell: {
      width: '32%',
      height: '48%',
      borderRadius: 2,
      backgroundColor: t.cardHighest,
      overflow: 'hidden',
    },

    // Save / retake actions under shutter
    captureActions: { marginTop: 8 },
    btn: {
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnDanger: { backgroundColor: t.danger },
    btnTopMargin: { marginTop: 8 },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },

    // Peek sheet
    peekCard: { padding: 12 },
    peekHandle: {
      alignItems: 'center',
      paddingBottom: 8,
      minHeight: 24,
    },
    dragHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.cardHighest,
    },
    peekHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
    },
    peekHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
      minWidth: 0,
    },
    peekTitle: {
      fontSize: t.type.titleMd,
      fontWeight: '700',
      color: t.text,
      flexShrink: 1,
    },
    peekBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 9999,
      backgroundColor: t.cardHigh,
    },
    peekBadgeText: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
    },
    peekToggle: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.primary,
      letterSpacing: 0.4,
    },
    peekList: { gap: 6, marginTop: 6 },
    peekEmpty: {
      fontSize: t.type.bodyMd,
      color: t.textMuted,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 12,
    },
    peekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      borderRadius: 12,
      backgroundColor: t.chipBg,
      gap: 10,
    },
    peekRowThumbWrap: {
      width: 72,
      height: 72,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: t.cardHighest,
      position: 'relative',
    },
    peekRowThumb: { width: '100%', height: '100%' },
    peekRowThumbScrim: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    peekRowBody: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 4 },
    peekCheckBox: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.cardHighest,
      alignItems: 'center',
      justifyContent: 'center',
    },
    peekRowTitle: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.text,
    },
    peekRowMeta: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: 11,
      color: t.textMuted,
    },
    peekDelBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
    },

    // Checklist grid (kept)
    checklistCard: { padding: 12 },
    checklistLabel: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    checklistHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    checklistColHeader: {
      width: 40,
      marginHorizontal: 2,
      textAlign: 'center',
      fontSize: t.type.labelSm - 1,
      color: t.textMuted,
      fontWeight: '700',
    },
    checklistRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 2,
    },
    checklistRowLabel: {
      width: 110,
      fontSize: t.type.labelSm - 1,
      color: t.text,
      fontWeight: '600',
    },
    checklistCell: {
      width: 40,
      height: 30,
      marginHorizontal: 2,
      borderRadius: 6,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
    },
    checklistCellText: {
      color: t.textInverse,
      fontSize: t.type.labelSm,
      fontWeight: '800',
    },

    // Fullscreen viewer
    fsRoot: { flex: 1, backgroundColor: '#000' },
    fsImgWrap: { flex: 1, overflow: 'hidden' },
    fsImg: { flex: 1, width: '100%' },
    fsMeta: {
      position: 'absolute',
      top: 50,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    fsMetaText: {
      color: '#fff',
      fontSize: t.type.bodyMd,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 14,
    },
    fsHint: {
      position: 'absolute',
      bottom: 100,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    fsHintText: {
      color: '#fff',
      fontSize: t.type.labelSm,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
    },
    fsCloseBtn: {
      position: 'absolute',
      top: 50,
      right: 16,
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    fsCloseText: { color: '#fff', fontSize: 28, fontWeight: '900', lineHeight: 30 },
    fsDelBtn: {
      position: 'absolute',
      bottom: 32,
      left: 24,
      right: 24,
      backgroundColor: t.danger,
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 14,
      alignItems: 'center',
      minHeight: 56,
      justifyContent: 'center',
    },
    fsDelText: { color: t.textInverse, fontSize: t.type.btn, fontWeight: '700' },
  });
}
