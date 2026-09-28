import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPage, asArray } from '@/lib/cms';
import { OccError } from '@/lib/occ';
import { Slot } from '@/components/cms/Slot';

type Props = { params: Promise<{ slug?: string[] }> };

export const revalidate = 300;

async function load(slug?: string[]) {
  const path = slug?.length ? `/${slug.join('/')}` : '/';
  try {
    return await getPage(path);
  } catch (e) {
    if (e instanceof OccError && e.type === 'CMSItemNotFoundError') notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug);
  return { title: page.title ?? page.name, robots: page.robotTag === 'NOINDEX_NOFOLLOW' ? 'noindex,nofollow' : undefined };
}

export default async function CmsPageRoute({ params }: Props) {
  const page = await load((await params).slug);
  const slots = asArray(page.contentSlots?.contentSlot);
  return (
    <main data-template={page.template}>
      {slots.map((slot) => (
        <Slot key={slot.slotId} slot={slot} />
      ))}
    </main>
  );
}
