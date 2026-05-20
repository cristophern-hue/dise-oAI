import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit, GeneratedImage } from '@/app/types';

interface VariationItem {
  variation_name: string;
  image_prompt: string;
}

export async function POST(req: NextRequest) {
  const { selectedConcept, brandKit }: { selectedConcept: GeneratedImage; brandKit: BrandKit } = await req.json();

  const brandKitContext = `
Brand: ${brandKit.name}
Primary color: ${brandKit.primaryColor}
Secondary color: ${brandKit.secondaryColor}
Accent color: ${brandKit.accentColor}
Style: ${brandKit.styleDescription}
`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Step 1: GPT-4o generates 4 variation prompts based on the selected concept
  const variationsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a senior creative director. Given a selected visual concept and its prompt, generate 4 variations of that concept.
Variations should maintain the same visual direction but explore different compositions, color emphasis, or minor stylistic differences.
Respond ONLY with valid JSON: { "variations": [ { "variation_name": "...", "image_prompt": "..." }, ... ] }
Each image_prompt must be detailed and ready to send to an image generation model.`,
      },
      {
        role: 'user',
        content: `Brand kit:\n${brandKitContext}\n\nSelected concept: ${selectedConcept.conceptName}\nOriginal prompt:\n${selectedConcept.prompt}\n\nGenerate 4 variations of this concept.`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(variationsResponse.choices[0].message.content || '{}');
  const variations: VariationItem[] = parsed.variations || [];

  // Step 2: Generate all 4 variation images in parallel
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
