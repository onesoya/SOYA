"use client";

type Progress = (message: string) => void;

export type BodyMediaSummary = {
  preparedFrames: number;
  sampledVideoFrames: number;
  skippedDuplicateFrames: number;
  reachedSafetyLimit: boolean;
};

type ConsumeBatch = (frames: string[], batchNumber: number, preparedFrames: number) => Promise<void>;

const BATCH_SIZE = 6;
const VIDEO_SAMPLE_SECONDS = 0.75;
const MAX_VIDEO_FRAMES = 240;
const DUPLICATE_DIFFERENCE = 0.45;

function waitFor(target: EventTarget, success: string, failure = "error") {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("선택한 파일을 읽지 못했어요."));
    };
    const cleanup = () => {
      target.removeEventListener(success, done);
      target.removeEventListener(failure, failed);
    };
    target.addEventListener(success, done, { once: true });
    target.addEventListener(failure, failed, { once: true });
  });
}

function frameDataUrl(source: CanvasImageSource, width: number, height: number) {
  const maxWidth = 1200;
  const maxHeight = 2200;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("이미지를 준비하지 못했어요.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function visualFingerprint(source: CanvasImageSource) {
  const width = 32;
  const height = 56;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("영상 장면을 비교하지 못했어요.");
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const result = new Uint8Array(width * height);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 4, targetIndex += 1) {
    result[targetIndex] = Math.round(pixels[sourceIndex] * 0.299 + pixels[sourceIndex + 1] * 0.587 + pixels[sourceIndex + 2] * 0.114);
  }
  return result;
}

function fingerprintDifference(previous: Uint8Array, current: Uint8Array) {
  let difference = 0;
  for (let index = 0; index < current.length; index += 1) difference += Math.abs(current[index] - previous[index]);
  return difference / current.length;
}

async function imageFrame(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    if (!image.complete) await waitFor(image, "load");
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("사진 크기를 확인하지 못했어요.");
    return frameDataUrl(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.01) return;
  const ready = waitFor(video, "seeked");
  video.currentTime = time;
  await ready;
}

async function openVideo(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  video.load();
  try {
    if (video.readyState < 1) await waitFor(video, "loadedmetadata");
    if (video.readyState < 2) await waitFor(video, "loadeddata");
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("동영상 길이를 확인하지 못했어요.");
    if (duration > 15 * 60) throw new Error("15분보다 긴 영상은 나누어서 선택해주세요.");
    return { video, duration, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function processBodyMedia(files: File[], progress: Progress, consume: ConsumeBatch): Promise<BodyMediaSummary> {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const videos = files.filter((file) => file.type.startsWith("video/"));
  if (images.length + videos.length !== files.length) throw new Error("사진 또는 동영상 파일만 선택할 수 있어요.");
  if (images.length > 24) throw new Error("사진은 한 번에 24장까지 선택해주세요.");

  let batch: string[] = [];
  let batchNumber = 0;
  let preparedFrames = 0;
  let sampledVideoFrames = 0;
  let skippedDuplicateFrames = 0;
  let retainedVideoFrames = 0;
  let reachedSafetyLimit = false;

  const flush = async () => {
    if (!batch.length) return;
    batchNumber += 1;
    const current = batch;
    batch = [];
    await consume(current, batchNumber, preparedFrames);
  };

  const append = async (frame: string) => {
    batch.push(frame);
    preparedFrames += 1;
    if (batch.length >= BATCH_SIZE) await flush();
  };

  for (let index = 0; index < images.length; index += 1) {
    progress(`사진을 준비하고 있어요 · ${index + 1}/${images.length}`);
    await append(await imageFrame(images[index]));
  }

  for (let fileIndex = 0; fileIndex < videos.length && !reachedSafetyLimit; fileIndex += 1) {
    progress(`${videos[fileIndex].name}에서 인바디 화면을 찾고 있어요`);
    const { video, duration, release } = await openVideo(videos[fileIndex]);
    try {
      const samples = Math.max(2, Math.ceil(duration / VIDEO_SAMPLE_SECONDS) + 1);
      const end = Math.max(0, duration - 0.08);
      let previousFingerprint: Uint8Array | undefined;
      for (let index = 0; index < samples; index += 1) {
        if (retainedVideoFrames >= MAX_VIDEO_FRAMES) {
          reachedSafetyLimit = true;
          break;
        }
        const time = samples === 1 ? 0 : end * index / (samples - 1);
        sampledVideoFrames += 1;
        progress(`영상 전체를 확인하고 있어요 · ${index + 1}/${samples} · 인바디 화면 ${retainedVideoFrames}개 발견`);
        await seek(video, time);
        if (!video.videoWidth || !video.videoHeight) continue;
        const fingerprint = visualFingerprint(video);
        if (previousFingerprint && fingerprintDifference(previousFingerprint, fingerprint) < DUPLICATE_DIFFERENCE) {
          skippedDuplicateFrames += 1;
          continue;
        }
        previousFingerprint = fingerprint;
        retainedVideoFrames += 1;
        await append(frameDataUrl(video, video.videoWidth, video.videoHeight));
      }
    } finally {
      release();
    }
  }

  await flush();
  if (!preparedFrames) throw new Error("분석할 인바디 화면을 만들지 못했어요.");
  return { preparedFrames, sampledVideoFrames, skippedDuplicateFrames, reachedSafetyLimit };
}
