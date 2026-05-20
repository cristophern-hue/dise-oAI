'use client';

import { GeneratedImage } from '@/app/types';

interface Props {
  image: GeneratedImage;
  selected?: boolean;
  onClick?: () => void;
  showName?: boolean;
}

export default function ImageCard({ image, selected, onClick, showName = true }: Props) {
  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all duration-200 ${
        selected
          ? 'border-indigo-500 shadow-lg shadow-indigo-500/30 scale-[1.02]'
          : 'border-white/10 hover:border-white/30'
      }`}
    >
      <img
        src={`data:image/png;base64,${image.base64}`}
        alt={image.conceptName}
        className="w-full aspect-square object-cover"
      />
      {showName && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <p className="text-white text-sm font-medium truncate">{image.conceptName}</p>
        </div>
      )}
      {selected && (
        <div className="absolute top-2 right-2 bg-indigo-500 rounded-full w-6 h-6 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}
