import {parentPort, workerData, Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';

export const semanticWidth = 416, semanticHeight = 234;
export const semanticFrameBytes = semanticWidth * semanticHeight * 3;
const model = fileURLToPath(new URL('./models/yolox_nano.onnx', import.meta.url));

// Official YOLOX-Nano export: raw [1,3549,85], stride grids 8/16/32, BGR CHW 0..255.
// https://github.com/Megvii-BaseDetection/YOLOX/tree/main/demo/ONNXRuntime
export function decodeYolox(data, dims) {
  if (dims.join(',') !== '1,3549,85' || data.length !== 3549 * 85) throw new Error('Unsupported local detector output');
  const boxes = [];
  let row = 0;
  for (const stride of [8, 16, 32]) {
    const cells = 416 / stride;
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++, row++) {
      const offset = row * 85;
      let classId = 0, score = 0;
      for (let c = 0; c < 80; c++) {
        const confidence = data[offset + 4] * data[offset + 5 + c];
        if (!Number.isFinite(confidence)) throw new Error('Non-finite local detector output');
        if (confidence > score) {score = confidence; classId = c;}
      }
      if (score < 0.25) continue;
      const cx = (data[offset] + x) * stride, cy = (data[offset + 1] + y) * stride;
      const w = Math.exp(data[offset + 2]) * stride, h = Math.exp(data[offset + 3]) * stride;
      if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('Invalid local detector box');
      const x0 = Math.max(0, (cx - w / 2) / semanticWidth), y0 = Math.max(0, (cy - h / 2) / semanticHeight);
      const x1 = Math.min(1, (cx + w / 2) / semanticWidth), y1 = Math.min(1, (cy + h / 2) / semanticHeight);
      if (x1 > x0 && y1 > y0) boxes.push({x0, y0, x1, y1, classId, score});
      // No NMS: protecting the union of duplicate boxes cannot uncover a detected subject.
      if (boxes.length > 500) throw new Error('Local detector output is unreliable');
    }
  }
  return boxes;
}

export function detectObjects(frames, {signal, modelPath = process.env.SELENE_PLACEMENT_MODEL || model} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./placement-semantic.mjs', import.meta.url), {workerData: {frames, modelPath}});
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    worker.once('message', message => message.error ? finish(new Error(message.error)) : finish(null, message.boxes));
    worker.once('error', error => finish(error));
    worker.once('exit', code => {if (code !== 0 && !signal?.aborted) finish(new Error('Local detector stopped'));});
  });
}

if (parentPort) {
  try {
    const ort = await import('onnxruntime-node');
    const session = await ort.InferenceSession.create(workerData.modelPath, {executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1});
    const pixels = new Float32Array(3 * 416 * 416), boxes = [];
    for (const frame of workerData.frames) {
      if (frame.length !== semanticFrameBytes) throw new Error('Invalid semantic source pixels');
      pixels.fill(114);
      for (let p = 0; p < semanticWidth * semanticHeight; p++) for (let c = 0; c < 3; c++) pixels[c * 416 * 416 + p] = frame[p * 3 + c];
      const output = await session.run({[session.inputNames[0]]: new ort.Tensor('float32', pixels, [1, 3, 416, 416])});
      const tensor = output[session.outputNames[0]];
      boxes.push(decodeYolox(tensor.data, tensor.dims));
    }
    await session.release();
    parentPort.postMessage({boxes});
  } catch (error) {parentPort.postMessage({error: error.message});}
}
