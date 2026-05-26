import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/app/lib/supabase';
import { BrandKit } from '@/app/types';

export async function GET() {
  const { data, error } = await supabase
    .from('brand_kits')
    .select('id, data')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data || []).map(row => ({ id: row.id, ...row.data })));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const kit = body as BrandKit;
  if (!kit?.id || typeof kit.id !== 'string' || !kit?.name || typeof kit.name !== 'string') {
    return NextResponse.json({ error: 'id and name are required strings' }, { status: 400 });
  }
  const { error } = await supabase
    .from('brand_kits')
    .upsert({ id: kit.id, data: kit, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const { error } = await supabase.from('brand_kits').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
