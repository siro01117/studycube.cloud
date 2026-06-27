// 모듈 — 홈 Dock에 뜨는 카드. DB(module + branch_module)가 진실.
// 모듈 추가 = DB INSERT + 여기 ROUTES에 화면 경로 등록. (코어는 무수정)
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Me } from '@/lib/perms';

export type ModuleCard = {
  key: string;
  label: string;
  icon: string | null;
  href: string;
  ready: boolean; // 화면 구현 여부
};

// 구현된 모듈의 화면 경로. 아직 없음 — 모듈 만들 때마다 추가.
export const MODULE_ROUTES: Record<string, string> = {
  // seat: '/m/seat',
};

// 활성 지점에서 (모듈 enabled) && (필요권한 충족) 인 카드 목록
export async function getHomeModules(me: Me): Promise<ModuleCard[]> {
  if (!me.activeBranchId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('branch_module')
    .select('enabled, module:module(key,label,icon,requires,ord)')
    .eq('branch_id', me.activeBranchId)
    .eq('enabled', true);

  type Row = { module: { key: string; label: string; icon: string | null; requires: string[]; ord: number } | null };
  const rows = (data ?? []) as unknown as Row[];

  return rows
    .map((r) => r.module)
    .filter((m): m is NonNullable<typeof m> => !!m)
    .filter((m) => me.isCto || (m.requires ?? []).every((p) => me.perms.includes(p)))
    .sort((a, b) => a.ord - b.ord)
    .map((m) => ({
      key: m.key,
      label: m.label,
      icon: m.icon,
      href: MODULE_ROUTES[m.key] ?? '#',
      ready: !!MODULE_ROUTES[m.key],
    }));
}
