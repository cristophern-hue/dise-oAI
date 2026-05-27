/**
 * Composites the brand logo onto a generated image using Canvas.
 * This is the only reliable way to ensure logo fidelity — generative models
 * always hallucinate logo variants, so we apply the real logo after generation.
 */

function detectBottomRightBrightness(
  ctx: CanvasRenderingContext2D,
  imgWidth: number,
  imgHeight: number,
): number {
  const regionW = Math.floor(imgWidth * 0.25);
  const regionH = Math.floor(imgHeight * 0.15);
  const x = imgWidth - regionW;
  const y = imgHeight - regionH;
  try {
    const data = ctx.getImageData(x, y, regionW, regionH).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (data.length / 4);
  } catch {
    return 128;
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

  if (!darkLogo && !lightLogo) return imageBase64;

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const base = await loadImage(`data:image/png;base64,${imageBase64}`);
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    ctx.drawImage(base, 0, 0);

    const brightness = detectBottomRightBrightness(ctx, canvas.width, canvas.height);
    // On dark bg (brightness < 140) use light logo; on light bg use dark logo
    let logoSrc: string | null = null;
    if (brightness < 140) {
      logoSrc = lightLogo || darkLogo;
    } else {
      logoSrc = darkLogo || lightLogo;
    }
    if (!logoSrc) return imageBase64;

    const logo = await loadImage(logoSrc);
    const logoW = Math.floor(canvas.width * 0.11);
    const scale = logoW / logo.naturalWidth;
    const logoH = Math.floor(logo.naturalHeight * scale);
    const pad = Math.floor(canvas.width * 0.035);
    const x = canvas.width - logoW - pad;
    const y = canvas.height - logoH - pad;

    ctx.drawImage(logo, x, y, logoW, logoH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
    return dataUrl.split(',')[1] || imageBase64;
  } catch {
    return imageBase64;
  }
}
