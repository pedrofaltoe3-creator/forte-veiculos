import Link from 'next/link';
import { activeOfferCents, formatKm, formatPrice, STATUS_LABEL, TRANSMISSION_LABEL, vehicleName } from '@/lib/format';
import type { Vehicle } from '@/lib/types';
import { photoUrl, sortPhotos } from '@/lib/vehicles';

type Props = { vehicle: Vehicle; variant?: 'default' | 'large'; priority?: boolean };

export function VehiclePhotoImage({ vehicle, sizes, priority }: { vehicle: Vehicle; sizes: string; priority?: boolean }) {
  const photo = sortPhotos(vehicle.vehicle_photos)[0];
  if (!photo) return <div className="card-photo-empty mono">Foto em breve</div>;
  return (
    <img
      src={photoUrl(photo.thumb_path)}
      srcSet={`${photoUrl(photo.thumb_path)} 800w, ${photoUrl(photo.storage_path)} ${photo.width}w`}
      sizes={sizes}
      alt={photo.alt ?? vehicleName(vehicle)}
      width={photo.width}
      height={photo.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

export function VehicleCard({ vehicle, variant = 'default', priority }: Props) {
  const km = formatKm(vehicle.mileage_km);
  const offer = activeOfferCents(vehicle);
  const specs = [
    String(vehicle.model_year),
    km,
    vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] : null,
  ].filter(Boolean);

  return (
    <article className={`card card-${variant}`}>
      <Link href={`/veiculos/${vehicle.slug}`} className="card-link">
        <div className="card-photo">
          <VehiclePhotoImage
            vehicle={vehicle}
            priority={priority}
            sizes={variant === 'large' ? '(max-width: 900px) 100vw, 60vw' : '(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 25vw'}
          />
          <span className="card-scan" aria-hidden="true" />
          {vehicle.status !== 'available' && (
            <span className={`status-tag status-${vehicle.status}`}>{STATUS_LABEL[vehicle.status]}</span>
          )}
          {offer !== null && <span className="offer-tag">Oferta</span>}
        </div>
        <div className="card-body">
          <p className="card-brand mono">{vehicle.brand}</p>
          <h3 className="card-title">
            {vehicle.model}
            {vehicle.version ? <span> {vehicle.version}</span> : null}
          </h3>
          <p className="card-specs mono">{specs.join(' · ')}</p>
          <p className="card-price">
            {offer !== null && <s className="old-price"><span className="sr-only">De </span>{formatPrice(vehicle.price_cents)}</s>}
            {offer !== null && <span className="sr-only"> por </span>}
            {formatPrice(offer ?? vehicle.price_cents)}
          </p>
        </div>
      </Link>
    </article>
  );
}
