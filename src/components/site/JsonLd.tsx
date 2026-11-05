import { getNonce } from '@/lib/tenant';

// Escapa "<" para o conteúdo vindo do banco nunca fechar a tag script (proteção contra XSS).
export async function JsonLd({ data }: { data: unknown }) {
  const nonce = await getNonce();
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
