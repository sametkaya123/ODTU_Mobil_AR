// ONNX Runtime session lifecycle for the YOLO model-test screen. Session is
// created once (native model load is slow) and reused across frames.

import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import type { InferenceSession as InferenceSessionType } from 'onnxruntime-react-native';

const MODEL_INPUT_SIZE = 640;

type OrtModule = typeof import('onnxruntime-react-native');

// onnxruntime-react-native's top-level import calls a native module's
// install() as a side effect — undefined (and throws) on any platform
// without the native module (web). expo-router eagerly requires every file
// under app/ to build its route table, so a static top-level import here
// would crash the ENTIRE app on boot on web, not just this screen. require()
// it lazily instead, only once this function actually runs.
function getOrt(): OrtModule {
  if (Platform.OS === 'web') {
    throw new Error(
      '[onnx] onnxruntime-react-native is a native module and is not supported on web — open this screen on an Android/iOS dev client.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('onnxruntime-react-native') as OrtModule;
}

let sessionPromise: Promise<InferenceSessionType> | null = null;
let loggedOutputShape = false;

function loadSession(): Promise<InferenceSessionType> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { InferenceSession } = getOrt();
      // ponytail: require() path is fixed — the model must live at this exact
      // path (assets/models/best.onnx), dropped in locally, not committed.
      const asset = Asset.fromModule(require('../../assets/models/best.onnx'));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      return InferenceSession.create(uri);
    })();
  }
  return sessionPromise;
}

export interface InferenceResult {
  data: Float32Array;
  dims: number[];
}

export async function runInference(inputTensor: Float32Array): Promise<InferenceResult> {
  const session = await loadSession();
  const { Tensor } = getOrt();
  const inputName = session.inputNames[0];
  const feeds = {
    [inputName]: new Tensor('float32', inputTensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
  };
  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const output = results[outputName];

  // Export flags (half precision, transpose, opset) can change the output
  // layout — log the real shape once instead of assuming [1, N, 8400].
  if (!loggedOutputShape) {
    console.log(`[onnx] output="${outputName}" dims=${JSON.stringify(output.dims)} type=${output.type}`);
    loggedOutputShape = true;
  }

  if (output.type !== 'float32') {
    throw new Error(
      `[onnx] unexpected output type "${output.type}" — export the model with half=False (fp16 output isn't handled here)`,
    );
  }

  return { data: output.data as Float32Array, dims: [...output.dims] as number[] };
}
