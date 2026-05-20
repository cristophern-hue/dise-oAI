'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { BrandKit, GeneratedImage, Step } from './types';
import ImageCard from './components/ImageCard';
import StepIndicator from './components/StepIndicator';
import LoadingGrid from './components/LoadingGrid';

export default function Home() {
  const [clients, setClients] = useState<BrandKit[]>([]);
  const [selectedClient, setSelectedClient] = useState<BrandKit | null>(null);
  const [brief, setBrief] = useState('');
  const [step, setStep] = useState<Step>('brief');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [concepts, setConcepts] = useState<GeneratedImage[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<GeneratedImage | null>(null);

  const [variations, setVariations] = useState<GeneratedImage[]>([]);
  const [selectedVariation, setSelectedVariation] = useState<GeneratedImage | null>(null);

  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [adjustment, setAdjustment] = useState('');
  const [adjustHistory, setAdjustHistory] = useState<string[]>([]);
  const adjustInputRef = useRef<HTMLInputElement>(null);

  const [generationMode, setGenerationMode] = useState<'no-people' | 'real-person'>('no-people');
  // no-people: product photo; real-person: photo of person already using the product
  const [referenceImageBase64, setReferenceImageBase64] = useState<string | null>(null);

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReferenceImageBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const stored = localStorage.getItem('brandKits');
    if (stored) setClients(JSON.parse(stored));
  }, []);

  const generateConcepts = async () => {
    if (!selectedClient || !brief.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          brandKit: selectedClient,
          mode: generationMode,
          referenceImageBase64: referenceImageBase64 ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setConcepts(data.images);
      setStep('concepts');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando conceptos');
    } finally {
      setLoading(false);
    }
  };

  const generateVariations = async () => {
    if (!selectedConcept || !selectedClient) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedConcept, brandKit: selectedClient }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setVariations(data.images);
      setStep('variations');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando variaciones');
    } finally {
      setLoading(false);
    }
  };

  const confirmVariation = () => {
    if (!selectedVariation) return;
    setCurrentImage(selectedVariation);
    setAdjustHistory([]);
    setStep('adjust');
  };

  const applyAdjustment = async () => {
    if (!currentImage || !adjustment.trim()) return;
    setLoading(true);
    setError('');
    const instruction = adjustment.trim();
    setAdjustment('');
    try {
      const res = await fetch('/api/adjust-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: currentImage.base64, instruction }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const updated: GeneratedImage = {
        ...currentImage,
        id: Math.random().toString(36).slice(2),
        base64: data.base64,
      };
      setCurrentImage(updated);
      setAdjustHistory(prev => [...prev, instruction]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error aplicando ajuste');
    } finally {
      setLoading(false);
      setTimeout(() => adjustInputRef.current?.focus(), 100);
    }
  };

  const downloadImage = () => {
    if (!currentImage) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${currentImage.base64}`;
    a.download = `${selectedClient?.name || 'imagen'}-${Date.now()}.png`;
    a.click();
  };

  const reset = () => {
    setStep('brief');
    setBrief('');
    setConcepts([]);
    setSelectedConcept(null);
    setVariations([]);
    setSelectedVariation(null);
    setCurrentImage(null);
    setAdjustHistory([]);
    setError('');
    setReferenceImageBase64(null);
    setGenerationMode('no-people');
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-semibold text-lg">Diseño AI</span>
        </div>
        <div className="flex items-center gap-4">
          <StepIndicator currentStep={step} />
          <Link
            href="/config"
            className="text-sm text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg"
          >
            Clientes
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-start gap-2">
            <span className="mt-0.5">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Step: BRIEF */}
        {step === 'brief' && (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold mb-2">Nueva pieza</h1>
              <p className="text-white/50">Seleccioná el cliente y escribí el brief de la campaña.</p>
            </div>

            {/* Client selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Cliente</label>
              {clients.length === 0 ? (
                <div className="border border-dashed border-white/20 rounded-xl p-6 text-center">
                  <p className="text-white/40 text-sm mb-3">No hay clientes configurados</p>
                  <Link href="/config" className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">
                    + Crear primer cliente
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {clients.map(client => (
                    <button
                      key={client.id}
                      onClick={() => setSelectedClient(client)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        selectedClient?.id === client.id
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-white/10 hover:border-white/20 bg-white/5'
                      }`}
                    >
                      <div className="flex gap-1.5 mb-2">
                        {[client.primaryColor, client.secondaryColor, client.accentColor].map((c, i) => (
                          <div key={i} className="w-4 h-4 rounded-full border border-black/20" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-sm font-medium truncate">{client.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Brief input */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Brief de campaña</label>
              <textarea
                value={brief}
                onChange={e => setBrief(e.target.value)}
                placeholder="Ej: Banner para Instagram, Black Friday, 2x1 en café premium, mensaje principal: 'Tu momento, doble', tono aspiracional..."
                rows={5}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 resize-none text-sm leading-relaxed"
              />
              <p className="text-xs text-white/30">GPT-4o va a refinar este brief y generar 6 conceptos visuales distintos.</p>
            </div>

            {/* Mode selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Tipo de imagen</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'no-people' as const, label: 'Sin personas', desc: 'Subís la foto del producto — genera composiciones sin modelos (flat lay, packshot)' },
                  { id: 'real-person' as const, label: 'Con persona de referencia', desc: 'Subís una foto de la persona ya usando el producto — esa imagen es la referencia visual' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGenerationMode(opt.id)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      generationMode === opt.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-white/10 hover:border-white/20 bg-white/5'
                    }`}
                  >
                    <p className="text-sm font-medium mb-1">{opt.label}</p>
                    <p className="text-xs text-white/40 leading-snug">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Reference image upload */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">
                {generationMode === 'no-people' ? 'Foto del producto' : 'Foto de la persona usando el producto'}
              </label>
              <div className="flex items-center gap-4">
                {referenceImageBase64 && (
                  <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 flex-shrink-0">
                    <img src={referenceImageBase64} alt="Referencia" className="w-full h-full object-cover" />
                  </div>
                )}
                <label className="cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl px-4 py-3 text-sm text-white/60 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {referenceImageBase64 ? 'Cambiar imagen' : 'Subir imagen'}
                  <input type="file" accept="image/*" onChange={handleReferenceImageUpload} className="hidden" />
                </label>
                {referenceImageBase64 && (
                  <button onClick={() => setReferenceImageBase64(null)} className="text-white/30 hover:text-red-400 text-xs transition-colors">Quitar</button>
                )}
              </div>
            </div>

            <button
              onClick={generateConcepts}
              disabled={!selectedClient || !brief.trim() || loading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generando conceptos...
                </>
              ) : (
                <>
                  Generar 6 conceptos
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        )}

        {/* Step: CONCEPTS */}
        {step === 'concepts' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">Elegí un concepto</h2>
                <p className="text-white/50 text-sm">6 direcciones visuales distintas para tu campaña</p>
              </div>
              <button onClick={reset} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver
              </button>
            </div>

            {loading ? (
              <LoadingGrid count={6} label="Generando 6 conceptos visuales..." />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {concepts.map(img => (
                    <ImageCard
                      key={img.id}
                      image={img}
                      selected={selectedConcept?.id === img.id}
                      onClick={() => setSelectedConcept(img)}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <p className="text-white/40 text-sm">
                    {selectedConcept ? `Seleccionado: ${selectedConcept.conceptName}` : 'Hacé click en un concepto para seleccionarlo'}
                  </p>
                  <button
                    onClick={generateVariations}
                    disabled={!selectedConcept || loading}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
                  >
                    Ver 4 variaciones
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: VARIATIONS */}
        {step === 'variations' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">Elegí una variación</h2>
                <p className="text-white/50 text-sm">4 versiones del concepto &ldquo;{selectedConcept?.conceptName}&rdquo;</p>
              </div>
              <button onClick={() => setStep('concepts')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver
              </button>
            </div>

            {loading ? (
              <LoadingGrid count={4} label="Generando 4 variaciones..." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {variations.map(img => (
                    <ImageCard
                      key={img.id}
                      image={img}
                      selected={selectedVariation?.id === img.id}
                      onClick={() => setSelectedVariation(img)}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <p className="text-white/40 text-sm">
                    {selectedVariation ? `Seleccionada: ${selectedVariation.conceptName}` : 'Elegí la variación base para ajustar'}
                  </p>
                  <button
                    onClick={confirmVariation}
                    disabled={!selectedVariation}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
                  >
                    Ajustar esta imagen
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: ADJUST */}
        {step === 'adjust' && currentImage && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">Ajustá la imagen</h2>
                <p className="text-white/50 text-sm">Describí los cambios que querés aplicar</p>
              </div>
              <button onClick={() => setStep('variations')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              {/* Image preview */}
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img
                    src={`data:image/png;base64,${currentImage.base64}`}
                    alt="Imagen actual"
                    className="w-full"
                  />
                </div>
                <button
                  onClick={downloadImage}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Descargar imagen
                </button>
              </div>

              {/* Adjustment panel */}
              <div className="space-y-4">
                {/* History */}
                {adjustHistory.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Ajustes aplicados</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {adjustHistory.map((h, i) => (
                        <div key={i} className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white/60 flex items-start gap-2">
                          <span className="text-indigo-400 mt-0.5">✓</span>
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Adjustment input */}
                <div className="space-y-2">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Nuevo ajuste</p>
                  <div className="space-y-2">
                    <input
                      ref={adjustInputRef}
                      type="text"
                      value={adjustment}
                      onChange={e => setAdjustment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !loading && applyAdjustment()}
                      placeholder="Ej: Subí el logo a la esquina superior, cambiá el fondo a negro..."
                      disabled={loading}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 text-sm disabled:opacity-50"
                    />
                    <button
                      onClick={applyAdjustment}
                      disabled={!adjustment.trim() || loading}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Aplicando ajuste...
                        </>
                      ) : (
                        'Aplicar ajuste'
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-white/30">Podés hacer todos los ajustes que necesitás. Enter para enviar.</p>
                </div>

                {/* Quick suggestions */}
                <div className="space-y-2">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Sugerencias rápidas</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Más contraste',
                      'Fondo más oscuro',
                      'Texto más grande',
                      'Estilo más minimalista',
                      'Agregar más espacio',
                      'Colores más vibrantes',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => setAdjustment(s)}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-white/60 hover:text-white transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={reset}
                  className="text-white/30 hover:text-white/60 text-sm transition-colors mt-4"
                >
                  Empezar de nuevo
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
