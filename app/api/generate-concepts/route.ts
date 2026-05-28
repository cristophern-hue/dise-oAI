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

const PRODUCT_DESCRIPTION_PROMPT = `Sos un técnico de producto experto. Analizá el objeto en la foto y describilo con precisión absoluta para que un modelo de IA generativa pueda reproducirlo EXACTAMENTE. Quien lea tu descripción no puede ver la foto — tu texto es el único recurso.

PASO 0 — CLASIFICACIÓN OBLIGATORIA: ¿Este objeto es una PRENDA DE VESTIR (ropa, calzado, accesorio de moda) o un PRODUCTO NO-FASHION (envase, packaging, herramienta, repuesto, alimento, electrodoméstico, etc.)?

Si es PRODUCTO NO-FASHION → ignorá completamente las secciones 1 y 5 (son exclusivas de prendas) y en su lugar describí:
   TIPO DE OBJETO: qué es exactamente (botella de aceite motor 4L, balde de lubricante 20L, filtro de combustible cilíndrico, etc.), función y segmento de mercado.
   FORMA Y GEOMETRÍA — CRÍTICO: silueta general (cilíndrico, rectangular, trapezoidal), si tiene asa/handle (posición, color, si es integrado), boca/tapón (forma, color exacto, posición), relieves o costillas, ratio alto:ancho ("3x más alto que ancho", "casi cuadrado").
   MATERIAL DEL CUERPO: HDPE opaco, PET semitransparente, lata metálica, polipropileno — color del material del cuerpo INDEPENDIENTE de la etiqueta, acabado (mate, semi-brillante, brillante).
   ETIQUETA / DECORACIÓN GRÁFICA — CRÍTICO (equivalente al estampado): cobertura (wrap-around, solo frontal, franja central), color base de la etiqueta con hex obligatorio, colores de todos los elementos gráficos con hex, posición y tamaño de cada elemento (logo, texto de marca, especificaciones técnicas como "5W-30"), tipografía visible y jerarquía, elementos adicionales (franjas, degradados, iconos de certificación, número de litros/volumen).
   TAPÓN/CIERRE: forma, color exacto con hex, tamaño relativo respecto al cuerpo.
   ELEMENTOS ÚNICOS Y AUSENCIAS: qué hace reconocible este producto vs uno genérico; qué NO tiene (ej: "SIN asa", "etiqueta solo frontal NO wrap-around").

Si es PRENDA DE VESTIR → aplicá las secciones 1-7 abajo.

Describí en este orden exacto:

1. TIPO DE PRENDA Y CALCE — CRÍTICO (SOLO PARA PRENDAS): categoría (remera, pantalón, vestido, campera, etc.), silueta y corte (slim, straight, wide-leg, oversize, entallado, etc.), largo exacto (hasta el tobillo, a la rodilla, etc.).
   Luego describí el CALCE REAL sobre el cuerpo con precisión quirúrgica:
   - ¿Cómo cae la tela? ¿Rígida y estructurada, o fluida y con drapeado?
   - ¿Dónde hay ceñimiento y dónde holgura? (ej: "ceñido en cadera y suelto desde el muslo hacia abajo", "holgado en todo el torso sin marcar el cuerpo")
   - ¿Qué grosor visual tiene la tela? ¿Parece liviana como jersey fino, media como punto grueso, o estructurada como denim?
   - ¿Cómo se comporta en movimiento? ¿Cae pegada al cuerpo o tiene vuelo/movimiento propio?
   - Describí el fit con una frase como "el pantalón cae relajado sin marcar las piernas, con ligera holgura en los muslos y piernas rectas hacia abajo" o "la remera queda levemente suelta sin ser oversize, cayendo sobre el cuerpo sin pegarse"
   NUNCA escribas solo "slim fit" o "relajado" — explicá QUÉ PARTES del cuerpo están ajustadas o sueltas.

2. COLOR BASE — CRÍTICO PARA PRENDAS LISAS: para colores sólidos (el caso más difícil) describí con máxima precisión:
   - CÓDIGO HEX ESTIMADO: analizá visualmente el color de la tela e indicá su código hexadecimal aproximado. Ejemplos: #C4B49A para beige arena cálido, #2B3A4A para azul marino oscuro, #1A1A1A para negro profundo. Sé específico — esto es lo más importante para que la IA reproduzca el color exacto. Formato: "Color hex aproximado: #XXXXXX"
   - Tono exacto en palabras: no "negro" sino "negro mate profundo sin brillo", no "azul" sino "azul marino oscuro con subtono violeta", no "gris" sino "gris carbón medio con ligero subtono verdoso"
   - Temperatura del color: frío, cálido o neutro
   - Saturación y profundidad: intenso, apagado, lavado, oscuro, claro
   - Cómo se comporta con la luz: absorbe la luz (mate), la refleja levemente (satinado suave), brilla (lustrado)
   - Para prendas con una sola trama de color, el hex es TODO — sin él el generador produce su propio "beige genérico"

3. ESTAMPADO / PRINT (cuando existe, es lo más crítico): describí CADA elemento gráfico individualmente — qué forma tiene, de qué color exacto, y además:
   - TAMAÑO PROPORCIONAL — NÚMERO EXACTO OBLIGATORIO: qué porcentaje del frente de la prenda ocupa el gráfico. Ej: "el gato ocupa el 65% del frente de la remera, desde 6 cm abajo del cuello hasta el ruedo exacto sin margen de tela en blanco". NUNCA escribir "aproximadamente" ni "unos" — usar números concretos porque el generador los replicará literalmente.
   - DISTANCIA DESDE EL CUELLO — CRÍTICO: a cuántos cm del cuello empieza el gráfico. Ej: "empieza a 5 cm del cuello" o "empieza justo debajo del pecho, a 18 cm del cuello". Este dato evita que el modelo suba o baje el gráfico respecto a la referencia.
   - LÍMITE INFERIOR CRÍTICO: ¿el gráfico llega exactamente al ruedo de la prenda, o hay margen de tela en blanco entre el gráfico y el ruedo? Indicalo con número. Si llega al ruedo → "el gráfico llega hasta el ruedo exacto, 0 cm de tela en blanco debajo". Si hay margen → "quedan exactamente Xcm de tela en blanco entre el gráfico y el ruedo". Este dato es OBLIGATORIO y define si la prenda es cropped-look o full-coverage.
   - POSICIÓN HORIZONTAL EXACTA: ¿centrado exactamente? ¿Descentrado? Si hay asimetría, describila — el generador DEBE respetar esa asimetría, no "corregirla".
   - JERARQUÍA DE ELEMENTOS: si hay texto + gráfico, describí cuál está arriba y a qué distancia. Ej: "texto 'DRINK COFFEE' centrado a 3 cm arriba del gato, en tipografía negra bold de 2 cm de alto"
   - Para estampados all-over: tamaño de cada motivo individual, densidad de repetición, y si hay variación de escala o color entre motivos
   Nunca escribas "estampado floral" — describí cada flor, su color, tamaño y posición relativa.

4. MATERIALES Y TEXTURA: tipo de tela inferido (denim, punto, tela plana, etc.), acabado (mate, satinado, brillante), peso visual (liviano, pesado, estructurado), transparencia, textura superficial visible

5. DETALLES DE CONFECCIÓN:
   - Para pantalones — describí en este orden:
     a) PRETINA: ¿elástica, con cordón, con presillas? ¿Ancho? ¿Color igual o distinto al pantalón?
     b) TIRO: bajo, medio o alto
     c) BOLSILLOS: cantidad, tipo y posición exacta (o ausencia total)
     d) BOTA: angosta, recta, acampanada — ancho estimado en el tobillo
     e) TERMINACIÓN DEL RUEDO — CRÍTICO SIEMPRE, sin excepción:
        - ¿Tiene puño/cuff elástico o de punto en el tobillo (tipo jogger)? → SI/NO. Si SÍ: describí el color EXACTO del cuff aunque sea igual al pantalón (ej: "cuff elástico rosa palo, MISMO color que el pantalón, ancho aprox 5 cm"), la textura (¿liso aunque el pantalón tenga estampado?), y si es más oscuro/claro que el resto.
        - ¿O es ruedo simple recto sin ningún cuff? → escribí explícitamente "ruedo simple recto, SIN cuff ni dobladillo elástico"
     f) FIT SOBRE EL CUERPO: cómo cae el pantalón sobre la cadera, muslos y piernas. ¿Holgado en todo? ¿Ajustado en cadera y suelto abajo? ¿Cómo se comporta la tela al caminar? Describí con frase completa.
     g) ESTAMPADO EN PANTALÓN: si tiene print all-over, ¿el cuff/pretina/bolsillos son del mismo estampado o son lisos? Este contraste define la silueta.
   - Para remeras/tops: cuello (redondo, V, polo, etc.), mangas (largo, corte), puños (color y textura aunque sean iguales a la manga), dobladillo. LARGO OBLIGATORIO: "queda X cm arriba/abajo del ombligo" o "cubre la cadera" o "toca el muslo".
   - Para vestidos/faldas — describí en este orden:
     a) LARGO: distancia exacta desde cintura al ruedo — "mini: 15 cm por encima de la rodilla" / "midi: llega a la pantorrilla, 10 cm bajo la rodilla" / "maxi: roza el piso" / indicá cm exactos si podés.
     b) ESCOTE: tipo exacto (redondo, V profundo, cuadrado, asimétrico, off-shoulder, halter) y profundidad estimada en cm desde el hombro.
     c) SILUETA: ajustado al cuerpo (body-con), recto/columna, evasé (se abre en cadera), línea A, fluido con drapeado.
     d) MANGA: sin mangas/sisa, manga corta, manga 3/4, manga larga — largo exacto en cm si es especial.
     e) CINTURA: ¿hay cintura marcada? ¿elástico, cinto, corte en la cintura? ¿La cintura está en la cintura natural, bajo el busto (empire), o en la cadera?
     f) TERMINACIÓN: ¿ruedo recto, asimétrico, con volado, deshilachado, aberturas laterales? Describí cada elemento.
     g) CONSTRUCCIÓN: ¿tiene forro? ¿hay estructura/ballenas? ¿escote con boning o totalmente sin estructura?
   - Para camperas/buzos/abrigos — describí en este orden:
     a) TIPO: campera (corta, llega a cadera), buzo (sin cierre), hoodie (con capucha), abrigo (largo), chaleco, blazer.
     b) LARGO: ¿hasta la cintura, cadera, muslo, rodilla? Indicá en cm si podés.
     c) CIERRE: ¿tiene cierre (zipper)? ¿Completo o hasta la cintura? ¿Color del zipper: igual, contraste? ¿Con o sin botonera superpuesta? ¿Sin cierre (pullover)?
     d) CAPUCHA: ¿tiene capucha? Si sí: ¿con cordón, ajustable, rígida, de punto? ¿Color igual o contraste?
     e) MANGAS: largo exacto, ¿cuff elástico o ribeteado en el puño? Describí textura/color del cuff aunque sea igual a la manga.
     f) BOLSILLOS: ¿canguro frontal único, bolsillos laterales con cierre, bolsillos de parche? Posición, tamaño, color.
     g) ACABADOS: ¿con parche/bordado/estampado en el pecho o espalda? ¿Detalle de cuello (cuello alto, crew, V)?
   - Para conjuntos y pijamas (2+ piezas) — CRÍTICO:
     a) Describí CADA PIEZA por separado con todos los detalles de los apartados anteriores.
     b) COORDINACIÓN DE ESTAMPADO: si ambas piezas tienen estampado all-over, ¿es el MISMO estampado exacto? ¿Misma escala? ¿O la parte de arriba tiene estampado y la de abajo es lisa? ¿Mismos colores?
     c) COORDINACIÓN DE COLOR BASE: aunque el estampado sea igual, ¿el color de fondo es idéntico entre ambas piezas, o hay variación tonal?
     d) CORTE DE CADA PIEZA: describí qué termina donde (ej: "top sin mangas recorte a 5 cm del ombligo + pantalón de tiro medio que tapa la cadera").
   - Para lencería / ropa interior:
     a) TIPO: bombacha (bikini, colaless, culotte, hilo dental, hipster), corpiño/corset (triángulo, push-up, bralette, bustier), body.
     b) COBERTURA: qué partes cubre y qué deja al descubierto — describí exactamente.
     c) MATERIALES: encaje (y patrón del encaje si es distintivo), microfibra (liso, satinado), algodón, punto.
     d) TIRAS Y BRETELES: ancho en mm, ¿regulables? ¿de qué material? ¿Color igual o contraste al cuerpo principal?
     e) DETALLES: aritos, lazos, bordados, entredós, elástico decorativo — posición exacta y color.
   - Para ropa deportiva (calzas, tops deportivos, hoodies deportivos):
     a) COMPRESIÓN: ¿segunda piel sin holgura (compresión alta)? ¿Ajustada con algo de elasticidad (media compresión)? ¿Solo ajustada sin compresión real?
     b) WAISTBAND/PRETINA DEPORTIVA: ancho en cm, ¿liso o con folded-over design (tira plegada)? ¿Con logotipo de marca o sin texto?
     c) PANELES DE CONTRASTE: si hay insertos de malla o tela distinta, describí: posición exacta (costado, espalda completa, axila, rodilla), color exacto del panel, y cómo se diferencia en textura o brillo de la tela principal.
     d) LARGO EXACTO: para calza: "tobillos", "3/4 pantorrilla", "rodilla", "muslo alto (short)". Para top: "cubre busto completo" / "cropped 5 cm sobre cintura".
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
    max_tokens: 1200,
  });
  return response.choices[0].message.content || '';
}

async function editProductForConcept(
  openai: OpenAI,
  productDataUrl: string,
  editPrompt: string,
): Promise<string> {
  try {
    // productDataUrl may arrive as a full data URL ("data:image/...;base64,...") or as
    // raw base64 (compressBase64ForStorage strips the prefix). Handle both.
    const isDataUrl = productDataUrl.startsWith('data:');
    const base64Data = isDataUrl ? productDataUrl.split(',')[1] : productDataUrl;
    const mimeType = isDataUrl ? (productDataUrl.split(';')[0].split(':')[1] || 'image/jpeg') : 'image/jpeg';
    const buffer = Buffer.from(base64Data, 'base64');
    const imageFile = await toFile(buffer, 'product.jpg', { type: mimeType });
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
  inputImages: string[] = [],
  orchestratorInstruction?: string,
): Promise<string> {
  // detail:'high' is valid in Responses API ResponseInputImageContent (defined in SDK types)
  const content = [
    ...inputImages.map(img => ({ type: 'input_image', image_url: img, detail: 'high' })),
    { type: 'input_text', text: prompt },
  ];

  // gpt-4o as orchestrator: analyzes reference images and text, then calls
  // gpt-image-2 tool. Using gpt-image-2 directly as orchestrator ignores
  // reference images and hallucinates products from text associations.
  // Responses API: system-level instruction goes in top-level `instructions` param.
  // Only user/assistant roles are valid in the input array.
  const input = [{ role: 'user', content }];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (openai.responses.create as any)({
        model: 'gpt-4o',
        ...(orchestratorInstruction ? { instructions: orchestratorInstruction } : {}),
        input,
        tools: [{
          type: 'image_generation',
          model: 'gpt-image-2',
          quality: 'medium',
          size: '1024x1536',
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const block of (response.output || [])) {
        if (block.type === 'image_generation_call') {
          if (block.result) return block.result;
          console.error('image_generation_call returned null result — status:', block.status, 'error:', block.error);
        }
      }
      console.error('Responses API output blocks:', JSON.stringify((response.output || []).map((b: { type: string }) => b.type)));
      return '';
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt === 0) {
        console.warn('generateWithGptImage2: rate limited, waiting 12s before retry');
        await new Promise(r => setTimeout(r, 12000));
        continue;
      }
      console.error('Responses API failed:', err);
      break;
    }
  }

  // Fallback: for e-commerce the visual reference matters — skip text-only fallback
  // to avoid generating brand-hallucinated images from training data.
  if (inputImages.length > 0) return '';

  const fallback = await openai.images.generate({
    model: 'gpt-image-2',
    prompt,
    size: '1024x1536',
    quality: 'low',
    n: 1,
  });
  return fallback.data?.[0]?.b64_json || '';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`concept timeout after ${ms}ms: ${label}`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
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
  const targetCount = Math.max(1, Math.min(count, 6));
  // Raw base64 → data URLs for Responses API / vision
  const styleReferenceDataUrls = styleReferenceImages.map(
    (b64: string) => b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`
  );

  // Visual refs from brand kit (style guide for generation)
  const visualRefs: string[] = (brandKit.referencePiecesThumbnails || []).slice(0, 2);
  const logos = extractLogoImages(brandKit);

  // Generate product + person descriptions — returned to frontend for the apply-product step
  let productDescription = '';
  let personDescription = '';

  if (productDetailImages.length > 0) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let desc: string;
        if (productDetailImages.length === 1) {
          desc = await describeProductWithVision(openai, productDetailImages[0]);
        } else {
          // Multiple products: describe each one with the appropriate framework (fashion vs packaging)
          const multiPrompt = `Hay ${productDetailImages.length} productos distintos en las imágenes (una imagen por producto). Describí CADA UNO por separado, numerándolos (PRODUCTO 1:, PRODUCTO 2:, etc.). Para cada uno, determiná primero si es prenda de vestir o producto no-fashion y aplicá el framework correspondiente.\n\n${PRODUCT_DESCRIPTION_PROMPT}`;
          const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: multiPrompt },
                ...productDetailImages.map(img => ({ type: 'image_url' as const, image_url: { url: img, detail: 'high' as const } })),
              ],
            }],
            max_tokens: 1200 * productDetailImages.length,
          });
          desc = response.choices[0].message.content || '';
        }
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
    : `6. ${isProductEcommerce ? 'Lifestyle del segmento — ambiente y elementos visuales que representan el segmento objetivo con el producto prominente' : isCorporate ? 'Fotografía corporativa aspiracional — espacio de trabajo premium, ciudad o arquitectura moderna como fondo, tipografía institucional' : isEvents ? 'Impacto y presencia digital — composición tipográfica bold, elementos gráficos de transmisión en vivo, paleta del brand kit con máximo contraste' : 'Superposición gráfica — MITAD fotografía MITAD diseño gráfico. La persona está físicamente integrada dentro de los elementos gráficos: franjas de color sólido que atraviesan el frame y cruzan el cuerpo, formas geométricas que envuelven o encuadran la figura, overlays de color semitransparente sobre partes del cuerpo. POSE OBLIGATORIA: cuerpo en diagonal pronunciada, en movimiento o girado — PROHIBIDO pose estática parada de frente. El nombre de campaña y descuento son parte de la arquitectura gráfica (no flotando encima), integrados en las franjas o bloques de color.'}`;

  const conceptDirections = isProductEcommerce
    ? `Direcciones (e-commerce de producto) — FOCO PROMOCIONAL. CADA UNA visualmente DISTINTA.
REGLAS OBLIGATORIAS PARA TODAS LAS DIRECCIONES:
- TODO el copy DEBE venir EXCLUSIVAMENTE del brief: nombre de campaña, descuento, mecánicas, claim. PROHIBIDO inventar taglines, slogans o copy que no esté en el brief.
- Si el brief NO tiene campaña → no hay headline inventado, solo nombre de la marca como texto mínimo.
- Si el brief TIENE nombre de campaña → ese nombre aparece en TODAS las piezas como headline principal.
- Si el brief TIENE descuento (ej: "20% off") → el número aparece en AL MENOS 4 de los 6 conceptos como elemento tipográfico dominante.
- Copy 100% en ESPAÑOL. CERO inglés en la composición.
- Cada pieza DEBE tener mínimo: headline del brief (o nombre de marca si no hay campaña) + logo de marca.
${productDetailImages.length > 1 ? `- AMBOS PRODUCTOS SIEMPRE VISIBLES: los ${productDetailImages.length} productos de las fotos deben aparecer en cada pieza, claramente reconocibles, sin recortar ni ocultar ninguno.` : ''}

1. HERO PROMOCIONAL — el/los producto(s) ocupa(n) 65-70% del frame, posicionado(s) en tercio inferior-central, iluminación de estudio sobre fondo sólido del color primario del brand kit. ZONA SUPERIOR (35%): nombre de campaña del brief en tipografía bold extralarge como bloque de texto dominante. Si hay descuento: incluirlo en tipografía heavy en contraste. Logo esquina inferior. Copy del brief, en español.
2. OFERTA CON NÚMERO GRANDE — layout de 3 franjas horizontales: (A) FRANJA SUPERIOR (20%): nombre de campaña del brief en tipografía medium sobre fondo del brand kit; (B) FRANJA CENTRAL (50%): si hay descuento → el porcentaje en tipografía heavy BLACK ultragrande (ocupa toda la franja) con el/los producto(s) integrado(s) al costado o detrás; si NO hay descuento → nombre de campaña en extralarge + producto(s) al lado; (C) FRANJA INFERIOR (30%): mecánicas del brief en tipografía sans-serif, separadas por "·", más logo. TODO en español.
3. SHOWCASE TÉCNICO — producto(s) con iluminación dramática lateral, fondo oscuro con gradiente sutil. ZONA SUPERIOR: nombre de campaña del brief en tipografía serif o display elegante. ZONA INFERIOR: 2-3 atributos técnicos o beneficios del brief en tipografía sans-serif pequeña + logo. Si hay descuento: badge pequeño en corner superior derecho. Estética premium, oscura, técnica.
4. LIFESTYLE DEL SEGMENTO — producto(s) integrado(s) en el ambiente especificado en el brief (taller, ruta, garage, motor). Overlay semitransparente oscuro en zona superior o inferior. Sobre el overlay: nombre de campaña del brief en tipografía bold + descuento si existe. El ambiente ambienta pero el copy y producto son protagonistas. Logo en corner.
5. TIPOGRÁFICO PROMOCIONAL — bloques de color contrastantes del brand kit (mitad izquierda / mitad derecha, o diagonal). El nombre de campaña del brief en tipografía heavy XL ocupa 50-60% del frame como elemento gráfico estructural. Producto(s) flotando en la mitad contraria, tamaño prominente (mínimo 40% de la mitad del frame). Si hay descuento: aparece en el bloque de color opuesto al headline, en tipografía bold. Copy del brief.
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
      : `Direcciones (fashion/editorial) — 6 conceptos de layout, cada uno con mood, composición y pose RADICALMENTE distintos entre sí. La prenda es la misma en todos; la diferencia es el universo creativo.

DIVERSIDAD OBLIGATORIA: si dos conceptos se parecen en pose, composición o mood, están mal. La pose no es un requisito a cumplir — emerge naturalmente del espíritu de cada concepto. El modelo elige la pose que mejor exprese ese espíritu; no hay una pose "correcta" o "incorrecta" por dirección.

1. Minimalista editorial — espíritu: quietud de lujo, elegancia contenida. OBLIGATORIO: nombre de campaña como tipografía fina y espaciada, pequeña pero presente. Espacio negativo trabajado. No es una foto de catálogo — es composición intencional.
2. Tipográfico editorial — espíritu: la tipografía ES la imagen. Texto dominante 50-60% del frame. Figura humana secundaria o fragmentada dentro del texto. CRÍTICO: el texto grande es ÚNICAMENTE el nombre de campaña del brief (ej: "PIJAMANIA") y/o el descuento — PROHIBIDO usar nombres de tipografías (Peridot, Helvetica, Gotham, etc.), palabras en inglés inventadas, o cualquier texto que no venga del brief.
3. Lifestyle aspiracional — espíritu: calidez doméstica, momento privado en entorno hogareño (sillón, sofá, cama, alfombra). Tercio superior: nombre de campaña + descuento SI LO HAY en el brief; si no hay descuento, solo el nombre de campaña o el nombre de la marca en tipografía limpia. Modelo centro-derecha; espacio inferior para copy de apoyo del brief o vacío.
4. KV retail full promocional — estructura de 3 zonas fijas: ZONA SUPERIOR (≈25%): fondo blanco o color muy claro, nombre de campaña en tipografía fina arriba + nombre de la oferta/mecánica en tipografía bold XL. ZONA CENTRAL (≈45%): foto de modelo o grupo familiar en contexto doméstico real. ZONA INFERIOR (≈30%): SI hay descuento en el brief → el porcentaje en tipografía heavy extrabold ultra-grande es el protagonista, debajo condición, fecha de vigencia, URL. SI NO hay descuento → el nombre de campaña o nombre de la marca en tipografía heavy bold XL ocupa esta zona, con URL o fecha del brief si existen. NUNCA inventar porcentajes ni mecánicas. Paleta del brand kit.
5. Full promocional — espíritu: jerarquía visual clara, actitud activa. Si hay descuento en el brief → energía de oferta, el número domina. Si no hay descuento → energía editorial, el nombre de campaña y la prenda dominan. Nunca inventar descuento.
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
⚠ MODO E-COMMERCE — EL PRODUCTO ES EL PUNTO DE PARTIDA: el generador recibirá SOLO las fotos del producto. La composición se construye desde el producto hacia afuera.
Ignorá nombres de marcas/tipos de producto del brief para decidir qué objetos físicos aparecen — solo los ${productDetailImages.length} producto(s) de las fotos.
${productDetailImages.length === 1
  ? `Empezá el image_prompt con "transform this product photo into...". Describí qué agregar alrededor. El producto no cambia.`
  : `Empezá con "Starting from the ${productDetailImages.length} product photos as anchors, build a composition where...". Describí posición y lo que rodea cada producto.`
}
PROHIBICIÓN ABSOLUTA en los image_prompts:
- NO nombrar el producto con nombres de marca, modelo o referencia comercial (NO "filtro Cummins LF16015", NO "aceite Valvoline", NO "CC2600 WF", NO ningún nombre de producto). Referite al producto SOLO como "the product from the reference photo" o "product 1 / product 2 from the reference photos".
- NO escribir instrucciones que modifiquen el producto: NO cambiar su color, NO aplicar logos sobre él, NO recolorear etiqueta, NO agregar texto en packaging.
Los image_prompts SOLO describen: posición del producto en el frame, fondo/ambiente ALREDEDOR, iluminación, y elementos tipográficos de campaña SEPARADOS del producto.` : ''}

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo y elementos concretos.`
    : `Sos un director creativo senior de retail y publicidad digital.
Dado un brief, brand kit y referencias visuales, generá exactamente ${targetCount} conceptos distintos para una pieza portrait 1024x1536.

REGLAS:
- Usá los hex exactos del brand kit como colores dominantes
- Estilo PREMIUM, nunca genérico ni clipart
- TODO el copy, titulares y texto visible en las imágenes DEBE estar en ESPAÑOL. Nunca inglés, nunca "Indulge in Luxury", nunca "Summer Dreams" ni frases genéricas anglosajones.
- NOMBRE DE CAMPAÑA/EVENTO: si el brief menciona un nombre (ej: "Pijamania", "Black Friday", "Cyber Monday"), usalo EXACTAMENTE como está escrito — sin traducirlo, modificarlo, reemplazarlo ni inventar uno alternativo. Ese nombre es el headline principal.
- REGLA CRÍTICA DE CONTENIDO: el nombre de campaña del brief DEBE aparecer en el image_prompt de AL MENOS 4 de los 6 conceptos como texto visible en la imagen. Si hay descuento (ej: "30% off"), debe aparecer en AL MENOS 3 conceptos. No inventar taglines alternativos — usar el contenido del brief.
- PROHIBICIÓN ABSOLUTA de inventar nombres de campaña, taglines genéricos, nombres de colecciones o cualquier copy que no esté textualmente en el brief. "Suavidad que acompaña tus momentos" es inventado y está PROHIBIDO si no está en el brief.
- Si el brief tiene un porcentaje de descuento, ese número debe dominar visualmente en las piezas promocionales.
- PRENDA: si el brief es sobre un tipo de prenda específico (pijamas, remeras, pantalones, etc.), la persona SIEMPRE viste ESA prenda. NUNCA un blazer, traje, vestido de oficina u otra prenda distinta. Si el brief dice pijamas → todos los conceptos muestran pijamas.
- AMBIENTE COHERENTE CON EL PRODUCTO: inferí el tipo de producto del brief y de la descripción del producto, y especificá explícitamente en cada image_prompt el ambiente coherente con ese tipo. Pijamas/ropa de descanso → dormitorio, cama, sofá, sala cálida, entorno de hogar. Ropa deportiva → gimnasio, parque, exterior activo. Ropa formal → ciudad, oficina, arquitectura urbana. NUNCA pongas una persona con pijamas en cocina de lujo, restaurante, exterior urbano ni oficina. EXCEPCIÓN: conceptos editoriales, tipográficos o de composición gráfica abstracta (estudio, fondo geométrico, overlay de color) no requieren ambiente literal — el fondo es diseño, no locación. Para cada image_prompt que use un ambiente real, escribí explícitamente el tipo de setting coherente con el producto.
${conceptDirections}
- Fondos en colores del brand kit, tipografía precisa, máx 2-3 elementos por pieza
- Si hay descripción de producto, TODOS los conceptos muestran ESA MISMA prenda reproducida con fidelidad. La variedad viene exclusivamente de la COMPOSICIÓN, layout, jerarquía tipográfica y mood — no del producto.
- Si hay referencias visuales de marca, los image_prompts deben seguir ese estilo visual
- PROHIBIDO inventar: precios, descuentos, porcentajes, cupones, promos, mecánicas. Solo lo que esté EXPLÍCITAMENTE en el brief.
- PROHIBIDO usar nombres de tipografías como texto visible en la composición (Peridot, Helvetica, Gotham, Arial, Extended, Condensed, etc.). Todo texto en la imagen debe ser copy real del brief o nombre de marca.
- REGLA CRÍTICA — CAMPOS VACÍOS: si el brief indica "No Aplicable", "N/A" o no especifica un valor para campaña, descuento, producto o mecánica, ese campo está VACÍO. CERO copy inventado para campos vacíos. Si no hay campaña → cero headline inventado. Si no hay descuento → cero porcentaje inventado. Si no hay producto → cero nombre de producto inventado. En ese caso el concepto es de IDENTIDAD DE MARCA PURA: composición fotográfica, paleta del brand kit, nombre de la marca como único texto opcional. Prohibido inventar "NUEVA COLECCIÓN", "BIENESTAR QUE SE SIENTE", "DUERME MEJOR" ni ningún tagline aspiracional si no está en el brief.
- TODA pieza de e-commerce DEBE tener como mínimo: headline o nombre del producto visible + logo. Una imagen sin copy no es un anuncio.
- NUNCA inventar logos gráficos — si no hay imagen de logo de referencia, solo colocar el nombre de la marca en texto tipográfico.
${isEvents ? `MODO EVENTOS — PROHIBICIONES ABSOLUTAS EN CADA image_prompt:
- CERO personas, siluetas de personas, audiencias, figuras humanas o sombras de personas — si el prompt incluye personas, es incorrecto.
- CERO contenido inventado: no inventar nombres de sesiones, ponentes, horarios ni agenda no presente en el brief.
- USAR EXCLUSIVAMENTE los hex del brand kit. Ningún color exterior a la paleta del brand kit.` : ''}
${isProductEcommerce ? `
⚠ MODO E-COMMERCE — EL PRODUCTO ES EL PUNTO DE PARTIDA: el generador de imagen recibirá ÚNICAMENTE las fotos del producto como input visual. La composición se construye desde el producto hacia afuera — el producto es el protagonista absoluto y la composición lo rodea.
ESTRUCTURA OBLIGATORIA de cada image_prompt:
1. PRIMERO describí cómo aparece el producto: posición en el frame (centro, tercio izquierdo, etc.), tamaño relativo (ocupa X% del frame), ángulo (frontal, 3/4, etc.), iluminación sobre el producto. NO describas cómo es el producto — el generador lo ve directamente en la foto.
2. SEGUNDO describí el fondo/ambiente que se construye ALREDEDOR del producto: color sólido del brand kit, gradiente, ambiente (taller, ruta, fondo neutro), iluminación ambiental.
3. TERCERO describí los elementos tipográficos que se agregan: posición del headline, copy de campaña (nombre + descuento del brief), tamaño y estilo tipográfico.
El brief puede mencionar nombres de marcas o tipos de productos como "Filtros Fleetguard" — IGNORAR para decidir qué objetos físicos aparecen. Los ÚNICOS objetos físicos son los de las fotos subidas (${productDetailImages.length} producto(s)).
${productDetailImages.length === 1
  ? `SINTAXIS (images.edit — 1 producto): empezá el image_prompt con "transform this product photo into a [tipo de composición]...". Describí qué agregar alrededor del producto. El producto NO cambia.`
  : `SINTAXIS (multi-producto): empezá con "Starting from the ${productDetailImages.length} product photos as anchors, build a composition where...". Describí cómo se posicionan y qué los rodea. Referite a cada producto como "product ${productDetailImages.map((_, i) => i + 1).join(' / product ')} from the reference photos".`
}
PROHIBICIÓN ABSOLUTA en los image_prompts:
- NO nombrar el producto con nombres de marca, modelo o referencia comercial (NO "filtro Cummins", NO "aceite Valvoline", NO "CC2600 WF", etc.). Referite al producto SOLO como "the product from the reference photo" o "product 1 / product 2 from the reference photos".
- NO modificar el producto: NO cambiar colores del envase/etiqueta, NO aplicar logos sobre él, NO recolorear, NO agregar texto en packaging. El producto es INMUTABLE. Los image_prompts SOLO describen qué poner ALREDEDOR.` : ''}

Respondé SOLO con JSON: { "concepts": [ { "concept_name": "...", "image_prompt": "..." }, ... ] }
El image_prompt debe mencionar colores hex exactos, disposición, estilo y elementos concretos.
OBLIGATORIO — MARCA EN CADA image_prompt: cada image_prompt DEBE terminar con esta frase exacta (reemplazando [NOMBRE] con el nombre real de la marca): "Bottom-right corner: the text [NOMBRE] rendered as clean typographic text only — absolutely no invented logo icons, marks, symbols, monograms, hearts, or graphic elements of any kind. Text only."`;


  const userTextContent = [
    `BRAND KIT:\n${brandKitContext}`,
    `BRIEF:\n${brief}`,
    `PERSONAS:\n${peopleInstruction}`,
    // E-commerce: products arrive as photos below — naming them textually causes Stage 1 to
    // hallucinate brand products from training data instead of referencing the uploaded photos.
    isProductEcommerce && productDetailImages.length > 0
      ? `PRODUCTOS: ${productDetailImages.length} producto(s) adjuntos como imágenes de referencia. Podés ver los productos directamente en las fotos. NO los nombres ni los describas en los image_prompts — referite a ellos ÚNICAMENTE como "the product from the reference photo" o "product 1 / product 2 from the reference photos".`
      : productDescription
        ? `PRODUCTOS (describí exactamente estos en los conceptos que los incluyan):\n${productDescription}`
        : '',
    isSimilarMode ? `CONCEPTOS DE REFERENCIA (generá variaciones de esta línea visual):` : '',
  ].filter(Boolean).join('\n\n');

  // For e-commerce mode, send product photos to Stage 1 so GPT-4o writes image_prompts
  // based on what it actually sees — not from training-data brand associations.
  const productDataUrlsForStage1 = isProductEcommerce
    ? productDetailImages.map(img => img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`)
    : [];

  const userMessageContent: ChatCompletionContentPart[] = [
    { type: 'text', text: userTextContent },
    ...(isSimilarMode
      ? styleReferenceDataUrls.map(url => ({
          type: 'image_url' as const,
          image_url: { url, detail: 'high' as const },
        }))
      : []),
    ...productDataUrlsForStage1.map(url => ({
      type: 'image_url' as const,
      image_url: { url, detail: 'high' as const },
    })),
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
  const enc = new TextEncoder();
  const doneStream = (extra?: object) => new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, productDescription, personDescription, ...extra })}\n\n`));
      c.close();
    }
  });
  if (!rawContent) {
    console.error('generate-concepts: GPT returned null content (possible content filter)');
    return new Response(doneStream(), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  let parsed: { concepts?: ConceptItem[] };
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error('generate-concepts: failed to parse GPT response:', err, rawContent?.slice(0, 200));
    return new Response(doneStream(), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const concepts: ConceptItem[] = parsed.concepts || [];
  if (concepts.length === 0) {
    console.error('generate-concepts: Stage 1 returned empty concepts array. Raw:', rawContent?.slice(0, 300));
    return new Response(doneStream(), { headers: { 'Content-Type': 'text/event-stream' } });
  }

  // Logo is composited client-side after generation — do NOT pass logo images to
  // gpt-image-2 or it will attempt to replicate them despite prompt instructions.
  const inputImages = [
    ...(isSimilarMode ? styleReferenceDataUrls : visualRefs),
    ...productDetailImages,
    ...(peopleMode === 'real' ? referenceImages.slice(0, 1) : []),
  ];

  const hasPeople = peopleMode !== 'none';
  const styleSuffix = isCorporate
    ? 'Premium institutional design, B2B advertising quality, clean and trustworthy. NOT generic stock photo aesthetic. If people appear: professional business context, diverse team, confident expression. Portrait 4:5.'
    : isEvents
    ? 'Event marketing design, bold typography, high-contrast layout, digital-first aesthetic. CTA-driven composition. Portrait 4:5.'
    : hasPeople
      ? 'Fotografía editorial de moda, tonos de piel naturales, calidad de campaña premium, fotorrealista. MOSTRAR LA PRENDA COMPLETA — todo el conjunto (top + pantalón completo, pies incluidos) debe verse. La pose, expresión y actitud emergen del espíritu del concepto. Elementos de texto integrados naturalmente en la composición. Cada concepto debe tener un layout, mood y tratamiento de fondo visualmente distinto. PROHIBIDO CLONES: si hay más de una persona en la imagen, DEBEN ser visualmente distintas entre sí — diferente tono de piel, altura, tipo de cabello o rasgos faciales. NUNCA duplicar la misma figura humana. PROHIBIDO formato webinar/evento/corporativo: CERO badges "WEBINAR", CERO ícono de calendario/reloj/agenda, CERO bullet points con íconos de registro, CERO CTAs "Inscríbete/Registrate". Esto es campaña de moda — la tipografía es decorativa y editorial, no funcional de evento.'
      : isProductEcommerce
        ? 'Professional product photography or high-end retail graphic design, agency quality, photorealistic. If a person is shown: full body fully visible from head to toe, no leg or foot cropping.'
        : 'Premium graphic design, agency quality, NOT generic AI art, portrait 4:5.';
  const productHint = isProductEcommerce && productDetailImages.length > 0
    ? productDetailImages.length > 1
      ? `⚠ PRODUCTO FÍSICO — INMUTABLE Y EXACTO (${productDetailImages.length} productos): Los productos de las fotos de referencia son los ÚNICOS objetos físicos. PROHIBIDO ABSOLUTO: NO generar productos desde datos de entrenamiento, NO sustituir, NO alucinar. PROHIBIDO MODIFICAR el producto: NO cambiar colores del envase/etiqueta, NO alterar ni reimaginar el texto impreso en el packaging, NO deformar la forma ni proporciones, NO aplicar logos adicionales SOBRE el producto. Los productos se reproducen EXACTAMENTE como están en las fotos. TODOS deben aparecer visiblemente.`
      : `⚠ PRODUCTO FÍSICO — INMUTABLE: El producto de la foto de referencia es FIJO. PROHIBIDO ABSOLUTO: NO generar un producto nuevo desde datos de entrenamiento, NO sustituir. PROHIBIDO MODIFICAR el producto: NO cambiar sus colores, NO alterar el texto o logos en el envase/etiqueta, NO aplicar marcas adicionales SOBRE el producto, NO deformar su forma ni proporciones. El producto permanece exactamente como está en la foto. SOLO cambia el fondo, la iluminación y los elementos tipográficos de campaña a su alrededor.`
    : '';

  const productImmutabilityHint = isProductEcommerce
    ? productDetailImages.length === 1
      ? 'PRODUCT FROZEN — DO NOT TOUCH: The product is the input image itself — its appearance is locked. NEVER alter: product colors, label text, packaging text, product shape, product proportions. NEVER apply brand logos or extra marks ON the product surface. ONLY permitted additions: background/environment around the product, lighting effects around it, typographic campaign elements (headlines, copy) placed OUTSIDE the product area.'
      : `PRODUCTS FROZEN — DO NOT TOUCH any of the ${productDetailImages.length} products: NEVER alter colors, label text, packaging text, product shape, proportions. NEVER apply logos or extra marks ON any product surface. Reproduce each product pixel-perfect from its reference photo.`
    : '';

  // Product description injected into every concept so gpt-image-2 replicates the exact
  // garment consistently. Person cloning prevented via prompt, not by removing the image.
  const productDescHint = hasPeople && !isEvents && !isCorporate && productDescription
    ? `Garment to feature (reproduce EXACTLY — same print, color, silhouette): ${productDescription}`
    : '';
  const styleHint = isSimilarMode
    ? 'IMPORTANT: The provided reference image is the approved Key Visual — maintain its exact graphic style, color palette, typography treatment, layout approach, and mood. Create a variation, not a copy: same DNA, different composition.'
    : visualRefs.length > 0
    ? 'Match the visual style, typography treatment and composition quality of the provided brand reference pieces.'
    : '';

  const hasLogos = !!(logos.dark || logos.light || brandKit.logoBase64);

  // The actual logo is composited onto the image client-side after generation,
  // which is the only reliable way to guarantee logo fidelity.
  // Always write the brand name as plain typography — no invented graphic marks anywhere.
  const logoHint = `BRAND MARK — CRÍTICO: en el corner inferior derecho renderizá ÚNICAMENTE las letras "${brandKit.name}" como texto tipográfico limpio. PROHIBICIÓN ABSOLUTA en TODA la imagen: NO renderizar ningún ícono, símbolo gráfico, monograma, escudo, corazón, marca gráfica, lettermark, ni ningún elemento que no sea texto puro. El único elemento de identidad de marca permitido es la palabra "${brandKit.name}" escrita en tipografía sans-serif limpia. Cualquier gráfico inventado en el corner es incorrecto.`;

  // Build image map hint so gpt-image-2 knows which input images are style refs vs product refs
  const imageMapHint = isProductEcommerce && productDetailImages.length > 1
    ? `IMAGE MAP — input images in order: [${[
        ...(isSimilarMode ? styleReferenceDataUrls : visualRefs).map((_, i) => `image ${i + 1}: brand style reference`),
        ...productDetailImages.map((_, i) => `image ${(isSimilarMode ? styleReferenceDataUrls : visualRefs).length + i + 1}: REAL PRODUCT ${i + 1} of ${productDetailImages.length} — reproduce exactly`),
      ].join('; ')}]. ALL products must appear in the composition.`
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
          concepts.map((concept: ConceptItem, conceptIdx: number) =>
          withTimeout((async () => {
            const fashionModelHint = hasPeople && !isCorporate && !isEvents
              ? FASHION_MODEL_POOL[conceptIdx % FASHION_MODEL_POOL.length]
              : '';
            // E-commerce: do NOT inject product description into Stage 2 fullPrompt.
            // Text with brand names / model numbers anchors gpt-image-2 to training-data products
            // instead of the visual input photos. The photos ARE the reference — no text needed.
            const productTypeContext = productDescription && !isEvents && !isProductEcommerce
              ? hasPeople && !isCorporate
                ? `PRODUCT TYPE: ${productDescription.split('\n').filter(Boolean)[0]?.slice(0, 180) || productDescription.slice(0, 180)}`
                : ''
              : '';

            const fullPrompt = [
              imageMapHint,
              productHint,
              productImmutabilityHint,
              productTypeContext,
              concept.image_prompt,
              `Brand colors: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}.`,
              `Typography: ${brandKit.typography || 'bold sans-serif'}.`,
              styleSuffix,
              productDescHint,
              fashionModelHint,
              hasPeople && !isCorporate && !isEvents
                ? 'Create a completely ORIGINAL AI-generated model — do NOT replicate the appearance or face of any person from uploaded reference images.'
                : '',
              styleHint,
              logoHint,
              isEvents ? 'ABSOLUTELY NO HUMANS, NO PEOPLE, NO SILHOUETTES, NO AUDIENCE, NO SPEAKER FIGURES. Pure typographic and geometric graphic design only.' : '',
              isEvents ? `USE ONLY THESE EXACT HEX COLORS: ${brandKit.primary1}, ${brandKit.primary2}, ${brandKit.primary3}. Do NOT add purple, violet, neon, or any color not in this brand kit.` : '',
              'LEGIBILIDAD — CRÍTICO: todo texto visible debe tener alto contraste con el fondo inmediato. Si el fondo es claro (beige, crema, blanco, gris claro) → texto oscuro (negro, gris oscuro, marino). Si el fondo es oscuro → texto blanco o muy claro. NUNCA texto claro sobre fondo claro ni texto oscuro sobre fondo oscuro. El número del descuento especialmente debe ser legible de un vistazo. Si hay riesgo de baja legibilidad, agregar un bloque de color sólido, sombra o área de contraste detrás del texto.',
              'ALL COMPOSITION TEXT MUST BE IN SPANISH: headlines, labels, CTAs, body copy — zero English in the composition. EXCEPTION: text printed ON the garment (estampados/prints) must be reproduced EXACTLY as it appears in the reference photo — do NOT translate garment print text.',
              'Use the EXACT campaign or event name from the brief verbatim as the headline — do NOT invent, translate, or replace it with a different name.',
              // In e-commerce mode skip the raw brief snippet — it contaminates gpt-image-2 with brand names
              // that cause it to hallucinate products from training data instead of copying the reference photos.
              isProductEcommerce ? 'VISUAL INPUT IS THE ONLY PRODUCT REFERENCE: Generate the product(s) exclusively from the input photo(s). IGNORE any product names, brand names, or model numbers that appear anywhere in this prompt — treat them as non-existent for the purpose of what the product looks like. The photo overrides all text.' : `FOR CONTEXT ONLY — do NOT copy or render this text verbatim in the image. Use only the campaign name and discount number as text elements: ${brief.slice(0, 300)}`,
              'CAMPOS VACÍOS — CRÍTICO: si el brief dice "No Aplicable" o no tiene campaña/descuento/producto, esos campos están VACÍOS. CERO texto inventado: cero taglines aspiracionales, cero porcentajes de descuento, cero nombres de colección, cero mecánicas. En ese caso: solo nombre de la marca como texto opcional y composición visual pura.',
              'do NOT include any invented text, prices, discounts, coupons, promo codes, or promotional copy that is not explicitly in the brief.',
              brandKit.typography ? `Use ${brandKit.typography} typeface for all text elements — no generic system fonts, no random serif italics.` : '',
              'PROHIBIDO: botones CTA tipo pill/badge ("Comprar ahora", "Ver más", "Shop Now") como elementos visuales gráficos. El copy va integrado tipográficamente en la composición, no como botón redondeado de e-commerce.',
              'ANTI-ALUCINACIÓN: no inventar detalles de prenda, colores, prints, bordados ni adornos que no estén en la foto de referencia o descripción. No agregar botones, logos, ni texto que no aparezca en el brief.',
              'CRITERIOS DE CALIDAD VISUAL — no son reglas de layout, son principios de intención: (1) Jerarquía de peso: no todo puede competir al mismo nivel visual — hay un elemento dominante, uno secundario, y el resto es apoyo. (2) Tensión y dinamismo: las diagonales, el contraste de tamaños y el peso visual crean movimiento — evitar composiciones donde todo tiene el mismo tamaño y reposo. (3) Regla de 3 segundos: el mensaje principal debe leerse en 3 segundos; si hay duda, el diseño falló. (4) Espacio vacío como recurso: el aire intencional señala premium — no llenar por llenar. (5) Emoción antes que información: la pieza debe generar una reacción emocional inmediata antes de que se lea el copy.',
            ].filter(Boolean).join(' ');

            // E-COMMERCE: product is the starting point — the composition is built around it.
            // Pass ONLY product photos as input images so gpt-4o anchors on the real products,
            // not on brand visual refs that can trigger training-data hallucination.
            // Single product: images.edit transforms the product photo into a composition (most faithful).
            // Multi-product: Responses API with product-only inputs, composition built outward from products.
            const productDataUrls = productDetailImages.map(img =>
              img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
            );

            // System instruction for the Responses API gpt-4o orchestrator in e-commerce mode.
            // This controls what gpt-4o writes in its internal image_generation tool call —
            // the most direct lever to prevent brand-name hallucination.
            const ecommerceOrchestatorInstruction = isProductEcommerce
              ? `You are an image composition orchestrator. Your sole job: translate the composition description into an image_generation prompt.

CRITICAL DISTINCTION:
- PRODUCT NAMES as physical objects to generate → FORBIDDEN. Never write "Cummins filter", "Valvoline bottle", "Fleetguard FS1000", or any brand+product combination when describing what object to visually render. Use "the product from reference image 1", "the dark bucket shown in the input photo", etc.
- CAMPAIGN COPY as text elements in the composition → REQUIRED. The headline text, campaign name, discount percentage, and other copy from the brief MUST appear as typographic elements. Example: a headline saying "CUMMINS SALE" is correct — it's text on the image, not a product to generate.

RULES for the image_generation prompt:
1. Products (physical objects): describe ONLY by visual appearance from the input reference photos. Never name the brand or model of the product you're rendering.
2. Typography/copy: use the exact campaign name, discount, and claims from the composition description — these are TEXT elements, not products.
3. Describe: product positioning, background/environment, lighting, and typographic elements.
4. If you see a product brand name used as a PHYSICAL OBJECT description, replace it with "the product from reference photo N".`
              : undefined;

            const generate = async (prompt: string): Promise<string> =>
              isProductEcommerce && productDetailImages.length === 1
                ? await editProductForConcept(openai, productDetailImages[0], prompt)
                : isProductEcommerce
                  ? await generateWithGptImage2(openai, prompt, productDataUrls, ecommerceOrchestatorInstruction)
                  : await generateWithGptImage2(openai, prompt, inputImages);

            try {
              let base64 = await generate(fullPrompt);

              // Retry with a simplified prompt if content filter blocks the full prompt
              if (!base64) {
                console.warn(`concept "${concept.concept_name}" empty on first attempt — retrying with simplified prompt`);
                const simplifiedPrompt = [
                  concept.image_prompt,
                  `Brand colors: ${brandKit.primary1}, ${brandKit.primary2}.`,
                  styleSuffix,
                  productDescHint,
                  fashionModelHint,
                  'ALL TEXT IN SPANISH.',
                ].filter(Boolean).join(' ');
                base64 = await generate(simplifiedPrompt);
              }

              if (!base64) {
                console.error(`concept "${concept.concept_name}" returned empty base64 after retry`);
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
          })(), 55000, concept.concept_name)
          )
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
