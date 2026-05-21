import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

function isRefusal(text: string): boolean {
  if (!text || text.length < 30) return true;
  const lower = text.toLowerCase();
  return lower.includes("i'm sorry") || lower.includes("i cannot") || lower.includes("i can't") || lower.includes("cannot assist") || lower.includes("can't assist");
}

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
    max_tokens: 800,
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
  const { brief, brandKit, peopleMode = 'none', productDetailImages = [], referenceImages = [] }: {
    brief: string;
    brandKit: BrandKit;
    peopleMode: PeopleMode;
    productDetailImages: string[];
    referenceImages: string[];
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  // Visual refs from brand kit (style guide for generation)
  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  const productRef: string | null = productDetailImages[0] || null;

  // Generate product + person descriptions — returned to frontend for the apply-product step
  let productDescription = '';
  let personDescription = '';

  if (productRef) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const desc = await describeProductWithVision(openai, productRef);
        productDescription = isRefusal(desc) ? '' : desc;
        if (productDescription) break;
        console.warn(`describe-product: attempt ${attempt + 1} returned refusal/empty`);
      } catch (err) {
        console.error(`describe-product: attempt ${attempt + 1} failed:`, err);
      }
    }
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

  const isProductEcommerce = peopleMode === 'none' && productDetailImages.length > 0;

  // People instruction for concept generation
  const peopleInstruction = peopleMode === 'none'
    ? 'NO incluir personas. Enfocarse en producto, composición, elementos gráficos y copy.'
    : 'Incluir una persona usando una prenda de moda acorde al brief y brand kit. Actitud aspiracional, editorial.';

  const conceptDirections = isProductEcommerce
    ? `Direcciones (e-commerce de producto):
1. Producto hero — producto centrado y protagonista sobre fondo limpio del brand kit, sin texto excepto logo
2. Pieza full promocional — producto(s) visible(s) + nombre del evento como headline principal + descripción del evento (fechas, % de descuento, mecánicas clave como cuotas/envío/retiro) todo integrado en una composición visual completa lista para publicar
3. Producto en contexto — el producto en uso real o en el ambiente donde se aplica (vehículo, industria, segmento target)
4. Layout tipográfico de oferta — copy de descuento/oferta como elemento visual dominante, producto integrado de forma secundaria
5. Showcase técnico — closeup del producto destacando calidad, materiales y detalles de ingeniería
6. Lifestyle del segmento — ambiente y elementos visuales que representan el segmento objetivo con el producto prominente`
    : `Direcciones (fashion/editorial):
1. Minimalista limpio — fondo sólido del brand kit, producto o persona centrados
2. Tipográfico editorial — tipografía grande como elemento visual, imagen secundaria
3. Producto hero — producto o prenda protagonista sin personas
4. Lifestyle aspiracional — ambiente y mood que refuerzan la identidad de marca
5. Composición geométrica — bloques de color, formas y tipografía del brand kit
6. Editorial de moda — fotografía aspiracional de agencia internacional`;

  // Step 1: GPT-4o generates 6 creative concept prompts tailored to mode.
  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior de retail y publicidad digital.
Dado un brief, brand kit y referencias visuales, generá exactamente 6 conceptos distintos para una pieza portrait 1024x1536.

REGLAS:
- Usá los hex exactos del brand kit como colores dominantes
- Estilo PREMIUM, nunca genérico ni clipart
${conceptDirections}
- Fondos en colores del brand kit, tipografía precisa, máx 2-3 elementos por pieza
- Si hay descripción de productos, los image_prompts deben referenciar esos productos específicos
- Si hay referencias visuales de marca, los image_prompts deben seguir ese estilo visual
- PROHIBIDO inventar: precios, descuentos, porcentajes, cupones, promos, mecánicas. Solo lo que esté EXPLÍCITAMENTE en el brief.

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo y elementos concretos.`,
      },
      {
        role: 'user',
        content: [
          `BRAND KIT:\n${brandKitContext}`,
          `BRIEF:\n${brief}`,
          `PERSONAS:\n${peopleInstruction}`,
          productDescription ? `PRODUCTOS (describí exactamente estos en los conceptos que los incluyan):\n${productDescription}` : '',
        ].filter(Boolean).join('\n\n'),
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  // All product images + visual refs as context. Person ref only for real-person mode.
  const inputImages = [
    ...visualRefs,
    ...productDetailImages, // ALL uploaded products, not just first
    ...(peopleMode === 'real' ? referenceImages.slice(0, 1) : []),
  ];

  // Step 2: Generate 6 concept images
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const hasPeople = peopleMode !== 'none';

    const styleSuffix = hasPeople
      ? 'Fashion editorial photography, natural skin tones, soft studio lighting, 85mm lens, high-end fashion campaign, photorealistic.'
      : isProductEcommerce
        ? 'Professional product photography or high-end retail graphic design, agency quality, photorealistic where applicable.'
        : 'Premium graphic design, agency quality, NOT generic AI art, portrait 4:5.';

    const productHint = isProductEcommerce && productDetailImages.length > 0
      ? 'IMPORTANT: The provided reference images show the exact products — feature those specific products in the composition, replicating their appearance faithfully.'
      : '';

    const styleHint = visualRefs.length > 0
      ? 'Match the visual style, typography treatment and composition quality of the provided brand reference pieces.'
      : '';

    const fullPrompt = [
      concept.image_prompt,
      `Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}.`,
      `Typography: ${brandKit.typography || 'bold sans-serif'}.`,
      styleSuffix,
      productHint,
      styleHint,
      'do NOT include any invented text, prices, discounts, coupons, promo codes, or promotional copy that is not explicitly in the brief.',
    ].filter(Boolean).join(' ');

    const base64 = await generateWithGptImage2(openai, fullPrompt, inputImages);

    return {
      id: Math.random().toString(36).slice(2),
      base64,
      prompt: fullPrompt,
      conceptName: concept.concept_name,
    };
  });

  const images = await Promise.all(imagePromises);

  // Return productDescription and personDescription so the frontend can
  // call /api/apply-product after the user selects a concept in the refine step
  return NextResponse.json({ images, productDescription, personDescription });
}
