'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { BrandKit, GeneratedImage, Step, PeopleMode } from './types';
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

  const [peopleMode, setPeopleMode] = useState<PeopleMode>('none');
  const [productDetailImages, setProductDetailImages] = useState<string[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  const [concepts, setConcepts] = useState<GeneratedImage[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<GeneratedImage | null>(null);

  const [variations, setVariations] = useState<GeneratedImage[]>([]);
  const [selectedVariation, setSelectedVariation] = useState<GeneratedImage | null>(null);

  const [refineImage, setRefineImage] = useState<GeneratedImage | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineHistory, setRefineHistory] = useState<string[]>([]);
  const refineInputRef = useRef<HTMLInputElement>(null);

  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [adjustment, setAdjustment] = useState('');
  const [adjustHistory, setAdjustHistory] = useState<string[]>([]);
  const adjustInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem('brandKits');
    if (stored) setClients(JSON.parse(stored));
  }, []);

  const readAsPng = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 2048;
          let { naturalWidth: w, naturalHeight: h } = img;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleProductDetailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(async file => {
      const png = await readAsPng(file);
      setProductDetailImages(prev => prev.length < 2 ? [...prev, png] : prev);
    });
    e.target.value = '';
  };

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(async file => {
      const png = await readAsPng(file);
      setReferenceImages(prev => prev.length < 2 ? [...prev, png] : prev);
    });
    e.target.value = '';
  };

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
          peopleMode,
          productDetailImages,
          referenceImages,
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

  const enterRefine = () => {
    if (!selectedConcept) return;
    setRefineImage(selectedConcept);
    setRefineHistory([]);
    setStep('refine');
  };

  const applyRefinement = async () => {
    if (!refineImage || !refineInput.trim()) return;
    setLoading(true);
    setError('');
    const instruction = refineInput.trim();
    setRefineInput('');
    try {
      const res = await fetch('/api/adjust-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: refineImage.base64, instruction }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRefineImage(prev => prev ? { ...prev, id: Math.random().toString(36).slice(2), base64: data.base64 } : prev);
      setRefineHistory(prev => [...prev, instruction]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error aplicando refinamiento');
    } finally {
      setLoading(false);
      setTimeout(() => refineInputRef.current?.focus(), 100);
    }
  };

  const generateVariations = async () => {
    if ((!selectedConcept && !refineImage) || !selectedClient) return;
    const conceptToUse = refineImage || selectedConcept!;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedConcept: conceptToUse, brandKit: selectedClient, peopleMode }),
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
    setRefineImage(null);
    setRefineHistory([]);
    setRefineInput('');
    setVariations([]);
    setSelectedVariation(null);
    setCurrentImage(null);
    setAdjustHistory([]);
    setError('');
    setPeopleMode('none');
    setProductDetailImages([]);
    setReferenceImages([]);
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
                      <div className="flex gap-1 mb-2 flex-wrap">
                        {[client.primary1, client.primary2, client.primary3, client.secondary1, client.secondary2, client.secondary3].map((c, i) => (
                          <div key={i} className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-sm font-medium truncate">{client.name}</p>
                      {client.referencePiecesStyle && (
                        <p className="text-xs text-indigo-400 mt-1">✓ {client.referencePiecesThumbnails?.length || 0} piezas ref.</p>
                      )}
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

            {/* People mode */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Personas en la imagen</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'none', label: 'Sin personas', desc: 'Producto, flat lay o composición', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                  { value: 'real', label: 'Con persona de referencia', desc: 'Subís la foto de la persona ya usando el producto', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setPeopleMode(opt.value); if (opt.value !== 'real') setReferenceImages([]); setProductDetailImages([]); }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      peopleMode === opt.value
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-white/10 hover:border-white/20 bg-white/5'
                    }`}
                  >
                    <svg className={`w-5 h-5 mb-2 ${peopleMode === opt.value ? 'text-indigo-400' : 'text-white/40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={opt.icon} />
                    </svg>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Product detail upload — always shown */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-white/60">Foto del producto / estampado en detalle</p>
                <p className="text-xs text-white/30">Primer plano del estampado o producto sobre fondo neutro — más detalle = mejor resultado.</p>
                <div className="flex gap-3 flex-wrap">
                  {productDetailImages.map((img, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/10">
                      <img src={img} alt={`prod ${i+1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setProductDetailImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center text-white/80 hover:text-white text-xs"
                      >×</button>
                    </div>
                  ))}
                  {productDetailImages.length < 2 && (
                    <label className="w-20 h-20 rounded-xl border border-dashed border-white/20 hover:border-white/40 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1">
                      <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-xs text-white/30">Foto</span>
                      <input type="file" accept="image/*" multiple onChange={handleProductDetailUpload} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {/* Person reference upload — only in 'real' mode */}
              {peopleMode === 'real' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-white/60">Foto de la persona usando el producto</p>
                  <p className="text-xs text-white/30">La persona ya vistiendo el producto — referencia para el modelo.</p>
                  <div className="flex gap-3 flex-wrap">
                    {referenceImages.map((img, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/10">
                        <img src={img} alt={`ref ${i+1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setReferenceImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center text-white/80 hover:text-white text-xs"
                        >×</button>
                      </div>
                    ))}
                    {referenceImages.length < 2 && (
                      <label className="w-20 h-20 rounded-xl border border-dashed border-white/20 hover:border-white/40 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1">
                        <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="text-xs text-white/30">Foto</span>
                        <input type="file" accept="image/*" multiple onChange={handleReferenceImageUpload} className="hidden" />
                      </label>
                    )}
                  </div>
                </div>
              )}
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
                    onClick={enterRefine}
                    disabled={!selectedConcept || loading}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
                  >
                    Afinar concepto
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: REFINE */}
        {step === 'refine' && refineImage && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">Afiná el concepto</h2>
                <p className="text-white/50 text-sm">Ajustá estampado, colores, modelo, composición — o avanzá directo a variaciones</p>
              </div>
              <button onClick={() => setStep('concepts')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              {/* Image preview */}
              <div className="rounded-xl overflow-hidden border border-white/10">
                <img
                  src={`data:image/png;base64,${refineImage.base64}`}
                  alt="Concepto a afinar"
                  className="w-full"
                />
              </div>

              {/* Refinement panel */}
              <div className="space-y-5">
                {refineHistory.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Refinamientos aplicados</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {refineHistory.map((h, i) => (
                        <div key={i} className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white/60 flex items-start gap-2">
                          <span className="text-indigo-400 mt-0.5">✓</span>
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Instrucción de refinamiento</p>
                  <input
                    ref={refineInputRef}
                    type="text"
                    value={refineInput}
                    onChange={e => setRefineInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !loading && applyRefinement()}
                    placeholder="Ej: hacer el estampado más pequeño, cambiar fondo a negro, modelo rubia de 25 años..."
                    disabled={loading}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 text-sm disabled:opacity-50"
                  />
                  <button
                    onClick={applyRefinement}
                    disabled={!refineInput.trim() || loading}
                    className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Aplicando...
                      </>
                    ) : 'Aplicar refinamiento'}
                  </button>
                </div>

                <button
                  onClick={generateVariations}
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generando variaciones...
                    </>
                  ) : (
                    <>
                      Generar 4 variaciones
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
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
              <button onClick={() => setStep('refine')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
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
