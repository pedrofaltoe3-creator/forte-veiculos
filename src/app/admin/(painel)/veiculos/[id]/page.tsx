import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { updateVehicle } from '@/app/admin/(painel)/actions';
import { DeleteVehicleButton } from '@/components/admin/DeleteVehicleButton';
import { PhotoManager } from '@/components/admin/PhotoManager';
import { VehicleForm } from '@/components/admin/VehicleForm';
import { requireAdminPage } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { vehicleTitle } from '@/lib/format';
import type { Vehicle, VehiclePrivateFields } from '@/lib/types';
import { photoUrl } from '@/lib/vehicles';

export const metadata: Metadata = { title: 'Editar veículo' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> };

export default async function EditVehiclePage({ params, searchParams }: Props) {
  const { supabase, site } = await requireAdminPage();
  const { id } = await params;
  const { novo } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data } = await supabase
    .from('vehicles')
    .select('*, vehicle_photos(id, storage_path, thumb_path, width, height, position, is_primary, alt)')
    .eq('id', id)
    .eq('company_id', site.company.id)
    .maybeSingle();
  if (!data) notFound();

  const vehicle = data as unknown as Vehicle & VehiclePrivateFields;
  const photos = [...vehicle.vehicle_photos]
    .sort((a, b) => a.position - b.position)
    .map((photo) => ({ id: photo.id, url: photoUrl(photo.thumb_path), is_primary: photo.is_primary }));

  return (
    <>
      <header className="a-head">
        <div>
          <Link className="a-back" href="/admin/veiculos">Veículos</Link>
          <h1>{vehicleTitle(vehicle)}</h1>
        </div>
        <div className="a-head-actions">
          {vehicle.status !== 'draft' && (
            <Link className="a-btn" href={`/veiculos/${vehicle.slug}`} target="_blank">Ver no site</Link>
          )}
          <DeleteVehicleButton vehicleId={vehicle.id} name={vehicleTitle(vehicle)} />
        </div>
      </header>

      {novo && <p className="alert alert-ok" role="status">Veículo cadastrado. Agora adicione as fotos.</p>}

      <PhotoManager vehicleId={vehicle.id} photos={photos} />

      <section className="a-section-gap" aria-label="Dados do veículo">
        <VehicleForm action={updateVehicle.bind(null, vehicle.id)} vehicle={vehicle} submitLabel="Salvar alterações" plateEnabled={Boolean(env.plateApiToken)} />
      </section>
    </>
  );
}
