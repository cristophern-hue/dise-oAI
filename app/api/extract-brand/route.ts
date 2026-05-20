import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const formData = await req.formData();
  const file = formData.get('pdf') as File;
  if (!file) return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const pdf = await pdfParse(buffer);
  const text = pdf.text.slice(0, 12000); // cap to avoid token limits

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a brand analyst. Extract brand identity information from a brand manual and return it as structured JSON.
Extract as much as possible. For colors, return hex codes when mentioned, otherwise describe the color.
Respond ONLY with valid JSON matching this exact shape:
{
  "name": "brand name or empty string",
  "primaryColor": "#hexcode or best guess from description",
  "secondaryColor": "#hexcode or best guess",
  "accentColor": "#hexcode or best guess",
  "styleDescription": "comprehensive description of visual style, tone, rules, dos and don'ts, target audience, typography, photography style, and any other relevant brand guidelines"
}`,
      },
      {
        role: 'user',
        content: `Extract the brand identity from this brand manual:\n\n${text}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const extracted = JSON.parse(response.choices[0].message.content || '{}');
  return NextResponse.json(extracted);
}
