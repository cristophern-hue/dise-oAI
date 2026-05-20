import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

type PeopleMode = 'none' | 'ai' | 'real';

function buildPeopleInstruction(peopleMode: PeopleMode, referenceDescription?: string): string {
  if (peopleMode === 'none') {
    return 'NO incluir personas en ningún concepto. Enfocarse en producto, composición, flat lay, elementos gráficos o escenas sin figuras humanas.';
  }
  if (peopleMode === 'ai') {
    return 'Incluir figuras humanas generadas por IA que representen la audiencia target de la marca. Las personas deben verse naturales, estilizadas y coherentes con el estilo visual de la marca.';
  }
  if (peopleMode === 'real' && referenceDescription) {
    return `Incluir una persona con las siguientes características (basadas en fotos de referencia): ${referenceDescription}. Mantener estas características físicas en todos los conceptos.`;
  }
  return 'Incluir personas que representen la audiencia target de la marca.';
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

  // If real photos provided, use GPT-4o vision to describe the people first
  let referenceDescription = '';
  if (peopleMode === 'real' && referenceImages.length > 0) {
    const visionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describí en detalle las características físicas y estilo de las personas en estas imágenes: tono de piel, color y estilo de cabello, complexión, rango de edad aproximado, estilo de vestimenta. Sé específico y conciso, máximo 3 oraciones.',
          },
          ...referenceImages.map(img => ({
            type: 'image_url' as const,
            image_url: { url: img, detail: 'low' as const },
          })),
        ],
      },
    ];
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: visionMessages,
      max_tokens: 200,
    });
    referenceDescription = visionResponse.choices[0].message.content || '';
  }

  const peopleInstruction = buildPeopleInstruction(peopleMode, referenceDescription);

  // Step 1: Generate 6 concept prompts
  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior especializado en campañas de moda y retail premium.
Dado un brief y un brand kit, generá exactamente 6 conceptos visuales distintos para una pieza de campaña portrait 1024x1536 (Instagram feed 4:5).

REGLAS CRÍTICAS:
- Usá los hex exactos del brand kit como colores dominantes de fondo, texto y elementos
- El estilo debe ser ELEGANTE y PREMIUM, nunca genérico ni tipo clipart
- Cada concepto debe tener dirección diferente: minimalista limpio, tipográfico editorial, producto hero con fondo de marca, lifestyle aspiracional, composición geométrica de marca, editorial de moda
- Los fondos deben ser los colores del brand kit (no blanco genérico, no degradados chillones)
- La tipografía debe ser serif o sans-serif elegante, nunca display genérico
- Nunca incluir más de 2-3 elementos en la composición
- El resultado debe parecer producido por una agencia de moda de nivel internacional

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe ser muy específico: mencionar colores hex, disposición de elementos, estilo de fotografía, mood, y características técnicas de la imagen.`,
      },
      {
        role: 'user',
        content: `BRAND KIT COMPLETO:\n${brandKitContext}\n\nBRIEF DE CAMPAÑA:\n${brief}\n\nINSTRUCCIÓN SOBRE PERSONAS:\n${peopleInstruction}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  const hasPeople = peopleMode !== 'none';
  const fashionSuffix = hasPeople
    ? 'Fashion editorial photography style, professional model, natural skin tones, soft studio lighting, 85mm lens bokeh, high-end fashion campaign, photorealistic, natural expressions, elegant posture.'
    : '';

  // Step 2: Generate all 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. MANDATORY brand colors: background or dominant elements must use ${brandKit.primary1} or ${brandKit.primary2} or ${brandKit.primary3}. Font style: ${brandKit.typography || 'elegant serif or clean sans-serif'}. ${fashionSuffix} High-end fashion campaign, premium retail aesthetic, agency-level production quality, NOT generic AI art, clean intentional composition, portrait 4:5 ratio.`;

    const imageResponse = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      size: '1024x1536',
      quality: hasPeople ? 'high' : 'medium',
      n: 1,
    });

    return {
      id: Math.random().toString(36).slice(2),
      base64: imageResponse.data?.[0]?.b64_json || '',
      prompt: fullPrompt,
      conceptName: concept.concept_name,
    };
  });

  const images = await Promise.all(imagePromises);
  return NextResponse.json({ images });
}
