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
    `A reference photo of a specific person AND a separate product image are both provided. Every concept MUST show this exact person wearing/using this exact product. Only composition, background, typography, and styling change between concepts. ${PRODUCT_FIDELITY}`,
};

export async function POST(req: NextRequest) {
  const {
    brief,
    brandKit,
    mode = 'no-people',
    referenceImageBase64,
    productImageBase64,
  }: {
    brief: string;
    brandKit: BrandKit;
    mode?: GenerationMode;
    referenceImageBase64?: string;
    productImageBase64?: string;
  } = await req.json();

  const brandKitContext = `
Brand: ${brandKit.name}
Primary color: ${brandKit.primaryColor}
Secondary color: ${brandKit.secondaryColor}
Accent color: ${brandKit.accentColor}
Style: ${brandKit.styleDescription}
`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const hasReference = !!referenceImageBase64 || !!productImageBase64;
  const modeNote = hasReference ? MODE_SYSTEM_NOTE[mode] : '';

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

  // Prepare image files once
  const toImageFile = async (b64: string, name: string) => {
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    return toFile(Buffer.from(raw, 'base64'), name, { type: 'image/png' });
  };

  const referenceImageFile = referenceImageBase64 ? await toImageFile(referenceImageBase64, 'reference.png') : null;
  const productImageFile = productImageBase64 ? await toImageFile(productImageBase64, 'product.png') : null;

  // real-person: pass person + product; no-people: pass whichever single image is available
  const editImages: Awaited<ReturnType<typeof toFile>>[] = [];
  if (mode === 'real-person') {
    if (referenceImageFile) editImages.push(referenceImageFile);
    if (productImageFile) editImages.push(productImageFile);
  } else {
    if (referenceImageBase64 && referenceImageFile) editImages.push(referenceImageFile);
    else if (productImageFile) editImages.push(productImageFile);
  }

  // Step 2: Generate all 6 images in parallel
  const imagePromises = concepts.map(async (concept: ConceptItem) => {
    const fullPrompt = `${concept.image_prompt}. Brand colors: primary ${brandKit.primaryColor}, secondary ${brandKit.secondaryColor}. Style: ${brandKit.styleDescription}. IMPORTANT: reproduce the product exactly as shown in the reference image — same print, same colors, same cut, do not change or invent any product details. Square format, professional quality, social media ad.`;

    let b64: string;

    if (editImages.length > 0) {
      const imageResponse = await openai.images.edit({
        model: 'gpt-image-1',
        image: editImages.length === 1 ? editImages[0] : editImages,
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
