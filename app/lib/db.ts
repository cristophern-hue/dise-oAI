export interface SavedSession {
  id: string;
  clientName: string;
  clientId: string | null;
  step: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export async function dbSaveSession(session: SavedSession): Promise<void> {
  await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

export async function dbGetAllSessions(): Promise<SavedSession[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((row: Record<string, unknown>) => ({
    id: row.id,
    clientName: row.client_name,
    clientId: row.client_id,
    step: row.step,
    brief: row.brief,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: row.data,
  }));
}

export async function dbDeleteSession(id: string): Promise<void> {
  await fetch('/api/sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}
