import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conceptImageBase64, productDetailImages, productDescription, peopleMode, personDescription, conceptName }: {
    conceptImageBase64: string;
    productDetailImages: string[];
    productDescription: string;
    peopleMode: 'none' | 'real';
    personDescription: string;
    conceptName?: string;
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!productDetailImages.length) {
    return NextResponse.json({ base64: conceptImageBase64, applied: false });
  }

  const hasPerson = peopleMode === 'real' && personDescription;
  const personPart = hasPerson ? ` El modelo debe coincidir con: ${personDescription}.` : '';
  const conceptContext = conceptName ? ` Estilo editorial: ${conceptName}.` : '';

  const garmentDesc = productDescription
    ? `Prenda a reproducir EXACTAMENTE:\n${productDescription}`
    : 'Reproduce the exact garment shown in the input product photo.';

  const allProductImages = productDetailImages.slice(0, 4);
  const multiProductRule = allProductImages.length > 1
    ? `PRENDAS A APLICAR (${allProductImages.length} piezas): aplicá TODAS las prendas de referencia que correspondan — por ejemplo si hay remera + pantalón, la persona debe vestir ambas prendas simultáneamente. No omitir ninguna prenda de referencia.`
    : '';

  const applyPrompt = [
    '═══ TAREA ÚNICA: cambiar SOLO la ropa. El concepto de entrada es SAGRADO. ═══',
    'LO QUE CAMBIA: las prendas que viste la persona, reemplazadas por las prendas de las fotos de referencia.',
    'LO QUE NO CAMBIA (PIXEL-PERFECT):',
    '- POSICIÓN Y POSE: la persona queda en el MISMO lugar del frame, misma pose, mismo tamaño, mismo ángulo. Inamovible.',
    '- FONDO Y COMPOSICIÓN: colores, geometrías, bloques, gradientes — idénticos. CERO armonización con la prenda nueva.',
    '- TEXTO Y TIPOGRAFÍA: todo el copy, logos y números quedan exactos. CERO texto nuevo, CERO texto eliminado.',
    '- ILUMINACIÓN Y ENCUADRE: idénticos al concepto original.',
    multiProductRule,
    'CÓMO REPRODUCIR LA PRENDA — LEÉ LA DESCRIPCIÓN DE PRODUCTO Y RESPETÁ CADA NÚMERO EXACTO:',
    '- Color: usá el hex exacto de la descripción si existe. Beige ≠ blanco (#C4B49A). Negro ≠ gris (#0A0A0A).',
    '- Calce: holgado→holgado, slim→slim. No ajustar ni entallar respecto a cómo cae en la referencia.',
    '- Remates: puño elástico en tobillo si lo tiene la referencia — nunca asumir ruedo abierto genérico.',
    '- Estampado — 4 reglas no negociables: (1) ESCALA: si la descripción dice "65% del frente", el gráfico DEBE ocupar exactamente ese 65% — no lo achicar, no lo "centrar", no lo "balancear". (2) DISTANCIA DEL CUELLO: si dice "empieza a 5 cm del cuello", respetar esa distancia exacta — PROHIBIDO subir o bajar el gráfico. (3) LÍMITE INFERIOR: si el gráfico llega al ruedo en la referencia → toca el ruedo en la imagen, 0 cm de tela en blanco debajo. Si hay espacio → reproducir exactamente esa cantidad de cm. PROHIBICIÓN ABSOLUTA de agregar espacio blanco que no existe en la referencia. (4) POSICIÓN HORIZONTAL: si está centrado, déjalo centrado. Si está descentrado, respeta esa asimetría exactamente — PROHIBIDO "corregir" posiciones.',
    '- ANTI-ALUCINACIÓN: no inventar bolsillos, botones, bordados ni adornos ausentes en la referencia.',
    '- Texto del estampado (ej: "DRINK COFFEE"): queda SOLO en la prenda, no se extrae como copy de la composición.',
    garmentDesc,
    personPart,
    conceptContext,
  ].filter(Boolean).join('\n');

  const conceptDataUrl = `data:image/png;base64,${conceptImageBase64}`;
  const productImageContent = allProductImages.map(img => ({
    type: 'input_image' as const,
    image_url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
    detail: 'high' as const,
  }));

  const responsesInput = (promptText: string) => [{
    role: 'user' as const,
    content: [
      { type: 'input_image' as const, image_url: conceptDataUrl, detail: 'high' as const },
      ...productImageContent,
      { type: 'input_text' as const, text: promptText },
    ],
  }];

  const responsesTool = [{ type: 'image_generation', model: 'gpt-image-2', quality: 'medium', size: '1024x1536' }];

  const tryResponses = async (promptText: string, label: string): Promise<string | null> => {
    for (let i = 0; i < 2; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (openai.responses.create as any)({
          model: 'gpt-4o',
          input: responsesInput(promptText),
          tools: responsesTool,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const block of (response.output || [])) {
          if (block.type === 'image_generation_call' && block.result) return block.result;
        }
        console.error(`apply-product ${label}: no image block`);
        return null; // content filter — retrying same prompt won't help
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 429 && i === 0) {
          console.warn(`apply-product ${label}: rate limited, waiting 10s`);
          await new Promise(r => setTimeout(r, 10000));
          continue; // one retry on 429 only
        }
        console.error(`apply-product ${label} failed:`, err);
        return null; // any other error — exit immediately
      }
    }
    return null;
  };

  // ── PATH 1: Responses API — full prompt ─────────────────────────────────
  // tryResponses already retries once on 429; no outer loop needed.
  const result1 = await tryResponses(applyPrompt, 'path1');
  if (result1) return NextResponse.json({ base64: result1, applied: true, appliedVia: 'responses' });

  // ── PATH 2: Responses API — simplified prompt (avoids content filter) ───
  // Still passes concept + product photos so gpt-image-2 sees the actual garment.
  const simplifiedPrompt = [
    'Replace the clothing on the person in the concept image with the exact garment shown in the product reference photos.',
    'Keep everything else completely unchanged: background, text, composition, pose, face, hair, lighting.',
    garmentDesc,
    multiProductRule,
  ].filter(Boolean).join('\n');

  const result2 = await tryResponses(simplifiedPrompt, 'path2');
  if (result2) return NextResponse.json({ base64: result2, applied: true, appliedVia: 'responses-simplified' });

  // ── PATH 3: images.edit — last resort, no product photo reference ────────
  try {
    const file = await toFile(Buffer.from(conceptImageBase64, 'base64'), 'concept.png', { type: 'image/png' });
    const res = await openai.images.edit({
      model: 'gpt-image-2',
      image: file,
      prompt: simplifiedPrompt,
      size: '1024x1536',
      quality: 'high',
    });
    const base64 = res.data?.[0]?.b64_json || '';
    if (base64) return NextResponse.json({ base64, applied: true, appliedVia: 'edit-concept-base' });
    console.error('apply-product path3 (edit) returned empty');
  } catch (err) {
    console.error('apply-product path3 (edit) failed:', err);
  }

  return NextResponse.json({ base64: conceptImageBase64, applied: false, appliedVia: 'none' });
}
