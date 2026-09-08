// Pure YOLO ONNX postprocessing — no RN/Expo deps, mirrors manifest.ts's testability pattern.
// Class order here MUST match the order used in the model's training data.yaml,
// not just this app's own AssetType list — they happen to coincide today.

export interface Detection {
  classId: number;
  className: string;
  conf: number;
  /** cx, cy, w, h — in model input space (e.g. 0..640). */
  box: [number, number, number, number];
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ax1 = a[0] - a[2] / 2;
  const ay1 = a[1] - a[3] / 2;
  const ax2 = a[0] + a[2] / 2;
  const ay2 = a[1] + a[3] / 2;
  const bx1 = b[0] - b[2] / 2;
  const by1 = b[1] - b[3] / 2;
  const bx2 = b[0] + b[2] / 2;
  const by2 = b[1] + b[3] / 2;

  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const interW = Math.max(0, ix2 - ix1);
  const interH = Math.max(0, iy2 - iy1);
  const inter = interW * interH;
  if (inter <= 0) return 0;

  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - by1);
  return inter / (areaA + areaB - inter);
}

export function nms(dets: Detection[], iouThreshold: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.conf - a.conf);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k.box, d.box) < iouThreshold)) kept.push(d);
  }
  return kept;
}

/**
 * Parses a YOLOv8-style ONNX output tensor into detections. Generic over the
 * runtime `dims` (channels-first `[1, 4+numClasses, N]` or channels-last
 * `[1, N, 4+numClasses]`) since export flags can flip the layout — don't
 * assume `[1, N, 8400]`.
 */
export function postprocess(
  data: Float32Array,
  dims: number[],
  classNames: string[],
  confThreshold = 0.4,
  iouThreshold = 0.45,
): Detection[] {
  const numClasses = classNames.length;
  const channelsFirst = dims[1] === 4 + numClasses;
  const numPreds = channelsFirst ? dims[2] : dims[1];
  const stride = 4 + numClasses;
  const get = (i: number, ch: number): number =>
    channelsFirst ? data[ch * numPreds + i] : data[i * stride + ch];

  const candidates: Detection[] = [];
  for (let i = 0; i < numPreds; i++) {
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = get(i, 4 + c);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < confThreshold) continue;
    candidates.push({
      classId: bestClass,
      className: classNames[bestClass] ?? `class_${bestClass}`,
      conf: bestScore,
      box: [get(i, 0), get(i, 1), get(i, 2), get(i, 3)],
    });
  }
  return nms(candidates, iouThreshold);
}

/** `[frame=0142] class=traffic_signal conf=0.94 infer_ms=162 fps=6.2 detections=1` */
export function formatDetectionLog(
  frame: number,
  det: Detection | null,
  inferMs: number,
  totalDetections: number,
): string {
  const f = `frame=${String(frame).padStart(4, '0')}`;
  const fps = (1000 / inferMs).toFixed(1);
  if (!det) {
    return `[${f}] class=none conf=0.00 infer_ms=${inferMs.toFixed(0)} fps=${fps} detections=0`;
  }
  return `[${f}] class=${det.className} conf=${det.conf.toFixed(2)} infer_ms=${inferMs.toFixed(0)} fps=${fps} detections=${totalDetections}`;
}

export function logDetections(frame: number, dets: Detection[], inferMs: number): void {
  if (dets.length === 0) {
    console.log(formatDetectionLog(frame, null, inferMs, 0));
    return;
  }
  for (const d of dets) {
    console.log(formatDetectionLog(frame, d, inferMs, dets.length));
  }
}
