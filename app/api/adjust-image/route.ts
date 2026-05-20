import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai';

export const maxDuration = 300;

const EDIT_SYSTEM = (instruction: string) =>
  `Aplicá este ajuste a la imagen: "${instruction}". Preservá el producto/estampado exactamente como aparece en la imagen de referencia — mismo color, mismo patrón, mismos detalles. Solo modificá lo que el ajuste indica, manteniendo el estilo premium de moda y la composición general.`;

async function editViaResponsesAPI(
  openai: OpenAI,
  imageBase64: string,
  instruction: string,
  productRefDataUrl?: string,
): Promise<string> {
  const imageDataUrl = `data:image/png;base64,${imageBase64}`;
  const content = [
    { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
    // Product reference anchors the print/pattern so it doesn't drift across adjustments
    ...(productRefDataUrl ? [{ type: 'input_image', image_url: productRefDataUrl, detail: 'high' }] : []),
    { type: 'input_text', text: EDIT_SYSTEM(instruction) },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (openai.responses.create as any)({
    model: 'gpt-image-2',
    input: [{ role: 'user', content }],
    tools: [{
      type: 'image_generation',
      model: 'gpt-image-2',
      quality: 'medium',
      size: '1024x1536',
      input_fidelity: 'high',
    }],
  });
  for (const block of (response.output || [])) {
    if (block.type === 'image_generation_call' && block.result) return block.result;
  }
  return '';
}

export async function POST(req: NextRequest) {
  const { imageBase64, instruction, productDetailImages = [] }: {
    imageBase64: string;
    instruction: string;
    productDetailImages: string[];
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const productRefDataUrl = productDetailImages[0] || undefined;

  // Primary: Responses API — product reference image keeps print/pattern anchored across adjustments
  try {
    const base64 = await editViaResponsesAPI(openai, imageBase64, instruction, productRefDataUrl);
    if (base64) return NextResponse.json({ base64 });
    console.error('Responses API returned no image block for edit');
  } catch (err) {
    console.error('Responses API edit failed, falling back to images.edit:', err);
  }

  // Fallback: images.edit API
  const buffer = Buffer.from(imageBase64, 'base64');
  const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
  const response = await openai.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: EDIT_SYSTEM(instruction),
    size: '1024x1536',
    quality: 'medium',
  });

  const base64 = response.data?.[0]?.b64_json || '';
  if (!base64) {
    return NextResponse.json({ error: 'No image returned from API' }, { status: 500 });
  }
  return NextResponse.json({ base64 });
}
