import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Gallery } from '@/components/site/Gallery';
import { JsonLd } from '@/components/site/JsonLd';
import { VehicleInterestForm } from '@/components/site/LeadForms';
import { VehicleCard } from '@/components/site/VehicleCard';
import {
  activeOfferCents,
  CATEGORY_LABEL,
  formatDay,
  formatKm,
  formatPrice,
  FUEL_LABEL,
  STATUS_LABEL,
  TRANSMISSION_LABEL,
  vehicleTitle,
} from '@/lib/format';
import { breadcrumbSchema, vehicleMetaDescription, vehicleSchema } from '@/lib/seo';
import { getPublicContext } from '@/lib/site-fallback';
import { getVehicleBySlug, listSimilar, photoUrl, sortPhotos } from '@/lib/vehicles';
import { vehicleInterestMessage, whatsappLink } from '@/lib/whatsapp';

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  const context = await getPublicContext();
  if (!context.companyId || !/^[a-z0-9-]{1,140}$/.test(slug)) return null;
  const vehicle = await getVehicleBySlug(context.companyId, slug);
  return vehicle ? { ...context, vehicle } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = await load((await params).slug);
  if (!loaded) return { title: 'Veículo não encontrado', robots: { index: false } };
  const { vehicle, settings } = loaded;
  const title = `${vehicleTitle(vehicle)} em ${settings.address_city ?? 'Cachoeiro de Itapemirim'}`;
  const description = vehicleMetaDescription(vehicle, settings);
  const photo = sortPhotos(vehicle.vehicle_photos)[0];
  return {
    title,
    description,
    alternates: { canonical: `/veiculos/${vehicle.slug}` },
    robots: vehicle.status === 'sold' ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url: `/veiculos/${vehicle.slug}`,
      images: photo ? [{ url: photoUrl(photo.storage_path), width: photo.width, height: photo.height }] : undefined,
    },
  };
}

export default async function VehiclePage({ params }: { params: Params }) {
  const loaded = await load((await params).slug);
  if (!loaded) notFound();
  const { vehicle, settings, siteUrl } = loaded;

  const title = vehicleTitle(vehicle);
  const whatsappHref = whatsappLink(settings.whatsapp, vehicleInterestMessage(vehicle, siteUrl));
  const similar = await listSimilar(vehicle);
  const consult = 'Sob consulta';
  const offer = vehicle.status === 'sold' ? null : activeOfferCents(vehicle);
  const currentPrice = offer ?? vehicle.price_cents;

  const specs: [string, string][] = [
    ['Marca', vehicle.brand],
    ['Modelo', vehicle.model],
    ['Versão', vehicle.version ?? consult],
    ['Ano', String(vehicle.model_year)],
    ['Quilometragem', formatKm(vehicle.mileage_km) ?? consult],
    ['Câmbio', vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] : consult],
    ['Combustível', vehicle.fuel ? FUEL_LABEL[vehicle.fuel] : consult],
    ['Cor', vehicle.color ?? consult],
    ['Categoria', CATEGORY_LABEL[vehicle.category]],
  ];

  const photos = sortPhotos(vehicle.vehicle_photos).map((photo) => ({
    full: photoUrl(photo.storage_path),
    thumb: photoUrl(photo.thumb_path),
    alt: photo.alt ?? title,
    width: photo.width,
    height: photo.height,
  }));

  return (
    <article className="vehicle-page">
      <JsonLd data={vehicleSchema(vehicle, settings, siteUrl)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Início', url: `${siteUrl}/` },
          { name: 'Estoque', url: `${siteUrl}/veiculos` },
          { name: title, url: `${siteUrl}/veiculos/${vehicle.slug}` },
        ])}
      />

      <nav className="breadcrumb mono" aria-label="Você está em">
        <Link href="/veiculos">Estoque</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>

      <div className="vehicle-top">
        <Gallery photos={photos} title={title} />

        <aside className="vehicle-summary">
          {vehicle.status !== 'available' && (
            <span className={`status-tag status-inline status-${vehicle.status}`}>{STATUS_LABEL[vehicle.status]}</span>
          )}
          <p className="card-brand mono">{vehicle.brand}</p>
          <h1>
            {vehicle.model}
            {vehicle.version ? <span> {vehicle.version}</span> : null}
          </h1>
          <p className="vehicle-meta mono">
            {[String(vehicle.model_year), formatKm(vehicle.mileage_km), vehicle.color].filter(Boolean).join(' · ')}
          </p>
          {offer !== null && <p className="vehicle-offer-tag"><span className="offer-tag offer-tag-inline">Oferta</span> <s className="old-price"><span className="sr-only">De </span>{formatPrice(vehicle.price_cents)}</s></p>}
          <p className="vehicle-price">{formatPrice(currentPrice)}</p>
          {offer !== null && vehicle.offer_until && <p className="vehicle-small">Oferta válida até {formatDay(vehicle.offer_until)}.</p>}

          {vehicle.status === 'sold' ? (
            <>
              <p className="vehicle-notice">Este carro já foi vendido. Conte o que você procura que a gente ajuda a encontrar outro.</p>
              <a className="btn btn-accent btn-block" href={whatsappLink(settings.whatsapp, `Olá! Vi que o ${title} foi vendido. Vocês têm algo parecido?`)} target="_blank" rel="noopener noreferrer">
                Procurar um parecido
              </a>
            </>
          ) : (
            <>
              {vehicle.status === 'reserved' && (
                <p className="vehicle-notice">Este carro está reservado no momento. Fale com a gente para saber se ainda há chance.</p>
              )}
              <a className="btn btn-accent btn-block" href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Tenho interesse neste carro
              </a>
              <a className="btn btn-line btn-block" href="#interesse">
                Prefiro deixar meu contato
              </a>
            </>
          )}
          <p className="vehicle-small">Preço e disponibilidade sujeitos a alteração. Confirme com a loja antes de vir.</p>
        </aside>
      </div>

      <div className="vehicle-details">
        <section aria-labelledby="ficha-title" className="spec-sheet">
          <h2 id="ficha-title">Ficha do carro</h2>
          <dl>
            {specs.map(([label, value]) => (
              <div key={label}>
                <dt className="mono">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {(vehicle.description || vehicle.features.length > 0) && (
          <section aria-labelledby="descricao-title" className="vehicle-text">
            <h2 id="descricao-title">Sobre este carro</h2>
            {vehicle.description && <p className="vehicle-description">{vehicle.description}</p>}
            {vehicle.features.length > 0 && (
              <ul className="feature-list">
                {vehicle.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {vehicle.status !== 'sold' && (
        <section className="vehicle-lead" id="interesse" aria-labelledby="interesse-title">
          <div>
            <h2 id="interesse-title">Quer que a gente te chame?</h2>
            <p>Deixe seu contato e a loja responde sobre o {title}.</p>
          </div>
          <div className="form-panel">
            <VehicleInterestForm slug={vehicle.slug} title={title} whatsappHref={whatsappHref} />
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section className="vehicle-similar" aria-labelledby="similares-title">
          <h2 id="similares-title">Também pode te interessar</h2>
          <div className="stock-grid">
            {similar.map((item) => (
              <VehicleCard key={item.id} vehicle={item} />
            ))}
          </div>
        </section>
      )}

      {vehicle.status !== 'sold' && (
        <div className="sticky-cta">
          <div>
            <span className="mono">{vehicle.model} {vehicle.model_year}</span>
            <strong>{formatPrice(currentPrice)}</strong>
          </div>
          <a className="btn btn-accent btn-small" href={whatsappHref} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </div>
      )}
    </article>
  );
}
