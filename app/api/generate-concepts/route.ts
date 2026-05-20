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
        content: `Sos un director creativo senior. Dado un brief de campaña y un brand kit completo, generá exactamente 6 conceptos visuales distintos para una imagen 1024x1024 de redes sociales.
Cada concepto debe tener una dirección visual diferente: minimalista, tipográfico bold, producto hero, lifestyle, abstracto, editorial.
Es CRÍTICO que:
- Incorpores los colores exactos del brand kit
- Respetes el estilo y las reglas de marca
- Sigas la instrucción sobre personas
Respondé SOLO con JSON válido: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe ser detallado, mencionar los colores hex exactos, y estar listo para enviarse a un modelo de generación de imágenes.`,
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

  // Step 2: Generate all 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Exact brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography: ${brandKit.typography || 'clean modern'}. ${brandKit.styleDescription.slice(0, 150)}. Square 1024x1024, professional social media ad.`;

    const imageResponse = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      size: '1024x1024',
      quality: 'medium',
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
