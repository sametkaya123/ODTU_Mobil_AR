// Pure-Node test for YOLO postprocess/NMS/log formatting. No RN/Expo deps —
// inline copy mirroring src/lib/yolo.ts, same convention as manifest.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

function iou(a, b) {
  const ax1 = a[0] - a[2] / 2, ay1 = a[1] - a[3] / 2, ax2 = a[0] + a[2] / 2, ay2 = a[1] + a[3] / 2;
  const bx1 = b[0] - b[2] / 2, by1 = b[1] - b[3] / 2, bx2 = b[0] + b[2] / 2, by2 = b[1] + b[3] / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter <= 0) return 0;
  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - by1);
  return inter / (areaA + areaB - inter);
}

function nms(dets, iouThreshold) {
  const sorted = [...dets].sort((a, b) => b.conf - a.conf);
  const kept = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k.box, d.box) < iouThreshold)) kept.push(d);
  }
  return kept;
}

function postprocess(data, dims, classNames, confThreshold = 0.4, iouThreshold = 0.45) {
  const numClasses = classNames.length;
  const channelsFirst = dims[1] === 4 + numClasses;
  const numPreds = channelsFirst ? dims[2] : dims[1];
  const stride = 4 + numClasses;
  const get = (i, ch) => (channelsFirst ? data[ch * numPreds + i] : data[i * stride + ch]);

  const candidates = [];
  for (let i = 0; i < numPreds; i++) {
    let bestClass = -1, bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = get(i, 4 + c);
      if (s > bestScore) { bestScore = s; bestClass = c; }
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

function formatDetectionLog(frame, det, inferMs, totalDetections) {
  const f = `frame=${String(frame).padStart(4, '0')}`;
  const fps = (1000 / inferMs).toFixed(1);
  if (!det) return `[${f}] class=none conf=0.00 infer_ms=${inferMs.toFixed(0)} fps=${fps} detections=0`;
  return `[${f}] class=${det.className} conf=${det.conf.toFixed(2)} infer_ms=${inferMs.toFixed(0)} fps=${fps} detections=${totalDetections}`;
}

const CLASSES = ['traffic_signal', 'cabinet'];

// Channels-first [1, 4+numClasses, N]: 3 candidate boxes, one below threshold.
function buildChannelsFirst() {
  // box0: signal, conf 0.9, centered at (100,100,20,20)
  // box1: signal, conf 0.8, heavily overlapping box0 -> should be NMS'd away
  // box2: cabinet, conf 0.3 -> below 0.4 threshold, dropped
  const boxes = [
    [100, 100, 20, 20],
    [102, 101, 20, 20],
    [300, 300, 20, 20],
  ];
  const scores = [
    [0.9, 0.0],
    [0.8, 0.0],
    [0.0, 0.3],
  ];
  const n = boxes.length;
  const dims = [1, 4 + CLASSES.length, n];
  const data = new Float32Array(dims[1] * n);
  for (let i = 0; i < n; i++) {
    data[0 * n + i] = boxes[i][0];
    data[1 * n + i] = boxes[i][1];
    data[2 * n + i] = boxes[i][2];
    data[3 * n + i] = boxes[i][3];
    data[4 * n + i] = scores[i][0];
    data[5 * n + i] = scores[i][1];
  }
  return { data, dims };
}

test('confThreshold drops low-score predictions', () => {
  const { data, dims } = buildChannelsFirst();
  const dets = postprocess(data, dims, CLASSES, 0.4, 0.45);
  assert.ok(dets.every((d) => d.conf >= 0.4));
  assert.ok(!dets.some((d) => d.className === 'cabinet'), 'cabinet at conf=0.3 must be dropped');
});

test('NMS keeps only the higher-confidence overlapping box', () => {
  const { data, dims } = buildChannelsFirst();
  const dets = postprocess(data, dims, CLASSES, 0.4, 0.45);
  const signals = dets.filter((d) => d.className === 'traffic_signal');
  assert.equal(signals.length, 1, 'overlapping box1 (conf 0.8) must be suppressed by box0 (conf 0.9)');
  // Float32Array storage rounds 0.9 to ~0.8999999761581421 — compare with tolerance.
  assert.ok(Math.abs(signals[0].conf - 0.9) < 1e-4);
});

test('postprocess is equivalent for a channels-last [1, N, 4+numClasses] layout', () => {
  const first = buildChannelsFirst();
  const n = first.dims[2];
  const stride = 4 + CLASSES.length;
  const dataLast = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < stride; ch++) {
      dataLast[i * stride + ch] = first.data[ch * n + i];
    }
  }
  const dimsLast = [1, n, stride];

  const a = postprocess(first.data, first.dims, CLASSES, 0.4, 0.45);
  const b = postprocess(dataLast, dimsLast, CLASSES, 0.4, 0.45);
  assert.deepEqual(
    a.map((d) => [d.className, d.conf]),
    b.map((d) => [d.className, d.conf]),
  );
});

test('formatDetectionLog matches the spec format exactly', () => {
  const det = { classId: 0, className: 'traffic_signal', conf: 0.94, box: [0, 0, 0, 0] };
  assert.equal(
    formatDetectionLog(142, det, 162.4, 1),
    '[frame=0142] class=traffic_signal conf=0.94 infer_ms=162 fps=6.2 detections=1',
  );
  assert.equal(
    formatDetectionLog(143, null, 158.0, 0),
    '[frame=0143] class=none conf=0.00 infer_ms=158 fps=6.3 detections=0',
  );
});
