import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { BrandKit, PeopleMode } from '@/app/types';
import { buildBrandKitContext, extractLogoImages } from '@/app/api/brandKitContext';

function isRefusal(text: string): boolean {
  if (!text || text.length < 30) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes("i'm sorry") || lower.includes("i cannot") || lower.includes("i can't") ||
    lower.includes("cannot assist") || lower.includes("can't assist") ||
    lower.includes("lo siento") || lower.includes("no puedo ayudar") || lower.includes("no puedo asistir") ||
    lower.includes("no es posible") || lower.includes("lamentablemente no")
  );
}

export const maxDuration = 300;

interface ConceptItem {
  concept_name: string;
  image_prompt: string;
}

const PRODUCT_DESCRIPTION_PROMPT = `Sos un técnico de producto de moda de alta gama. Analizá esta prenda y describila con precisión quirúrgica para que pueda ser reproducida EXACTAMENTE por un modelo de IA generativa. Imaginá que quien lee tu descripción no puede ver la foto — tu texto es el único recurso.

Describí en este orden exacto:

1. TIPO DE PRENDA: categoría (remera, pantalón, vestido, campera, etc.), silueta y corte (slim, straight, wide-leg, oversize, entallado, etc.), largo exacto (hasta el tobillo, a la rodilla, etc.)

2. COLOR BASE — CRÍTICO PARA PRENDAS LISAS: para colores sólidos (el caso más difícil) describí con máxima precisión:
   - CÓDIGO HEX ESTIMADO: analizá visualmente el color de la tela e indicá su código hexadecimal aproximado. Ejemplos: #C4B49A para beige arena cálido, #2B3A4A para azul marino oscuro, #1A1A1A para negro profundo. Sé específico — esto es lo más importante para que la IA reproduzca el color exacto. Formato: "Color hex aproximado: #XXXXXX"
   - Tono exacto en palabras: no "negro" sino "negro mate profundo sin brillo", no "azul" sino "azul marino oscuro con subtono violeta", no "gris" sino "gris carbón medio con ligero subtono verdoso"
   - Temperatura del color: frío, cálido o neutro
   - Saturación y profundidad: intenso, apagado, lavado, oscuro, claro
   - Cómo se comporta con la luz: absorbe la luz (mate), la refleja levemente (satinado suave), brilla (lustrado)
   - Para prendas con una sola trama de color, el hex es TODO — sin él el generador produce su propio "beige genérico"

3. ESTAMPADO / PRINT (cuando existe, es lo más crítico): describí CADA elemento gráfico individualmente — qué forma tiene, de qué color exacto, qué tamaño relativo al total de la prenda, cómo se distribuye (all-over, centrado, borde, repetición, etc.), orientación, y cómo contrasta con el fondo. Si hay texto, copialo exactamente. Nunca escribas "estampado floral" — describí cada flor, su color, tamaño y posición.

4. MATERIALES Y TEXTURA: tipo de tela inferido (denim, punto, tela plana, etc.), acabado (mate, satinado, brillante), peso visual (liviano, pesado, estructurado), transparencia, textura superficial visible

5. DETALLES DE CONFECCIÓN:
   - Para pantalones: pretina (elástica, con presillas para cinturón, ancho), tiro (bajo, medio, alto), bolsillos (cantidad, tipo, posición), bota (angosta, recta, acampanada, ancho exacto estimado), cierre (visible/invisible, color), terminación del ruedo (doblado, overlock, costura plana)
   - Para remeras/tops: cuello (redondo, V, polo, etc.), mangas (largo, corte), puños, dobladillo
   - Para todas: costuras decorativas, piping, botones, cierres, terminaciones especiales

6. ELEMENTOS ÚNICOS: cualquier detalle que diferencie esta prenda de una genérica del mismo color — una costura decorativa, un detalle en la pretina, una textura inusual, un corte asimétrico

7. AUSENCIAS CRÍTICAS (igual de importante que lo anterior):
   Listá explícitamente qué NO tiene esta prenda. Esto evita que la IA invente features genéricos.
   Ejemplos obligatorios para pantalones:
   - Si NO tiene bolsillos cargo → escribí "SIN bolsillos cargo ni bolsillos laterales de ningún tipo"
   - Si NO tiene bolsillos con solapa/flap → escribí "SIN bolsillos con solapa ni flap pockets"
   - Si NO tiene cintura elástica → escribí "SIN elástico en pretina — solo presillas para cinturón"
   - Si NO tiene pliegues → escribí "SIN pliegues ni pinzas"
   - Si NO tiene dobladillo tipo jogger → escribí "ruedo simple, SIN dobladillo elástico"
   Para cualquier prenda: siempre describí qué pockets NO tiene además de los que SÍ tiene.
   Una prenda bien descrita dice tanto lo que ES como lo que NO ES.

REGLA CLAVE: Para prendas de color sólido (pantalones, remeras básicas, camisas lisas), el color es el único diferenciador. Dedicá mínimo 3 oraciones al color exacto con todos sus matices, temperatura, comportamiento con la luz y acabado. Una descripción vaga del color ("pantalón negro") producirá resultados incorrectos.`;

async function describeProductWithVision(openai: OpenAI, imageDataUrl: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PRODUCT_DESCRIPTION_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ],
    }],
    max_tokens: 800,
  });
  return response.choices[0].message.content || '';
}

async function editProductForConcept(
  openai: OpenAI,
  productDataUrl: string,
  editPrompt: string,
): Promise<string> {
  try {
    const base64Data = productDataUrl.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    const imageFile = await toFile(buffer, 'product.jpg', { type: 'image/jpeg' });
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: editPrompt,
      size: '1024x1536',
      quality: 'medium',
    });
    return response.data?.[0]?.b64_json || '';
  } catch (err) {
    console.error('editProductForConcept failed:', err);
    return '';
  }
}

async function generateWithGptImage2(
  openai: OpenAI,
  prompt: string,
  inputImages: string[] = []
): Promise<string> {
  const content = [
    ...inputImages.map(img => ({ type: 'input_image', image_url: img, detail: 'high' })),
    { type: 'input_text', text: prompt },
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai.responses.create as any)({
      model: 'gpt-image-2',
      input: [{ role: 'user', content }],
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'medium',
        size: '1024x1536',
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.output || [])) {
      if (block.type === 'image_generation_call' && block.result) return block.result;
    }
    console.error('Responses API returned no image block');
  } catch (err) {
    console.error('Responses API failed:', err);
  }

  const fallback = await openai.images.generate({
    model: 'gpt-image-2',
    prompt,
    size: '1024x1536',
    quality: 'low',
    n: 1,
  });
  return fallback.data?.[0]?.b64_json || '';
}

export async function POST(req: NextRequest) {
  const {
    brief, brandKit, peopleMode = 'none',
    productDetailImages = [], referenceImages = [],
    styleReferenceImages = [], count = 6,
  }: {
    brief: string;
    brandKit: BrandKit;
    peopleMode: PeopleMode;
    productDetailImages: string[];
    referenceImages: string[];
    styleReferenceImages: string[];
    count: number;
  } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const brandKitContext = buildBrandKitContext(brandKit);

  const isSimilarMode = styleReferenceImages.length > 0;
  const targetCount = isSimilarMode ? Math.max(1, Math.min(count, 6)) : 6;
  // Raw base64 → data URLs for Responses API / vision
  const styleReferenceDataUrls = styleReferenceImages.map(
    (b64: string) => b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`
  );

  // Visual refs from brand kit (style guide for generation)
  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  const productRef: string | null = productDetailImages[0] || null;
  const logos = extractLogoImages(brandKit);

  // Generate product + person descriptions — returned to frontend for the apply-product step
  let productDescription = '';
  let personDescription = '';

  if (productRef) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const desc = await describeProductWithVision(openai, productRef);
        productDescription = isRefusal(desc) ? '' : desc;
        if (productDescription) break;
        console.warn(`describe-product: attempt ${attempt + 1} returned refusal/empty`);
      } catch (err) {
        console.error(`describe-product: attempt ${attempt + 1} failed:`, err);
      }
    }
  }

  if (peopleMode === 'real' && referenceImages.length > 0) {
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describí brevemente las características físicas de las personas en estas imágenes: tono de piel, cabello, complexión, edad aproximada. Máximo 2 oraciones.' },
          ...referenceImages.map(img => ({ type: 'image_url' as const, image_url: { url: img, detail: 'low' as const } })),
        ],
      }],
      max_tokens: 150,
    });
    personDescription = visionResponse.choices[0].message.content || '';
  }

  const isProductEcommerce = peopleMode === 'none' && productDetailImages.length > 0;
  const isCorporate = peopleMode === 'corporate';
  const isEvents = peopleMode === 'events';

  // People instruction for concept generation
  const peopleInstruction = peopleMode === 'none'
    ? 'NO incluir personas. Enfocarse en producto, composición, elementos gráficos y copy.'
    : isCorporate
      ? 'Personas opcionales: si aparecen deben ser profesionales en contexto corporativo (reunión, oficina, ciudad). No es obligatorio incluirlas — priorizá composición gráfica y tipografía.'
      : isEvents
        ? 'PROHIBICIÓN ABSOLUTA: CERO personas, CERO siluetas, CERO audiencias, CERO figuras humanas en ningún prompt. Solo tipografía, iconografía digital y elementos gráficos.'
        : 'Incluir una persona usando una prenda de moda acorde al brief y brand kit. Actitud aspiracional, editorial.';

  const hasVisualRefs = visualRefs.length > 0;
  const refStyleDirection = hasVisualRefs
    ? `6. Réplica de estilo de marca — seguí EXACTAMENTE el estilo visual, composición tipográfica y tratamiento gráfico de las piezas de referencia de la marca que se incluyen como imágenes`
    : `6. ${isProductEcommerce ? 'Lifestyle del segmento — ambiente y elementos visuales que representan el segmento objetivo con el producto prominente' : isCorporate ? 'Fotografía corporativa aspiracional — espacio de trabajo premium, ciudad o arquitectura moderna como fondo, tipografía institucional' : isEvents ? 'Impacto y presencia digital — composición tipográfica bold, elementos gráficos de transmisión en vivo, paleta del brand kit con máximo contraste' : 'Editorial de moda — fotografía aspiracional de agencia internacional'}`;

  const conceptDirections = isProductEcommerce
    ? `Direcciones (e-commerce de producto) — CADA UNA debe ser visualmente DISTINTA a las demás.
REGLAS OBLIGATORIAS PARA TODAS LAS DIRECCIONES:
- Todo el copy, titulares, CTAs y texto visible en la imagen DEBEN estar en ESPAÑOL. Nunca inglés.
- Usá el nombre de campaña del brief (si existe) como elemento tipográfico principal, no un tagline genérico inventado.
- Si el brief tiene descuento (ej: "30% off"), ese porcentaje debe aparecer prominentemente en la pieza como elemento tipográfico fuerte.
- Cada pieza DEBE incluir como mínimo headline o nombre de producto visible + logo de marca. Sin copy no hay anuncio.

1. Producto hero con headline — el producto ocupa 70% del frame, fondo color sólido del brand kit. Si el brief tiene nombre de campaña, usarlo en tipografía bold XL. Si hay descuento, incluirlo en tipografía contrastante y legible. Nombre del producto/línea como apoyo. Logo en esquina. Copy 100% en español.
2. Pieza full promocional — layout en tres franjas verticales: (A) FRANJA SUPERIOR: nombre de campaña del brief en tipografía medium, fondo color sólido del brand kit; (B) FRANJA CENTRAL: el porcentaje de descuento del brief (ej: "30%") en tipografía heavy BLACK ultragrande es el elemento visual dominante, debajo texto secundario como "de descuento" o "off" en tipografía regular más pequeña; (C) FRANJA INFERIOR: zona de mecánicas — lista horizontal limpia de 3-4 ítems en tipografía SANS-SERIF del brand kit, separados por línea vertical fina o punto mediano "·", SIN iconos stock ni clipart genérico, solo texto tipográfico alineado. Producto integrado en la franja central detrás o al lado del número. Logo en esquina inferior derecha. TODO el copy en ESPAÑOL usando la tipografía del brand kit.
3. Producto en contexto ambiental — el producto integrado en su entorno real según el brief. Overlay semitransparente con headline corto en ESPAÑOL y nombre de marca. El ambiente es el protagonista pero el copy está presente.
4. Diseño gráfico tipográfico puro — bloques de color del brand kit, tipografía bold XL ocupa 60% del frame. El headline usa la terminología exacta del brief en ESPAÑOL. Producto flotando pequeño en un corner. Tipografía estructural como elemento gráfico dominante.
5. Showcase técnico con copy — macro/closeup del producto con iluminación de estudio dramática, fondo oscuro con gradiente lateral. Nombre del producto en tipografía elegante + tagline corto del brief en ESPAÑOL. Logo en esquina inferior.
${refStyleDirection}`
    : isEvents
      ? `Direcciones (eventos/webinars) — CADA UNA visualmente DISTINTA, estilo marketing de evento digital.
REGLAS ABSOLUTAS PARA TODAS LAS DIRECCIONES:
- CERO personas, siluetas, audiencias, figuras humanas o sombras de personas en ningún prompt
- CERO contenido inventado: no inventar nombres de sesiones, speakers, tiempos ni agenda que no estén en el brief
- Si el brief no tiene agenda detallada, usar solo "Sesión 1", "Sesión 2" como placeholders genéricos
- USAR SOLO los colores hex del brand kit — no inventar paletas púrpuras, neón ni gradientes que no estén en el brand kit

1. CTA de registro urgente — título del evento en tipografía bold XL, fecha y hora del brief prominentes, elemento gráfico tipo botón/banner "Registrate". Fondo sólido del color primario del brand kit. Solo elementos tipográficos y gráficos.
2. Tipográfico de impacto — nombre del evento ocupa 70% del frame en tipografía extra-bold, subtítulo y fecha del brief como secundarios. Fondo con formas geométricas abstractas en paleta del brand kit. Solo tipografía y formas.
3. Agenda visual — layout de programa con íconos genéricos y horarios del brief. Si el brief no tiene sesiones, usar "Sesión 1 · Sesión 2 · Sesión 3" como estructura visual. Paleta del brand kit. Solo tipografía e íconos.
4. Cuenta regresiva / urgencia — countdown tipográfico grande DÍAS / HORAS / MINUTOS, fondo oscuro del brand kit, elementos de líneas y formas geométricas para tensión visual. Solo tipografía y formas.
5. Online / livestreaming — íconos de play, ondas o pantalla como elemento central, copy "En vivo" / "Online" / "Gratis", formas circulares o de señal. Solo iconografía y tipografía en paleta del brand kit.
${refStyleDirection}`
      : isCorporate
      ? `Direcciones (corporativo/servicios) — CADA UNA visualmente DISTINTA, estilo institucional premium:
1. Titular impactante — headline del brief en tipografía bold XL ocupa 60% del frame. Fondo con foto de archivo de alta calidad (ciudad, arquitectura, abstracto) o color sólido del brand kit. Logo y copy de apoyo presentes.
2. Personas en contexto profesional — profesionales en reunión, espacio de trabajo moderno o entorno urbano. Actitud de confianza y liderazgo. Headline y logo de marca bien posicionados. Calidad fotográfica premium.
3. Datos y resultados — números grandes, porcentajes o métricas del brief como elementos visuales principales. Íconos minimalistas, líneas de datos, gráficos abstractos en paleta del brand kit. Fondo oscuro o degradado del brand kit.
4. Abstracto geométrico — formas geométricas abstractas (círculos, líneas, grillas) en paleta del brand kit. Sugieren conexión, crecimiento o innovación. Tipografía institucional elegante como elemento gráfico central. Sin fotografía realista.
5. Arquitectura y espacio aspiracional — edificio corporativo moderno, skyline o espacio interior premium como imagen dominante. Overlay semitransparente en color del brand kit. Headline y propuesta de valor sobre la imagen.
${refStyleDirection}`
      : `Direcciones (fashion/editorial) — CADA UNA visualmente DISTINTA. La persona SIEMPRE viste la prenda del brief — nunca inventar ropa distinta.
1. Minimalista limpio — fondo sólido del brand kit, producto o persona centrados. Incluir nombre de campaña del brief y nombre de marca en tipografía visible.
2. Tipográfico editorial — tipografía grande como elemento visual dominante, imagen secundaria. El nombre de campaña y/o descuento del brief son el texto protagonista. En español.
3. Producto hero — prenda protagonista con iluminación de estudio. Copy visible: nombre de campaña + descuento si aplica. Nombre de marca en esquina.
4. Lifestyle aspiracional — ambiente y mood que refuerzan la identidad de marca. Nombre de campaña del brief en tipografía elegante visible.
5. Composición geométrica — bloques de color, formas y tipografía del brand kit. Nombre de campaña y descuento del brief integrados como elementos tipográficos estructurales.
${refStyleDirection}`;

  // Step 1: GPT-4o generates concept prompts tailored to mode (or variations in similar mode).
  const systemInstructions = isSimilarMode
    ? `Sos un director creativo senior de retail y publicidad digital.
Se te pasan conceptos visuales de referencia que el cliente aprobó. Tu tarea es generar exactamente ${targetCount} variaciones distintas que mantengan la misma línea gráfica (paleta, tratamiento tipográfico, mood, composición general) pero con diferencias claras en disposición, elementos secundarios y approach visual. No copies — varía.

REGLAS:
- Respetá el estilo visual de los conceptos de referencia
- Usá los hex exactos del brand kit como colores dominantes
- Estilo PREMIUM, nunca genérico ni clipart
- Fondos en colores del brand kit, tipografía precisa, máx 2-3 elementos por pieza
- Si hay descripción de productos, los image_prompts deben referenciar esos productos específicos
- PROHIBIDO inventar: precios, descuentos, porcentajes, cupones, promos, mecánicas. Solo lo que esté EXPLÍCITAMENTE en el brief.
${isProductEcommerce ? `
MODO E-COMMERCE CON PRODUCTO: cada image_prompt es una INSTRUCCIÓN DE EDICIÓN para images.edit.
El modelo recibe la foto del producto y la transforma. Describí:
- Qué fondo agregar (color sólido del brand kit, ambiente industrial, etc.)
- Qué texto y elementos de marca superponer
- Cómo componer el producto en el encuadre
- NUNCA decir "generate" — siempre "transform this product photo into..."
El producto DEBE quedar exactamente igual — solo se agregan elementos alrededor.` : ''}

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo y elementos concretos.`
    : `Sos un director creativo senior de retail y publicidad digital.
Dado un brief, brand kit y referencias visuales, generá exactamente 6 conceptos distintos para una pieza portrait 1024x1536.

REGLAS:
- Usá los hex exactos del brand kit como colores dominantes
- Estilo PREMIUM, nunca genérico ni clipart
- TODO el copy, titulares y texto visible en las imágenes DEBE estar en ESPAÑOL. Nunca inglés, nunca "Indulge in Luxury", nunca "Summer Dreams" ni frases genéricas anglosajones.
- NOMBRE DE CAMPAÑA/EVENTO: si el brief menciona un nombre (ej: "Pijamania", "Black Friday", "Cyber Monday"), usalo EXACTAMENTE como está escrito — sin traducirlo, modificarlo, reemplazarlo ni inventar uno alternativo. Ese nombre es el headline principal.
- REGLA CRÍTICA DE CONTENIDO: el nombre de campaña del brief DEBE aparecer en el image_prompt de AL MENOS 4 de los 6 conceptos como texto visible en la imagen. Si hay descuento (ej: "30% off"), debe aparecer en AL MENOS 3 conceptos. No inventar taglines alternativos — usar el contenido del brief.
- PROHIBICIÓN ABSOLUTA de inventar nombres de campaña, taglines genéricos, nombres de colecciones o cualquier copy que no esté textualmente en el brief. "Suavidad que acompaña tus momentos" es inventado y está PROHIBIDO si no está en el brief.
- Si el brief tiene un porcentaje de descuento, ese número debe dominar visualmente en las piezas promocionales.
- PRENDA: si el brief es sobre un tipo de prenda específico (pijamas, remeras, pantalones, etc.), la persona SIEMPRE viste ESA prenda. NUNCA un blazer, traje, vestido de oficina u otra prenda distinta. Si el brief dice pijamas → todos los conceptos muestran pijamas.
${conceptDirections}
- Fondos en colores del brand kit, tipografía precisa, máx 2-3 elementos por pieza
- Si hay descripción de productos, los image_prompts deben referenciar esos productos específicos
- Si hay referencias visuales de marca, los image_prompts deben seguir ese estilo visual
- PROHIBIDO inventar: precios, descuentos, porcentajes, cupones, promos, mecánicas. Solo lo que esté EXPLÍCITAMENTE en el brief.
- TODA pieza de e-commerce DEBE tener como mínimo: headline o nombre del producto visible + logo. Una imagen sin copy no es un anuncio.
- NUNCA inventar logos gráficos — si no hay imagen de logo de referencia, solo colocar el nombre de la marca en texto tipográfico.
${isEvents ? `MODO EVENTOS — PROHIBICIONES ABSOLUTAS EN CADA image_prompt:
- CERO personas, siluetas de personas, audiencias, figuras humanas o sombras de personas — si el prompt incluye personas, es incorrecto.
- CERO contenido inventado: no inventar nombres de sesiones, ponentes, horarios ni agenda no presente en el brief.
- USAR EXCLUSIVAMENTE los hex del brand kit. Ningún color exterior a la paleta del brand kit.` : ''}
${isProductEcommerce ? `
MODO E-COMMERCE CON PRODUCTO: cada image_prompt es una INSTRUCCIÓN DE EDICIÓN para images.edit.
El modelo recibe la foto del producto y la transforma. Describí:
- Qué fondo agregar (color sólido del brand kit, ambiente industrial, etc.)
- Qué texto y elementos de marca superponer (logo, nombre del evento, copy de la promo, fechas, mecánicas)
- Cómo componer el producto en el encuadre
- NUNCA decir "generate" — siempre "transform this product photo into..."
El producto en la foto DEBE quedar exactamente igual — solo se agregan elementos alrededor.` : ''}

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo y elementos concretos.`;

  const userTextContent = [
    `BRAND KIT:\n${brandKitContext}`,
    `BRIEF:\n${brief}`,
    `PERSONAS:\n${peopleInstruction}`,
    productDescription ? `PRODUCTOS (describí exactamente estos en los conceptos que los incluyan):\n${productDescription}` : '',
    isSimilarMode ? `CONCEPTOS DE REFERENCIA (generá variaciones de esta línea visual):` : '',
  ].filter(Boolean).join('\n\n');

  const userMessageContent: ChatCompletionContentPart[] = [
    { type: 'text', text: userTextContent },
    ...(isSimilarMode
      ? styleReferenceDataUrls.map(url => ({
          type: 'image_url' as const,
          image_url: { url, detail: 'high' as const },
        }))
      : []),
  ];

  const conceptsResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: userMessageContent },
    ],
    response_format: { type: 'json_object' },
  });

  const rawContent = conceptsResponse.choices[0].message.content;
  if (!rawContent) {
    console.error('generate-concepts: GPT returned null content (possible content filter)');
    const controller2 = new ReadableStream({ start(c) { c.close(); } });
    return new Response(controller2, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const parsed = JSON.parse(rawContent);
  const concepts: ConceptItem[] = parsed.concepts || [];

  // Logo images to pass as visual references — gpt-image-2 can replicate them faithfully
  const logoImages = [logos.dark, logos.light].filter(Boolean) as string[];

  // In similar mode: style references lead; otherwise brand visual refs lead.
  // Product images are NOT included in fashion/people mode — passing a product photo that
  // contains a real person causes gpt-image-2 to clone that person across all 6 concepts.
  // In people mode the product is described via text (productDescription) instead.
  const inputImages = [
    ...(isSimilarMode ? styleReferenceDataUrls : visualRefs),
    ...(isProductEcommerce ? productDetailImages : []),
    ...(peopleMode === 'real' ? referenceImages.slice(0, 1) : []),
    ...logoImages,
  ];

  const hasPeople = peopleMode !== 'none';
  const styleSuffix = isCorporate
    ? 'Premium institutional design, B2B advertising quality, clean and trustworthy. NOT generic stock photo aesthetic. If people appear: professional business context, diverse team, confident expression. Portrait 4:5.'
    : isEvents
    ? 'Event marketing design, bold typography, high-contrast layout, digital-first aesthetic. CTA-driven composition. Portrait 4:5.'
    : hasPeople
      ? 'Fashion editorial photography, natural skin tones, soft studio lighting, 85mm lens, high-end fashion campaign, photorealistic. FULL BODY SHOT — the model must be fully visible from head to toe, the complete outfit shown without any cropping of legs or feet. Reserve the lower 25% of the frame for text/logo overlay on a dark or color-blocked band, keeping the model fully visible above it.'
      : isProductEcommerce
        ? 'Professional product photography or high-end retail graphic design, agency quality, photorealistic. If a person is shown: full body fully visible from head to toe, no leg or foot cropping. Text and logo in a dedicated color band at the bottom of the frame, NOT overlapping the body.'
        : 'Premium graphic design, agency quality, NOT generic AI art, portrait 4:5.';
  const productHint = isProductEcommerce && productDetailImages.length > 0
    ? 'IMPORTANT: The provided reference images show the exact products — feature those specific products in the composition, replicating their appearance faithfully.'
    : '';

  // In fashion/people mode the product image is NOT passed as visual input, so we inject
  // the text description so the model knows what garment to feature.
  const productDescHint = hasPeople && !isEvents && !isCorporate && productDescription
    ? `Garment to feature: ${productDescription}`
    : '';
  const styleHint = isSimilarMode
    ? 'IMPORTANT: The provided reference image is the approved Key Visual — maintain its exact graphic style, color palette, typography treatment, layout approach, and mood. Create a variation, not a copy: same DNA, different composition.'
    : visualRefs.length > 0
    ? 'Match the visual style, typography treatment and composition quality of the provided brand reference pieces.'
    : '';

  const logoHint = logoImages.length > 0
    ? (() => {
        const base = 'Include the brand logo in the bottom-right corner (≈8% of frame width, clear space around it). ';
        if (logos.dark && logos.light) {
          return base +
            'Two logo versions are provided as reference images: a dark/colored version and a white/reversed version. ' +
            'RULE: use the WHITE logo on dark or saturated color backgrounds; use the DARK logo on light or white backgrounds. ' +
            'Replicate the logo faithfully — same shape, proportions, colors, and elements. Never distort or recolor it.';
        }
        if (logos.dark) {
          return base +
            'The dark logo version is provided as a reference image. Replicate it faithfully on a background area with sufficient contrast. ' +
            'Never distort or recolor it.';
        }
        return base +
          'The white/light logo version is provided as a reference image. Replicate it faithfully on dark or colored backgrounds. ' +
          'Never distort or recolor it.';
      })()
    : '';

  // Step 2: Stream each concept image as it completes
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: object) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  // Each fashion concept gets a distinct model character to avoid cloning across images
  const FASHION_MODEL_POOL = [
    'Unique model: light-skinned woman, straight blonde hair, slender, 25-28 yrs.',
    'Unique model: medium-tan woman, curly dark hair, athletic build, 28-33 yrs.',
    'Unique model: dark-skinned woman, natural textured hair, 24-30 yrs.',
    'Unique model: warm-toned woman, straight black hair, petite, 26-31 yrs.',
    'Unique model: light-medium woman, wavy auburn hair, tall, 27-33 yrs.',
    'Unique model: olive-skinned woman, long dark waves, 25-30 yrs.',
  ];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await Promise.allSettled(
          concepts.map(async (concept: ConceptItem, conceptIdx: number) => {
            const fashionModelHint = hasPeople && !isCorporate && !isEvents
              ? FASHION_MODEL_POOL[conceptIdx % FASHION_MODEL_POOL.length]
              : '';
            const fullPrompt = [
              concept.image_prompt,
              `Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}.`,
              `Typography: ${brandKit.typography || 'bold sans-serif'}.`,
              styleSuffix,
              productHint,
              productDescHint,
              fashionModelHint,
              hasPeople && !isCorporate && !isEvents
                ? 'Create a completely ORIGINAL AI-generated model — do NOT replicate the appearance or face of any person from uploaded reference images.'
                : '',
              styleHint,
              logoHint,
              isEvents ? 'ABSOLUTELY NO HUMANS, NO PEOPLE, NO SILHOUETTES, NO AUDIENCE, NO SPEAKER FIGURES. Pure typographic and geometric graphic design only.' : '',
              isEvents ? `USE ONLY THESE EXACT HEX COLORS: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Do NOT add purple, violet, neon, or any color not in this brand kit.` : '',
              'ALL TEXT IN THE IMAGE MUST BE IN SPANISH. Zero English words in any headline, label, CTA, or body copy.',
              'Use the EXACT campaign or event name from the brief verbatim as the headline — do NOT invent, translate, or replace it with a different name.',
              `Campaign brief (use this content for any text in the image): ${brief.slice(0, 400)}`,
              'do NOT include any invented text, prices, discounts, coupons, promo codes, or promotional copy that is not explicitly in the brief.',
              brandKit.typography ? `Use ${brandKit.typography} typeface for all text elements — no generic system fonts, no random serif italics.` : '',
            ].filter(Boolean).join(' ');

            try {
              const base64 = isProductEcommerce && productDetailImages[0]
                ? await editProductForConcept(openai, productDetailImages[0], fullPrompt)
                : await generateWithGptImage2(openai, fullPrompt, inputImages);

              if (!base64) {
                console.error(`concept "${concept.concept_name}" returned empty base64`);
                send(controller, { error: concept.concept_name });
                return;
              }
              send(controller, {
                image: {
                  id: Math.random().toString(36).slice(2),
                  base64,
                  prompt: fullPrompt,
                  conceptName: concept.concept_name,
                },
              });
            } catch (err) {
              console.error(`concept "${concept.concept_name}" failed:`, err);
              send(controller, { error: concept.concept_name });
            }
          })
        );
      } finally {
        send(controller, { done: true, productDescription, personDescription });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
