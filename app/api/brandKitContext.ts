import { BrandKit } from '@/app/types';

export function buildBrandKitContext(brandKit: BrandKit): string {
  const referencesSection = brandKit.referencePiecesStyle
    ? `\nESTILO DE PIEZAS ANTERIORES APROBADAS (seguir este estilo):\n${brandKit.referencePiecesStyle}`
    : '';

  const effectiveDarkLogo = brandKit.logoDark || brandKit.logoBase64;
  const logoSection = effectiveDarkLogo || brandKit.logoLight
    ? `\nLOGO DE MARCA:
- Versión oscura (fondos claros/blancos): ${effectiveDarkLogo ? 'disponible como imagen de referencia' : 'no disponible'}
- Versión blanca/clara (fondos oscuros/coloridos): ${brandKit.logoLight ? 'disponible como imagen de referencia' : 'no disponible'}
REGLA DE SELECCIÓN: si el área donde va el logo tiene fondo oscuro o saturado → versión blanca; si el fondo es claro o blanco → versión oscura.
POSICIÓN: esquina inferior derecha (o la que mejor respete la composición), tamaño ≈8% del ancho total. Zona de respeto obligatoria — nunca superponer texto ni otros elementos sobre el logo.
FIDELIDAD: reproducir el logo exactamente — misma forma, proporciones y elementos. Nunca distorsionar, recolorear ni simplificar.`
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
${logoSection}
`.trim();
}

export function extractLogoImages(brandKit: BrandKit): { dark: string | null; light: string | null } {
  return {
    dark: brandKit.logoDark || brandKit.logoBase64 || null,
    light: brandKit.logoLight || null,
  };
}
