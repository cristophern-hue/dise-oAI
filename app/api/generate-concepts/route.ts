import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { BrandKit } from '@/app/types';

type GenerationMode = 'no-people' | 'real-person';

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

const PRODUCT_FIDELITY =
  'CRITICAL: The product must appear EXACTLY as in the reference photo — same print, same colors, same fabric texture, same cut, same details. Do NOT invent, simplify, or alter the product in any way. The product is the non-negotiable anchor of every concept.';

const MODE_SYSTEM_NOTE: Record<GenerationMode, string> = {
  'no-people':
    `A reference image is provided (it may show someone wearing/using the product or the product alone). Extract the product from it and feature it faithfully. Every concept must show ONLY the product — no people, no models. Focus on product presentation: flat lays, packshots, styled surfaces, or abstract compositions. ${PRODUCT_FIDELITY}`,
  'real-person':
    `A reference photo of a real person already wearing/using the product is provided. That single image contains both the person and the product. Every concept MUST use this image as the visual anchor — preserve the person's appearance and the product's exact look. Only composition, background, typography, and styling change between concepts. ${PRODUCT_FIDELITY}`,
};

export async function POST(req: NextRequest) {
  const {
    brief,
    brandKit,
    mode = 'no-people',
    referenceImageBase64,
  }: {
    brief: string;
    brandKit: BrandKit;
    mode?: GenerationMode;
    referenceImageBase64?: string;
  } = await req.json();

  const brandKitContext = `
Brand: ${brandKit.name}
Primary color: ${brandKit.primaryColor}
Secondary color: ${brandKit.secondaryColor}
Accent color: ${brandKit.accentColor}
Style: ${brandKit.styleDescription}
`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const modeNote = referenceImageBase64 ? MODE_SYSTEM_NOTE[mode] : '';

  // Step 1: GPT-4o generates 6 distinct concept prompts
  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a senior creative director. Given a campaign brief and brand kit, generate exactly 6 distinct visual concepts for a 1024x1024 social media image.
Each concept must have a different visual approach: e.g., minimalist, bold typographic, product hero, lifestyle, abstract, editorial.
Incorporate the brand colors and style into every concept.
${modeNote}
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

  // Both modes use a single reference image passed via referenceImageBase64
  let referenceImageFile: Awaited<ReturnType<typeof toFile>> | null = null;
  if (referenceImageBase64) {
    const raw = referenceImageBase64.includes(',') ? referenceImageBase64.split(',')[1] : referenceImageBase64;
    referenceImageFile = await toFile(Buffer.from(raw, 'base64'), 'reference.png', { type: 'image/png' });
  }

  // Step 2: Generate all 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Brand colors: primary ${brandKit.primaryColor}, secondary ${brandKit.secondaryColor}. Style: ${brandKit.styleDescription}. IMPORTANT: reproduce the product exactly as shown in the reference image — same print, same colors, same cut, do not change or invent any product details. Square format, professional quality, social media ad.`;

    let b64: string;

    if (referenceImageFile) {
      const imageResponse = await openai.images.edit({
        model: 'gpt-image-1',
        image: referenceImageFile,
        prompt: fullPrompt,
        size: '1024x1024',
        quality: 'medium',
        n: 1,
      });
      b64 = imageResponse.data?.[0]?.b64_json || '';
    } else {
      const imageResponse = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: fullPrompt,
        size: '1024x1024',
        quality: 'medium',
        n: 1,
      });
      b64 = imageResponse.data?.[0]?.b64_json || '';
    }

    return {
      id: Math.random().toString(36).slice(2),
      base64: b64,
      prompt: fullPrompt,
      conceptName: concept.concept_name,
    };
  });

  const images = await Promise.all(imagePromises);

  return NextResponse.json({ images });
}
