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
        content: `Sos un analista de marca experto. Extraé TODA la información de identidad visual de un manual de marca.
Es CRÍTICO que captures los hex codes EXACTOS que aparecen en el texto. Si el texto menciona #3b3836, usá ese valor exacto.
Respondé SOLO con JSON válido con esta estructura:
{
  "name": "nombre de la marca",
  "primary1": "#hexcode exacto del primer color primario",
  "primary2": "#hexcode exacto del segundo color primario",
  "primary3": "#hexcode exacto del tercer color primario",
  "secondary1": "#hexcode exacto del primer color secundario",
  "secondary2": "#hexcode exacto del segundo color secundario",
  "secondary3": "#hexcode exacto del tercer color secundario",
  "typography": "tipografías exactas mencionadas, incluyendo todas las variantes (Regular, Wide, Extended, pesos, etc.)",
  "styleDescription": "descripción completa: estilo visual, tono, audiencia target, reglas de uso del logo, guías de imágenes/fotografía, reglas de diseño, prohibiciones, aplicaciones en RRSS y cualquier otra guía relevante"
}
Si hay menos de 3 colores en alguna paleta, repetí el más relevante o usá una variante cercana.`,
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
