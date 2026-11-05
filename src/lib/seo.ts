import 'server-only';
import { fullAddress } from '@/lib/site-fallback';
import { activeOfferCents, currentPriceCents, formatPrice, FUEL_LABEL, TRANSMISSION_LABEL, vehicleName, vehicleTitle } from '@/lib/format';
import { siteImageUrl } from '@/lib/site-images';
import type { SiteSettings, Vehicle } from '@/lib/types';
import { photoUrl, sortPhotos } from '@/lib/vehicles';

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function autoDealerSchema(settings: SiteSettings, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    '@id': `${siteUrl}/#loja`,
    name: settings.display_name,
    url: siteUrl,
    image: new URL(siteImageUrl(settings, 'fachada'), siteUrl).href,
    telephone: settings.phone_display ?? undefined,
    email: settings.email ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: settings.address_street ?? undefined,
      addressLocality: settings.address_city ?? undefined,
      addressRegion: settings.address_state ?? undefined,
      postalCode: settings.address_zip ?? undefined,
      addressCountry: 'BR',
    },
    areaServed: settings.address_city ?? undefined,
    openingHoursSpecification: settings.hours.map((slot) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: slot.days.map((day) => SCHEMA_DAYS[day]),
      opens: slot.open,
      closes: slot.close,
    })),
    sameAs: [settings.instagram_url, settings.facebook_url].filter(Boolean),
  };
}

export function vehicleSchema(vehicle: Vehicle, settings: SiteSettings, siteUrl: string) {
  const url = `${siteUrl}/veiculos/${vehicle.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: vehicleTitle(vehicle),
    brand: { '@type': 'Brand', name: vehicle.brand },
    model: vehicle.model,
    vehicleConfiguration: vehicle.version ?? undefined,
    vehicleModelDate: String(vehicle.model_year),
    itemCondition: 'https://schema.org/UsedCondition',
    mileageFromOdometer: vehicle.mileage_km == null ? undefined : { '@type': 'QuantitativeValue', value: vehicle.mileage_km, unitCode: 'KMT' },
    vehicleTransmission: vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] : undefined,
    fuelType: vehicle.fuel ? FUEL_LABEL[vehicle.fuel] : undefined,
    color: vehicle.color ?? undefined,
    description: vehicle.description ?? undefined,
    image: sortPhotos(vehicle.vehicle_photos).slice(0, 6).map((photo) => photoUrl(photo.storage_path)),
    url,
    offers: {
      '@type': 'Offer',
      url,
      price: (currentPriceCents(vehicle) / 100).toFixed(2),
      priceCurrency: 'BRL',
      priceValidUntil: activeOfferCents(vehicle) !== null ? (vehicle.offer_until ?? undefined) : undefined,
      availability: vehicle.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      seller: { '@type': 'AutoDealer', name: settings.display_name, address: fullAddress(settings) },
    },
  };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
  };
}

export function vehicleMetaDescription(vehicle: Vehicle, settings: SiteSettings) {
  return `${vehicleName(vehicle)} ${vehicle.model_year} por ${formatPrice(currentPriceCents(vehicle))} na ${settings.display_name}, em ${settings.address_city ?? 'Cachoeiro de Itapemirim'}. Veja fotos e fale pelo WhatsApp.`;
}
