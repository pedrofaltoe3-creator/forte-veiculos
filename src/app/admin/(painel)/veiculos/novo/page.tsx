import type { Metadata } from 'next';
import Link from 'next/link';
import { createVehicle } from '@/app/admin/(painel)/actions';
import { VehicleForm } from '@/components/admin/VehicleForm';
import { requireAdminPage } from '@/lib/auth/guards';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Cadastrar veículo' };

export default async function NewVehiclePage() {
  await requireAdminPage();
  return (
    <>
      <header className="a-head">
        <div>
          <Link className="a-back" href="/admin/veiculos">Veículos</Link>
          <h1>Cadastrar veículo</h1>
        </div>
      </header>
      <p className="muted a-lede">Salve os dados primeiro. Na próxima tela você adiciona as fotos.</p>
      <VehicleForm action={createVehicle} submitLabel="Salvar e adicionar fotos" plateEnabled={Boolean(env.plateApiToken)} />
    </>
  );
}
