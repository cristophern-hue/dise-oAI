import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

export async function POST(req: NextRequest) {
  const { brief, brandKit }: { brief: string; brandKit: BrandKit } = await req.json();

  const brandKitContext = `
Brand: ${brandKit.name}
Primary color: ${brandKit.primaryColor}
Secondary color: ${brandKit.secondaryColor}
Accent color: ${brandKit.accentColor}
Style: ${brandKit.styleDescription}
`;

  // Step 1: GPT-4o generates 6 distinct concept prompts
  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a senior creative director. Given a campaign brief and brand kit, generate exactly 6 distinct visual concepts for a 1024x1024 social media image.
Each concept must have a different visual approach: e.g., minimalist, bold typographic, product hero, lifestyle, abstract, editorial.
Incorporate the brand colors and style into every concept.
Respond ONLY with valid JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
image_prompt must be detailed, specific, and ready to send directly to an image generation model.`,
      },
      {
        role: 'user',
        content: `Brand kit:\n${brandKitContext}\n\nCampaign brief:\n${brief}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(conceptsResponse.choices[0].message.content || '{}');
  const concepts: ConceptItem[] = parsed.concepts || [];

  // Step 2: Generate all 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Brand colors: primary ${brandKit.primaryColor}, secondary ${brandKit.secondaryColor}. Style: ${brandKit.styleDescription}. Square format, professional quality, social media ad.`;

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
