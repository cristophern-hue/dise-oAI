import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { BrandKit } from '@/app/types';
import { buildBrandKitContext } from '@/app/api/brandKitContext';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { clientRequest, brandKit }: { clientRequest: string; brandKit: BrandKit | null } = await req.json();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const brandContext = brandKit ? `\nBRAND KIT DEL CLIENTE:\n${buildBrandKitContext(brandKit)}` : '';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Sos un director creativo senior especializado en moda y retail. Tu tarea es transformar una solicitud informal de un cliente en un brief creativo estructurado y accionable para un equipo de diseño digital.

ESTRUCTURA el brief en dos bloques:

BLOQUE 1 — DATOS DEL PROYECTO (bullets cortos, solo lo que está en la solicitud):
• Campaña/Evento: nombre si existe
• Período: fechas de vigencia o entrega
• Mecánica: descuento, promoción o mensaje clave a comunicar
• Piezas requeridas: listado de formatos y plataformas (web, email, punto de venta, redes, etc.)
• Referencias: mencioná si el cliente nombra archivos o imágenes de referencia que no podés ver
Omitir bullets que no tengan información en la solicitud.

BLOQUE 2 — DIRECCIÓN CREATIVA (1-2 párrafos):
Redactá la dirección visual con precisión: qué debe mostrar la pieza, el mood y atmósfera, estilo fotográfico o gráfico, paleta emocional, jerarquía tipográfica, elementos visuales clave. Debe ser lo suficientemente específico para guiar la generación de imágenes y el diseño gráfico. No repitas los datos del bloque anterior.

Al final, si falta información importante para ejecutar (público objetivo, tono de marca, canal principal), agregá una línea: "Falta definir: [lista]"

Máximo 220 palabras totales. Escribí en español rioplatense.`,
      },
      {
        role: 'user',
        content: `SOLICITUD DEL CLIENTE:\n${clientRequest}${brandContext}`,
      },
    ],
    max_tokens: 450,
  });

  const brief = response.choices[0].message.content || '';
  return NextResponse.json({ brief });
}
