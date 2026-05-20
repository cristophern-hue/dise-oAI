import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit, GeneratedImage } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

interface VariationItem {
  variation_name: string;
  image_prompt: string;
}

export async function POST(req: NextRequest) {
  const { selectedConcept, brandKit }: { selectedConcept: GeneratedImage; brandKit: BrandKit } = await req.json();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  const variationsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior. Dado un concepto visual seleccionado y su prompt, generá 4 variaciones de ese concepto.
Las variaciones deben mantener la misma dirección visual pero explorar diferentes composiciones, énfasis de color, o diferencias estilísticas menores.
Es CRÍTICO que uses los colores exactos del brand kit y respetes todas las reglas de marca.
Respondé SOLO con JSON válido: { "variations": [ { "variation_name": "...", "image_prompt": "..." }, ... ] }`,
      },
      {
        role: 'user',
        content: `BRAND KIT COMPLETO:\n${brandKitContext}\n\nCONCEPTO SELECCIONADO: ${selectedConcept.conceptName}\nPROMPT ORIGINAL:\n${selectedConcept.prompt}\n\nGenerá 4 variaciones de este concepto.`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(variationsResponse.choices[0].message.content || '{}');
  const variations: VariationItem[] = parsed.variations || [];

  const imagePromises = variations.map(async (variation: VariationItem) => {
    const imageResponse = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: variation.image_prompt,
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });

    return {
      id: Math.random().toString(36).slice(2),
      base64: imageResponse.data?.[0]?.b64_json || '',
      prompt: variation.image_prompt,
      conceptName: variation.variation_name,
    };
  });

  const images = await Promise.all(imagePromises);
  return NextResponse.json({ images });
}
