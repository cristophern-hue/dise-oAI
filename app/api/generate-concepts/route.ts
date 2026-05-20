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

function buildPeopleInstruction(peopleMode: PeopleMode, referenceDescription?: string): string {
  if (peopleMode === 'none') return 'NO incluir personas. Enfocarse en producto, composición, flat lay o elementos gráficos.';
  if (peopleMode === 'real' && referenceDescription) return `Incluir una persona con estas características: ${referenceDescription}.`;
  return 'Incluir personas que representen la audiencia target de la marca.';
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
    ...inputImages.map(img => ({ type: 'input_image', image_url: img })),
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

export async function POST(req: NextRequest) {
  const { brief, brandKit, peopleMode = 'none', referenceImages = [] }: {
    brief: string;
    brandKit: BrandKit;
    peopleMode: PeopleMode;
    referenceImages: string[];
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  const productRef: string | null = referenceImages[0] || null;

  // Describe product and/or person with GPT-4o vision when reference images are provided
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

  const peopleInstruction = buildPeopleInstruction(peopleMode, personDescription);
  const hasPeople = peopleMode !== 'none';
  const fashionSuffix = hasPeople
    ? 'Fashion editorial photography, natural skin tones, soft studio lighting, 85mm lens, high-end fashion campaign, photorealistic.'
    : '';

  const productConstraint = productDescription
    ? `\nPRODUCTO OBLIGATORIO: El producto en la imagen DEBE ser exactamente: ${productDescription}. No sustituir, no simplificar, no inventar otro producto.`
    : '';

  // Step 1: GPT-4o generates 6 concept prompts
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
        content: `BRAND KIT:\n${brandKitContext}\n\nBRIEF:\n${brief}\n\nPERSONAS:\n${peopleInstruction}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  // Input images for gpt-image-2: style refs from brand kit + product/person ref
  const inputImages = [
    ...visualRefs,
    ...(productRef ? [productRef] : []),
  ];

  // Step 2: Generate 6 images in parallel with gpt-image-2
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}${productDescription ? ` PRODUCTO EXACTO: ${productDescription}.` : ''} Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography: ${brandKit.typography || 'elegant serif'}. ${fashionSuffix} Premium fashion campaign, agency quality, NOT generic AI art, portrait 4:5.`;

    const base64 = await generateWithGptImage2(openai, fullPrompt, inputImages);

    return {
      id: Math.random().toString(36).slice(2),
      base64,
      prompt: fullPrompt,
      conceptName: concept.concept_name,
    };
  });

  const images = await Promise.all(imagePromises);
  return NextResponse.json({ images });
}
