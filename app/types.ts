export interface BrandKit {
  id: string;
  name: string;
  // Primary palette
  primary1: string;
  primary2: string;
  primary3: string;
  // Secondary palette
  secondary1: string;
  secondary2: string;
  secondary3: string;
  // Typography & style
  typography: string;
  styleDescription: string;
  logoBase64?: string;
}

export interface GeneratedImage {
  id: string;
  base64: string;
  prompt: string;
  conceptName: string;
}

export type Step = 'brief' | 'concepts' | 'variations' | 'adjust' | 'done';
