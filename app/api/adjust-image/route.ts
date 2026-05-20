import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai';

export async function POST(req: NextRequest) {
  const { imageBase64, instruction }: { imageBase64: string; instruction: string } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Convert base64 to Buffer then to File for the API
  const buffer = Buffer.from(imageBase64, 'base64');
  const imageFile = await toFile(buffer, 'image.png', { type: 'image/png' });

  const response = await openai.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: instruction,
    size: '1024x1536',
    quality: 'medium',
  });

  return NextResponse.json({
    base64: response.data?.[0]?.b64_json || '',
  });
}
