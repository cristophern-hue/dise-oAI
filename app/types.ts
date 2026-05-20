export interface BrandKit {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
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
