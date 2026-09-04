import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import type { AngleSlug, DistanceM, LightSlug, PostureSlug, ReferenceImage } from '@/types/domain';

const DISTANCES: readonly DistanceM[] = [5, 10, 15, 20, 30];

type Phase = 'IDLE' | 'PREVIEW' | 'CAPTURING' | 'SAVED';

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

  useEffect(() => {
    loadShots();
  }, [loadShots]);

  useEffect(() => {
    if (distance && angle && light && posture && phase === 'IDLE') setPhase('PREVIEW');
    if ((!distance || !angle || !light || !posture) && phase === 'PREVIEW') setPhase('IDLE');
  }, [distance, angle, light, posture, phase]);

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
      // Optimistic UI update — refresh table + grid immediately, then reconcile.
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

  const done = useMemo(() => doneKeys(shots, aId), [shots, aId]);

  // Checklist grid is still 5×6 (distance×angle). A cell counts as filled if
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
      <View style={styles.preview}>
        {phase === 'SAVED' && pendingUri ? (
          <Pressable
            style={styles.previewFill}
            onPress={() => setFullscreen({ kind: 'preview' })}
          >
            <Image source={{ uri: pendingUri }} style={styles.previewImg} resizeMode="contain" />
          </Pressable>
        ) : (
          <CameraView ref={camRef} style={styles.camera} facing="back" />
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          style={styles.bottom}
          contentContainerStyle={styles.bottomContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.assetBadge}>
            <Text style={styles.assetBadgeText}>{aId}</Text>
          </View>

          {phase !== 'SAVED' && (
            <>
              <Text style={styles.section}>Mesafe</Text>
              <View style={styles.chips}>
                {DISTANCES.map((d) => (
                  <Chip key={d} active={distance === d} onPress={() => setDistance(d)} t={t}>
                    {d}m
                  </Chip>
                ))}
              </View>

              <Text style={styles.section}>Açı</Text>
              <View style={styles.chips}>
                {ANGLE_SLUGS.map((a) => (
                  <Chip key={a} active={angle === a} onPress={() => setAngle(a)} t={t}>
                    {ANGLE_LABELS[a]}
                  </Chip>
                ))}
              </View>

              <Text style={styles.section}>Işık</Text>
              <View style={styles.chips}>
                {LIGHT_SLUGS.map((l) => (
                  <Chip key={l} active={light === l} onPress={() => setLight(l)} t={t}>
                    {LIGHT_LABELS[l]}
                  </Chip>
                ))}
              </View>

              <Text style={styles.section}>Duruş</Text>
              <View style={styles.chips}>
                {POSTURE_SLUGS.map((p) => (
                  <Chip
                    key={p}
                    active={posture === p}
                    onPress={() => setPosture(p)}
                    t={t}
                  >
                    {POSTURE_LABELS[p]}
                  </Chip>
                ))}
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  phase !== 'PREVIEW' && styles.btnDisabled,
                  pressed && phase === 'PREVIEW' && styles.pressed,
                ]}
                onPress={capture}
                disabled={phase !== 'PREVIEW'}
              >
                <Text style={styles.btnText}>
                  {phase === 'CAPTURING' ? '⏳ Çekiliyor…' : '📸 Çek'}
                </Text>
              </Pressable>
            </>
          )}

          {phase === 'SAVED' && (
            <View style={styles.actionCard}>
              <Text style={styles.section}>Bu çekimi ne yapalım?</Text>
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

          <Text style={styles.section}>Eksik kombinasyonlar ({doneCells.size}/30)</Text>
          <Checklist done={doneCells} candidateKey={candidateKey} t={t} />

          {shots.length > 0 && (
            <>
              <Text style={styles.section}>Çekilen fotoğraflar ({shots.length})</Text>
              <Text style={styles.help}>Fotoğrafa dokun → tam ekran açılır.</Text>
              <View style={styles.shotGrid}>
                {shots
                  .slice()
                  .sort((a, b) => a.file_index - b.file_index)
                  .map((s) => (
                    <ShotThumb
                      key={`${s.file_index}-${s.captured_at}`}
                      uri={photoPath(ixId, aId, s.file_index)}
                      shot={s}
                      onOpen={() => setFullscreen({ kind: 'shot', shot: s })}
                      onDelete={() => deleteShot(s)}
                      t={t}
                    />
                  ))}
              </View>
            </>
          )}
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
            t={t}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function FullscreenViewer({ uri, meta, showDelete, onClose, onDelete, t }: {
  uri: string;
  meta: string;
  showDelete: boolean;
  onClose: () => void;
  onDelete?: () => void;
  t: ReturnType<typeof useTheme>;
}) {
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
    <View style={fs(t).root}>
      <View {...panResponder.panHandlers} style={fs(t).imgWrap}>
        <Image
          source={{ uri }}
          style={[
            fs(t).img,
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
      <View style={fs(t).meta} pointerEvents="none">
        <Text style={fs(t).metaText}>{meta}</Text>
      </View>
      <View style={fs(t).hint} pointerEvents="none">
        <Text style={fs(t).hintText}>{hint}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [fs(t).closeBtn, pressed && { opacity: 0.5 }]}
        onPress={onClose}
        hitSlop={12}
      >
        <Text style={fs(t).closeText}>×</Text>
      </Pressable>
      {showDelete && onDelete ? (
        <Pressable
          style={({ pressed }) => [fs(t).delBtn, pressed && { opacity: 0.7 }]}
          onPress={onDelete}
        >
          <Text style={fs(t).delText}>🗑  Fotoğrafı Sil</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chip({
  active,
  onPress,
  children,
  t,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        {
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.chipBg,
        },
        active && { backgroundColor: t.primary, borderColor: t.primary },
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      <Text style={{ color: active ? t.textInverse : t.text, fontWeight: '600', fontSize: t.type.body - 1 }}>
        {children}
      </Text>
    </Pressable>
  );
}

function ShotThumb({
  uri,
  shot,
  onOpen,
  onDelete,
  t,
}: {
  uri: string;
  shot: ReferenceImage;
  onOpen: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={shotStyles(t).thumbWrap}>
      <Pressable style={shotStyles(t).thumbPressable} onPress={onOpen}>
        <Image source={{ uri }} style={shotStyles(t).thumb} resizeMode="cover" />
        <View style={shotStyles(t).thumbMeta}>
          <Text style={shotStyles(t).thumbMetaText} numberOfLines={1}>
            {shot.distance_m}m · {ANGLE_LABELS[shot.angle]} · {POSTURE_LABELS[shot.posture]}
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={({ pressed }) => [shotStyles(t).thumbDel, pressed && { opacity: 0.5 }]}
        onPress={onDelete}
        hitSlop={6}
      >
        <Text style={shotStyles(t).thumbDelText}>×</Text>
      </Pressable>
    </View>
  );
}

function Checklist({
  done,
  candidateKey,
  t,
}: {
  done: Set<string>;
  candidateKey: string | null;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ width: 110 }} />
        {DISTANCES.map((d) => (
          <Text
            key={d}
            style={{
              width: 44,
              textAlign: 'center',
              fontSize: t.type.caption - 1,
              color: t.textMuted,
              fontWeight: '700',
            }}
          >
            {d}m
          </Text>
        ))}
      </View>
      {ANGLE_SLUGS.map((a) => (
        <View key={a} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
          <Text style={{ width: 110, fontSize: t.type.caption - 1, color: t.text, fontWeight: '500' }}>
            {ANGLE_LABELS[a]}
          </Text>
          {DISTANCES.map((d) => {
            const key = `${d}|${a}`;
            const hit = done.has(key);
            const pending = !hit && candidateKey === key;
            const dup = hit && candidateKey === key;
            return (
              <View
                key={d}
                style={{
                  width: 40,
                  height: 30,
                  marginHorizontal: 2,
                  borderRadius: 6,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: dup
                    ? t.warn
                    : hit
                      ? t.ok
                      : pending
                        ? t.danger
                        : t.missingBg,
                  borderWidth: hit && !dup ? 0 : 1,
                  borderColor: dup ? t.warn : pending ? t.danger : t.border,
                }}
              >
                <Text style={{ color: t.textInverse, fontSize: t.type.caption, fontWeight: '800' }}>
                  {dup ? '⚠' : hit || pending ? '✓' : '·'}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    warn: { fontSize: t.type.title, color: t.warn, marginBottom: 12, fontWeight: '700' },
    preview: {
      height: 240,
      backgroundColor: t.previewBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewFill: { width: '100%', flex: 1, alignItems: 'stretch', justifyContent: 'center' },
    camera: { flex: 1, width: '100%' },
    previewImg: { width: '100%', height: '100%' },
    bottom: { flex: 1, backgroundColor: t.bg },
    bottomContent: { padding: 12, paddingBottom: 32 },
    assetBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 14,
      backgroundColor: t.primary,
    },
    assetBadgeText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.caption },
    section: {
      marginTop: 16,
      marginBottom: 6,
      fontSize: t.type.caption,
      color: t.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    help: { fontSize: t.type.caption - 1, color: t.textMuted, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    btn: {
      marginTop: 16,
      backgroundColor: t.primary,
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
    btnDanger: { backgroundColor: t.danger },
    btnDisabled: { opacity: 0.4 },
    btnTopMargin: { marginTop: 10 },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    actionCard: {
      backgroundColor: t.card,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    shotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  });
}

function shotStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    thumbWrap: {
      width: 104,
      height: 104,
      borderRadius: 12,
      backgroundColor: t.missingBg,
      borderWidth: 1,
      borderColor: t.border,
      position: 'relative',
    },
    thumbPressable: { width: '100%', height: '100%', overflow: 'hidden', borderRadius: 12 },
    thumb: { width: '100%', height: '100%' },
    thumbMeta: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingVertical: 3,
      paddingHorizontal: 6,
    },
    thumbMetaText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    thumbDel: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbDelText: { color: '#fff', fontWeight: '900', fontSize: 18, lineHeight: 20 },
  });
}

function fs(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    imgWrap: { flex: 1, overflow: 'hidden' },
    img: { flex: 1, width: '100%' },
    meta: {
      position: 'absolute',
      top: 50,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    metaText: {
      color: '#fff',
      fontSize: t.type.body,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 14,
    },
    hint: {
      position: 'absolute',
      bottom: 100,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    hintText: {
      color: '#fff',
      fontSize: t.type.caption,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
    },
    closeBtn: {
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
    closeText: { color: '#fff', fontSize: 28, fontWeight: '900', lineHeight: 30 },
    delBtn: {
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
    delText: { color: t.textInverse, fontSize: t.type.btn, fontWeight: '700' },
  });
}
