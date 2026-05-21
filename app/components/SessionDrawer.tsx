'use client';

import { SavedSession } from '@/app/lib/db';

const STEP_LABELS: Record<string, string> = {
  brief: 'Brief',
  concepts: 'Conceptos',
  refine: 'Afinación',
  done: 'Listo',
};

const STEP_COLORS: Record<string, string> = {
  brief: 'bg-white/10 text-white/40',
  concepts: 'bg-blue-500/20 text-blue-400',
  refine: 'bg-indigo-500/20 text-indigo-400',
  done: 'bg-emerald-500/20 text-emerald-400',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

interface Props {
  open: boolean;
  sessions: SavedSession[];
  currentId: string | null;
  onClose: () => void;
  onLoad: (session: SavedSession) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function SessionDrawer({
  open,
  sessions,
  currentId,
  onClose,
  onLoad,
  onDelete,
  onNew,
}: Props) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-full w-72 bg-[#0f0f11] border-r border-white/10 z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <span className="font-semibold text-sm">Sesiones</span>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New session */}
        <div className="px-3 py-3 border-b border-white/10">
          <button
            onClick={() => { onNew(); onClose(); }}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva sesión
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-white/30 text-sm">
              No hay sesiones guardadas
            </div>
          ) : (
            sessions.map(s => (
              <div
                key={s.id}
                className={`group relative mx-2 mb-1 rounded-xl px-3 py-3 cursor-pointer transition-colors ${
                  s.id === currentId
                    ? 'bg-indigo-500/15 border border-indigo-500/30'
                    : 'hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => { onLoad(s); onClose(); }}
              >
                <div className="text-sm font-medium text-white/90 truncate pr-6">
                  {s.clientName || 'Sin cliente'}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                      STEP_COLORS[s.step] || STEP_COLORS.brief
                    }`}
                  >
                    {STEP_LABELS[s.step] || s.step}
                  </span>
                  <span className="text-[11px] text-white/30">{formatDate(s.updatedAt)}</span>
                </div>

                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                  className="absolute top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-white/25 hover:text-red-400"
                  title="Eliminar sesión"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
