'use client';

import { useEffect, useState } from 'react';
import type { BusinessHours } from '@/lib/types';

function isOpenNow(hours: BusinessHours[], date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const time = `${get('hour')}:${get('minute')}`;
  return hours.some((slot) => slot.days.includes(day) && time >= slot.open && time < slot.close);
}

// Calculado no navegador, porque a página é entregue com o horário do momento da visita.
export function OpenNow({ hours }: { hours: BusinessHours[] }) {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setOpen(isOpenNow(hours));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [hours]);

  if (open === null) return <span className="open-now mono" aria-hidden="true">&nbsp;</span>;
  return (
    <span className={`open-now mono${open ? ' is-open' : ''}`}>
      <span className="open-dot" aria-hidden="true" />
      {open ? 'Aberto agora' : 'Fechado agora'}
    </span>
  );
}
