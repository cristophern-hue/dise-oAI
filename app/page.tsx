'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { BrandKit, GeneratedImage, Step, PeopleMode } from './types';
import ImageCard from './components/ImageCard';
import StepIndicator from './components/StepIndicator';
import LoadingGrid from './components/LoadingGrid';

const SESSION_KEY = 'disenoai_session';

interface SessionData {
  step: Step;
  brief: string;
  selectedClientId: string | null;
  peopleMode: PeopleMode;
  concepts: GeneratedImage[];
  selectedConcepts: GeneratedImage[];
  productDescription: string;
  personDescription: string;
  refineImage: GeneratedImage | null;
  refineHistory: string[];
  refineImageHistory: string[];
}

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
  const [selectedConcepts, setSelectedConcepts] = useState<GeneratedImage[]>([]);
  const [refineIndex, setRefineIndex] = useState(0);
  const [productDescription, setProductDescription] = useState('');
  const [personDescription, setPersonDescription] = useState('');

  const [refineImage, setRefineImage] = useState<GeneratedImage | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineHistory, setRefineHistory] = useState<string[]>([]);
  const [refineImageHistory, setRefineImageHistory] = useState<string[]>([]);
  const refineInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    const stored = localStorage.getItem('brandKits');
    if (stored) setClients(JSON.parse(stored));
  }, []);

  const readAsPng = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          let { naturalWidth: w, naturalHeight: h } = img;
          if (!w || !h) { resolve(dataUrl); return; }
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          try {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
            const result = canvas.toDataURL('image/jpeg', 0.75);
            resolve(result.length > 100 ? result : dataUrl);
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      };
      reader.onerror = () => resolve('');
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
      setProductDescription(data.productDescription || '');
      setPersonDescription(data.personDescription || '');
      setStep('concepts');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando conceptos');
    } finally {
      setLoading(false);
    }
  };

  const toggleConceptSelection = (img: GeneratedImage) => {
    setSelectedConcepts(prev =>
      prev.find(c => c.id === img.id) ? prev.filter(c => c.id !== img.id) : [...prev, img]
    );
  };

  const enterRefine = async () => {
    if (selectedConcepts.length === 0) return;
    // If product was uploaded, apply it to each selected concept before entering refine
    if (productDetailImages.length > 0) {
      setLoading(true);
      setError('');
      try {
        const results = await Promise.all(
          selectedConcepts.map(async concept => {
            const res = await fetch('/api/apply-product', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conceptImageBase64: concept.base64,
                productDetailImages,
                productDescription,
                peopleMode,
                personDescription,
              }),
            });
            if (!res.ok) return { concept, applied: false };
            const data = await res.json();
            return {
              concept: data.base64 ? { ...concept, base64: data.base64 } : concept,
              applied: data.applied === true,
            };
          })
        );
        const applied = results.map(r => r.concept);
        const anyFailed = results.some(r => !r.applied);
        if (anyFailed) {
          setError('No se pudo aplicar el producto en uno o más conceptos. Se usará el concepto original para afinar.');
        }
        setSelectedConcepts(applied);
        setRefineIndex(0);
        setRefineImage(applied[0]);
        setRefineHistory([]);
        setStep('refine');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error aplicando producto');
      } finally {
        setLoading(false);
      }
      return;
    }
    setRefineIndex(0);
    setRefineImage(selectedConcepts[0]);
    setRefineHistory([]);
    setStep('refine');
  };

  const saveRefinedAndNext = () => {
    if (!refineImage) return;
    const updated = selectedConcepts.map((c, i) => i === refineIndex ? refineImage : c);
    setSelectedConcepts(updated);
    const nextIndex = refineIndex + 1;
    if (nextIndex < updated.length) {
      setRefineIndex(nextIndex);
      setRefineImage(updated[nextIndex]);
      setRefineHistory([]);
      setRefineImageHistory([]);
    }
  };

  const downloadAllSelected = () => {
    selectedConcepts.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${img.base64}`;
        a.download = `${selectedClient?.name || 'concepto'}-${img.conceptName.replace(/\s+/g, '-')}.png`;
        a.click();
      }, i * 300);
    });
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
        body: JSON.stringify({ imageBase64: refineImage.base64, instruction, productDetailImages }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRefineImageHistory(prev => [...prev, refineImage.base64]);
      setRefineImage(prev => prev ? { ...prev, id: Math.random().toString(36).slice(2), base64: data.base64 } : prev);
      setRefineHistory(prev => [...prev, instruction]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error aplicando refinamiento');
    } finally {
      setLoading(false);
      setTimeout(() => refineInputRef.current?.focus(), 100);
    }
  };

  const undoRefinement = () => {
    if (refineImageHistory.length === 0) return;
    const prev = refineImageHistory[refineImageHistory.length - 1];
    setRefineImageHistory(h => h.slice(0, -1));
    setRefineImage(img => img ? { ...img, id: Math.random().toString(36).slice(2), base64: prev } : img);
    setRefineHistory(h => h.slice(0, -1));
  };

  const finishRefine = () => {
    if (!refineImage) return;
    const updated = selectedConcepts.map((c, i) => i === refineIndex ? refineImage : c);
    setSelectedConcepts(updated);
    setStep('done');
  };


  const reset = () => {
    setStep('brief');
    setBrief('');
    setConcepts([]);
    setSelectedConcepts([]);
    setRefineIndex(0);
    setProductDescription('');
    setPersonDescription('');
    setRefineImage(null);
    setRefineHistory([]);
    setRefineImageHistory([]);
    setRefineInput('');
    setError('');
    setPeopleMode('none');
    setProductDetailImages([]);
    setReferenceImages([]);
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  };

  const regenerateConcepts = async () => {
    setSelectedConcepts([]);
    setRefineIndex(0);
    await generateConcepts();
  };

  // Auto-save session to localStorage whenever key state changes
  useEffect(() => {
    if (step === 'brief' && !brief && !selectedClient) return;
    const session: SessionData = {
      step, brief,
      selectedClientId: selectedClient?.id || null,
      peopleMode, concepts, selectedConcepts,
      productDescription, personDescription,
      refineImage, refineHistory, refineImageHistory,
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  }, [step, brief, selectedClient, peopleMode, concepts, selectedConcepts, productDescription, personDescription, refineIndex, refineImage, refineHistory, refineImageHistory]);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s: SessionData = JSON.parse(raw);
      if (s.step === 'brief') return;
      // Handle legacy sessions that had 'adjust' step
      if ((s.step as string) === 'adjust') s.step = 'refine';
      setBrief(s.brief || '');
      setPeopleMode(s.peopleMode || 'none');
      setConcepts(s.concepts || []);
      setSelectedConcepts(s.selectedConcepts || []);
      setProductDescription(s.productDescription || '');
      setPersonDescription(s.personDescription || '');
      setRefineImage(s.refineImage || null);
      setRefineImageHistory(s.refineImageHistory || []);
      setRefineHistory(s.refineHistory || []);
      if (s.selectedClientId) {
        const stored = localStorage.getItem('brandKits');
        if (stored) {
          const kits: BrandKit[] = JSON.parse(stored);
          const found = kits.find(k => k.id === s.selectedClientId);
          if (found) setSelectedClient(found);
        }
      }
      setStep(s.step);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportSession = () => {
    const session: SessionData = {
      step, brief,
      selectedClientId: selectedClient?.id || null,
      peopleMode, concepts, selectedConcepts,
      productDescription, personDescription,
      refineImage, refineHistory, refineImageHistory,
    };
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sesion-${selectedClient?.name || 'disenoai'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s: SessionData = JSON.parse(reader.result as string);
        setBrief(s.brief || '');
        setPeopleMode(s.peopleMode || 'none');
        setConcepts(s.concepts || []);
        setSelectedConcepts(s.selectedConcepts || []);
        setProductDescription(s.productDescription || '');
        setPersonDescription(s.personDescription || '');
        setRefineImage(s.refineImage || null);
        setRefineImageHistory(s.refineImageHistory || []);
        setRefineHistory(s.refineHistory || []);
        if (s.selectedClientId) {
          const stored = localStorage.getItem('brandKits');
          if (stored) {
            const kits: BrandKit[] = JSON.parse(stored);
            const found = kits.find(k => k.id === s.selectedClientId);
            if (found) setSelectedClient(found);
          }
        }
        setStep(s.step);
      } catch { setError('No se pudo importar la sesión — archivo inválido.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
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
        <div className="flex items-center gap-3">
          <StepIndicator currentStep={step} />
          {step !== 'brief' && (
            <button
              onClick={exportSession}
              title="Guardar sesión como archivo"
              className="text-sm text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Guardar
            </button>
          )}
          <label
            title="Retomar sesión guardada"
            className="text-sm text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
            </svg>
            Retomar
            <input type="file" accept=".json" onChange={importSession} className="hidden" />
          </label>
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
                <h2 className="text-2xl font-bold mb-1">Elegí hasta 3 conceptos</h2>
                <p className="text-white/50 text-sm">Seleccioná los que más te gustan para afinarlos y enviarle al cliente</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={regenerateConcepts}
                  disabled={loading}
                  className="text-sm text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg disabled:opacity-40 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerar
                </button>
                <button onClick={reset} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                  ← Volver
                </button>
              </div>
            </div>

            {loading && step === 'concepts' ? (
              <LoadingGrid count={selectedConcepts.length || 6} label={productDetailImages.length > 0 && selectedConcepts.length > 0 ? `Aplicando producto a ${selectedConcepts.length} concepto${selectedConcepts.length > 1 ? 's' : ''}...` : 'Generando 6 conceptos visuales...'} />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {concepts.map(img => {
                    const selIdx = selectedConcepts.findIndex(c => c.id === img.id);
                    const isSelected = selIdx !== -1;
                    return (
                      <div key={img.id} className="relative">
                        <ImageCard
                          image={img}
                          selected={isSelected}
                          onClick={() => toggleConceptSelection(img)}
                        />
                        {isSelected && (
                          <div className="absolute top-2 left-2 w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
                            {selIdx + 1}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Product description editor — shown whenever product images were uploaded */}
                {productDetailImages.length > 0 && (
                  <div className="space-y-2 border border-indigo-500/20 bg-indigo-500/5 rounded-xl p-4">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs font-medium text-indigo-300">Descripción del producto — editala antes de afinar para mejorar la fidelidad</p>
                    </div>
                    <textarea
                      value={productDescription}
                      onChange={e => setProductDescription(e.target.value)}
                      rows={5}
                      placeholder="La IA no pudo generar una descripción automática. Describí el producto manualmente: tipo de prenda, color, estampado, detalles..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/80 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 resize-none placeholder-white/20"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <p className="text-white/40 text-sm">
                      {selectedConcepts.length === 0 ? 'Hacé click para seleccionar' : `${selectedConcepts.length} concepto${selectedConcepts.length > 1 ? 's' : ''} seleccionado${selectedConcepts.length > 1 ? 's' : ''}`}
                    </p>
                    {selectedConcepts.length > 0 && (
                      <button
                        onClick={downloadAllSelected}
                        className="text-white/50 hover:text-white/80 text-sm border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Descargar todos
                      </button>
                    )}
                  </div>
                  <button
                    onClick={enterRefine}
                    disabled={selectedConcepts.length === 0 || loading}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
                  >
                    {loading ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Aplicando producto...</>
                    ) : (
                      <>Afinar {selectedConcepts.length > 1 ? `${selectedConcepts.length} conceptos` : 'concepto'}<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg></>
                    )}
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
                <h2 className="text-2xl font-bold mb-1">
                  Afiná el concepto
                  {selectedConcepts.length > 1 && (
                    <span className="ml-3 text-base font-normal text-indigo-400">{refineIndex + 1} de {selectedConcepts.length}</span>
                  )}
                </h2>
                <p className="text-white/50 text-sm">{refineImage.conceptName}</p>
              </div>
              <button onClick={() => setStep('concepts')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              {/* Image preview */}
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={`data:image/png;base64,${refineImage.base64}`} alt="Concepto" className="w-full" />
                </div>
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = `data:image/png;base64,${refineImage.base64}`;
                    a.download = `${selectedClient?.name || 'concepto'}-${refineImage.conceptName.replace(/\s+/g, '-')}.png`;
                    a.click();
                  }}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-sm px-4 py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Descargar este concepto
                </button>
              </div>

              {/* Refinement panel */}
              <div className="space-y-4">
                {refineHistory.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Aplicados</p>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {refineHistory.map((h, i) => (
                        <div key={i} className="bg-white/5 rounded-lg px-3 py-2 text-sm text-white/60 flex items-start gap-2">
                          <span className="text-indigo-400 mt-0.5">✓</span>{h}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Presets */}
                <div className="space-y-2">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Ajustes rápidos</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Fondo más oscuro',
                      'Fondo blanco limpio',
                      'Más contraste',
                      'Iluminación más suave',
                      'Estampado más visible',
                      'Colores más vibrantes',
                      'Modelo mujer joven',
                      'Modelo hombre joven',
                      'Quitar personas',
                      'Solo producto flat lay',
                      'Composición más centrada',
                      'Agregar texto de marca',
                    ].map(preset => (
                      <button
                        key={preset}
                        onClick={() => setRefineInput(preset)}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-500/50 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <input
                    ref={refineInputRef}
                    type="text"
                    value={refineInput}
                    onChange={e => setRefineInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !loading && applyRefinement()}
                    placeholder="O escribí tu ajuste..."
                    disabled={loading}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 text-sm disabled:opacity-50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={applyRefinement}
                      disabled={!refineInput.trim() || loading}
                      className="flex-1 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Aplicando...</> : 'Aplicar'}
                    </button>
                    {refineImageHistory.length > 0 && (
                      <button
                        onClick={undoRefinement}
                        disabled={loading}
                        title="Deshacer último ajuste"
                        className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 disabled:opacity-40 text-white/60 hover:text-white px-3 py-3 rounded-xl transition-colors flex items-center gap-1.5 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        Deshacer
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  {refineIndex < selectedConcepts.length - 1 ? (
                    <button
                      onClick={saveRefinedAndNext}
                      disabled={loading}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      Guardar y siguiente
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={finishRefine}
                      disabled={loading}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      Finalizar
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step: DONE */}
        {step === 'done' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-1">¡Listos para entregar!</h2>
                <p className="text-white/50 text-sm">{selectedConcepts.length} concepto{selectedConcepts.length > 1 ? 's' : ''} finalizado{selectedConcepts.length > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setStep('refine')} className="text-white/40 hover:text-white/70 text-sm transition-colors">
                ← Volver a afinación
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {selectedConcepts.map((img, i) => (
                <div key={img.id} className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <img src={`data:image/png;base64,${img.base64}`} alt={img.conceptName} className="w-full" />
                  </div>
                  <p className="text-xs text-white/50 text-center truncate">{img.conceptName}</p>
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = `data:image/png;base64,${img.base64}`;
                      a.download = `${selectedClient?.name || 'concepto'}-${i + 1}-${img.conceptName.replace(/\s+/g, '-')}.png`;
                      a.click();
                    }}
                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Descargar
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={downloadAllSelected}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Descargar todos ({selectedConcepts.length})
              </button>
              <button
                onClick={reset}
                className="text-white/40 hover:text-white/70 text-sm transition-colors border border-white/10 hover:border-white/20 px-4 py-3 rounded-xl"
              >
                Nueva campaña
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
