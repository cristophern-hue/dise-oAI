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
  const personPart = hasPerson ? ` El modelo debe coincidir con: ${personDescription}.` : '';
  const conceptContext = conceptName ? ` Estilo editorial: ${conceptName}.` : '';

  const garmentDesc = productDescription
    ? `Prenda a reproducir EXACTAMENTE:\n${productDescription}`
    : 'Reproduce the exact garment shown in the input product photo.';

  const applyPrompt = [
    'QUÉ CAMBIAR: reemplazá ÚNICAMENTE las prendas que viste la persona en la imagen del concepto con la prenda de referencia del producto.',
    'QUÉ NO TOCAR: textos, tipografías, fondo, composición, iluminación, logos, pose de la persona, expresión, peinado. Todo lo demás queda pixel-perfect.',
    'REGLAS DE COLOR CRÍTICAS:',
    '- Si el color de la prenda tiene código HEX en la descripción (formato #XXXXXX), usá ESE color exacto.',
    '- Beige NUNCA es blanco ni gris. Negro es negro profundo, no gris oscuro.',
    '- Reproducí la silueta EXACTA: slim→slim, recto→recto. No ensanchar ni entalllar.',
    '- Reproducí SOLO los bolsillos visibles en la referencia. Si NO hay bolsillos cargo → CERO bolsillos cargo.',
    '- No inventar ningún detalle que no esté en la foto de referencia.',
    garmentDesc,
    personPart,
    conceptContext,
  ].filter(Boolean).join('\n');

  // ── PATH 1: Responses API — GPT-4o sees concept + product photos, orchestrates gpt-image-2 ──
  // Most accurate for clothing replacement — GPT-4o understands both images before generating.
  try {
    const conceptDataUrl = `data:image/png;base64,${conceptImageBase64}`;
    const productImageContent = productDetailImages.slice(0, 2).map(img => ({
      type: 'input_image' as const,
      image_url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
      detail: 'high' as const,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-4o',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: conceptDataUrl, detail: 'high' },
          ...productImageContent,
          { type: 'input_text', text: applyPrompt },
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
    console.error('apply-product path1 (responses): no image block');
  } catch (err) {
    console.error('apply-product path1 (responses) failed:', err);
  }

  // ── PATH 2: images.edit with concept as base — faster fallback ──────────
  try {
    const file = await toFile(Buffer.from(conceptImageBase64, 'base64'), 'concept.png', { type: 'image/png' });
    const res = await openai.images.edit({
      model: 'gpt-image-2',
      image: file,
      prompt: applyPrompt,
      size: '1024x1536',
      quality: 'medium',
    });
    const base64 = res.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64, applied: true, appliedVia: 'edit-concept-base' });
    console.error('apply-product path2 (edit) returned empty');
  } catch (err) {
    console.error('apply-product path2 (edit) failed:', err);
  }

  return NextResponse.json({ base64: conceptImageBase64, applied: false, appliedVia: 'none' });
}
