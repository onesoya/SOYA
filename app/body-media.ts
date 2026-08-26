"use client";

type Progress = (message: string) => void;

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

async function videoFrames(file: File, limit: number, progress: Progress) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
    if (video.readyState < 1) await waitFor(video, "loadedmetadata");
    if (video.readyState < 2) await waitFor(video, "loadeddata");
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("동영상 길이를 확인하지 못했어요.");
    if (duration > 15 * 60) throw new Error("15분보다 긴 영상은 나누어서 선택해주세요.");
    const count = Math.min(limit, Math.max(2, Math.ceil(duration / 1.25)));
    const end = Math.max(0, duration - 0.08);
    const frames: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const time = count === 1 ? 0 : end * index / (count - 1);
      progress(`영상 장면을 준비하고 있어요 · ${index + 1}/${count}`);
      await seek(video, time);
      if (!video.videoWidth || !video.videoHeight) continue;
      frames.push(frameDataUrl(video, video.videoWidth, video.videoHeight));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareBodyMedia(files: File[], progress: Progress) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const videos = files.filter((file) => file.type.startsWith("video/"));
  if (images.length + videos.length !== files.length) throw new Error("사진 또는 동영상 파일만 선택할 수 있어요.");
  if (images.length > 24) throw new Error("사진은 한 번에 24장까지 선택해주세요.");
  const frames: string[] = [];
  for (let index = 0; index < images.length; index += 1) {
    progress(`사진을 준비하고 있어요 · ${index + 1}/${images.length}`);
    frames.push(await imageFrame(images[index]));
  }
  const remaining = Math.max(0, 48 - frames.length);
  const perVideoLimit = videos.length ? Math.max(2, Math.floor(remaining / videos.length)) : 0;
  for (let index = 0; index < videos.length && frames.length < 48; index += 1) {
    progress(`${videos[index].name}에서 장면을 찾고 있어요`);
    const extracted = await videoFrames(videos[index], Math.min(perVideoLimit, 48 - frames.length), progress);
    frames.push(...extracted);
  }
  if (!frames.length) throw new Error("분석할 장면을 만들지 못했어요.");
  return frames.slice(0, 48);
}
