import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

export const maxDuration = 300;

type PeopleMode = 'none' | 'ai' | 'real';

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

const PRODUCT_DESCRIPTION_PROMPT = `Sos un técnico de producto de moda de alta gama. Analizá esta prenda y describila con precisión quirúrgica para que pueda ser reproducida EXACTAMENTE por un modelo de IA generativa. Imaginá que quien lee tu descripción no puede ver la foto — tu texto es el único recurso.

Describí en este orden exacto:

1. TIPO DE PRENDA: categoría (remera, vestido, campera, etc.), silueta y corte (oversize, entallado, recto, etc.), largo
2. COLOR BASE Y FONDO: tono exacto y profundidad (no "azul" sino "azul marino oscuro casi negro", "blanco roto cálido", etc.)
3. ESTAMPADO / PRINT (es lo más crítico): describí CADA elemento gráfico individualmente — qué forma tiene, de qué color exacto, qué tamaño relativo al total de la prenda, cómo se distribuye (all-over, centrado, borde, repetición, etc.), orientación, y cómo contrasta con el fondo. Si hay texto, copialo exactamente.
4. MATERIALES Y TEXTURA: acabado (mate, satinado, brillante), peso visual, transparencia
5. DETALLES DE CONFECCIÓN: cuello (redondo, V, polo, etc.), mangas (largo, corte), puños, bolsillos, costuras decorativas, piping, botones, cierres, terminaciones
6. ELEMENTOS ÚNICOS: cualquier detalle que diferencie esta prenda de una genérica

IMPORTANTE sobre el estampado: nunca escribas "estampado floral" — describí cada flor, su color, tamaño y posición. El nivel de especificidad del estampado determina si la IA lo reproduce correctamente.`;

async function describeProductWithVision(openai: OpenAI, imageDataUrl: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PRODUCT_DESCRIPTION_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ],
    }],
    max_tokens: 600,
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

// Pass 2 for 'real' mode: use images.edit() to add the person to the product-only image.
// images.edit() is the correct API for targeted modifications — unlike input_fidelity:high
// which conflicts with adding a new element (person) to the scene.
async function addPersonToImage(
  openai: OpenAI,
  imageBase64: string,
  personDescription: string,
  fashionSuffix: string,
): Promise<string> {
  const prompt = `Add a person to this fashion image. The person is wearing the exact product already shown — preserve every detail of the product: same color, same print/pattern with all its elements, same silhouette and construction details. Person: ${personDescription}. Editorial fashion pose, confident attitude. ${fashionSuffix}`;

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt,
      size: '1024x1536',
      quality: 'medium',
    });
    const base64 = response.data?.[0]?.b64_json || '';
    if (base64) return base64;
    console.error('addPersonToImage: empty b64_json');
  } catch (err) {
    console.error('addPersonToImage failed:', err);
  }
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
    const fullPrompt = `${concept.image_prompt}${productDescription ? ` PRODUCTO OBLIGATORIO — reproducir exactamente, sin simplificar ni interpretar: ${productDescription}. Cada detalle del estampado, color y confección debe ser idéntico al original.` : ''} Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography: ${brandKit.typography || 'elegant serif'}. Premium fashion campaign, agency quality, NOT generic AI art, portrait 4:5.`;

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
