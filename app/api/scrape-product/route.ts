import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { url }: { url: string } = await req.json();

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }

  // Fetch the HTML of the product page
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error('scrape-product fetch failed:', err);
    return NextResponse.json({ error: 'No se pudo acceder a la URL' }, { status: 422 });
  }

  // Strip tags, scripts, styles — keep only visible text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 8000);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `Sos un director creativo de agencia de publicidad digital.
Se te da el texto de una página de producto de e-commerce.
Extraé la información relevante y generá un brief creativo conciso para diseñar una pieza de marketing para ese producto.

El brief debe incluir:
- Nombre del producto y descripción clara
- Propuesta de valor principal (qué lo hace especial)
- Precio, descuentos o promociones si están mencionados
- Público objetivo inferido
- Tono y mood sugerido para la comunicación
- 1-2 puntos de diferenciación clave

Formato: texto corrido, español, máximo 200 palabras. Directo y accionable.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Página del producto:\n${text}` },
      ],
      max_tokens: 400,
    });

    const brief = response.choices[0].message.content || '';
    return NextResponse.json({ brief });
  } catch (err) {
    console.error('scrape-product GPT failed:', err);
    return NextResponse.json({ error: 'Error generando brief desde URL' }, { status: 500 });
  }
}
