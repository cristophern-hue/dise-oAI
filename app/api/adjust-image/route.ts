import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

const EDIT_PROMPT = (instruction: string) =>
  `Apply this adjustment to the fashion image: "${instruction}". Preserve the garment/product exactly — same colors, same print pattern, same details. Only change what the instruction specifies. Keep premium fashion editorial style and overall composition.`;

export async function POST(req: NextRequest) {
  const { imageBase64, instruction, productDetailImages = [] }: {
    imageBase64: string;
    instruction: string;
    productDetailImages: string[];
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Primary: images.edit — single API call, much faster than Responses API orchestration
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: EDIT_PROMPT(instruction),
      size: '1024x1536',
      quality: 'medium',
    });
    const base64 = response.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64 });
    console.error('adjust-image: images.edit returned empty');
  } catch (err) {
    console.error('adjust-image images.edit failed, trying Responses API:', err);
  }

  // Fallback: Responses API with product reference for complex adjustments
  try {
    const imageDataUrl = `data:image/png;base64,${imageBase64}`;
    const productRefDataUrl = productDetailImages[0] || undefined;
    const content = [
      { type: 'input_image', image_url: imageDataUrl, detail: 'high' as const },
      ...(productRefDataUrl ? [{ type: 'input_image', image_url: productRefDataUrl, detail: 'high' as const }] : []),
      { type: 'input_text', text: EDIT_PROMPT(instruction) },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-4o',
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', model: 'gpt-image-2', quality: 'medium', size: '1024x1536' }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) {
        return NextResponse.json({ base64: block.result });
      }
    }
  } catch (err) {
    console.error('adjust-image Responses API fallback failed:', err);
  }

  return NextResponse.json({ error: 'No image returned from API' }, { status: 500 });
}
