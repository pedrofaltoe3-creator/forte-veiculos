import Link from 'next/link';
import { InstagramEmbeds, MapEmbed } from '@/components/site/ConsentEmbeds';
import { HeroScrub } from '@/components/site/HeroScrub';
import { JsonLd } from '@/components/site/JsonLd';
import { ContactForm, EvaluationForm } from '@/components/site/LeadForms';
import { OpenNow } from '@/components/site/OpenNow';
import { VehicleCard } from '@/components/site/VehicleCard';
import { CATEGORY_LABEL } from '@/lib/format';
import { autoDealerSchema } from '@/lib/seo';
import { fullAddress, getPublicContext, socialHandle } from '@/lib/site-fallback';
import { hasCustomImage, siteImageUrl } from '@/lib/site-images';
import { getFacets, listFeatured, listInstagramPosts, listOffers, listRecent, siteVideoUrl } from '@/lib/vehicles';
import { EVALUATION_MESSAGE, GENERAL_MESSAGE, whatsappLink } from '@/lib/whatsapp';

const DEALS = [
  {
    number: '01',
    title: 'Comprar',
    text: 'Escolha no estoque, veja as fotos e peça os detalhes pelo WhatsApp. Depois venha ver o carro de perto.',
    slot: 'comprar',
    href: '/veiculos',
    cta: 'Ver estoque',
  },
  {
    number: '02',
    title: 'Vender',
    text: 'Mande os dados do seu carro ou traga até a loja. A gente avalia e explica o valor.',
    slot: 'vender',
    href: '#avaliacao',
    cta: 'Avaliar meu carro',
  },
  {
    number: '03',
    title: 'Trocar',
    text: 'Seu usado pode entrar na negociação do próximo. É só informar o carro atual e o que você procura.',
    slot: 'trocar',
    href: '#avaliacao',
    cta: 'Quero trocar',
  },
] as const;

const REASONS = [
  ['Procedência', 'Carro com histórico conhecido e documentação em ordem.'],
  ['Seleção', 'O estoque é escolhido com cuidado, um carro de cada vez.'],
  ['Transparência', 'Você sabe o que está comprando antes de fechar.'],
  ['Avaliação justa', 'Seu usado avaliado com critério e valor explicado.'],
  ['Atendimento', 'Gente da loja com você, do primeiro contato às chaves.'],
  ['Suporte', 'A gente acompanha a negociação inteira e continua por perto depois.'],
];

const FAQ = [
  {
    question: 'Posso ver o carro antes de decidir?',
    answer: 'Pode e deve. A loja fica na Otton Marins, em Cachoeiro de Itapemirim. Avise qual carro quer ver e a gente deixa ele pronto.',
  },
  {
    question: 'Como fico sabendo da procedência do carro?',
    answer: 'Pergunte sobre o histórico e a documentação do carro que você escolheu. Procedência é compromisso da loja, e você pode tirar todas as dúvidas antes de fechar.',
  },
  {
    question: 'Por que alguns anúncios não mostram a quilometragem?',
    answer: 'Quando o dado ainda não foi lançado no site, ele aparece como "sob consulta". Chame no WhatsApp que a gente informa na hora.',
  },
  {
    question: 'Vocês aceitam meu carro na troca?',
    answer: 'A loja trabalha com compra, venda e troca. Preencha a avaliação com os dados do seu carro e a gente retorna no telefone informado.',
  },
  {
    question: 'O preço do site está atualizado?',
    answer: 'O estoque deste site é atualizado direto pela loja. Carro reservado ou vendido aparece marcado. Preço e disponibilidade podem mudar, então confirme antes de vir.',
  },
];

export default async function HomePage() {
  const { companyId, settings, siteUrl } = await getPublicContext();
  const [featured, recent, facets, posts, offers] = companyId
    ? await Promise.all([listFeatured(companyId, 5), listRecent(companyId, 8), getFacets(companyId), listInstagramPosts(companyId), listOffers(companyId)])
    : [[], [], { brands: [], categories: [], total: 0 }, [], []];

  const whatsappHref = whatsappLink(settings.whatsapp, GENERAL_MESSAGE);
  const evaluationWhatsapp = whatsappLink(settings.whatsapp, EVALUATION_MESSAGE);
  const address = fullAddress(settings);
  const handle = socialHandle(settings.instagram_url);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const showcase = featured.length > 0 ? featured : recent.slice(0, 5);

  return (
    <>
      <JsonLd data={autoDealerSchema(settings, siteUrl)} />
      <HeroScrub whatsappHref={whatsappHref} customImage={hasCustomImage(settings, 'abertura') ? siteImageUrl(settings, 'abertura') : null} />

      {offers.length > 0 && (
        <section className="section showcase offers" aria-labelledby="ofertas-title" id="ofertas" data-live>
          <header className="section-head" data-reveal>
            <p className="kicker mono">Ofertas</p>
            <h2 id="ofertas-title">Carros com preço especial.</h2>
            <Link className="text-link" href="/veiculos?oferta=1">
              Ver todas as ofertas
            </Link>
          </header>
          <div className="showcase-grid">
            {offers.map((vehicle, index) => (
              <div key={vehicle.id} data-reveal style={{ transitionDelay: `${Math.min(index, 3) * 80}ms` }}>
                <VehicleCard vehicle={vehicle} variant={index === 0 ? 'large' : 'default'} priority={index === 0} />
              </div>
            ))}
          </div>
        </section>
      )}

      {showcase.length > 0 && (
        <section className="section showcase" aria-labelledby="destaques-title" data-live>
          <header className="section-head" data-reveal>
            <p className="kicker mono">Em destaque</p>
            <h2 id="destaques-title">Na frente do pátio, esta semana.</h2>
            <Link className="text-link" href="/veiculos">
              Ver todo o estoque
            </Link>
          </header>
          <div className="showcase-grid">
            {showcase.map((vehicle, index) => (
              <div key={vehicle.id} data-reveal style={{ transitionDelay: `${Math.min(index, 3) * 80}ms` }}>
                <VehicleCard vehicle={vehicle} variant={index === 0 ? 'large' : 'default'} priority={index === 0} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="paper-section" aria-labelledby="catalogo-title" id="catalogo">
        <div className="paper-inner">
          <div className="finder" data-reveal>
            <div>
              <p className="kicker kicker-ink mono">Estoque</p>
              <h2 id="catalogo-title">Procure do seu jeito.</h2>
            </div>
            <form className="finder-search" action="/veiculos" method="get" role="search">
              <label className="sr-only" htmlFor="busca-home">Buscar por modelo, marca ou ano</label>
              <input id="busca-home" name="q" type="search" placeholder="Modelo, marca ou ano" maxLength={60} />
              <button type="submit" className="btn btn-ink">Buscar</button>
            </form>
          </div>

          {facets.categories.length > 0 && (
            <ul className="category-row" data-reveal>
              {facets.categories.map((category) => (
                <li key={category.name}>
                  <Link href={`/veiculos?categoria=${category.name}`}>
                    <span>{CATEGORY_LABEL[category.name]}</span>
                    <span className="mono">{category.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {recent.length > 0 ? (
            <>
              <div className="stock-grid">
                {recent.map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
              <Link className="btn btn-ink stock-more" href="/veiculos">
                Ver os {facets.total} carros do estoque
              </Link>
            </>
          ) : (
            <p className="stock-empty">
              O estoque está sendo atualizado. <a href={whatsappHref} target="_blank" rel="noopener noreferrer">Pergunte pelo WhatsApp</a> o que chegou.
            </p>
          )}

          {facets.brands.length > 0 && (
            <ul className="brand-row mono" aria-label="Marcas no estoque" data-reveal>
              {facets.brands.map((brand) => (
                <li key={brand.name}>
                  <Link href={`/veiculos?marca=${encodeURIComponent(brand.name)}`}>{brand.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="about" id="sobre" aria-labelledby="sobre-title">
        <img className="about-photo" src={siteImageUrl(settings, 'fachada')} alt="Fachada da Forte Veículos com carros na frente da loja" width={1200} height={575} loading="lazy" />
        <div className="about-copy" data-reveal>
          <p className="kicker mono">A loja</p>
          <h2 id="sobre-title">Forte no nome. Firme na palavra.</h2>
          <p>{settings.about_text}</p>
        </div>
      </section>

      <section className="section differentials" aria-labelledby="diferenciais-title" id="diferenciais">
        <header className="section-head section-head-wide" data-reveal>
          <p className="kicker mono">Por que a Forte</p>
          <h2 id="diferenciais-title">Seis motivos para fechar com a gente.</h2>
          <p className="section-lede">O que você encontra aqui, do primeiro contato às chaves.</p>
        </header>
        <ol className="reasons-grid" data-reveal>
          {REASONS.map(([title, text], index) => (
            <li className="reason" key={title}>
              <span className="mono reason-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section deals" aria-labelledby="negocios-title" id="negocios">
        <header className="section-head" data-reveal>
          <p className="kicker mono">Compra, venda e troca</p>
          <h2 id="negocios-title">Três negócios, o mesmo jeito de fazer.</h2>
        </header>
        <div className="deals-grid">
          {DEALS.map((deal, index) => (
            <article className="deal" key={deal.title} data-reveal style={{ transitionDelay: `${index * 90}ms` }}>
              <img src={siteImageUrl(settings, deal.slot)} alt="" width={1200} height={800} loading="lazy" />
              <div className="deal-body">
                <span className="mono deal-number">{deal.number}</span>
                <h3>{deal.title}</h3>
                <p>{deal.text}</p>
                <Link className="text-link" href={deal.href}>{deal.cta}</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="evaluation" id="avaliacao" aria-labelledby="avaliacao-title">
        <div className="evaluation-copy" data-reveal>
          <p className="kicker mono">Avaliação de usado</p>
          <h2 id="avaliacao-title">Quanto vale o seu carro?</h2>
          <p>Mande os dados. A gente analisa e retorna no telefone informado, com o valor explicado.</p>
          <a className="text-link" href={evaluationWhatsapp} target="_blank" rel="noopener noreferrer">
            Prefiro mandar fotos pelo WhatsApp
          </a>
        </div>
        <div className="form-panel" data-reveal>
          <EvaluationForm whatsappHref={evaluationWhatsapp} />
        </div>
      </section>

      <section className="section instagram" aria-labelledby="instagram-title" id="instagram">
        <div className="instagram-head" data-reveal>
          <div>
            <p className="kicker mono">Instagram</p>
            <h2 id="instagram-title">O que chega no pátio passa por lá.</h2>
          </div>
          {settings.instagram_url && (
            <a className="btn btn-line" href={settings.instagram_url} target="_blank" rel="noopener noreferrer">
              @{handle}
            </a>
          )}
        </div>
        <InstagramEmbeds
          posts={posts.map((post) => ({ id: post.id, permalink: post.permalink, videoUrl: post.video_path ? siteVideoUrl(post.video_path) : null }))}
          profileUrl={settings.instagram_url}
        />
      </section>

      <section className="section faq" aria-labelledby="faq-title">
        <header className="section-head" data-reveal>
          <p className="kicker mono">Perguntas de quem está comprando</p>
          <h2 id="faq-title">Pergunte sem medo.</h2>
        </header>
        <div className="faq-list" data-reveal>
          {FAQ.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="location" id="localizacao" aria-labelledby="localizacao-title">
        <div className="location-copy" data-reveal>
          <p className="kicker mono">Onde estamos</p>
          <h2 id="localizacao-title">Venha ver de perto.</h2>
          <address>{address}</address>
          <OpenNow hours={settings.hours} />
          <dl className="hours">
            {settings.hours.map((slot) => (
              <div key={slot.label}>
                <dt>{slot.label}</dt>
                <dd className="mono">{slot.open} às {slot.close}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="location-map" data-reveal>
          <MapEmbed query={address} title={`Mapa da ${settings.display_name}`} mapsUrl={mapsUrl} />
        </div>
      </section>

      <section className="contact" id="contato" aria-labelledby="contato-title">
        <div className="contact-cta" data-reveal>
          <h2 id="contato-title">Qual carro você quer ver?</h2>
          <p>Fale direto com a loja. {settings.phone_display}</p>
          <a className="btn btn-accent btn-large" href={whatsappHref} target="_blank" rel="noopener noreferrer">
            Chamar no WhatsApp
          </a>
        </div>
        <div className="form-panel" data-reveal>
          <p className="form-panel-title">Ou deixe uma mensagem</p>
          <ContactForm whatsappHref={whatsappHref} />
        </div>
      </section>
    </>
  );
}
