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
  const kit: BrandKit = await req.json();
  const { error } = await supabase
    .from('brand_kits')
    .upsert({ id: kit.id, data: kit, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const { error } = await supabase.from('brand_kits').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
