import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

export async function POST(req: NextRequest) {
  const { brief, brandKit }: { brief: string; brandKit: BrandKit } = await req.json();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior. Dado un brief de campaña y un brand kit completo, generá exactamente 6 conceptos visuales distintos para una imagen 1024x1024 de redes sociales.
Cada concepto debe tener una dirección visual diferente: minimalista, tipográfico bold, producto hero, lifestyle, abstracto, editorial.
Es CRÍTICO que incorpores los colores exactos del brand kit y respetes el estilo y las reglas de marca en cada concepto.
Respondé SOLO con JSON válido: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe ser detallado, específico, mencionar los colores hex exactos, y estar listo para enviarse directamente a un modelo de generación de imágenes.`,
      },
      {
        role: 'user',
        content: `BRAND KIT COMPLETO:\n${brandKitContext}\n\nBRIEF DE CAMPAÑA:\n${brief}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Use exact brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Typography style: ${brandKit.typography || 'clean modern'}. ${brandKit.styleDescription.slice(0, 200)}. Square 1024x1024 format, professional social media ad.`;

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
