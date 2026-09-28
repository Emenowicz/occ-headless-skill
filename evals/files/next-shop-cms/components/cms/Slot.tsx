import { asArray, type CmsSlot } from '@/lib/cms';
import { registry, componentKey } from './registry';

export function Slot({ slot }: { slot: CmsSlot }) {
  return (
    <section data-position={slot.position}>
      {asArray(slot.components?.component).map((c) => {
        const Component = registry[componentKey(c)];
        return Component ? <Component key={c.uid} data={c} /> : null;
      })}
    </section>
  );
}
