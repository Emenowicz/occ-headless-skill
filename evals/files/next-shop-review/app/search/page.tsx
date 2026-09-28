import { searchProducts } from '@/lib/occ';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = '', page = '1' } = await searchParams;
  const result = await searchProducts(q, Number(page));

  return (
    <section>
      <aside>
        {result.facets?.map((facet: any) => (
          <div key={facet.name}>
            <h3>{facet.name}</h3>
            {facet.values.map((value: any) => (
              <a key={value.name} href={`/search?q=${encodeURIComponent(`${q}:relevance:${facet.name}:${value.name}`)}`}>
                {value.name} ({value.count})
              </a>
            ))}
          </div>
        ))}
      </aside>
      <ul>
        {result.products?.map((p: any) => (
          <li key={p.code}><a href={`/p/${p.code}`}>{p.name}</a></li>
        ))}
      </ul>
      <a href={`/search?q=${encodeURIComponent(q)}&page=${Number(page) + 1}`}>Next page</a>
    </section>
  );
}
