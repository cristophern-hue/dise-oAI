import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { text }: { text: string } = await req.json();

  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un analista de marca. Extraé la identidad visual de un manual de marca y respondé SOLO con JSON válido con esta estructura exacta:
{
  "name": "nombre de la marca o string vacío",
  "primaryColor": "#hexcode del color principal (si no hay hex, estimá uno que represente el color descrito)",
  "secondaryColor": "#hexcode del color secundario",
  "accentColor": "#hexcode del color de acento",
  "styleDescription": "descripción completa del estilo visual, tono, audiencia, tipografía, reglas de diseño, qué se debe y no se debe hacer, estilo fotográfico y cualquier otra guía relevante de la marca"
}`,
      },
      {
        role: 'user',
        content: `Manual de marca:\n\n${text}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const extracted = JSON.parse(response.choices[0].message.content || '{}');
  return NextResponse.json(extracted);
}
