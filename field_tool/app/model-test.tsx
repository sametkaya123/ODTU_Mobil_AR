// Model Testi — YOLO ONNX inference measurement tool. Not a demo: minimal UI,
// no extra render overhead beyond what's needed to read ms/FPS off the phone
// and stream a parseable log to the Metro terminal for offline analysis.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { toByteArray } from 'base64-js';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { IconSymbol } from '@/components/StatTile';
import { runInference } from '@/lib/onnx';
import { postprocess, logDetections, type Detection } from '@/lib/yolo';
import type { AssetType } from '@/types/domain';

const MODEL_SIZE = 640;
const CONF_THRESHOLD = 0.4;
const IOU_THRESHOLD = 0.45;
const CAMERA_WARMUP_MS = 400;

// Model's classes, in the exact order embedded in best.onnx's own metadata
// (Netron / onnxruntime get_modelmeta().custom_metadata_map['names'] ->
// {0: 'bus_stop', 1: 'cabinet', 2: 'traffic_signal'}) — NOT alphabetical and
// NOT the order AssetType happens to be declared in. If you swap in a
// different best.onnx, re-check its embedded names before trusting labels.
const CLASS_NAMES: readonly AssetType[] = ['bus_stop', 'cabinet', 'traffic_signal'];

/**
 * Full-sensor JPEG -> letterboxed 640x640 Float32 NCHW tensor. Native resize
 * first (cheap), pure-JS decode only ever touches the already-shrunk image.
 */
async function preprocessFrame(uri: string, srcWidth: number, srcHeight: number) {
  const scale = MODEL_SIZE / Math.max(srcWidth, srcHeight);
  const resizeW = Math.max(1, Math.round(srcWidth * scale));
  const resizeH = Math.max(1, Math.round(srcHeight * scale));

  const manipulated = await manipulateAsync(uri, [{ resize: { width: resizeW, height: resizeH } }], {
    base64: true,
    format: SaveFormat.JPEG,
    compress: 0.9,
  });
  const bytes = toByteArray(manipulated.base64!);
  const raw = jpeg.decode(bytes, { useTArray: true });

  const padX = Math.floor((MODEL_SIZE - raw.width) / 2);
  const padY = Math.floor((MODEL_SIZE - raw.height) / 2);
  const plane = MODEL_SIZE * MODEL_SIZE;
  // Ultralytics letterbox fills with mid-gray (114/255), not black.
  const tensor = new Float32Array(3 * plane).fill(114 / 255);
  for (let y = 0; y < raw.height; y++) {
    const rowBase = y * raw.width;
    const dy = y + padY;
    for (let x = 0; x < raw.width; x++) {
      const s = (rowBase + x) * 4;
      const dx = x + padX;
      const di = dy * MODEL_SIZE + dx;
      tensor[di] = raw.data[s] / 255;
      tensor[plane + di] = raw.data[s + 1] / 255;
      tensor[2 * plane + di] = raw.data[s + 2] / 255;
    }
  }
  return { tensor, scale, padX, padY };
}

export default function ModelTestScreen() {
  const t = useTheme();
  const styles = makeStyles(t);
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);

  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferMs, setInferMs] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const runningRef = useRef(false);
  const frameIndexRef = useRef(0);
  // Last captured photo's own pixel size — needed to map model-space boxes
  // back to the on-screen preview rect (approximates the preview as a
  // center-cropped "cover" fit of the same-aspect photo; exact only if the
  // CameraView's fill matches the photo aspect).
  const photoSizeRef = useRef({ width: 1, height: 1 });
  const geomRef = useRef({ scale: 1, padX: 0, padY: 0 });

  const loop = useCallback(async () => {
    if (!runningRef.current || !camRef.current) return;
    try {
      // Cycle time (capture + preprocess + inference + postprocess) is what
      // actually gates this loop, so infer_ms/fps reflect that whole cycle —
      // expo-camera has no frame-processor API, so there's no cheaper way to
      // sample a "frame" than a still capture.
      const t0 = performance.now();
      const photo = await camRef.current.takePictureAsync({ skipProcessing: true });
      if (!photo?.uri) return;
      photoSizeRef.current = { width: photo.width, height: photo.height };

      const { tensor, scale, padX, padY } = await preprocessFrame(photo.uri, photo.width, photo.height);
      geomRef.current = { scale, padX, padY };
      const { data, dims } = await runInference(tensor);
      const dets = postprocess(data, dims, [...CLASS_NAMES], CONF_THRESHOLD, IOU_THRESHOLD);
      const ms = performance.now() - t0;

      logDetections(frameIndexRef.current, dets, ms);
      frameIndexRef.current += 1;
      setDetections(dets);
      setInferMs(ms);
      setFps(1000 / ms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (runningRef.current) {
        requestAnimationFrame(() => {
          void loop();
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!perm?.granted) return;
    runningRef.current = true;
    setPaused(false);
    const warmup = setTimeout(() => {
      void loop();
    }, CAMERA_WARMUP_MS);
    return () => {
      runningRef.current = false;
      clearTimeout(warmup);
    };
  }, [perm?.granted, loop]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      runningRef.current = !next;
      if (!next) void loop();
      return next;
    });
  }, [loop]);

  const reset = useCallback(() => {
    frameIndexRef.current = 0;
    setDetections([]);
    setInferMs(null);
    setFps(null);
    setError(null);
  }, []);

  const onPreviewLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewSize({ width, height });
  }, []);

  if (!perm) {
    return <SafeAreaView style={styles.safe} />;
  }

  if (!perm.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <IconSymbol name="videocam" size={32} color={t.textMuted} />
          <Text style={[styles.body, { marginTop: 12, textAlign: 'center' }]}>
            Model testi için kamera izni gerekli.
          </Text>
          <Pressable style={[styles.btn, styles.btnPrimary, { marginTop: 16 }]} onPress={() => requestPerm()}>
            <Text style={styles.btnText}>İzin Ver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Photo -> preview mapping: photo is letterboxed into MODEL_SIZE square at
  // {scale, padX, padY}. Preview is assumed to "cover"-fit the photo (fill
  // the view, cropping overflow) — matches CameraView's default preview fill.
  const { scale: geomScale, padX: geomPadX, padY: geomPadY } = geomRef.current;
  const { width: photoW, height: photoH } = photoSizeRef.current;
  const coverScale =
    previewSize.width > 0 ? Math.max(previewSize.width / photoW, previewSize.height / photoH) : 0;
  const coverOffsetX = (previewSize.width - photoW * coverScale) / 2;
  const coverOffsetY = (previewSize.height - photoH * coverScale) / 2;
  const toScreen = (origX: number, origY: number) => ({
    x: origX * coverScale + coverOffsetX,
    y: origY * coverScale + coverOffsetY,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.previewWrap} onLayout={onPreviewLayout}>
        <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />

        {previewSize.width > 0 && previewSize.height > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {detections.map((d, i) => {
              const [cx, cy, w, h] = d.box;
              const { x, y } = toScreen((cx - w / 2 - geomPadX) / geomScale, (cy - h / 2 - geomPadY) / geomScale);
              const bw = (w / geomScale) * coverScale;
              const bh = (h / geomScale) * coverScale;
              return (
                <Rect
                  key={i}
                  x={x}
                  y={y}
                  width={bw}
                  height={bh}
                  fill="none"
                  stroke={t.signal}
                  strokeWidth={2}
                />
              );
            })}
            {detections.map((d, i) => {
              const [cx, cy, w, h] = d.box;
              const { x, y } = toScreen((cx - w / 2 - geomPadX) / geomScale, (cy - h / 2 - geomPadY) / geomScale);
              return (
                <SvgText key={`l${i}`} x={x + 4} y={Math.max(14, y - 6)} fill={t.signal} fontSize={13} fontWeight="bold">
                  {`${d.className} ${d.conf.toFixed(2)}`}
                </SvgText>
              );
            })}
          </Svg>
        )}

        <View style={styles.topBar} pointerEvents="none">
          <Text style={styles.topBarText}>
            FPS: {fps != null ? fps.toFixed(1) : '—'}   Inference: {inferMs != null ? `${inferMs.toFixed(0)}ms` : '—'}
          </Text>
          {error && (
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.btn, paused ? styles.btnPrimary : styles.btnDanger]} onPress={togglePause}>
          <IconSymbol name={paused ? 'play_arrow' : 'pause'} size={18} color={t.textInverse} />
          <Text style={styles.btnText}>{paused ? 'Devam Et' : 'Duraklat'}</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnSecondary]} onPress={reset}>
          <IconSymbol name="restart_alt" size={18} color={t.text} />
          <Text style={[styles.btnText, { color: t.text }]}>Reset</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.previewBg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { color: t.text, fontSize: t.type.bodyMd },
    previewWrap: { flex: 1, backgroundColor: t.previewBg, overflow: 'hidden' },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 12,
      paddingBottom: 10,
      paddingHorizontal: 14,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    topBarText: { color: '#fff', fontSize: t.type.dataMonoMd, fontFamily: 'monospace', fontWeight: '700' },
    errorText: { color: '#FF6B6B', fontSize: t.type.labelSm, marginTop: 4 },
    bottomBar: {
      flexDirection: 'row',
      gap: 12,
      padding: 12,
      backgroundColor: t.bg,
    },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      minHeight: 52,
    },
    btnPrimary: { backgroundColor: t.primary },
    btnDanger: { backgroundColor: t.danger },
    btnSecondary: { backgroundColor: t.chipBg, borderWidth: 1, borderColor: t.border },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
  });
}
