import 'server-only';
import { occ } from './occ';

export type CmsComponent = { uid: string; typeCode: string; flexType?: string; [key: string]: unknown };
export type CmsSlot = { slotId: string; position: string; components?: { component?: CmsComponent | CmsComponent[] } };
export type CmsPage = {
  uid: string; title?: string; name?: string; label?: string; robotTag?: string; template?: string;
  contentSlots?: { contentSlot?: CmsSlot | CmsSlot[] };
};

const ISR = { next: { revalidate: 300 } };

export const asArray = <T,>(x?: T | T[]): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

export function getPage(path: string): Promise<CmsPage> {
  const params: Record<string, string> = { fields: 'DEFAULT' };
  if (path !== '/') {
    params.pageType = 'ContentPage';
    params.pageLabel = path;
  }
  return occ<CmsPage>('users/anonymous/cms/pages', params, ISR);
}

export async function getComponents(ids: string[]): Promise<CmsComponent[]> {
  if (!ids.length) return [];
  const res = await occ<{ component?: CmsComponent[] }>(
    'users/anonymous/cms/components',
    { componentIds: ids.join(','), pageSize: String(ids.length), fields: 'DEFAULT' },
    ISR,
  );
  return res.component ?? [];
}
