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
        content: `Sos un director creativo senior especializado en retail, moda e industria. Tu tarea es transformar una solicitud informal de un cliente en un brief creativo estructurado y accionable para un equipo de diseño digital.

ESTRUCTURA el brief en dos bloques:

BLOQUE 1 — DATOS DEL PROYECTO (bullets cortos, solo lo que está en la solicitud):
• Campaña/Evento: nombre. Si hay múltiples eventos, listá cada uno con su nombre y fechas en sub-bullets.
• Piezas requeridas: cantidad, formatos y plataformas (web, email, redes, punto de venta, etc.)
• Mecánicas promocionales: listá TODAS las mecánicas mencionadas (descuentos, cuotas, envío gratis, retiro express, código promo, etc.) — una por línea.
• Segmento / público objetivo: a quién va dirigido (si se menciona).
• Paleta de colores: si el cliente especifica colores, listálos exactamente.
• Legal: si hay textos legales, condiciones o disclaimers con fechas, mencionálos.
• Referencias: archivos o imágenes de referencia que el cliente nombra pero no podés ver.
Omitir bullets que no tengan información en la solicitud.

BLOQUE 2 — DIRECCIÓN CREATIVA (1-2 párrafos):
Redactá la dirección visual: qué debe mostrar la pieza, elementos visuales que representen el segmento, jerarquía tipográfica (qué mensaje lidera, qué va secundario), mood y atmósfera, estilo gráfico. Si la paleta está dictada por el cliente, indicá cómo usarla. Debe ser específico para guiar generación de imágenes. No repitas los datos del bloque anterior.

Al final, si falta info crítica (% de descuento exacto, productos, canal), agregá: "Falta confirmar: [lista]"

Máximo 260 palabras totales. Escribí en español rioplatense.`,
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
