'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { BrandKit, GeneratedImage } from '../types';

const FORMAT_LABELS: Record<string, string> = {
  story: 'Story 9:16',
  feed45: 'Feed 4:5',
  square: 'Square 1:1',
  landscape: 'Landscape 16:9',
  pmax_landscape: 'PMax Landscape',
  pmax_square: 'PMax Square',
  banner_desktop: 'Banner Desktop',
  banner_mobile: 'Banner Mobile',
};

interface AdaptedImage {
  format: string;
  label: string;
  conceptId: string;
  base64: string;
}

export default function BrandOfferPage() {
  const [clients, setClients] = useState<BrandKit[]>([]);
  const [selectedClient, setSelectedClient] = useState<BrandKit | null>(null);

  // Form fields
  const [campaignName, setCampaignName] = useState('');
  const [discount, setDiscount] = useState('50%');
  const [categories, setCategories] = useState('Medicamentos de Venta Libre\nProductos Naturales\nDermocosmética');
  const [headline, setHeadline] = useState('');
  const [tagline, setTagline] = useState('');
  const [ctaCopy, setCtaCopy] = useState('');
  const [extraNotes, setExtraNotes] = useState('');

  // Generation state
  const [loading, setLoading] = useState(false);
  const [concepts, setConcepts] = useState<GeneratedImage[]>([]);
  const [loadingCount, setLoadingCount] = useState(0);
  const [step, setStep] = useState<'form' | 'results'>('form');

  // Adapt state
  const [selectedConcept, setSelectedConcept] = useState<GeneratedImage | null>(null);
  const [adaptFormats, setAdaptFormats] = useState<string[]>([]);
  const [adaptedImages, setAdaptedImages] = useState<AdaptedImage[]>([]);
  const [adapting, setAdapting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/brand-kits').then(r => r.json()).then(setClients).catch(() => []);
  }, []);

  const buildBrief = () => {
    const catList = categories.split('\n').filter(Boolean);
    return [
      campaignName ? `CAMPAÑA: ${campaignName}` : '',
      discount ? `DESCUENTO: hasta ${discount} en productos seleccionados` : '',
      catList.length > 0 ? `CATEGORÍAS CON DESCUENTO:\n${catList.map(c => `• ${c}`).join('\n')}` : '',
      headline ? `TITULAR: ${headline}` : '',
      tagline ? `TAGLINE: ${tagline}` : '',
      ctaCopy ? `CTA: ${ctaCopy}` : '',
      extraNotes ? `NOTAS ADICIONALES: ${extraNotes}` : '',
      'ESTILO VISUAL: colorido, retail/farmacéutico, amigable y claro. Íconos simples o ilustración por categoría. Bloques de color del brand kit. Tipografía bold con el porcentaje de descuento como elemento visual dominante. Sin personas obligatorias. Sin fotos de producto.',
    ].filter(Boolean).join('\n');
  };

  const generate = async () => {
    if (!selectedClient || !campaignName.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setLoadingCount(6);
    setConcepts([]);
    setAdaptedImages([]);
    setSelectedConcept(null);
    setStep('results');

    const brief = buildBrief();
    try {
      const res = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          brief,
          brandKit: selectedClient,
          peopleMode: 'corporate',
          productDetailImages: [],
          referenceImages: [],
          count: 6,
        }),
      });
      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.image) {
              setConcepts(prev => [...prev, data.image]);
              setLoadingCount(prev => Math.max(0, prev - 1));
            }
            if (data.done) setLoadingCount(0);
            if (data.error) setLoadingCount(prev => Math.max(0, prev - 1));
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') console.error('generate failed:', err);
    } finally {
      setLoading(false);
      setLoadingCount(0);
    }
  };

  const download = (img: GeneratedImage) => {
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${img.base64}`;
    a.download = `${selectedClient?.name || 'concepto'}-${img.conceptName.replace(/\s+/g, '-')}.png`;
    a.click();
  };

  const downloadAll = () => concepts.forEach(download);

  const adaptConcept = async () => {
    if (!selectedConcept || adaptFormats.length === 0) return;
    setAdapting(true);
    const results = await Promise.allSettled(
      adaptFormats.map(async (format) => {
        const res = await fetch('/api/adapt-size', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: selectedConcept.base64, format }),
        });
        const data = await res.json();
        return { format, label: FORMAT_LABELS[format] || format, conceptId: selectedConcept.id, base64: data.base64 || '' };
      })
    );
    const ok = results.flatMap(r => r.status === 'fulfilled' && r.value.base64 ? [r.value] : []);
    setAdaptedImages(prev => [...prev.filter(a => a.conceptId !== selectedConcept.id), ...ok]);
    setAdapting(false);
  };

  const toggleFormat = (f: string) =>
    setAdaptFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);

  return (
    <div className="min-h-screen bg-[#1C1C1E] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-white/50 hover:text-white text-sm">← Volver</Link>
          <h1 className="text-white font-semibold">Campaña de Oferta</h1>
          <span className="text-xs bg-[#FF912D]/20 text-[#FF912D] px-2 py-0.5 rounded-full">MVP</span>
        </div>
        {step === 'results' && (
          <button onClick={() => { setStep('form'); setConcepts([]); }} className="text-sm text-white/50 hover:text-white">
            ← Nuevo brief
          </button>
        )}
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {step === 'form' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Form */}
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Brief de campaña</h2>
                <p className="text-sm text-white/50">Completá los datos y generamos 6 conceptos automáticamente.</p>
              </div>

              {/* Client selector */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Cliente *</label>
                <select
                  value={selectedClient?.id || ''}
                  onChange={e => setSelectedClient(clients.find(c => c.id === e.target.value) || null)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF912D]/50"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {clients.length === 0 && (
                  <p className="text-xs text-white/40 mt-1">
                    No hay clientes.{' '}
                    <Link href="/config" className="text-[#FF912D]">Configurar →</Link>
                  </p>
                )}
              </div>

              {/* Campaign name */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Nombre de campaña *</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder="ej: Cyber Monday, Semana de la Salud"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50"
                />
              </div>

              {/* Discount */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Descuento</label>
                <input
                  type="text"
                  value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder="ej: 50%, hasta 40%"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50"
                />
              </div>

              {/* Categories */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Categorías con descuento (una por línea)</label>
                <textarea
                  value={categories}
                  onChange={e => setCategories(e.target.value)}
                  rows={4}
                  placeholder="Medicamentos de Venta Libre&#10;Productos Naturales&#10;Dermocosmética"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50 resize-none"
                />
              </div>

              {/* Headline */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Titular (opcional)</label>
                <input
                  type="text"
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  placeholder="ej: NOVASALUD CERCA DE TI"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50"
                />
              </div>

              {/* Tagline */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Tagline / Copy de apoyo (opcional)</label>
                <input
                  type="text"
                  value={tagline}
                  onChange={e => setTagline(e.target.value)}
                  placeholder="ej: Productos seleccionados con hasta un 50% DCTO"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50"
                />
              </div>

              {/* CTA */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">CTA / URL (opcional)</label>
                <input
                  type="text"
                  value={ctaCopy}
                  onChange={e => setCtaCopy(e.target.value)}
                  placeholder="ej: Encontrá tus productos en novasalud.cl"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50"
                />
              </div>

              {/* Extra notes */}
              <div>
                <label className="text-sm text-white/70 block mb-1.5">Notas adicionales (opcional)</label>
                <textarea
                  value={extraNotes}
                  onChange={e => setExtraNotes(e.target.value)}
                  rows={2}
                  placeholder="ej: Material dirigido a colaboradores. Solo sucursales."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF912D]/50 resize-none"
                />
              </div>

              <button
                onClick={generate}
                disabled={!selectedClient || !campaignName.trim() || loading}
                className="w-full bg-[#FF912D] hover:bg-[#e8822a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {loading ? 'Generando...' : 'Generar 6 conceptos →'}
              </button>
            </div>

            {/* Preview del brief */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Preview del brief</p>
              <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">
                {buildBrief() || 'Completá los campos para ver el brief...'}
              </pre>
            </div>
          </div>
        )}

        {step === 'results' && (
          <div className="space-y-8">
            {/* Status bar */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{campaignName}</h2>
                <p className="text-sm text-white/50">{selectedClient?.name} · {concepts.length} concepto{concepts.length !== 1 ? 's' : ''} generado{concepts.length !== 1 ? 's' : ''}{loadingCount > 0 ? `, ${loadingCount} en proceso...` : ''}</p>
              </div>
              <div className="flex gap-3">
                {concepts.length > 0 && (
                  <button onClick={downloadAll} className="text-sm border border-white/20 hover:border-white/40 px-4 py-2 rounded-lg transition-colors">
                    ↓ Descargar todos
                  </button>
                )}
                {!loading && (
                  <button
                    onClick={generate}
                    className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                  >
                    ↺ Regenerar
                  </button>
                )}
              </div>
            </div>

            {/* Concept grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {concepts.map(img => (
                <div
                  key={img.id}
                  className={`relative group rounded-xl overflow-hidden cursor-pointer border-2 transition-colors ${
                    selectedConcept?.id === img.id ? 'border-[#FF912D]' : 'border-transparent'
                  }`}
                  onClick={() => setSelectedConcept(prev => prev?.id === img.id ? null : img)}
                >
                  <img src={`data:image/png;base64,${img.base64}`} alt={img.conceptName} className="w-full" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-between p-3 opacity-0 group-hover:opacity-100">
                    <span className="text-xs text-white/80 bg-black/60 px-2 py-1 rounded">{img.conceptName}</span>
                    <button
                      onClick={e => { e.stopPropagation(); download(img); }}
                      className="text-xs text-white bg-[#FF912D] hover:bg-[#e8822a] px-3 py-1.5 rounded-lg"
                    >
                      ↓
                    </button>
                  </div>
                  {selectedConcept?.id === img.id && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-[#FF912D] rounded-full flex items-center justify-center text-xs font-bold">✓</div>
                  )}
                </div>
              ))}

              {/* Loading skeletons */}
              {Array.from({ length: loadingCount }).map((_, i) => (
                <div key={`skel-${i}`} className="rounded-xl bg-white/5 animate-pulse aspect-[2/3]" />
              ))}
            </div>

            {/* Adapt formats */}
            {concepts.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">Adaptaciones de formato</h3>
                  <p className="text-sm text-white/50">
                    {selectedConcept ? `Adaptando: "${selectedConcept.conceptName}"` : 'Seleccioná un concepto del grid para adaptar.'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {Object.entries(FORMAT_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => toggleFormat(key)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        adaptFormats.includes(key)
                          ? 'bg-[#FF912D] border-[#FF912D] text-white'
                          : 'border-white/20 text-white/60 hover:border-white/40 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={adaptConcept}
                  disabled={!selectedConcept || adaptFormats.length === 0 || adapting}
                  className="bg-[#FF912D] hover:bg-[#e8822a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
                >
                  {adapting ? 'Adaptando...' : `Generar ${adaptFormats.length} adaptación${adaptFormats.length !== 1 ? 'es' : ''}`}
                </button>

                {/* Adapted images */}
                {adaptedImages.length > 0 && (
                  <div>
                    <p className="text-sm text-white/50 mb-3">{adaptedImages.length} adaptaciones generadas</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {adaptedImages.map((a, i) => (
                        <div key={i} className="group relative">
                          <img src={`data:image/png;base64,${a.base64}`} alt={a.label} className="w-full rounded-lg" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-lg flex items-end p-2 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = `data:image/png;base64,${a.base64}`;
                                link.download = `${selectedClient?.name || 'concepto'}-${a.label}.png`;
                                link.click();
                              }}
                              className="text-xs text-white bg-[#FF912D] px-3 py-1.5 rounded w-full text-center"
                            >
                              ↓ {a.label}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
