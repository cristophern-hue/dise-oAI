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

function buildPeopleInstruction(peopleMode: PeopleMode, referenceDescription?: string): string {
  if (peopleMode === 'none') return 'NO incluir personas. Enfocarse en producto, composición, flat lay o elementos gráficos.';
  if (peopleMode === 'ai') return 'Incluir figuras humanas generadas por IA, naturales, estilizadas y coherentes con el estilo de la marca.';
  if (peopleMode === 'real' && referenceDescription) return `Incluir una persona con estas características: ${referenceDescription}.`;
  return 'Incluir personas que representen la audiencia target de la marca.';
}

async function generateImageWithProduct(
  openai: OpenAI,
  prompt: string,
  productImage: string
): Promise<string> {
  const fullPrompt = `CRÍTICO: Preservar el producto EXACTO de la imagen de referencia — mismo estampado, mismo diseño, mismos colores, mismo corte. No inventar ni modificar ningún detalle del producto. ${prompt}`;
  const raw = productImage.includes(',') ? productImage.split(',')[1] : productImage;
  const imageFile = await toFile(Buffer.from(raw, 'base64'), 'reference.png', { type: 'image/png' });
  const response = await openai.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt: fullPrompt,
    size: '1024x1024',
    quality: 'high',
    n: 1,
  });
  return response.data?.[0]?.b64_json || '';
}

async function generateImageWithStyleRefs(
  openai: OpenAI,
  prompt: string,
  styleRefs: string[]
): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-image-2',
      input: [{
        role: 'user',
        content: [
          ...styleRefs.map(img => ({ type: 'input_image', image_url: img })),
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
      if (block.type === 'image_generation_call' && block.result) return block.result;
    }
  } catch (err) {
    console.error('Responses API failed:', err);
  }
  return generateImageFromText(openai, prompt);
}

async function generateImageFromText(
  openai: OpenAI,
  prompt: string
): Promise<string> {
  try {
    const imageResponse = await openai.images.generate({
      model: 'gpt-image-2',
      prompt,
      size: '1024x1536',
      quality: 'low',
      n: 1,
    });
    const b64 = imageResponse.data?.[0]?.b64_json || '';
    if (!b64) console.error('gpt-image-2 returned empty b64_json');
    return b64;
  } catch (err) {
    console.error('gpt-image-2 failed, falling back to gpt-image-1:', err);
    const fallback = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1536',
      quality: 'low',
      n: 1,
    });
    return fallback.data?.[0]?.b64_json || '';
  }
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

  // Visual references: piezas anteriores del brand kit (máx 2 para no saturar)
  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  // Product/person reference images — used in both modes to anchor the exact product
  const productRefs: string[] = referenceImages.slice(0, 1);
  const hasVisualRefs = visualRefs.length > 0 || productRefs.length > 0;

  // For 'real' mode: describe the person so the prompt can reference them
  let referenceDescription = '';
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
    referenceDescription = visionResponse.choices[0].message.content || '';
  }

  const peopleInstruction = buildPeopleInstruction(peopleMode, referenceDescription);
  const hasPeople = peopleMode !== 'none';

  const fashionSuffix = hasPeople
    ? 'Fashion editorial photography, professional model, natural skin tones, soft studio lighting, 85mm lens, high-end fashion campaign, photorealistic.'
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

  // Step 2: Generate 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Use brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography: ${brandKit.typography || 'elegant serif'}. ${fashionSuffix} Premium fashion campaign, agency quality, NOT generic AI art, portrait 4:5.`;

    let base64: string;
    if (productRefs.length > 0) {
      // Product image provided — images.edit() guarantees the model receives the exact product
      base64 = await generateImageWithProduct(openai, fullPrompt, productRefs[0]);
    } else if (visualRefs.length > 0) {
      // Only brand kit style refs — use Responses API for style guidance
      base64 = await generateImageWithStyleRefs(openai, fullPrompt, visualRefs);
    } else {
      base64 = await generateImageFromText(openai, fullPrompt);
    }

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
