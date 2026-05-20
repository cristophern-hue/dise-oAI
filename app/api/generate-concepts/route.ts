import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

export const maxDuration = 300;

type PeopleMode = 'none' | 'ai' | 'real';

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

async function describeProductWithVision(openai: OpenAI, imageDataUrl: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Describí este producto de ropa con MÁXIMO detalle para reproducirlo exactamente en una imagen generada por IA. Incluí: tipo de prenda, corte exacto, color base, estampado/print (describe cada elemento del patrón, sus colores, tamaño y distribución), materiales o texturas visibles, detalles de confección (costuras, piping, botones, bolsillos, cuello, puños), y cualquier elemento distintivo. Sé extremadamente específico — esta descripción es la única guía para reproducir el producto exacto.',
        },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ],
    }],
    max_tokens: 400,
  });
  return response.choices[0].message.content || '';
}

async function generateWithGptImage2(
  openai: OpenAI,
  prompt: string,
  inputImages: string[] = []
): Promise<string> {
  const content = [
    ...inputImages.map(img => ({ type: 'input_image', image_url: img, detail: 'high' })),
    { type: 'input_text', text: prompt },
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-image-2',
      input: [{ role: 'user', content }],
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'medium',
        size: '1024x1536',
        ...(inputImages.length > 0 ? { input_fidelity: 'high' } : {}),
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) return block.result;
    }
    console.error('Responses API returned no image block');
  } catch (err) {
    console.error('Responses API failed:', err);
  }

  // Fallback: text-only with gpt-image-2
  const fallback = await openai.images.generate({
    model: 'gpt-image-2',
    prompt,
    size: '1024x1536',
    quality: 'low',
    n: 1,
  });
  return fallback.data?.[0]?.b64_json || '';
}

// Two-pass approach for 'real' mode: take a product-only image and add the person on top.
// This preserves product fidelity (generated alone first) while incorporating the person.
async function addPersonToImage(
  openai: OpenAI,
  imageBase64: string,
  personDescription: string,
  fashionSuffix: string,
): Promise<string> {
  const imageDataUrl = `data:image/png;base64,${imageBase64}`;
  const prompt = `Agregá una persona a esta imagen de moda. Características de la persona: ${personDescription}. La persona está usando el producto que ya aparece en la imagen — NO lo modifiques, no cambies su color, estampado ni silueta. Conservá el fondo, la composición y el estilo visual de la imagen original. ${fashionSuffix}`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-image-2',
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
          { type: 'input_text', text: prompt },
        ],
      }],
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'medium',
        size: '1024x1536',
        input_fidelity: 'high',
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) return block.result;
    }
    console.error('addPersonToImage: no image block returned');
  } catch (err) {
    console.error('addPersonToImage failed:', err);
  }
  // Fallback: return original product-only image
  return imageBase64;
}

export async function POST(req: NextRequest) {
  const { brief, brandKit, peopleMode = 'none', productDetailImages = [], referenceImages = [] }: {
    brief: string;
    brandKit: BrandKit;
    peopleMode: PeopleMode;
    productDetailImages: string[];
    referenceImages: string[];
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  const productRef: string | null = productDetailImages[0] || null;

  let productDescription = '';
  let personDescription = '';

  if (productRef) {
    productDescription = await describeProductWithVision(openai, productRef);
  }

  if (peopleMode === 'real' && referenceImages.length > 0) {
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describí brevemente las características físicas de las personas en estas imágenes: tono de piel, cabello, complexión, edad aproximada. Máximo 2 oraciones.' },
          ...referenceImages.map(img => ({ type: 'image_url' as const, image_url: { url: img, detail: 'low' as const } })),
        ],
      }],
      max_tokens: 150,
    });
    personDescription = visionResponse.choices[0].message.content || '';
  }

  const fashionSuffix = 'Fashion editorial photography, natural skin tones, soft studio lighting, 85mm lens, high-end fashion campaign, photorealistic.';

  const productConstraint = productDescription
    ? `\nPRODUCTO OBLIGATORIO: El producto en la imagen DEBE ser exactamente: ${productDescription}. No sustituir, no simplificar, no inventar otro producto.`
    : '';

  // Step 1: GPT-4o generates 6 concept prompts.
  // For 'real' mode, concepts are generated as product-only (person is added in pass 2 below).
  const peopleForConcepts = peopleMode === 'none'
    ? 'NO incluir personas. Enfocarse en producto, composición, flat lay o elementos gráficos.'
    : 'El producto es el protagonista. Composición limpia y premium, sin personas por ahora.';

  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior de moda y retail premium.
Dado un brief y un brand kit, generá exactamente 6 conceptos visuales distintos para una pieza portrait 1024x1536 (Instagram 4:5).

REGLAS:
- Usá los hex exactos del brand kit como colores dominantes
- Estilo ELEGANTE y PREMIUM, nunca genérico ni clipart
- Direcciones: minimalista limpio, tipográfico editorial, producto hero, lifestyle aspiracional, composición geométrica, editorial de moda
- Fondos en colores del brand kit, tipografía elegante, máx 2-3 elementos
- Nivel de agencia de moda internacional
${productConstraint}

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo fotográfico y mood.`,
      },
      {
        role: 'user',
        content: `BRAND KIT:\n${brandKitContext}\n\nBRIEF:\n${brief}\n\nPERSONAS:\n${peopleForConcepts}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  // Input images for pass 1: brand kit style refs + product detail.
  // No person photo — generate product-only first to guarantee product fidelity.
  const inputImages = [
    ...visualRefs,
    ...productDetailImages.slice(0, 1),
  ];

  // Step 2: Generate 6 product-only images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}${productDescription ? ` PRODUCTO EXACTO: ${productDescription}.` : ''} Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography: ${brandKit.typography || 'elegant serif'}. Premium fashion campaign, agency quality, NOT generic AI art, portrait 4:5.`;

    const base64 = await generateWithGptImage2(openai, fullPrompt, inputImages);

    return {
      id: Math.random().toString(36).slice(2),
      base64,
      prompt: fullPrompt,
      conceptName: concept.concept_name,
    };
  });

  const images = await Promise.all(imagePromises);

  // Step 3 (real mode only): add person to each product-only image.
  // Two-pass approach: product generated alone (perfect fidelity) → person layered on top.
  if (peopleMode === 'real' && personDescription) {
    const withPerson = await Promise.all(
      images.map(async img => {
        const base64WithPerson = await addPersonToImage(openai, img.base64, personDescription, fashionSuffix);
        return { ...img, base64: base64WithPerson };
      })
    );
    return NextResponse.json({ images: withPerson });
  }

  return NextResponse.json({ images });
}
