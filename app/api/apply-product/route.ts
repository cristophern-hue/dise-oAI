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

  const prompt = `Tomá este concepto visual de moda y reemplazá la prenda/producto por el producto exacto que aparece en la imagen de referencia.
${productPart}
${personPart}

REGLAS:
- El producto debe verse EXACTAMENTE igual al de la imagen de referencia: mismos colores, mismo estampado con todos sus elementos, misma silueta y detalles de confección
- Conservá la composición, el fondo, la iluminación y el mood del concepto original
- Estilo fashion editorial premium, fotorrealista`;

  const conceptDataUrl = `data:image/png;base64,${conceptImageBase64}`;
  const productDataUrl = productDetailImages[0];

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
          { type: 'input_image', image_url: productDataUrl, detail: 'high' },
          { type: 'input_text', text: prompt },
        ],
      }],
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'medium',
        size: '1024x1536',
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) {
        return NextResponse.json({ base64: block.result, applied: true });
      }
    }
    console.error('apply-product: Responses API returned no image block');
  } catch (err) {
    console.error('apply-product Responses API (gpt-4o) failed:', err);
  }

  // Fallback: images.edit con prompt descriptivo fuerte
  try {
    const buffer = Buffer.from(conceptImageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const editPrompt = productDescription
      ? `Replace the main clothing/garment in this fashion image with the following product, preserving all composition, background, lighting and style. Product to apply: ${productDescription}.${personPart}`
      : `Replace the main clothing/garment in this fashion editorial image with the product from the reference. Keep the composition, background, lighting, and overall mood exactly the same.${personPart}`;

    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: editPrompt,
      size: '1024x1536',
      quality: 'medium',
    });
    const base64 = response.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64, applied: true });
    console.error('apply-product: images.edit returned empty b64_json');
  } catch (err) {
    console.error('apply-product images.edit fallback failed:', err);
  }

  // Last resort: return original with flag so client can warn the user
  return NextResponse.json({ base64: conceptImageBase64, applied: false });
}
