import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const formData = await req.formData();
  const file = formData.get('pdf') as File;
  if (!file) return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');

  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: file.name || 'brand-manual.pdf',
            file_data: `data:application/pdf;base64,${base64}`,
          },
          {
            type: 'input_text',
            text: `Analizá este manual de marca y extraé la identidad visual. Respondé SOLO con JSON válido con esta estructura exacta:
{
  "name": "nombre de la marca o string vacío",
  "primaryColor": "#hexcode del color principal (si no hay hex, estimá uno que represente el color descrito)",
  "secondaryColor": "#hexcode del color secundario",
  "accentColor": "#hexcode del color de acento",
  "styleDescription": "descripción completa del estilo visual, tono, audiencia, tipografía, reglas de diseño, qué se debe y no se debe hacer, estilo fotográfico y cualquier otra guía relevante de la marca"
}`,
          },
        ],
      },
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (response.output as any[])
    .filter((b) => b.type === 'message')
    .flatMap((b) => b.content ?? [])
    .filter((c: { type: string }) => c.type === 'output_text')
    .map((c: { text?: string }) => c.text ?? '')
    .join('');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse response' }, { status: 500 });

  const extracted = JSON.parse(jsonMatch[0]);
  return NextResponse.json(extracted);
}
