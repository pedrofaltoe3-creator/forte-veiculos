import type { Metadata } from 'next';
import Link from 'next/link';
import { fullAddress, getPublicContext } from '@/lib/site-fallback';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Como a Forte Veículos trata dados pessoais, conforme a Lei Geral de Proteção de Dados (LGPD).',
  alternates: { canonical: '/politica-de-privacidade' },
};

export default async function PrivacyPage() {
  const { settings, technical } = await getPublicContext();
  const controller = technical.legal_name ?? settings.display_name;
  const contactEmail = technical.dpo_email ?? settings.email;

  return (
    <div className="legal">
      <div className="legal-inner">
        <h1>Política de Privacidade</h1>
        <p className="legal-date">Versão 2026-11. Última atualização: novembro de 2026.</p>

        <h2>Quem é responsável pelos seus dados</h2>
        <p>
          {controller}
          {technical.cnpj ? `, CNPJ ${technical.cnpj}` : ''}, com endereço em {fullAddress(settings)}, é a controladora
          dos dados pessoais tratados neste site, nos termos da Lei nº 13.709/2018 (LGPD).
        </p>

        <h2>Encarregado pelo tratamento de dados</h2>
        <p>
          {technical.dpo_name ? `${technical.dpo_name}. ` : ''}
          Canal de contato: {contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : `WhatsApp ${settings.phone_display}`}.
        </p>

        <h2>Quais dados tratamos e para quê</h2>
        <table>
          <thead>
            <tr>
              <th>Dados</th>
              <th>Finalidade</th>
              <th>Base legal (LGPD, art. 7º)</th>
              <th>Prazo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Nome, telefone, e-mail e mensagem enviados nos formulários</td>
              <td>Responder ao seu contato e tratar do veículo de interesse</td>
              <td>Consentimento (I) e procedimentos preliminares a um contrato (V)</td>
              <td>Até 24 meses, ou até você pedir a exclusão</td>
            </tr>
            <tr>
              <td>Dados do seu veículo no formulário de avaliação</td>
              <td>Avaliar o carro para compra ou troca</td>
              <td>Procedimentos preliminares a um contrato (V)</td>
              <td>Até 24 meses, ou até você pedir a exclusão</td>
            </tr>
            <tr>
              <td>Assinatura técnica do endereço IP, sem guardar o IP original</td>
              <td>Segurança: limitar tentativas excessivas e abuso dos formulários</td>
              <td>Legítimo interesse (IX)</td>
              <td>Até 24 meses junto do registro; contadores de tentativas, até 2 dias</td>
            </tr>
            <tr>
              <td>Registro das suas escolhas de cookies</td>
              <td>Comprovar o consentimento e respeitar a sua decisão</td>
              <td>Cumprimento de obrigação legal (II)</td>
              <td>Até 60 meses</td>
            </tr>
            <tr>
              <td>Dados de navegação por cookies analíticos e de marketing, se aceitos</td>
              <td>Entender o uso do site e medir anúncios</td>
              <td>Consentimento (I)</td>
              <td>Conforme a <Link href="/politica-de-cookies">Política de Cookies</Link></td>
            </tr>
          </tbody>
        </table>

        <h2>Com quem compartilhamos</h2>
        <p>
          Usamos fornecedores que tratam dados em nosso nome para o site funcionar: Supabase (banco de dados, autenticação
          e armazenamento) e o serviço de hospedagem do site. Se você aceitar os cookies correspondentes, também atuam Google
          (Analytics, Maps) e Meta (Pixel, Instagram). Ao conversar pelo WhatsApp, valem também as regras desse aplicativo.
          Não vendemos dados pessoais.
        </p>

        <h2>Transferência internacional</h2>
        <p>
          O banco de dados e a hospedagem do site ficam em servidores nos Estados Unidos, e outros fornecedores podem processar
          dados fora do Brasil. Nesses casos, a transferência segue as hipóteses previstas no art. 33 da LGPD.
        </p>

        <h2>Como protegemos</h2>
        <p>
          Conexão criptografada (HTTPS), controle de acesso por empresa e por usuário, verificação em duas etapas para a
          equipe, registro das atividades administrativas e cópias de segurança. Nenhum sistema é totalmente imune a falhas.
          Em caso de incidente relevante, comunicaremos a ANPD e os titulares afetados, conforme a lei.
        </p>

        <h2>Seus direitos (LGPD, art. 18)</h2>
        <ul>
          <li>Confirmar se tratamos seus dados e ter acesso a eles.</li>
          <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
          <li>Pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.</li>
          <li>Pedir a portabilidade dos dados.</li>
          <li>Eliminar dados tratados com base no consentimento e revogar esse consentimento a qualquer momento.</li>
          <li>Saber com quem compartilhamos seus dados.</li>
          <li>Apresentar petição à Autoridade Nacional de Proteção de Dados (ANPD).</li>
        </ul>
        <p>Para exercer esses direitos, use o canal do encarregado indicado acima.</p>

        <h2>Crianças e adolescentes</h2>
        <p>Este site não é destinado a menores de 18 anos, e não coletamos dados deles de forma intencional.</p>

        <h2>Alterações</h2>
        <p>Esta política pode mudar. A versão e a data no início da página indicam a mais recente.</p>
      </div>
    </div>
  );
}
