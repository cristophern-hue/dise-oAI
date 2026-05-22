'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BrandKit } from '@/app/types';

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    })
  );
  return pages.join('\n').slice(0, 12000);
}

const EMPTY_FORM: Omit<BrandKit, 'id'> = {
  name: '',
  primary1: '#000000',
  primary2: '#ffffff',
  primary3: '#cccccc',
  secondary1: '#888888',
  secondary2: '#aaaaaa',
  secondary3: '#eeeeee',
  typography: '',
  styleDescription: '',
  referencePiecesStyle: undefined,
  referencePiecesThumbnails: [],
  logoBase64: undefined,
  logoDark: undefined,
  logoLight: undefined,
  quickAdjustments: [],
};

const PRIMARY_LABELS = ['P1', 'P2', 'P3'];
const SECONDARY_LABELS = ['S1', 'S2', 'S3'];

export default function ConfigPage() {
  const [clients, setClients] = useState<BrandKit[]>([]);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [analyzingRefs, setAnalyzingRefs] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newAdjustment, setNewAdjustment] = useState('');

  useEffect(() => {
    fetch('/api/brand-kits').then(r => r.json()).then(setClients).catch(console.error);
  }, []);

  const persist = async (updated: BrandKit[], changed: BrandKit | null, deletedId?: string) => {
    setClients(updated);
    if (deletedId) {
      await fetch('/api/brand-kits', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deletedId }),
      });
    } else if (changed) {
      await fetch('/api/brand-kits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setSaved(false);
  };

  const openEdit = (client: BrandKit) => {
    setEditing(client);
    setForm({ ...client });
    setShowForm(true);
    setSaved(false);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text.trim()) throw new Error('El PDF no tiene texto extraíble');
      const res = await fetch('/api/extract-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Error procesando el PDF');
      }
      const data = await res.json();
      setForm(f => ({
        ...f,
        name: data.name || f.name,
        primary1: data.primary1 || f.primary1,
        primary2: data.primary2 || f.primary2,
        primary3: data.primary3 || f.primary3,
        secondary1: data.secondary1 || f.secondary1,
        secondary2: data.secondary2 || f.secondary2,
        secondary3: data.secondary3 || f.secondary3,
        typography: data.typography || f.typography,
        styleDescription: data.styleDescription || f.styleDescription,
      }));
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : 'No se pudo leer el PDF'}`);
    } finally {
      setExtracting(false);
      e.target.value = '';
    }
  };

  const compressImage = (file: File): Promise<string> =>
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
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
            const result = canvas.toDataURL('image/jpeg', 0.75);
            resolve(result.length > 100 ? result : dataUrl);
          } catch { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });

  const handleReferencePiecesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAnalyzingRefs(true);
    try {
      const newImages: string[] = await Promise.all(
        files.slice(0, 5).map(file => compressImage(file))
      );
      const allImages = [...(form.referencePiecesThumbnails || []), ...newImages].slice(0, 5);
      const res = await fetch('/api/analyze-references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: allImages }),
      });
      if (!res.ok) throw new Error('Error analizando piezas');
      const data = await res.json();
      setForm(f => ({
        ...f,
        referencePiecesThumbnails: allImages,
        referencePiecesStyle: data.styleDescription,
      }));
    } catch {
      alert('No se pudieron analizar las piezas. Intentá de nuevo.');
    } finally {
      setAnalyzingRefs(false);
      e.target.value = '';
    }
  };

  const removeReferencePiece = async (idx: number) => {
    const remaining = (form.referencePiecesThumbnails || []).filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      setForm(f => ({ ...f, referencePiecesThumbnails: [], referencePiecesStyle: undefined }));
      return;
    }
    setAnalyzingRefs(true);
    try {
      const res = await fetch('/api/analyze-references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: remaining }),
      });
      const data = await res.json();
      setForm(f => ({ ...f, referencePiecesThumbnails: remaining, referencePiecesStyle: data.styleDescription }));
    } finally {
      setAnalyzingRefs(false);
    }
  };

  const compressLogo = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const MAX = 512;
          let { naturalWidth: w, naturalHeight: h } = img;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });

  const handleLogoUpload = (variant: 'logoDark' | 'logoLight') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await compressLogo(file);
    setForm(f => ({ ...f, [variant]: dataUrl, ...(variant === 'logoDark' ? { logoBase64: undefined } : {}) }));
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.styleDescription.trim()) return;
    let kit: BrandKit;
    let updated: BrandKit[];
    if (editing) {
      kit = { ...form, id: editing.id };
      updated = clients.map(c => c.id === editing.id ? kit : c);
    } else {
      kit = { ...form, id: Math.random().toString(36).slice(2) };
      updated = [...clients, kit];
    }
    await persist(updated, kit);
    setSaved(true);
    setTimeout(() => { setShowForm(false); setSaved(false); }, 800);
  };

  const handleDelete = (id: string) => {
    persist(clients.filter(c => c.id !== id), null, id);
  };

  const allColors = (client: BrandKit) =>
    [client.primary1, client.primary2, client.primary3, client.secondary1, client.secondary2, client.secondary3];

  const colorFields: { key: keyof BrandKit; label: string }[] = [
    { key: 'primary1', label: 'P1' },
    { key: 'primary2', label: 'P2' },
    { key: 'primary3', label: 'P3' },
    { key: 'secondary1', label: 'S1' },
    { key: 'secondary2', label: 'S2' },
    { key: 'secondary3', label: 'S3' },
  ];

  return (
    <div className="min-h-screen bg-[#F0EBE3]">
      <header className="bg-[#111111] border-b border-white/10 px-6 py-4 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#FA5A1E] flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-semibold text-lg">Diseño AI</span>
        </div>
        <Link href="/" className="text-sm text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg">
          ← Generar
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-1">Clientes</h1>
            <p className="text-white/50 text-sm">Configurá el brand kit de cada cliente.</p>
          </div>
          <button
            onClick={openNew}
            className="bg-[#FA5A1E] hover:bg-[#FF912D] text-white font-medium px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo cliente
          </button>
        </div>

        {/* Client list */}
        {clients.length === 0 && !showForm ? (
          <div className="border border-dashed border-white/20 rounded-2xl p-12 text-center">
            <p className="text-white/40 mb-4">No hay clientes aún</p>
            <button onClick={openNew} className="text-[#FF912D] hover:text-[#FFB950] font-medium transition-colors">
              + Crear el primero
            </button>
          </div>
        ) : (
          <div className="space-y-3 mb-8">
            {clients.map(client => (
              <div key={client.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {client.logoBase64 ? (
                    <img src={client.logoBase64} alt={client.name} className="w-10 h-10 rounded-lg object-contain bg-white/10 p-1" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white/30 text-lg font-bold">
                      {client.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{client.name}</p>
                    <div className="flex gap-1 mt-1.5">
                      {allColors(client).map((c, i) => (
                        <div key={i} className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ backgroundColor: c }} title={c} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(client)} className="text-white/40 hover:text-white/70 p-2 rounded-lg hover:bg-white/5 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(client.id)} className="text-white/40 hover:text-red-400 p-2 rounded-lg hover:bg-white/5 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <label className={`cursor-pointer flex items-center gap-2 text-sm px-4 py-2 rounded-xl border transition-colors ${extracting ? 'opacity-50 cursor-not-allowed border-white/10 text-white/40' : 'border-[#FA5A1E]/40 text-[#FF912D] hover:bg-[#FA5A1E]/10 hover:border-[#FF912D]'}`}>
                {extracting ? (
                  <><div className="w-4 h-4 border-2 border-[#FF912D]/30 border-t-[#FF912D] rounded-full animate-spin" />Leyendo manual...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>Importar desde PDF</>
                )}
                <input type="file" accept=".pdf" onChange={handlePdfUpload} disabled={extracting} className="hidden" />
              </label>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <label className="text-sm text-white/60">Nombre del cliente</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Kayser"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] text-sm"
              />
            </div>

            {/* Colors */}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-white/60">Paleta primaria</label>
                <p className="text-xs text-white/30 mt-0.5">Los 3 colores principales de la marca</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(['primary1', 'primary2', 'primary3'] as const).map((key, i) => (
                  <div key={key} className="space-y-1.5">
                    <p className="text-xs text-white/40">{PRIMARY_LABELS[i]}</p>
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                      <input type="color" value={form[key] as string} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                      <span className="text-xs text-white/60 font-mono">{form[key] as string}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <label className="text-sm text-white/60">Paleta secundaria</label>
                <p className="text-xs text-white/30 mt-0.5">Colores complementarios</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(['secondary1', 'secondary2', 'secondary3'] as const).map((key, i) => (
                  <div key={key} className="space-y-1.5">
                    <p className="text-xs text-white/40">{SECONDARY_LABELS[i]}</p>
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                      <input type="color" value={form[key] as string} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                      <span className="text-xs text-white/60 font-mono">{form[key] as string}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Typography */}
            <div className="space-y-2">
              <label className="text-sm text-white/60">Tipografía</label>
              <input
                type="text"
                value={form.typography}
                onChange={e => setForm(f => ({ ...f, typography: e.target.value }))}
                placeholder="Ej: Peridot PE (principal), Peridot PE Wide (secundaria), Peridot PE Extended (complementaria)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] text-sm"
              />
            </div>

            {/* Style */}
            <div className="space-y-2">
              <label className="text-sm text-white/60">Estilo y reglas de marca</label>
              <textarea
                value={form.styleDescription}
                onChange={e => setForm(f => ({ ...f, styleDescription: e.target.value }))}
                placeholder="Estilo visual, tono, audiencia, reglas de uso del logo, guía de imágenes, prohibiciones, aplicaciones RRSS..."
                rows={5}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] resize-none text-sm leading-relaxed"
              />
            </div>

            {/* Reference pieces */}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-white/60">Piezas anteriores aprobadas</label>
                <p className="text-xs text-white/30 mt-0.5">GPT-4o analiza el estilo visual y lo usa como referencia en cada generación. Máx 5 piezas.</p>
              </div>
              <div className="flex gap-3 flex-wrap">
                {(form.referencePiecesThumbnails || []).map((img, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/10">
                    <img src={img} alt={`ref ${i+1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeReferencePiece(i)}
                      disabled={analyzingRefs}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center text-white/80 hover:text-white text-xs"
                    >×</button>
                  </div>
                ))}
                {(form.referencePiecesThumbnails || []).length < 5 && (
                  <label className={`w-20 h-20 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 transition-colors ${analyzingRefs ? 'opacity-50 cursor-not-allowed border-white/10' : 'border-white/20 hover:border-white/40 cursor-pointer'}`}>
                    {analyzingRefs ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="text-xs text-white/30">Pieza</span>
                      </>
                    )}
                    <input type="file" accept="image/*" multiple onChange={handleReferencePiecesUpload} disabled={analyzingRefs} className="hidden" />
                  </label>
                )}
              </div>
              {form.referencePiecesStyle && (
                <div className="bg-[#FA5A1E]/5 border border-[#FA5A1E]/20 rounded-xl p-3">
                  <p className="text-xs text-[#FF912D] font-medium mb-1">Estilo extraído</p>
                  <p className="text-xs text-white/50 leading-relaxed line-clamp-3">{form.referencePiecesStyle}</p>
                </div>
              )}
            </div>

            {/* Logos */}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-white/60">Logos</label>
                <p className="text-xs text-white/30 mt-0.5">La IA elige la versión correcta según el fondo de cada pieza y lo replica visualmente.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Dark logo */}
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Logo oscuro <span className="text-white/25">(fondos claros)</span></p>
                  <div className="bg-white rounded-xl p-3 flex items-center justify-center min-h-[80px] border border-black/10">
                    {(form.logoDark || form.logoBase64) ? (
                      <img src={form.logoDark || form.logoBase64} alt="Logo oscuro" className="max-h-16 max-w-full object-contain" />
                    ) : (
                      <span className="text-black/20 text-xs">Sin logo</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <label className="flex-1 cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60 hover:text-white transition-colors text-center">
                      {(form.logoDark || form.logoBase64) ? 'Cambiar' : 'Subir'}
                      <input type="file" accept="image/*" onChange={handleLogoUpload('logoDark')} className="hidden" />
                    </label>
                    {(form.logoDark || form.logoBase64) && (
                      <button
                        onClick={() => setForm(f => ({ ...f, logoDark: undefined, logoBase64: undefined }))}
                        className="text-white/30 hover:text-red-400 text-xs px-2 transition-colors"
                      >Quitar</button>
                    )}
                  </div>
                </div>

                {/* Light logo */}
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Logo blanco <span className="text-white/25">(fondos oscuros)</span></p>
                  <div className="bg-[#111111] rounded-xl p-3 flex items-center justify-center min-h-[80px] border border-white/10">
                    {form.logoLight ? (
                      <img src={form.logoLight} alt="Logo blanco" className="max-h-16 max-w-full object-contain" />
                    ) : (
                      <span className="text-white/20 text-xs">Sin logo</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <label className="flex-1 cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60 hover:text-white transition-colors text-center">
                      {form.logoLight ? 'Cambiar' : 'Subir'}
                      <input type="file" accept="image/*" onChange={handleLogoUpload('logoLight')} className="hidden" />
                    </label>
                    {form.logoLight && (
                      <button
                        onClick={() => setForm(f => ({ ...f, logoLight: undefined }))}
                        className="text-white/30 hover:text-red-400 text-xs px-2 transition-colors"
                      >Quitar</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick adjustments */}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-white/60">Ajustes rápidos del cliente</label>
                <p className="text-xs text-white/30 mt-0.5">Aparecen primero en el paso de afinación. Ej: "Fondo con textura industrial", "Logo en esquina superior".</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(form.quickAdjustments || []).map((adj, i) => (
                  <span key={i} className="flex items-center gap-1.5 bg-[#FA5A1E]/10 border border-[#FA5A1E]/30 text-[#FF912D] text-xs px-3 py-1.5 rounded-lg">
                    {adj}
                    <button
                      onClick={() => setForm(f => ({ ...f, quickAdjustments: (f.quickAdjustments || []).filter((_, idx) => idx !== i) }))}
                      className="text-[#FF912D]/60 hover:text-[#FF912D] ml-0.5"
                    >×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAdjustment}
                  onChange={e => setNewAdjustment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newAdjustment.trim()) {
                      setForm(f => ({ ...f, quickAdjustments: [...(f.quickAdjustments || []), newAdjustment.trim()] }));
                      setNewAdjustment('');
                    }
                  }}
                  placeholder="Escribí un ajuste y presioná Enter..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] text-sm"
                />
                <button
                  onClick={() => {
                    if (!newAdjustment.trim()) return;
                    setForm(f => ({ ...f, quickAdjustments: [...(f.quickAdjustments || []), newAdjustment.trim()] }));
                    setNewAdjustment('');
                  }}
                  disabled={!newAdjustment.trim()}
                  className="bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm transition-colors"
                >
                  + Agregar
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.styleDescription.trim()}
                className={`flex-1 font-medium px-4 py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  saved ? 'bg-green-600 text-white' : 'bg-[#FA5A1E] hover:bg-[#FF912D] disabled:opacity-40 disabled:cursor-not-allowed text-white'
                }`}
              >
                {saved ? (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Guardado</>
                ) : (
                  editing ? 'Guardar cambios' : 'Crear cliente'
                )}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-3 rounded-xl border border-white/10 hover:border-white/20 text-white/60 hover:text-white transition-colors text-sm">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
