import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conceptImageBase64, productDetailImages, productDescription, peopleMode, personDescription }: {
    conceptImageBase64: string;
    productDetailImages: string[];
    productDescription: string;
    peopleMode: 'none' | 'real';
    personDescription: string;
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const hasProductImage = productDetailImages.length > 0;
  const hasPerson = peopleMode === 'real' && personDescription;

  if (!hasProductImage) {
    return NextResponse.json({ base64: conceptImageBase64, applied: false });
  }

  const personPart = hasPerson
    ? `\nPERSONA: ${personDescription}. La persona lleva puesto exactamente este producto.`
    : '';

  const productPart = productDescription
    ? `\nPRODUCTO A APLICAR (reproducir exactamente, sin simplificar):\n${productDescription}`
    : '\nPRODUCTO A APLICAR: el producto exacto que aparece en la segunda imagen de referencia.';

  const multiProductNote = productDetailImages.length > 1
    ? `\nHay ${productDetailImages.length} imágenes de referencia de productos — aplicá TODOS los productos visibles en cada imagen (ej: remera + pantalón, campera + falda).`
    : '';

  const prompt = `You are a precision fashion image editor. Replace the clothing in the concept image with the EXACT garment(s) from the reference product photo(s). Everything else stays identical.

STEP 1 — Study the reference product photo carefully:
- What is the EXACT silhouette? (slim, straight, wide-leg, relaxed, etc.)
- What pockets are visible? Count them and note their exact position and type.
- What is the EXACT waist construction? (belt loops only, elastic, etc.)
- What is the leg opening width?

STEP 2 — Reproduce faithfully:
${productPart}
${personPart}
${multiProductNote}

SILHOUETTE FIDELITY — the most critical rule:
- If the reference is SLIM fit → output MUST be slim fit. Never widen it.
- If the reference has NO cargo pockets → output MUST have zero cargo pockets. This is non-negotiable.
- If the reference has NO side flap pockets → output MUST have none.
- If the reference shows ONLY front slash pockets → output has ONLY front slash pockets.
- The exact leg width, rise, and hem treatment must match the reference photo.
- DO NOT invent any feature not clearly visible in the reference product photo.
- DO NOT add cargo pockets, patch pockets, or flap pockets unless they are explicitly in the reference.
- DO NOT widen or loosen the silhouette beyond what is shown.

WHAT TO CHANGE: replace the person's clothing with the exact reference garment(s).
WHAT NOT TO CHANGE (pixel-perfect):
- All text, typography, headlines, slogans, copy, dates
- Background, colors, gradients, textures
- Composition, layout, lighting, mood
- Brand logos, icons, graphic elements
- The person's pose, position, skin tone, face

Style: fashion editorial premium, photorealistic.`;

  const conceptDataUrl = `data:image/png;base64,${conceptImageBase64}`;
  const productImageContent = productDetailImages.map(img => ({
    type: 'input_image' as const, image_url: img, detail: 'high' as const,
  }));

  // Primary: Responses API con gpt-4o como orquestador (entiende imágenes de entrada)
  // y gpt-image-2 como herramienta de generación
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-4o',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: conceptDataUrl, detail: 'high' },
          ...productImageContent,
          { type: 'input_text', text: prompt },
        ],
      }],
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'high',
        size: '1024x1536',
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) {
        return NextResponse.json({ base64: block.result, applied: true, appliedVia: 'responses' });
      }
    }
    console.error('apply-product: Responses API returned no image block');
  } catch (err) {
    console.error('apply-product Responses API (gpt-4o) failed:', err);
  }

  // Fallback A: images.edit using PRODUCT IMAGE as the base (not concept).
  // This preserves the garment identity better — the product IS the input, we just place it on a model.
  if (productDescription) {
    try {
      const productBase64 = productDetailImages[0].startsWith('data:')
        ? productDetailImages[0].split(',')[1]
        : productDetailImages[0];
      const productBuffer = Buffer.from(productBase64, 'base64');
      const productFile = await toFile(productBuffer, 'product.png', { type: 'image/png' });
      const conceptStyle = 'fashion editorial style, premium photography, studio lighting, photorealistic';
      const fallbackAPrompt = [
        `This is a product photo. Transform it into a fashion editorial image: place this exact garment on a fashion model.`,
        `CRITICAL: The garment must remain 100% identical — same silhouette, same pockets (only what is visible here), same fit, same color, same details.`,
        `DO NOT add, remove or change any pockets, details or features. What you see is what must appear.`,
        personDescription ? `The model should match: ${personDescription}.` : 'Use a fashion model appropriate for the garment.',
        conceptStyle,
        productDescription ? `Garment reference: ${productDescription}` : '',
      ].filter(Boolean).join(' ');

      const res = await openai.images.edit({
        model: 'gpt-image-2',
        image: productFile,
        prompt: fallbackAPrompt,
        size: '1024x1536',
        quality: 'high',
      });
      const base64 = res.data?.[0]?.b64_json || '';
      if (base64) return NextResponse.json({ base64, applied: true, appliedVia: 'edit-product-base' });
      console.error('apply-product: fallback A (product base) returned empty');
    } catch (err) {
      console.error('apply-product fallback A failed:', err);
    }
  }

  // Fallback B: images.edit using concept as base with descriptive prompt
  try {
    const buffer = Buffer.from(conceptImageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const fallbackBPrompt = productDescription
      ? `Replace the main clothing/garment in this fashion image with the following product EXACTLY as described — do not invent features not mentioned. Preserving all composition, background, lighting. Product: ${productDescription}.${personPart}`
      : `Replace the main clothing/garment in this fashion editorial image with the reference product. Keep the composition, background, lighting, and overall mood exactly the same.${personPart}`;

    const res = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: fallbackBPrompt,
      size: '1024x1536',
      quality: 'high',
    });
    const base64 = res.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64, applied: true, appliedVia: 'edit-concept-base' });
    console.error('apply-product: fallback B returned empty b64_json');
  } catch (err) {
    console.error('apply-product fallback B failed:', err);
  }

  return NextResponse.json({ base64: conceptImageBase64, applied: false, appliedVia: 'none' });
}
