'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { deleteLead, markLeadAnswered, markLeadOpened, saveLeadNotes, updateLeadStatus } from '@/app/admin/(painel)/actions';
import { formatDateTime, LEAD_STATUS_LABEL, LEAD_TYPE_LABEL } from '@/lib/format';
import type { Lead, LeadStatus } from '@/lib/types';
import { whatsappLink } from '@/lib/whatsapp';

const EVALUATION_LABEL: Record<string, string> = {
  brand: 'Marca',
  model: 'Modelo',
  year: 'Ano',
  mileage_km: 'Quilometragem',
  intent: 'Quer',
};

export function LeadDetail({ lead, defaultOpen }: { lead: Lead; defaultOpen?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saved, setSaved] = useState<string | null>(null);

  const phone = lead.phone ?? '';
  const whatsappNumber = phone.length <= 11 ? `55${phone}` : phone;

  // Abrir um lead novo põe em andamento. O ref evita repetir quando a tela atualiza.
  const opened = useRef(false);
  const markOpened = () => {
    if (opened.current || status !== 'new') return;
    opened.current = true;
    setStatus('in_progress');
    startTransition(async () => {
      await markLeadOpened(lead.id);
      router.refresh();
    });
  };

  useEffect(() => {
    if (defaultOpen) markOpened();
    // Só no carregamento: depois quem avisa é o onToggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <details className="a-lead" open={defaultOpen} onToggle={(event) => { if (event.currentTarget.open) markOpened(); }}>
      <summary>
        <span className={`a-lead-status a-lead-${status}`}>{LEAD_STATUS_LABEL[status]}</span>
        <strong>{lead.name}</strong>
        <span className="a-lead-sub">{lead.vehicle_label ?? LEAD_TYPE_LABEL[lead.type]}</span>
        <time dateTime={lead.created_at}>{formatDateTime(lead.created_at)}</time>
      </summary>
      <div className="a-lead-body">
        <dl>
          <div><dt>Tipo</dt><dd>{LEAD_TYPE_LABEL[lead.type]}</dd></div>
          {lead.phone && <div><dt>Telefone</dt><dd>{lead.phone}</dd></div>}
          {lead.email && <div><dt>E-mail</dt><dd><a href={`mailto:${lead.email}`}>{lead.email}</a></dd></div>}
          {lead.vehicle_label && <div><dt>Veículo</dt><dd>{lead.vehicle_label}</dd></div>}
          {lead.evaluation &&
            Object.entries(lead.evaluation).map(([key, value]) => (
              <div key={key}><dt>{EVALUATION_LABEL[key] ?? key}</dt><dd>{String(value)}</dd></div>
            ))}
          {lead.source_path && <div><dt>Página</dt><dd>{lead.source_path}</dd></div>}
        </dl>
        {lead.message && <p className="a-lead-message">{lead.message}</p>}

        <div className="a-lead-actions">
          {lead.phone && (
            <a
              className="a-btn a-btn-primary a-btn-small"
              href={whatsappLink(whatsappNumber, `Olá, ${lead.name}! Aqui é da Forte Veículos, recebemos seu contato pelo site.`)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (status !== 'new' && status !== 'in_progress') return;
                setStatus('answered');
                startTransition(async () => {
                  await markLeadAnswered(lead.id);
                  router.refresh();
                });
              }}
            >
              Responder no WhatsApp
            </a>
          )}
          <label className="a-inline-field">
            <span>Situação</span>
            <select
              value={status}
              disabled={pending}
              onChange={(event) => {
                const next = event.target.value as LeadStatus;
                setStatus(next);
                startTransition(async () => {
                  const result = await updateLeadStatus(lead.id, next);
                  if (!result.ok) setStatus(lead.status);
                  router.refresh();
                });
              }}
            >
              {Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="a-field a-field-wide">
          <span>Anotações internas</span>
          <textarea value={notes} rows={3} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="a-lead-actions">
          <button
            type="button"
            className="a-btn a-btn-small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveLeadNotes(lead.id, notes);
                setSaved(result.ok ? 'Anotação salva.' : 'Não foi possível salvar.');
              })
            }
          >
            Salvar anotação
          </button>
          {saved && <span role="status" className="muted">{saved}</span>}
          <button
            type="button"
            className="a-btn a-btn-small a-btn-danger a-push-right"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Excluir o contato de ${lead.name}? Esta ação não pode ser desfeita.`)) return;
              startTransition(async () => {
                await deleteLead(lead.id);
                router.refresh();
              });
            }}
          >
            Excluir contato
          </button>
        </div>
      </div>
    </details>
  );
}
