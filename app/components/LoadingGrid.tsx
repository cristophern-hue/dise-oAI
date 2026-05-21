'use client';

interface Props {
  count: number;
  label: string;
}

export default function LoadingGrid({ count, label }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-[#FF912D] border-t-transparent rounded-full animate-spin" />
        <p className="text-white/70 text-sm">{label}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-white/5 border border-white/10 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
