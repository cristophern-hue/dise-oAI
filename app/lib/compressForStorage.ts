/**
 * Compresses a base64 image for session storage.
 * Reduces to max 512px wide at JPEG 60% — small enough for Supabase/Vercel
 * limits while retaining enough quality to restore session state.
 */
export async function compressBase64ForStorage(base64: string): Promise<string> {
  if (!base64) return base64;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    });
    const MAX = 512;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1] || base64;
  } catch {
    return base64;
  }
}

export async function compressImagesForStorage<T extends { base64: string }>(items: T[]): Promise<T[]> {
  return Promise.all(items.map(async item => ({
    ...item,
    base64: await compressBase64ForStorage(item.base64),
  })));
}
