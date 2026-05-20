import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai';

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const formData = await req.formData();
  const file = formData.get('pdf') as File;
  if (!file) return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload PDF to OpenAI Files API, then use it in chat
  const uploaded = await openai.files.create({
    file: await toFile(buffer, file.name || 'brand-manual.pdf', { type: 'application/pdf' }),
    purpose: 'user_data',
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.chat.completions.create as any)({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: { file_id: uploaded.id },
            },
            {
              type: 'text',
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
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const extracted = JSON.parse(content);
    return NextResponse.json(extracted);
  } finally {
    // Clean up uploaded file
    await openai.files.delete(uploaded.id).catch(() => null);
  }
}
