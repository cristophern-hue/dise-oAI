/**
 * Composites the brand logo onto a generated image using Canvas.
 * This is the only reliable way to ensure logo fidelity — generative models
 * always hallucinate logo variants, so we apply the real logo after generation.
 */

function sampleColor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): { r: number; g: number; b: number; brightness: number } {
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0;
    const px = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    r = r / px; g = g / px; b = b / px;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    return { r, g, b, brightness };
  } catch {
    return { r: 255, g: 255, b: 255, brightness: 255 };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function compositeLogoOntoBase64(
  imageBase64: string,
  brandKit: { logoDark?: string; logoLight?: string; logoBase64?: string; name: string },
): Promise<string> {
  const darkLogo = brandKit.logoDark || brandKit.logoBase64 || null;
  const lightLogo = brandKit.logoLight || null;

  if (!darkLogo && !lightLogo) {
    console.log('[logoComposite] no logo available for', brandKit.name);
    return imageBase64;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    // Detect format from base64 header (JPEG starts with /9j/, PNG with iVBOR)
    const mime = imageBase64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    const base = await loadImage(`data:${mime};base64,${imageBase64}`);
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    ctx.drawImage(base, 0, 0);

    const logoW = Math.floor(canvas.width * 0.13);
    const pad = Math.floor(canvas.width * 0.035);
    const sampleW = logoW + pad * 2;
    const sampleH = Math.floor(canvas.height * 0.12);
    const sampleX = canvas.width - sampleW;
    const sampleY = canvas.height - sampleH;

    // Sample background color in the logo area to choose version and clear correctly
    const { r, g, b, brightness } = sampleColor(ctx, sampleX, sampleY, sampleW, sampleH);

    // Choose logo version: dark logo by default, light only on very dark backgrounds
    const logoSrc = (brightness < 80 && lightLogo) ? lightLogo : (darkLogo || lightLogo);
    if (!logoSrc) return imageBase64;

    const logo = await loadImage(logoSrc);
    const scale = logoW / logo.naturalWidth;
    const logoH = Math.floor(logo.naturalHeight * scale);
    const x = canvas.width - logoW - pad;
    const y = canvas.height - logoH - pad;

    // Clear the logo area with the background color to erase any hallucinated logo underneath
    ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    ctx.fillRect(x - pad * 0.5, y - pad * 0.5, logoW + pad, logoH + pad);

    ctx.drawImage(logo, x, y, logoW, logoH);

    console.log(`[logoComposite] ✓ composited logo for ${brandKit.name} (brightness=${Math.round(brightness)}, version=${logoSrc === lightLogo ? 'light' : 'dark'})`);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
    return dataUrl.split(',')[1] || imageBase64;
  } catch (err) {
    console.error('[logoComposite] failed:', err);
    return imageBase64;
  }
}
