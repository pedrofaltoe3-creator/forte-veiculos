'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import {
  createRecoveryLink,
  endUserSessions,
  inviteUser,
  removeMember,
  resetUserMfa,
  setMemberActive,
  setMemberRole,
  type InviteState,
} from '@/app/admin/(painel)/actions';
import { submitKeepingValues } from '@/lib/forms';
import type { MemberRole } from '@/lib/types';

export type MemberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  active: boolean;
};

function AccessLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="a-access-link">
      <input readOnly value={link} aria-label="Link de acesso" onFocus={(event) => event.target.select()} />
      <button
        type="button"
        className="a-btn a-btn-small"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

export function InviteUserForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteUser, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <section className="a-card" aria-labelledby="convite-title">
      <div className="a-card-head"><h2 id="convite-title">Criar acesso</h2></div>
      <form action={action} onSubmit={submitKeepingValues(action)} className="a-form a-grid">
        <label className={`a-field${errors.full_name ? ' has-error' : ''}`}>
          <span>Nome</span>
          <input name="full_name" required maxLength={120} />
          {errors.full_name && <small className="a-field-error" role="alert">{errors.full_name}</small>}
        </label>
        <label className={`a-field${errors.email ? ' has-error' : ''}`}>
          <span>E-mail</span>
          <input name="email" type="email" required maxLength={180} />
          {errors.email && <small className="a-field-error" role="alert">{errors.email}</small>}
        </label>
        <label className="a-field">
          <span>Permissão</span>
          <select name="role" defaultValue="owner">
            <option value="owner">Proprietário: estoque, preços, fotos e leads</option>
            <option value="master">Master: tudo, inclusive acessos e ajustes técnicos</option>
          </select>
        </label>
        <div className="a-form-actions a-field-wide">
          <button className="a-btn a-btn-primary" disabled={pending}>{pending ? 'Criando...' : 'Criar acesso'}</button>
        </div>
      </form>
      {state && (
        <div className={`alert ${state.ok ? 'alert-ok' : 'alert-error'}`} role={state.ok ? 'status' : 'alert'}>
          <p>{state.message}</p>
          {state.link && <AccessLink link={state.link} />}
        </div>
      )}
    </section>
  );
}

export function MemberCard({ member, isSelf }: { member: MemberRow; isSelf: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message?: string; link?: string } | null>(null);

  const run = (operation: () => Promise<{ ok: boolean; message?: string; link?: string }>) => {
    setFeedback(null);
    startTransition(async () => {
      const result = await operation();
      setFeedback(result.ok && !result.message ? null : result);
      router.refresh();
    });
  };

  return (
    <li className={`a-member${member.active ? '' : ' is-inactive'}`}>
      <div className="a-member-head">
        <div>
          <strong>{member.fullName ?? member.email}</strong>
          <span className="a-row-sub">{member.email}{isSelf ? ' (você)' : ''}</span>
        </div>
        <label className="a-inline-field">
          <span className="sr-only">Permissão de {member.email}</span>
          <select
            value={member.role}
            disabled={pending}
            onChange={(event) => run(() => setMemberRole(member.userId, event.target.value))}
          >
            <option value="owner">Proprietário</option>
            <option value="master">Master</option>
          </select>
        </label>
      </div>
      <div className="a-member-actions">
        <button type="button" className="a-btn a-btn-small" disabled={pending} onClick={() => run(() => createRecoveryLink(member.userId))}>
          Link para nova senha
        </button>
        <button type="button" className="a-btn a-btn-small" disabled={pending} onClick={() => run(() => endUserSessions(member.userId))}>
          Encerrar sessões
        </button>
        <button
          type="button"
          className="a-btn a-btn-small"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Redefinir o MFA de ${member.email}? A pessoa cadastra de novo no próximo login.`)) {
              run(() => resetUserMfa(member.userId));
            }
          }}
        >
          Redefinir MFA
        </button>
        <button type="button" className="a-btn a-btn-small" disabled={pending} onClick={() => run(() => setMemberActive(member.userId, !member.active))}>
          {member.active ? 'Desativar' : 'Reativar'}
        </button>
        <button
          type="button"
          className="a-btn a-btn-small a-btn-danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remover o acesso de ${member.email} a esta empresa?`)) run(() => removeMember(member.userId));
          }}
        >
          Remover
        </button>
      </div>
      {feedback && (
        <div className={`alert ${feedback.ok ? 'alert-ok' : 'alert-error'}`} role={feedback.ok ? 'status' : 'alert'}>
          <p>{feedback.message ?? 'Não foi possível concluir.'}</p>
          {feedback.link && <AccessLink link={feedback.link} />}
        </div>
      )}
    </li>
  );
}
