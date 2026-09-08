// Lets `require('...best.onnx')` resolve as a Metro asset module (see metro.config.js assetExts).
declare module '*.onnx' {
  const asset: number;
  export default asset;
}
