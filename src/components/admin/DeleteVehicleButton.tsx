'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deleteVehicle } from '@/app/admin/(painel)/actions';

export function DeleteVehicleButton({ vehicleId, name }: { vehicleId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="a-btn a-btn-danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Excluir ${name} e todas as fotos? Esta ação não pode ser desfeita.`)) return;
        startTransition(async () => {
          const result = await deleteVehicle(vehicleId);
          if (result.ok) router.push('/admin/veiculos');
          else window.alert(result.message ?? 'Não foi possível excluir.');
        });
      }}
    >
      {pending ? 'Excluindo...' : 'Excluir veículo'}
    </button>
  );
}
