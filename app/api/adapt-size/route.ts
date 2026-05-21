import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

type Format =
  | 'story' | 'feed45' | 'square' | 'landscape'
  | 'pmax_square' | 'pmax_landscape' | 'pmax_portrait'
  | 'banner_desktop' | 'banner_mobile' | 'webpush'
  | 'mailing';

const FORMAT_CONFIG: Record<Format, { size: string; prompt: string }> = {
  // ── RRSS ──────────────────────────────────────────────────────────────
  story: {
    size: '1024x1792',
    prompt: 'Adapt this image to a 9:16 vertical story format (Instagram/TikTok/Reels). Extend the background naturally at top and bottom. Keep all text, logos, product, and composition elements exactly as they are.',
  },
  feed45: {
    size: '1024x1536',
    prompt: 'Adapt this image to a 4:5 portrait format (Instagram/Facebook feed). Extend the background slightly at top and bottom to fill the frame. Keep all text, logos, product, and main elements fully visible.',
  },
  square: {
    size: '1024x1024',
    prompt: 'Adapt this image to a square 1:1 format (Instagram/Facebook feed). Extend or slightly crop the background to fill the square while keeping all text, logos, product, and the main subject fully visible and centered.',
  },
  landscape: {
    size: '1792x1024',
    prompt: 'Adapt this image to a 16:9 horizontal format (Facebook/YouTube). Extend the background naturally to left and right. Keep all text, logos, product, and main composition elements exactly as they are.',
  },

  // ── Google Ads / PMax ─────────────────────────────────────────────────
  pmax_square: {
    size: '1024x1024',
    prompt: 'Adapt this image to a square 1:1 Google Ads / Performance Max format. Keep the composition clean and the main message legible at small sizes. Center the product/subject. Keep all original text and brand elements.',
  },
  pmax_landscape: {
    size: '1792x1024',
    prompt: 'Adapt this image to a 1.91:1 horizontal Google Ads / Performance Max format. Redistribute horizontally: product on one side, text/headline on the other. Keep all original text, logos, and brand elements.',
  },
  pmax_portrait: {
    size: '1024x1536',
    prompt: 'Adapt this image to a 4:5 portrait Google Ads / Performance Max format. Place headline at top, product in center, supporting copy at bottom. Keep all original text, logos, and brand elements.',
  },

  // ── Banners ───────────────────────────────────────────────────────────
  banner_desktop: {
    size: '1792x1024',
    prompt: 'Adapt this image to a very wide horizontal web banner (approx 4:1, e.g. 1950×450). Place the product/subject on one side and the headline/text on the other. Extend the background to fill. Keep all original text, logos, and brand elements.',
  },
  banner_mobile: {
    size: '1024x1024',
    prompt: 'Adapt this image to a square mobile banner (800×800). Center the product/subject, keep all text readable, extend background to fill. Keep all original text, logos, and brand elements.',
  },
  webpush: {
    size: '1792x1024',
    prompt: 'Adapt this image to a compact horizontal webpush notification format (720×360, 2:1). Keep the main message and product clearly visible in a small horizontal space. Keep all original text and brand elements.',
  },

  // ── Email ─────────────────────────────────────────────────────────────
  mailing: {
    size: '1024x1792',
    prompt: 'Adapt this image to a vertical email/mailing format (600px wide, portrait). Place the headline in the top third, product in the center, and supporting copy/CTAs at the bottom. Keep all original text, logos, and brand elements intact.',
  },
};

export async function POST(req: NextRequest) {
  const { imageBase64, format }: { imageBase64: string; format: Format } = await req.json();

  const config = FORMAT_CONFIG[format];
  if (!config) return NextResponse.json({ error: 'Invalid format' }, { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: config.prompt,
      size: config.size as Parameters<typeof openai.images.edit>[0]['size'],
      quality: 'medium',
    });
    const base64 = response.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64 });
    return NextResponse.json({ error: 'No image returned' }, { status: 500 });
  } catch (err) {
    console.error('adapt-size failed:', err);
    return NextResponse.json({ error: 'Failed to adapt image' }, { status: 500 });
  }
}
