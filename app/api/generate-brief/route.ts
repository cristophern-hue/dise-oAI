import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { clientRequest, brandKit }: { clientRequest: string; brandKit: BrandKit | null } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const brandContext = brandKit ? `\nBRAND KIT DEL CLIENTE:\n${buildBrandKitContext(brandKit)}` : '';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior especializado en moda y retail. Tu tarea es transformar una solicitud informal de un cliente en un brief creativo estructurado y accionable para un equipo de diseño.

El brief debe ser concreto, inspirador y útil — no genérico. Máximo 150 palabras. Formato libre (no uses bullets ni headers), redactado como una dirección creativa.

Incluí siempre: objetivo de la pieza, formato/plataforma, mensaje principal, tono y mood, elementos visuales clave.`,
      },
      {
        role: 'user',
        content: `SOLICITUD DEL CLIENTE:\n${clientRequest}${brandContext}`,
      },
    ],
    max_tokens: 300,
  });

  const brief = response.choices[0].message.content || '';
  return NextResponse.json({ brief });
}
