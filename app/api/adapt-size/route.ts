import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

type Format =
  | 'story' | 'feed45' | 'square' | 'landscape'
  | 'pmax_square' | 'pmax_landscape' | 'pmax_portrait'
  | 'banner_desktop' | 'banner_mobile' | 'webpush'
  | 'mailing';

const FORMAT_CONFIG: Record<Format, { size: string; instruction: string }> = {
  // ── RRSS ──────────────────────────────────────────────────────────────
  story: {
    size: '1024x1792',
    instruction: 'Recompose this image to a 9:16 vertical story format. Extend the background naturally at top and bottom to fill the frame. Keep the person, product, all text, logos, and composition elements exactly as they are — do not crop or hide any of them.',
  },
  feed45: {
    size: '1024x1536',
    instruction: 'Recompose this image to a 4:5 portrait format. Extend the background slightly at top and bottom. Keep all text, logos, product, and main elements fully visible.',
  },
  square: {
    size: '1024x1024',
    instruction: 'Recompose this image to a square 1:1 format. Extend or slightly crop background to fill the square while keeping all text, logos, product, and the main subject fully visible and centered.',
  },
  landscape: {
    size: '1792x1024',
    instruction: 'Recompose this image to a 16:9 horizontal format. Extend the background naturally to left and right. Keep all text, logos, product, and main composition elements exactly as they are.',
  },

  // ── Google Ads / PMax ─────────────────────────────────────────────────
  pmax_square: {
    size: '1024x1024',
    instruction: 'Recompose this image to a square 1:1 Google Ads format. Keep the composition clean and the main message legible. Center the product/subject. Preserve all original text and brand elements exactly.',
  },
  pmax_landscape: {
    size: '1792x1024',
    instruction: 'Recompose this image to a 1.91:1 horizontal Google Ads format. Redistribute horizontally: product on one side, text/headline on the other side. Keep all original text, logos, and brand elements exactly as they appear in the source.',
  },
  pmax_portrait: {
    size: '1024x1536',
    instruction: 'Recompose this image to a 4:5 portrait Google Ads format. Place headline at top, product in center, supporting copy at bottom. Keep all original text, logos, and brand elements exactly as they appear.',
  },

  // ── Banners ───────────────────────────────────────────────────────────
  banner_desktop: {
    size: '1792x1024',
    instruction: 'Recompose this image to a wide horizontal web banner (approx 4:1 ratio). Place the product/person on one side and the headline/text on the other. Extend the background to fill. Keep all original text, logos, and brand elements exactly as they appear in the source image.',
  },
  banner_mobile: {
    size: '1024x1024',
    instruction: 'Recompose this image to a square mobile banner format. Center the product/subject, keep all text readable, extend background to fill. Keep all original text, logos, and brand elements exactly as they appear.',
  },
  webpush: {
    size: '1792x1024',
    instruction: 'Recompose this image to a compact horizontal web push notification format (2:1 ratio). Keep the main message and product clearly visible. Keep all original text and brand elements exactly as they appear.',
  },

  // ── Email ─────────────────────────────────────────────────────────────
  mailing: {
    size: '1024x1792',
    instruction: 'Recompose this image to a vertical email format. Place the headline in the top third, product in the center, and supporting copy at the bottom. Keep all original text, logos, and brand elements intact exactly as they appear in the source.',
  },
};

const ANTI_HALLUCINATION = [
  'CRITICAL — DO NOT INVENT TEXT: reproduce ONLY the exact text visible in the source image. Do not add, translate, or replace any headline, tagline, or body copy.',
  'DO NOT add English words or phrases that are not in the source image.',
  'DO NOT add promotional text, CTAs, product names, or slogans that are not visible in the source.',
  'The source image is the absolute reference — replicate its content faithfully in the new format.',
].join(' ');

export async function POST(req: NextRequest) {
  const { imageBase64, format }: { imageBase64: string; format: Format } = await req.json();

  const config = FORMAT_CONFIG[format];
  if (!config) return NextResponse.json({ error: 'Invalid format' }, { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sourceDataUrl = `data:image/png;base64,${imageBase64}`;
  const fullPrompt = `${config.instruction} ${ANTI_HALLUCINATION}`;

  // PATH 1: Responses API — GPT-4o sees the source image before generating the adaptation
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-4o',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: sourceDataUrl, detail: 'high' },
          { type: 'input_text', text: fullPrompt },
        ],
      }],
      tools: [{ type: 'image_generation', model: 'gpt-image-2', quality: 'medium', size: config.size }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) {
        return NextResponse.json({ base64: block.result });
      }
    }
    console.error(`adapt-size path1 (${format}): no image block`);
  } catch (err) {
    console.error(`adapt-size path1 (${format}) failed:`, err);
  }

  // PATH 2: images.edit fallback
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: fullPrompt,
      size: config.size as Parameters<typeof openai.images.edit>[0]['size'],
      quality: 'medium',
    });
    const base64 = response.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64 });
    console.error(`adapt-size path2 (${format}): no image returned`);
  } catch (err) {
    console.error(`adapt-size path2 (${format}) failed:`, err);
  }

  return NextResponse.json({ error: 'Failed to adapt image' }, { status: 500 });
}
