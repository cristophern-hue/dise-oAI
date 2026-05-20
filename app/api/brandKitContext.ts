import { BrandKit } from '@/app/types';

export function buildBrandKitContext(brandKit: BrandKit): string {
  const referencesSection = brandKit.referencePiecesStyle
    ? `\nESTILO DE PIEZAS ANTERIORES APROBADAS (seguir este estilo):\n${brandKit.referencePiecesStyle}`
    : '';

  return `
MARCA: ${brandKit.name}

PALETA PRIMARIA:
- Color 1: ${brandKit.primary1}
- Color 2: ${brandKit.primary2}
- Color 3: ${brandKit.primary3}

PALETA SECUNDARIA:
- Color 4: ${brandKit.secondary1}
- Color 5: ${brandKit.secondary2}
- Color 6: ${brandKit.secondary3}

TIPOGRAFÍA: ${brandKit.typography || 'No especificada'}

ESTILO Y REGLAS DE MARCA:
${brandKit.styleDescription}
${referencesSection}
`.trim();
}
