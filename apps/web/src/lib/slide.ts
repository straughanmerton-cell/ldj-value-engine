/**
 * 卖点幻灯片（客户 2026-09-26：「我就要做到 PPT 这种效果」）。
 *
 * 这一层只放**放映纸本身的几何与本地素材**，不碰任何出稿逻辑：
 * - 画布固定 **1280 × 720**（16:9），屏幕上按容器宽度整体缩放，导出 / 打印 1:1；
 * - 产品图**只存在这台机器的浏览器里**（localStorage，按卖点页 id 分开存），
 *   不上传服务器、不进数据库，删掉卖点页时一起清（见 clearSlideImage 的调用方）。
 *
 * 版式与配色对齐客户给的《八角亭卖点手卡（7.30）》：
 * 左栏可并排放**两张**产品图（正面包装 + 实物），右栏 01–04 四条同色系箭头块。
 */

/** 放映纸设计尺寸（px）。1280 × 720 = 13.333in × 7.5in @96dpi，与 PowerPoint 16:9 一一对应。 */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** 一页最多两张产品图（参考手卡就是「包装 + 实物」并排两栏）。 */
export const MAX_SLIDE_IMAGES = 2;

const IMAGE_KEY_PREFIX = "ldj.slide.images.";
/** 单图时代的旧 key，读的时候兜底一次，免得老用户存的图看起来丢了。 */
const LEGACY_IMAGE_KEY_PREFIX = "ldj.slide.image.";

/** 单张产品图上限 12MB：再大就不是手卡该有的清晰度了，先压一下。 */
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/** 压到长边 1400px：够投影和 A4 打印，也保证 localStorage 与 .pptx 不会爆。 */
const IMAGE_MAX_EDGE = 1400;

function imageKey(sessionId: string | null): string | null {
  return sessionId ? `${IMAGE_KEY_PREFIX}${sessionId}` : null;
}

/** 读这一页存过的产品图（最多两张；没有 / 存不进去都返回空数组，不抛错）。 */
export function readSlideImages(sessionId: string | null): string[] {
  const key = imageKey(sessionId);
  if (!key) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string" && item.startsWith("data:image/"))
          .slice(0, MAX_SLIDE_IMAGES);
      }
    }
    const legacy = window.localStorage.getItem(`${LEGACY_IMAGE_KEY_PREFIX}${sessionId}`);
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

export function writeSlideImages(sessionId: string | null, images: readonly string[]): void {
  const key = imageKey(sessionId);
  if (!key) {
    return;
  }
  try {
    const kept = images.slice(0, MAX_SLIDE_IMAGES);
    if (kept.length > 0) {
      window.localStorage.setItem(key, JSON.stringify(kept));
    } else {
      window.localStorage.removeItem(key);
    }
    window.localStorage.removeItem(`${LEGACY_IMAGE_KEY_PREFIX}${sessionId}`);
  } catch {
    // 配额满了也不许把页面搞崩：图放不下就退化为「这一页不放图」。
  }
}

/** 删掉卖点页时顺手清掉本机存的图，免得 localStorage 越积越多。 */
export function clearSlideImage(sessionId: string): void {
  const key = imageKey(sessionId);
  if (!key) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${LEGACY_IMAGE_KEY_PREFIX}${sessionId}`);
  } catch {
    // 忽略：清不掉也不影响使用。
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari 对某些格式会抛错，落到 <img> 兜底。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("这张图读不出来，换一张试试"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 把用户选 / 拖 / 贴进来的图片压成一张可放进放映纸的 dataURL。
 * 只做等比缩放 + 白底铺满，不做裁剪，避免把包装上的字切掉。
 */
export async function fileToSlideImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选一张图片文件（jpg / png / webp）");
  }
  if (file.size > IMAGE_MAX_BYTES) {
    throw new Error("图片超过 12MB，先用手机 / 电脑压一下再放进来");
  }
  const source = await loadBitmap(file);
  const sourceW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sourceH = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!sourceW || !sourceH) {
    throw new Error("这张图读不出尺寸，换一张试试");
  }
  const ratio = Math.min(1, IMAGE_MAX_EDGE / Math.max(sourceW, sourceH));
  const width = Math.max(1, Math.round(sourceW * ratio));
  const height = Math.max(1, Math.round(sourceH * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("这台设备的浏览器不支持处理图片");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

/** 文件名里不能出现 `\ / : * ? " < > |`，顺手把空白收成下划线。 */
export function safeFileName(text: string, fallback: string): string {
  const cleaned = (text || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "_")
    .trim();
  return cleaned || fallback;
}
