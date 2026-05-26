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
    'QUÉ CAMBIAR: reemplazá ÚNICAMENTE las prendas que viste la persona en la imagen del concepto con la/s prenda/s de referencia del producto.',
    'QUÉ NO TOCAR: textos, tipografías, fondo, composición, iluminación, logos, pose de la persona, expresión, peinado. Todo lo demás queda pixel-perfect.',
    'COLORES DEL FONDO Y ELEMENTOS GRÁFICOS — PROHIBICIÓN ABSOLUTA: no ajustar, no armonizar, no adaptar los colores del fondo, geometrías, texto, bloques de color ni ningún elemento que no sea la prenda. Si el fondo era azul → sigue azul exacto. Si el texto era blanco → sigue blanco. Si había geometrías grises → siguen grises. La "armonía de color" entre prenda y fondo NO es tu decisión — está PROHIBIDA.',
    multiProductRule,
    'REGLAS DE COLOR CRÍTICAS — ANTI-ALUCINACIÓN:',
    '- Si el color de la prenda tiene código HEX en la descripción (formato #XXXXXX), usá ESE color exacto. No interpretar, no ajustar.',
    '- Beige NUNCA es blanco ni gris. Beige es tono arena cálido, aproximadamente #C4B49A. Si la prenda es beige → reproducila beige, NO blanca.',
    '- Negro es negro profundo (#0A0A0A), NO gris oscuro. Marino es azul marino (#1A2B4A), NO negro.',
    '- Tonos cálidos (camel, terracota, ocre) conservan su temperatura — no los enfriar ni neutralizar.',
    '- CALCE Y CAÍDA — CRÍTICO: replicá exactamente cómo cae y calza la prenda sobre el cuerpo según las fotos de referencia. Si el pantalón es relajado con holgura en los muslos → relajado, no ajustado. Si la remera cae suelta sin marcar el cuerpo → suelta. Si la tela es gruesa y estructurada → grosor visible. Si es liviana con caída fluida → fluida. NO cambiar el fit ni la silueta de cómo aparece en las fotos de referencia.',
    '- Reproducí la silueta EXACTA: slim→slim, recto→recto, wide→wide, holgado→holgado. No entallar ni ensanchar.',
    '- REMATES Y PUÑOS — CRÍTICO: revisá las fotos de referencia para el terminado exacto de cada pieza. Si el pantalón tiene puño/cuff elástico en el tobillo → reproducilo con ese puño. Si tiene ruedo recto → ruedo recto. Si la manga tiene puño de color diferente → ese puño. Nunca supongas un ruedo genérico abierto si la referencia muestra otra cosa.',
    '- Reproducí SOLO los bolsillos visibles en la referencia. Si NO hay bolsillos cargo → CERO bolsillos cargo.',
    '- No inventar ningún detalle que no esté en la foto de referencia.',
    '- ANTI-ALUCINACIÓN: no agregar botones, bordados, prints, logos ni adornos que no estén en la referencia.',
    '- POSICIÓN Y ESCALA DE ESTAMPADOS — CRÍTICO: el gráfico/print debe ocupar EXACTAMENTE las mismas proporciones y posición que en las fotos de referencia. Si el gráfico llega casi hasta el ruedo de la remera → debe llegar hasta ahí, no quedarse a mitad de camino. Si el texto está a 3 cm arriba del gráfico → esa distancia. No reducir la escala ni dejar espacios en blanco donde la referencia muestra gráfico. Las fotos de referencia son la fuente de verdad absoluta para tamaño y posición del print.',
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

  const responsesTool = [{ type: 'image_generation', model: 'gpt-image-2', quality: 'high', size: '1024x1536' }];

  const tryResponses = async (promptText: string, label: string): Promise<string | null> => {
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
    } catch (err) {
      console.error(`apply-product ${label} failed:`, err);
    }
    return null;
  };

  // ── PATH 1: Responses API — full prompt, up to 2 attempts ───────────────
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await tryResponses(applyPrompt, `path1 attempt ${attempt}`);
    if (result) return NextResponse.json({ base64: result, applied: true, appliedVia: 'responses' });
  }

  // ── PATH 2: Responses API — simplified prompt (avoids content filter) ───
  // Still passes concept + product photos so gpt-image-2 sees the actual garment.
  const simplifiedPrompt = [
    'Replace the clothing on the person in the concept image with the exact garment shown in the product reference photos.',
    'Keep everything else completely unchanged: background, text, composition, pose, face, hair, lighting.',
    garmentDesc,
    multiProductRule,
  ].filter(Boolean).join('\n');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await tryResponses(simplifiedPrompt, `path2 attempt ${attempt}`);
    if (result) return NextResponse.json({ base64: result, applied: true, appliedVia: 'responses-simplified' });
  }

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
