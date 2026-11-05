import type { Metadata } from 'next';
import Link from 'next/link';
import { CookiePreferencesButton } from '@/components/site/CookieConsent';

export const metadata: Metadata = {
  title: 'Política de Cookies',
  description: 'Quais cookies a Forte Veículos usa e como alterar ou revogar suas preferências a qualquer momento.',
  alternates: { canonical: '/politica-de-cookies' },
};

const ROWS = [
  ['fv_consent', 'Necessário', 'Guarda a sua escolha de cookies', 'Primeira parte', '6 meses'],
  ['sb-*-auth-token', 'Necessário', 'Mantém o login da equipe no painel. Não é usado para visitantes', 'Primeira parte', 'Até 8 horas sem uso'],
  ['_ga, _ga_*', 'Analítico', 'Google Analytics: estatísticas agregadas de visitas', 'Google', 'Até 2 anos'],
  ['_fbp, _fbc', 'Marketing', 'Meta Pixel: medição de anúncios', 'Meta', 'Até 90 dias'],
  ['Cookies do Instagram', 'Marketing', 'Exibição de publicações incorporadas', 'Meta', 'Definido pela Meta'],
  ['Cookies do Google Maps', 'Marketing', 'Exibição do mapa incorporado, se você aceitar ou clicar em Mostrar mapa', 'Google', 'Definido pelo Google'],
];

export default function CookiesPage() {
  return (
    <div className="legal">
      <div className="legal-inner">
        <h1>Política de Cookies</h1>
        <p className="legal-date">Versão 2026-11. Última atualização: novembro de 2026.</p>

        <h2>O que são cookies</h2>
        <p>
          São pequenos arquivos guardados no seu navegador. Alguns são necessários para o site funcionar. Outros servem para
          medir visitas ou anúncios e só são ativados com a sua autorização.
        </p>

        <h2>Como escolher</h2>
        <p>
          Ao entrar no site você pode aceitar todos, rejeitar os não essenciais ou personalizar por categoria. Cookies
          analíticos e de marketing ficam desligados até você decidir. Você pode mudar de ideia quando quiser, com o mesmo
          esforço, e a revogação apaga os cookies de análise e marketing que tenham sido gravados neste domínio.
        </p>
        <div className="legal-actions">
          <CookiePreferencesButton className="link-button" />
        </div>

        <h2>Cookies utilizados</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Para que serve</th>
              <th>Origem</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row[0]}>
                {row.map((cell) => (
                  <td key={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Os cookies analíticos e de marketing só existem quando a ferramenta correspondente está ativada pela loja e você
          autorizou.
        </p>

        <h2>Registro do consentimento</h2>
        <p>
          Guardamos um registro da sua escolha, com um identificador aleatório, a data, a versão desta política e uma assinatura
          técnica do IP, para comprovar o consentimento. Saiba mais na{' '}
          <Link href="/politica-de-privacidade">Política de Privacidade</Link>.
        </p>

        <h2>No seu navegador</h2>
        <p>
          Você também pode bloquear ou apagar cookies nas configurações do navegador. Bloquear os necessários pode impedir que a
          sua escolha seja lembrada.
        </p>
      </div>
    </div>
  );
}
