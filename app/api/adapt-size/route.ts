import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

type Format = 'story' | 'square' | 'landscape' | 'banner_desktop' | 'banner_mobile' | 'mailing' | 'webpush';

const FORMAT_CONFIG: Record<Format, { size: string; prompt: string }> = {
  story: {
    size: '1024x1792',
    prompt: 'Adapt this image to a 9:16 vertical story format. Extend the background naturally at the top and bottom. Keep all text, logos, product, and main composition elements exactly as they are — only extend the background.',
  },
  square: {
    size: '1024x1024',
    prompt: 'Adapt this image to a square 1:1 format. Extend or slightly crop the background to fill the square frame while keeping all text, logos, product, and the main subject fully visible and centered.',
  },
  landscape: {
    size: '1792x1024',
    prompt: 'Adapt this image to a 16:9 horizontal landscape format. Extend the background naturally to the left and right. Keep all text, logos, product, and main composition elements exactly as they are — only extend the sides.',
  },
  banner_desktop: {
    size: '1792x1024',
    prompt: 'Adapt this image to a very wide horizontal banner format (approx 4:1 ratio, desktop web banner). Redistribute the composition horizontally: place the product/subject on one side and text/copy on the other. Extend the background to fill. Keep all original text, logos, and brand elements.',
  },
  banner_mobile: {
    size: '1024x1024',
    prompt: 'Adapt this image to a square mobile banner format (800x800px). Center the product/subject, keep all text readable, extend background to fill the square. Keep all original text, logos, and brand elements.',
  },
  mailing: {
    size: '1024x1792',
    prompt: 'Adapt this image to a vertical email/mailing format (600px wide, portrait orientation). Place the most important visual element and headline in the top third, product in the middle, and supporting copy at the bottom. Keep all original text, logos, and brand elements intact.',
  },
  webpush: {
    size: '1792x1024',
    prompt: 'Adapt this image to a horizontal webpush notification format (720x360, 2:1 ratio). Keep the composition compact and impactful — main message and product clearly visible in a small horizontal space. Keep all original text and brand elements.',
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
