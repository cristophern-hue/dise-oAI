'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { BrandKit, GeneratedImage, Step, PeopleMode } from './types';
import ImageCard from './components/ImageCard';
import StepIndicator from './components/StepIndicator';
import LoadingGrid from './components/LoadingGrid';
import SessionDrawer from './components/SessionDrawer';
import { dbSaveSession, dbGetAllSessions, dbDeleteSession, type SavedSession } from './lib/db';
import { compressImagesForStorage, compressBase64ForStorage } from './lib/compressForStorage';

const LAST_SESSION_KEY = 'disenoai_last_session_id';

export default function Home() {
  const [clients, setClients] = useState<BrandKit[]>([]);
  const [selectedClient, setSelectedClient] = useState<BrandKit | null>(null);
  const [brief, setBrief] = useState('');
  const [clientRequest, setClientRequest] = useState('');
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [productUrl, setProductUrl] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);

  const [showDrawer, setShowDrawer] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [adaptFormats, setAdaptFormats] = useState<string[]>([]);
  const [adaptedImages, setAdaptedImages] = useState<{ format: string; label: string; conceptId: string; base64: string }[]>([]);
  const [generatingAdaptations, setGeneratingAdaptations] = useState(false);
  const [step, setStep] = useState<Step>('brief');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const loadingStartRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState('');

  const [peopleMode, setPeopleMode] = useState<PeopleMode>('none');
  const [productDetailImages, setProductDetailImages] = useState<string[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [kvMode, setKvMode] = useState(false);
  const [kvReferenceImage, setKvReferenceImage] = useState<string | null>(null);

  const [concepts, setConcepts] = useState<GeneratedImage[]>([]);
  const [generatingCount, setGeneratingCount] = useState(0);
  const [conceptCount, setConceptCount] = useState(6);
  const [selectedConcepts, setSelectedConcepts] = useState<GeneratedImage[]>([]);
  const [refineIndex, setRefineIndex] = useState(0);
  const [productDescription, setProductDescription] = useState('');
  const [personDescription, setPersonDescription] = useState('');

  const [refineImage, setRefineImage] = useState<GeneratedImage | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineHistory, setRefineHistory] = useState<string[]>([]);
  const [refineImageHistory, setRefineImageHistory] = useState<string[]>([]);
  const refineInputRef = useRef<HTMLInputElement>(null);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);


  const startLoading = (msg: string) => {
    setLoading(true);
    setLoadingMsg(msg);
    setElapsedSec(0);
    loadingStartRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
  };

  const stopLoading = () => {
    setLoading(false);
    setLoadingMsg('');
    setElapsedSec(0);
    if (loadingStartRef.current) { clearInterval(loadingStartRef.current); loadingStartRef.current = null; }
  };

  // brand-kits are loaded by the combined useEffect below alongside sessions

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
      setProductDetailImages(prev => prev.length < 4 ? [...prev, png] : prev);
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

  const parseConceptStream = async (res: Response, onImage: (img: GeneratedImage) => Promise<void>): Promise<{ productDescription: string; personDescription: string }> => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let productDesc = '';
    let personDesc = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(part.slice(6));
          if (data.image) await onImage(data.image);
          if (data.done) { productDesc = data.productDescription || ''; personDesc = data.personDescription || ''; }
        } catch { /* ignore malformed chunk */ }
      }
    }
    return { productDescription: productDesc, personDescription: personDesc };
  };

  const generateConcepts = async () => {
    if (!selectedClient || !brief.trim()) return;
    if (kvMode && !kvReferenceImage) return;
    const count = kvMode ? 5 : conceptCount;
    setGeneratingCount(count);
    setConcepts([]);
    setSelectedConcepts([]);
    setProductDescription('');
    setPersonDescription('');
    setStep('concepts');
    startLoading(kvMode ? 'Reciclando KV...' : 'Generando conceptos...');
    setError('');
    try {
      const compressedProductImages = await Promise.all(productDetailImages.map(compressBase64ForStorage));
      const res = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          brandKit: selectedClient,
          peopleMode,
          productDetailImages: compressedProductImages,
          referenceImages,
          ...(kvMode && kvReferenceImage ? { styleReferenceImages: [kvReferenceImage], count: 5 } : { count: conceptCount }),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      let received = 0;
      const { productDescription: pd, personDescription: prd } = await parseConceptStream(res, async img => {
        received++;
        setConcepts(prev => [...prev, img]);
      });
      setGeneratingCount(received); // sync counter to actual received so progress shows 100%
      setProductDescription(pd);
      setPersonDescription(prd);
      if (received === 0) setError('No se generaron imágenes. Revisá que el brief no esté vacío y volvé a intentar.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando conceptos');
      setStep('brief');
    } finally {
      stopLoading();
    }
  };

  const generateSimilar = async () => {
    if (selectedConcepts.length === 0 || !selectedClient || !brief.trim()) return;
    const newCount = Math.max(conceptCount, concepts.length) - selectedConcepts.length;
    if (newCount <= 0) return;
    const pinned = [...selectedConcepts];
    setGeneratingCount(conceptCount);
    setConcepts([...pinned]);
    startLoading(`Generando ${newCount} similar${newCount > 1 ? 'es' : ''}...`);
    setError('');
    try {
      const compressedRefs = await Promise.all(pinned.map(c => compressBase64ForStorage(c.base64)));
      const compressedProductImages = await Promise.all(productDetailImages.map(compressBase64ForStorage));
      const res = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          brandKit: selectedClient,
          peopleMode,
          productDetailImages: compressedProductImages,
          referenceImages,
          styleReferenceImages: compressedRefs,
          count: newCount,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      let added = 0;
      const { productDescription: pd } = await parseConceptStream(res, async img => {
        added++;
        setConcepts(prev => [...prev, img]);
      });
      if (pd && !productDescription) setProductDescription(pd);
      if (added === 0) setError('No se pudieron generar variaciones. Intentá de nuevo o usá Regenerar para empezar desde cero.');
      else setSelectedConcepts([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando similares');
    } finally {
      stopLoading();
    }
  };

  const generateBrief = async () => {
    if (!clientRequest.trim()) return;
    setGeneratingBrief(true);
    try {
      const res = await fetch('/api/generate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRequest, brandKit: selectedClient }),
      });
      if (!res.ok) throw new Error('Error generando brief');
      const data = await res.json();
      setBrief(data.brief || '');
    } catch {
      setError('No se pudo generar el brief. Escribilo manualmente.');
    } finally {
      setGeneratingBrief(false);
    }
  };

  const scrapeProductUrl = async () => {
    if (!productUrl.trim()) return;
    setScrapingUrl(true);
    try {
      const res = await fetch('/api/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error leyendo URL');
      }
      const data = await res.json();
      setBrief(data.brief || '');
      setProductUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la URL del producto.');
    } finally {
      setScrapingUrl(false);
    }
  };

  const generateAdaptations = async () => {
    if (adaptFormats.length === 0 || selectedConcepts.length === 0) return;
    setGeneratingAdaptations(true);
    setAdaptedImages([]);
    const FORMAT_LABELS: Record<string, string> = {
      story: 'Story 9:16', feed45: 'Feed 4:5', square: 'Cuadrado 1:1', landscape: 'Landscape 16:9',
      pmax_square: 'PMax 1:1', pmax_landscape: 'PMax 1.91:1', pmax_portrait: 'PMax 4:5',
      banner_desktop: 'Banner Desktop', banner_mobile: 'Banner Mobile', webpush: 'Webpush',
      mailing: 'Mailing',
    };
    try {
      const tasks = selectedConcepts.flatMap(concept =>
        adaptFormats.map(format => ({ concept, format }))
      );
      const results = await Promise.all(
        tasks.map(async ({ concept, format }) => {
          const res = await fetch('/api/adapt-size', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: concept.base64, format }),
          });
          if (!res.ok) return null;
          const data = await res.json();
          if (!data.base64) return null;
          return { format, label: FORMAT_LABELS[format] || format, conceptId: concept.id, base64: data.base64 };
        })
      );
      setAdaptedImages(results.filter(Boolean) as { format: string; label: string; conceptId: string; base64: string }[]);
    } catch {
      setError('Error generando adaptaciones');
    } finally {
      setGeneratingAdaptations(false);
    }
  };

  const toggleConceptSelection = (img: GeneratedImage) => {
    setSelectedConcepts(prev =>
      prev.find(c => c.id === img.id) ? prev.filter(c => c.id !== img.id) : [...prev, img]
    );
  };

  const enterRefine = async () => {
    if (selectedConcepts.length === 0) return;
    const isProductEcommerce = peopleMode === 'none' && productDetailImages.length > 0;
    // Only run apply-product in 'real' fashion mode — product already embedded in e-commerce mode
    if (productDetailImages.length > 0 && peopleMode === 'real') {
      const total = selectedConcepts.length;
      setApplyProgress({ done: 0, total });
      startLoading(`Aplicando producto...`);
      setError('');
      try {
        // Sequential — Responses API can't handle many concurrent requests
        const results: { concept: typeof selectedConcepts[0]; applied: boolean }[] = [];
        for (const concept of selectedConcepts) {
          const res = await fetch('/api/apply-product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conceptImageBase64: concept.base64,
              productDetailImages,
              productDescription,
              peopleMode,
              personDescription,
              conceptName: concept.conceptName,
            }),
          });
          const result = res.ok
            ? await res.json().then(async (data: { base64?: string; applied?: boolean; appliedVia?: string }) => {
                console.log(`apply-product [${concept.conceptName}]: applied=${data.applied} via=${data.appliedVia}`);
                return {
                  concept: { ...concept, base64: data.base64 || concept.base64 },
                  applied: data.applied === true,
                };
              })
            : { concept, applied: false };
          setApplyProgress(p => p ? { ...p, done: p.done + 1 } : p);
          results.push(result);
        }
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
        stopLoading();
        setApplyProgress(null);
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
    startLoading('Aplicando ajuste...');
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
      stopLoading();
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
    setKvMode(false);
    setKvReferenceImage(null);
    setCurrentSessionId(null);
    localStorage.removeItem(LAST_SESSION_KEY);
  };

  const regenerateConcepts = async () => {
    setSelectedConcepts([]);
    setRefineIndex(0);
    await generateConcepts();
  };

  const applySessionData = useCallback((d: Record<string, unknown>, allClients: BrandKit[]) => {
    setBrief((d.brief as string) || '');
    setClientRequest((d.clientRequest as string) || '');
    setPeopleMode((d.peopleMode as PeopleMode) || 'none');
    const restored = (d.selectedConcepts as GeneratedImage[]) || [];
    // concepts array is not persisted (too large); restore grid from selectedConcepts
    setConcepts(restored);
    setSelectedConcepts(restored);
    setProductDescription((d.productDescription as string) || '');
    setPersonDescription((d.personDescription as string) || '');
    setRefineImage((d.refineImage as GeneratedImage | null) || null);
    setRefineHistory((d.refineHistory as string[]) || []);
    setRefineImageHistory((d.refineImageHistory as string[]) || []);
    setRefineIndex((d.refineIndex as number) || 0);
    setProductDetailImages((d.productDetailImages as string[]) || []);
    setReferenceImages((d.referenceImages as string[]) || []);
    setAdaptFormats((d.adaptFormats as string[]) || []);
    setAdaptedImages((d.adaptedImages as { format: string; label: string; conceptId: string; base64: string }[]) || []);
    const cid = d.selectedClientId as string | null;
    if (cid) {
      const found = allClients.find(k => k.id === cid);
      if (found) setSelectedClient(found);
    } else {
      setSelectedClient(null);
    }
    const s = (d.step as string) || 'brief';
    setStep((s === 'adjust' ? 'refine' : s) as Step);
  }, []);

  // Load brand kits + sessions on mount, restore last active session
  useEffect(() => {
    Promise.all([
      fetch('/api/brand-kits').then(r => r.json()).catch(() => []),
      dbGetAllSessions().catch(() => []),
    ]).then(([allClients, sessions]: [BrandKit[], SavedSession[]]) => {
      setClients(allClients);
      setSavedSessions(sessions);
      const lastId = localStorage.getItem(LAST_SESSION_KEY);
      if (lastId) {
        const last = sessions.find(s => s.id === lastId);
        if (last) {
          setCurrentSessionId(last.id);
          applySessionData(last.data, allClients);
        }
      }
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to IndexedDB (debounced 1.5s) whenever state changes
  useEffect(() => {
    if (step === 'brief' && !brief.trim() && !selectedClient) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        setCurrentSessionId(sessionId);
        localStorage.setItem(LAST_SESSION_KEY, sessionId);
      }

      const now = new Date().toISOString();
      // Compress all base64 images before saving to stay under Vercel's 4MB body limit.
      const [compSelectedConcepts, compProductImages, compRefineHistory, compAdaptedImages, compReferenceImages] = await Promise.all([
        compressImagesForStorage(selectedConcepts),
        Promise.all(productDetailImages.map(compressBase64ForStorage)),
        Promise.all(refineImageHistory.map(compressBase64ForStorage)),
        compressImagesForStorage(adaptedImages),
        Promise.all(referenceImages.map(compressBase64ForStorage)),
      ]);
      const compRefineImage = refineImage
        ? { ...refineImage, base64: await compressBase64ForStorage(refineImage.base64) }
        : null;
      const data = {
        step, brief, clientRequest,
        selectedClientId: selectedClient?.id || null,
        peopleMode, selectedConcepts: compSelectedConcepts,
        productDescription, personDescription,
        refineImage: compRefineImage, refineHistory, refineImageHistory: compRefineHistory,
        refineIndex, productDetailImages: compProductImages, referenceImages: compReferenceImages,
        adaptFormats, adaptedImages: compAdaptedImages,
      };

      setSavedSessions(prev => {
        const existing = prev.find(s => s.id === sessionId);
        const updated: SavedSession = {
          id: sessionId!,
          clientName: selectedClient?.name || 'Sin cliente',
          clientId: selectedClient?.id || null,
          step,
          brief,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          data,
        };
        dbSaveSession(updated).catch(console.error);
        localStorage.setItem(LAST_SESSION_KEY, sessionId!);
        const rest = prev.filter(s => s.id !== sessionId);
        return [updated, ...rest];
      });
    }, 1500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, brief, selectedClient, peopleMode, concepts, selectedConcepts, productDescription, personDescription, refineIndex, refineImage, refineHistory, refineImageHistory, adaptFormats, adaptedImages]);

  const newSession = () => {
    setCurrentSessionId(null);
    localStorage.removeItem(LAST_SESSION_KEY);
    setStep('brief');
    setBrief('');
    setClientRequest('');
    setSelectedClient(null);
    setPeopleMode('none');
    setConcepts([]);
    setSelectedConcepts([]);
    setProductDescription('');
    setPersonDescription('');
    setRefineImage(null);
    setRefineHistory([]);
    setRefineImageHistory([]);
    setRefineIndex(0);
    setProductDetailImages([]);
    setReferenceImages([]);
    setKvMode(false);
    setKvReferenceImage(null);
    setAdaptFormats([]);
    setAdaptedImages([]);
    setError('');
  };

  const loadSessionFromDrawer = useCallback((s: SavedSession) => {
    setCurrentSessionId(s.id);
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    applySessionData(s.data, clients);
  }, [clients, applySessionData]);

  const deleteSessionFromDrawer = async (id: string) => {
    await dbDeleteSession(id);
    setSavedSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) newSession();
  };

  const exportSession = () => {
    const session = {
      step, brief,
      selectedClientId: selectedClient?.id || null,
      peopleMode, concepts, selectedConcepts,
      productDescription, personDescription,
      refineImage, refineHistory, refineImageHistory,
    };
    const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sesion-${selectedClient?.name || 'disenoai'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const importSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const s = JSON.parse(reader.result as string);
        // If brand kits haven't loaded yet, fetch them now so the client can be matched
        const currentClients = clients.length > 0
          ? clients
          : await fetch('/api/brand-kits').then(r => r.json()).catch(() => []);
        if (currentClients.length > 0 && clients.length === 0) setClients(currentClients);
        applySessionData(s, currentClients);
      } catch { setError('No se pudo importar la sesión — archivo inválido.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-[#F0EBE3]">
      <SessionDrawer
        open={showDrawer}
        sessions={savedSessions}
        currentId={currentSessionId}
        onClose={() => setShowDrawer(false)}
        onLoad={loadSessionFromDrawer}
        onDelete={deleteSessionFromDrawer}
        onNew={newSession}
      />

      {/* Header */}
      <header className="bg-[#111111] border-b border-white/10 px-6 py-4 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDrawer(true)}
            title="Biblioteca de sesiones"
            className="w-8 h-8 rounded-lg bg-[#FA5A1E] hover:bg-[#FF912D] transition-colors flex items-center justify-center relative"
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            {savedSessions.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#FF912D] rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                {savedSessions.length > 9 ? '9+' : savedSessions.length}
              </span>
            )}
          </button>
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
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold mb-2">{kvMode ? 'Reciclar KV' : 'Nueva pieza'}</h1>
                <p className="text-white/50">{kvMode ? 'Generá variaciones basadas en un KV aprobado.' : 'Seleccioná el cliente y escribí el brief de la campaña.'}</p>
              </div>
              {/* Mode tabs */}
              <div className="flex gap-1 p-1 bg-white/5 border border-white/10 rounded-xl self-start">
                <button
                  onClick={() => { setKvMode(false); setKvReferenceImage(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${!kvMode ? 'bg-[#FA5A1E] text-white shadow-sm' : 'text-white/50 hover:text-white/70'}`}
                >
                  Nueva pieza
                </button>
                <button
                  onClick={() => setKvMode(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${kvMode ? 'bg-[#FA5A1E] text-white shadow-sm' : 'text-white/50 hover:text-white/70'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reciclar KV
                </button>
              </div>
            </div>

            {/* Client selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Cliente</label>
              {clients.length === 0 ? (
                <div className="border border-dashed border-white/20 rounded-xl p-6 text-center">
                  <p className="text-white/40 text-sm mb-3">No hay clientes configurados</p>
                  <Link href="/config" className="text-[#FF912D] hover:text-[#FFB950] text-sm font-medium">
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
                          ? 'border-[#FF912D] bg-[#FA5A1E]/10'
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
                        <p className="text-xs text-[#FF912D] mt-1">✓ {client.referencePiecesThumbnails?.length || 0} piezas ref.</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Brief generator */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Generar brief desde...</label>

              {/* From client message */}
              <div className="flex gap-2 items-start">
                <textarea
                  value={clientRequest}
                  onChange={e => setClientRequest(e.target.value)}
                  placeholder="Mensaje del cliente: 'Hola! Necesito algo para el lanzamiento de nuestra colección de verano...'"
                  rows={2}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] resize-none text-sm leading-relaxed"
                />
                <button
                  onClick={generateBrief}
                  disabled={!clientRequest.trim() || generatingBrief || scrapingUrl}
                  className="shrink-0 bg-[#FA5A1E]/80 hover:bg-[#FA5A1E] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  {generatingBrief ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generando...</>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Desde mensaje
                    </>
                  )}
                </button>
              </div>

              {/* From product URL */}
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 hover:border-white/20 focus-within:border-[#FF912D] rounded-xl px-4 py-2.5 transition-colors">
                  <svg className="w-3.5 h-3.5 text-white/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <input
                    type="url"
                    value={productUrl}
                    onChange={e => setProductUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && scrapeProductUrl()}
                    placeholder="URL del producto (ej: tienda.com/producto)"
                    className="flex-1 bg-transparent text-white placeholder-white/25 focus:outline-none text-sm"
                  />
                </div>
                <button
                  onClick={scrapeProductUrl}
                  disabled={!productUrl.trim() || scrapingUrl || generatingBrief}
                  className="shrink-0 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white/80 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  {scrapingUrl ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Leyendo...</>
                  ) : (
                    <>Leer producto</>
                  )}
                </button>
              </div>
              <p className="text-xs text-white/30">GPT-4o analiza el mensaje o scrapeá el producto desde su URL para generar el brief.</p>
            </div>

            {/* Brief input */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Brief de campaña</label>
              <textarea
                value={brief}
                onChange={e => setBrief(e.target.value)}
                placeholder="El brief aparecerá acá. También podés escribirlo directamente."
                rows={5}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] resize-none text-sm leading-relaxed"
              />
              <p className="text-xs text-white/30">Editá el brief antes de generar los conceptos.</p>
            </div>

            {/* People mode */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/70">Personas en la imagen</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'none', label: 'PRODUCTO', desc: 'Anuncio centrado en un producto físico', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                  { value: 'real', label: 'FASHION', desc: 'Prendas y moda con personas usando el producto', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                  { value: 'corporate', label: 'CORPORATIVO', desc: 'Agencias, bancos, servicios y empresas B2B', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 00-1-1h-2a1 1 0 00-1 1v5m4 0H9' },
                  { value: 'events', label: 'EVENTOS', desc: 'Conferencias, webinars, workshops y lanzamientos', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setPeopleMode(opt.value); if (opt.value !== 'real') setReferenceImages([]); if (opt.value === 'corporate' || opt.value === 'events') setProductDetailImages([]); }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      peopleMode === opt.value
                        ? 'border-[#FF912D] bg-[#FA5A1E]/10'
                        : 'border-white/10 hover:border-white/20 bg-white/5'
                    }`}
                  >
                    <svg className={`w-5 h-5 mb-2 ${peopleMode === opt.value ? 'text-[#FF912D]' : 'text-white/40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={opt.icon} />
                    </svg>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Product detail upload — hidden in corporate and events modes */}
              {peopleMode !== 'corporate' && peopleMode !== 'events' && <div className="space-y-2">
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
                  {productDetailImages.length < 4 && (
                    <label className="w-20 h-20 rounded-xl border border-dashed border-white/20 hover:border-white/40 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1">
                      <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-xs text-white/30">Foto</span>
                      <input type="file" accept="image/*" multiple onChange={handleProductDetailUpload} className="hidden" />
                    </label>
                  )}
                </div>
              </div>}

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

            {/* KV upload — only shown in Reciclar KV mode */}
            {kvMode && (
              <div className="border-2 border-dashed border-[#FA5A1E]/40 rounded-2xl p-6 space-y-4 bg-[#FA5A1E]/3">
                <div>
                  <p className="text-sm font-medium text-[#FF912D] mb-1">KV de referencia</p>
                  <p className="text-xs text-white/40">Subí el KV aprobado. Se generarán 5 variaciones que mantienen su línea gráfica adaptadas al brief de arriba.</p>
                </div>
                {kvReferenceImage ? (
                  <div className="flex items-center gap-4">
                    <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-[#FA5A1E]/40 shrink-0">
                      <img src={`data:image/png;base64,${kvReferenceImage}`} alt="KV referencia" className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-[#FF912D]">KV cargado</p>
                      <p className="text-xs text-white/40">Se generarán 5 variaciones de este estilo adaptadas al brief.</p>
                      <button
                        onClick={() => setKvReferenceImage(null)}
                        className="text-xs text-white/30 hover:text-red-400 transition-colors"
                      >Quitar KV</button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-3 py-8 rounded-xl border border-dashed border-[#FA5A1E]/30 hover:border-[#FF912D] cursor-pointer transition-colors bg-white/3">
                    <svg className="w-8 h-8 text-[#FF912D]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm text-[#FF912D]/80 font-medium">Subí el KV aprobado</p>
                      <p className="text-xs text-white/30 mt-0.5">PNG, JPG, WEBP</p>
                    </div>
                    <input type="file" accept="image/*" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const png = await readAsPng(file);
                      setKvReferenceImage(png.split(',')[1] || png);
                      e.target.value = '';
                    }} className="hidden" />
                  </label>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {!kvMode && (
                <div className="flex items-center gap-1 bg-[#111111]/60 border border-white/10 rounded-xl px-1 py-1">
                  {[2, 3, 4, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => setConceptCount(n)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${conceptCount === n ? 'bg-[#FA5A1E] text-white' : 'text-white/40 hover:text-white/70'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={generateConcepts}
                disabled={!selectedClient || !brief.trim() || loading || (kvMode && !kvReferenceImage)}
                className="bg-[#FA5A1E] hover:bg-[#FF912D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {loadingMsg}{elapsedSec > 5 ? ` · ${elapsedSec}s` : ''}
                  </>
                ) : kvMode ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reciclar KV → 5 conceptos
                  </>
                ) : (
                  <>
                    Generar {conceptCount} concepto{conceptCount !== 1 ? 's' : ''}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
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

            <>
                {/* Generation progress bar */}
                {(loading || (generatingCount > 0 && concepts.length >= generatingCount)) && (
                  <div className={`border rounded-xl px-4 py-3 space-y-2.5 transition-colors ${concepts.length >= generatingCount && generatingCount > 0 ? 'bg-green-900/20 border-green-500/20' : 'bg-[#111111]/60 border-white/10'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {concepts.length >= generatingCount && generatingCount > 0 ? (
                          <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <div className="w-3.5 h-3.5 border-2 border-[#FF912D]/40 border-t-[#FF912D] rounded-full animate-spin shrink-0" />
                        )}
                        <span className="text-sm text-white/80">
                          {concepts.length === 0
                            ? 'Analizando brief y diseñando conceptos...'
                            : concepts.length >= generatingCount
                              ? `${generatingCount} concepto${generatingCount !== 1 ? 's' : ''} listo${generatingCount !== 1 ? 's' : ''}`
                              : `${concepts.length} de ${generatingCount} concepto${concepts.length !== 1 ? 's' : ''} listo${concepts.length !== 1 ? 's' : ''}...`}
                        </span>
                      </div>
                      <span className="text-xs text-white/30 tabular-nums">{elapsedSec}s</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#FA5A1E] to-[#FF912D] rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${generatingCount > 0 ? Math.max(4, (concepts.length / generatingCount) * 100) : 4}%` }}
                      />
                    </div>
                    {concepts.length === 0 && (
                      <p className="text-xs text-white/30">GPT-4o diseña los conceptos → gpt-image-2 los genera en paralelo</p>
                    )}
                  </div>
                )}

                {/* Apply-product progress bar */}
                {applyProgress && (
                  <div className="bg-[#111111]/60 border border-[#FA5A1E]/20 rounded-xl px-4 py-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3.5 h-3.5 border-2 border-[#FF912D]/40 border-t-[#FF912D] rounded-full animate-spin shrink-0" />
                        <span className="text-sm text-white/80">
                          Aplicando producto — {applyProgress.done} de {applyProgress.total} listo{applyProgress.done !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span className="text-xs text-white/30 tabular-nums">{elapsedSec}s</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#FA5A1E] to-[#FF912D] rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${Math.max(4, (applyProgress.done / applyProgress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

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
                          <div className="absolute top-2 left-2 w-6 h-6 bg-[#FF912D] rounded-full flex items-center justify-center text-xs font-bold text-white">
                            {selIdx + 1}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {loading && Array.from({ length: Math.max(0, generatingCount - concepts.length) }).map((_, i) => (
                    <div key={`skeleton-${i}`} className="aspect-[2/3] rounded-xl border border-white/10 bg-white/5 animate-pulse flex flex-col justify-end p-3 gap-2">
                      <div className="flex items-center justify-center flex-1">
                        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      </div>
                      <div className="h-2.5 bg-white/20 rounded-full w-2/3" />
                    </div>
                  ))}
                </div>

                {/* Product description editor — only for fashion/person mode; e-commerce uses images.edit directly */}
                {productDetailImages.length > 0 && peopleMode !== 'none' && (
                  <div className="space-y-2 border border-[#FA5A1E]/20 bg-[#FA5A1E]/5 rounded-xl p-4">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-[#FF912D] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs font-medium text-[#FFB950]">Descripción del producto — editala antes de afinar para mejorar la fidelidad</p>
                    </div>
                    <textarea
                      value={productDescription}
                      onChange={e => setProductDescription(e.target.value)}
                      rows={5}
                      placeholder="La IA no pudo generar una descripción automática. Describí el producto manualmente: tipo de prenda, color, estampado, detalles..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/80 text-xs leading-relaxed focus:outline-none focus:border-[#FF912D] resize-none placeholder-white/20"
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
                    {selectedConcepts.length > 0 && selectedConcepts.length < Math.max(conceptCount, concepts.length) && (
                      <button
                        onClick={generateSimilar}
                        disabled={loading}
                        title="Genera variaciones que siguen la línea visual de los seleccionados"
                        className="text-white/50 hover:text-white/80 text-sm border border-white/10 hover:border-[#FA5A1E]/50 hover:text-[#FF912D] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Generar {Math.max(conceptCount, concepts.length) - selectedConcepts.length} similares
                      </button>
                    )}
                  </div>
                  <button
                    onClick={enterRefine}
                    disabled={selectedConcepts.length === 0 || loading}
                    className="bg-[#FA5A1E] hover:bg-[#FF912D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
                  >
                    {loading ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{loadingMsg}{elapsedSec > 5 ? ` · ${elapsedSec}s` : ''}</>
                    ) : (
                      <>Afinar {selectedConcepts.length > 1 ? `${selectedConcepts.length} conceptos` : 'concepto'}<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg></>
                    )}
                  </button>
                </div>
            </>
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
                    <span className="ml-3 text-base font-normal text-[#FF912D]">{refineIndex + 1} de {selectedConcepts.length}</span>
                  )}
                </h2>
                <p className="text-white/50 text-sm">{refineImage.conceptName}</p>
              </div>
              <button
                onClick={() => {
                  if (refineIndex > 0) {
                    const updated = selectedConcepts.map((c, i) => i === refineIndex ? refineImage! : c);
                    setSelectedConcepts(updated);
                    const prev = refineIndex - 1;
                    setRefineIndex(prev);
                    setRefineImage(updated[prev]);
                    setRefineHistory([]);
                    setRefineImageHistory([]);
                  } else {
                    setStep('concepts');
                  }
                }}
                className="text-white/40 hover:text-white/70 text-sm transition-colors"
              >
                ← Volver
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              {/* Image preview */}
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden border border-white/10 relative">
                  <img
                    src={`data:image/png;base64,${refineImage.base64}`}
                    alt="Concepto"
                    className={`w-full transition-all duration-300 ${loading ? 'blur-sm scale-[1.02]' : ''}`}
                  />
                  {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px]">
                      <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin mb-2" style={{ borderWidth: '3px' }} />
                      <p className="text-[#ffffff] text-sm font-medium">{loadingMsg || 'Aplicando...'}</p>
                      {elapsedSec > 3 && <p className="text-[#ffffff]/60 text-xs mt-1">{elapsedSec}s</p>}
                    </div>
                  )}
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
                          <span className="text-[#FF912D] mt-0.5">✓</span>{h}
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
                      ...(selectedClient?.quickAdjustments || []),
                      ...(productDetailImages.length > 0 && peopleMode === 'none'
                        ? [
                            'Fondo más oscuro',
                            'Fondo blanco limpio',
                            'Fondo con textura industrial',
                            'Más contraste',
                            'Producto más grande',
                            'Producto centrado',
                            'Agregar sombra al producto',
                            'Composición más minimalista',
                            'Agregar texto del evento',
                            'Resaltar detalles del producto',
                            'Colores más vibrantes',
                            'Agregar texto de marca',
                          ]
                        : [
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
                          ]
                      ),
                    ].map((preset, i) => {
                      const isClientPreset = i < (selectedClient?.quickAdjustments?.length || 0);
                      return (
                        <button
                          key={`${preset}-${i}`}
                          onClick={() => setRefineInput(preset)}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors border ${
                            isClientPreset
                              ? 'bg-[#FA5A1E]/10 border-[#FA5A1E]/30 text-[#FF912D] hover:bg-[#FA5A1E]/20'
                              : 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-[#FA5A1E]/50 text-white/60 hover:text-white'
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#FF912D] text-sm disabled:opacity-50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={applyRefinement}
                      disabled={!refineInput.trim() || loading}
                      className="flex-1 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{elapsedSec > 0 ? `${elapsedSec}s...` : 'Aplicando...'}</> : 'Aplicar'}
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
                      className="flex-1 bg-[#FA5A1E] hover:bg-[#FF912D] disabled:opacity-40 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
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
                      className="flex-1 bg-[#FA5A1E] hover:bg-[#FF912D] disabled:opacity-40 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
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
                className="bg-[#FA5A1E] hover:bg-[#FF912D] text-white font-medium px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
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

            {/* Adaptaciones de tamaño */}
            <div className="border-t border-white/10 pt-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold mb-1">Adaptaciones de tamaño</h3>
                  <p className="text-white/40 text-sm">Generá los mismos conceptos en otros formatos para distintas plataformas.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setAdaptFormats(['story','feed45','square','landscape','pmax_square','pmax_landscape','pmax_portrait','banner_desktop','banner_mobile','webpush','mailing'])}
                    className="text-xs text-[#FF912D] hover:text-[#FFB950] border border-[#FA5A1E]/30 hover:border-[#FF912D] px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Todos
                  </button>
                  {adaptFormats.length > 0 && (
                    <button
                      onClick={() => setAdaptFormats([])}
                      className="text-xs text-white/40 hover:text-white/70 border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
              {[
                { group: 'RRSS', items: [
                  { key: 'story', label: 'Story 9:16', desc: 'Instagram / TikTok / Reels' },
                  { key: 'feed45', label: 'Feed 4:5', desc: 'Instagram / Facebook' },
                  { key: 'square', label: 'Cuadrado 1:1', desc: 'Instagram / Facebook' },
                  { key: 'landscape', label: 'Landscape 16:9', desc: 'Facebook / YouTube' },
                ]},
                { group: 'Google Ads / PMax', items: [
                  { key: 'pmax_square', label: '1:1', desc: 'PMax · Display' },
                  { key: 'pmax_landscape', label: '1.91:1', desc: 'PMax · Display' },
                  { key: 'pmax_portrait', label: '4:5', desc: 'PMax · Display' },
                ]},
                { group: 'Banners & Email', items: [
                  { key: 'banner_desktop', label: 'Banner Desktop', desc: '1950×450 web' },
                  { key: 'banner_mobile', label: 'Banner Mobile', desc: '800×800' },
                  { key: 'webpush', label: 'Webpush', desc: '720×360' },
                  { key: 'mailing', label: 'Mailing', desc: '600×alto email' },
                ]},
              ].map(({ group, items }) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">{group}</p>
                  <div className="flex flex-wrap gap-3">
                {items.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setAdaptFormats(prev => prev.includes(f.key) ? prev.filter(x => x !== f.key) : [...prev, f.key])}
                    className={`px-4 py-2.5 rounded-xl border text-left transition-all ${
                      adaptFormats.includes(f.key)
                        ? 'border-[#FF912D] bg-[#FA5A1E]/10'
                        : 'border-white/10 hover:border-white/20 bg-white/5'
                    }`}
                  >
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-white/40">{f.desc}</p>
                  </button>
                ))}
                  </div>
                </div>
              ))}
              <button
                onClick={generateAdaptations}
                disabled={adaptFormats.length === 0 || generatingAdaptations}
                className="bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 text-sm"
              >
                {generatingAdaptations ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generando adaptaciones...</>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Generar {adaptFormats.length > 0 ? `${adaptFormats.length} formato${adaptFormats.length > 1 ? 's' : ''} × ${selectedConcepts.length} concepto${selectedConcepts.length > 1 ? 's' : ''}` : 'adaptaciones'}
                  </>
                )}
              </button>

              {adaptedImages.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Adaptaciones generadas</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {adaptedImages.map((img, i) => {
                      const concept = selectedConcepts.find(c => c.id === img.conceptId);
                      return (
                        <div key={i} className="space-y-2">
                          <div className="rounded-xl overflow-hidden border border-white/10">
                            <img src={`data:image/png;base64,${img.base64}`} alt={img.label} className="w-full" />
                          </div>
                          <p className="text-xs text-white/50 text-center">{img.label} · {concept?.conceptName || ''}</p>
                          <button
                            onClick={() => {
                              const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(img.base64), c => c.charCodeAt(0))], { type: 'image/png' }));
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${selectedClient?.name || 'concepto'}-${img.label.replace(/\s+/g, '-')}-${i + 1}.png`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              setTimeout(() => URL.revokeObjectURL(url), 5000);
                            }}
                            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Descargar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
