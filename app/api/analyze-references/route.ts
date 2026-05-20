import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { images }: { images: string[] } = await req.json();

  if (!images?.length) return NextResponse.json({ error: 'No images provided' }, { status: 400 });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analizá estas piezas gráficas anteriores de la marca y describí en detalle el estilo visual para que un modelo de IA pueda replicarlo. Incluí:
- Composición y layout (cómo se distribuyen los elementos, jerarquía visual)
- Uso real de los colores (fondos, texto, elementos destacados)
- Estilo tipográfico (tamaño relativo, peso, posición del texto)
- Tratamiento de imágenes (si hay fotos: encuadre, iluminación, recorte)
- Elementos gráficos recurrentes (formas, líneas, patrones, espaciado)
- Tono general (minimalista, recargado, elegante, bold, etc.)
- Cualquier característica distintiva del estilo

Sé muy específico y concreto. La descripción será usada como guía para generar nuevas piezas en el mismo estilo.`,
          },
          ...images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: img, detail: 'high' as const },
          })),
        ],
      },
    ],
    max_tokens: 600,
  });

  const styleDescription = response.choices[0].message.content || '';
  return NextResponse.json({ styleDescription });
}
