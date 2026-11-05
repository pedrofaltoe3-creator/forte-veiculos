import type { Metadata } from 'next';
import { SiteImageManager } from '@/components/admin/SiteImageManager';
import { requireAdminPage } from '@/lib/auth/guards';
import { hasCustomImage, SITE_IMAGE_SLOT_NAMES, SITE_IMAGE_SLOTS, siteImageUrl } from '@/lib/site-images';

export const metadata: Metadata = { title: 'Fotos do site' };

export default async function SiteImagesPage() {
  const { site } = await requireAdminPage();
  const images = SITE_IMAGE_SLOT_NAMES.map((slot) => ({
    slot,
    label: SITE_IMAGE_SLOTS[slot].label,
    hint: SITE_IMAGE_SLOTS[slot].hint,
    url: siteImageUrl(site.settings, slot),
    isCustom: hasCustomImage(site.settings, slot),
  }));

  return (
    <>
      <header className="a-head"><h1>Fotos do site</h1></header>
      <p className="muted a-lede">Troque as fotos das páginas do site. O site muda na hora. As fotos dos carros ficam em Veículos.</p>
      <SiteImageManager images={images} />
    </>
  );
}
