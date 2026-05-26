import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conceptImageBase64, productDetailImages, productDescription, peopleMode, personDescription, conceptName }: {
    conceptImageBase64: string;
    productDetailImages: string[];
    productDescription: string;
    peopleMode: 'none' | 'real';
    personDescription: string;
    conceptName?: string;
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!productDetailImages.length) {
    return NextResponse.json({ base64: conceptImageBase64, applied: false });
  }

  const hasPerson = peopleMode === 'real' && personDescription;
  const personPart = hasPerson ? ` The model should match: ${personDescription}.` : '';
  const conceptContext = conceptName ? ` Editorial style: ${conceptName}.` : '';

  const garmentDesc = productDescription
    ? `Garment to reproduce EXACTLY:\n${productDescription}`
    : 'Reproduce the exact garment shown in the input product photo.';

  const silhouetteRules = `
CRITICAL RULES — read before generating:
- Reproduce the garment's EXACT silhouette. If it is slim → output is slim. If it is straight → output is straight. Never widen, taper, or otherwise change the fit.
- Reproduce ONLY the pockets visible in the reference. If there are NO cargo/side pockets → output has ZERO cargo/side pockets. This is absolute.
- If a HEX color is mentioned in the garment description (format #XXXXXX), match that exact color. Do not interpret "beige" as your own generic beige.
- Do NOT invent any detail not visible in the reference.`;

  // ── PATH 1: images.edit with CONCEPT IMAGE as base (~15-25s) ────────────
  // Primary path: preserves the selected concept's composition, background, model, and pose.
  // Only the clothing is replaced with the product — everything else stays pixel-perfect.
  try {
    const file = await toFile(Buffer.from(conceptImageBase64, 'base64'), 'concept.png', { type: 'image/png' });

    const promptA = productDescription
      ? [
          'Replace ONLY the clothing/garment on the person in this fashion image with the following product.',
          'Preserve everything else pixel-perfect: background, lighting, composition, text, logos, pose, model appearance.',
          silhouetteRules,
          garmentDesc,
          personPart,
        ].filter(Boolean).join(' ')
      : `Replace the main garment on the person with the reference product. Keep all composition, background, lighting, model, and text identical.${personPart}`;

    const res = await openai.images.edit({
      model: 'gpt-image-2',
      image: file,
      prompt: promptA,
      size: '1024x1536',
      quality: 'medium',
    });
    const base64 = res.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64, applied: true, appliedVia: 'edit-concept-base' });
    console.error('apply-product path1 returned empty');
  } catch (err) {
    console.error('apply-product path1 failed:', err);
  }

  // ── PATH 3: Responses API gpt-4o + gpt-image-2 (slowest, ~90-180s, last resort) ──
  try {
    const conceptDataUrl = `data:image/png;base64,${conceptImageBase64}`;
    const productImageContent = productDetailImages.map(img => ({
      type: 'input_image' as const, image_url: img, detail: 'high' as const,
    }));
    const promptC = `Replace the clothing in the concept image with the EXACT garment from the product photo(s).${silhouetteRules}\n${garmentDesc}${personPart}\nPreserve background, text, layout, lighting, pose.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-4o',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: conceptDataUrl, detail: 'high' },
          ...productImageContent,
          { type: 'input_text', text: promptC },
        ],
      }],
      tools: [{ type: 'image_generation', model: 'gpt-image-2', quality: 'medium', size: '1024x1536' }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) {
        return NextResponse.json({ base64: block.result, applied: true, appliedVia: 'responses' });
      }
    }
    console.error('apply-product path3: no image block');
  } catch (err) {
    console.error('apply-product path3 failed:', err);
  }

  return NextResponse.json({ base64: conceptImageBase64, applied: false, appliedVia: 'none' });
}
