'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  login,
  requestPasswordReset,
  startMfaEnrollment,
  updatePassword,
  verifyMfa,
  type MfaEnrollment,
} from '@/app/admin/auth-actions';
import { submitKeepingValues } from '@/lib/forms';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="auth-form">
      <label>
        E-mail
        <input name="email" type="email" autoComplete="username" required maxLength={180} autoFocus />
      </label>
      <label>
        Senha
        <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </label>
      {state && !state.ok && <p className="alert alert-error" role="alert">{state.message}</p>}
      <button className="a-btn a-btn-primary a-btn-block" disabled={pending}>
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  if (state?.ok) return <p className="alert alert-ok" role="status">{state.message}</p>;
  return (
    <form action={action} className="auth-form">
      <label>
        E-mail da sua conta
        <input name="email" type="email" autoComplete="username" required maxLength={180} autoFocus />
      </label>
      <button className="a-btn a-btn-primary a-btn-block" disabled={pending}>
        {pending ? 'Enviando...' : 'Enviar link'}
      </button>
    </form>
  );
}

export function NewPasswordForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="auth-form">
      <label>
        Nova senha
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} autoFocus />
        <small>Ao menos 12 caracteres, com letras e números.</small>
      </label>
      <label>
        Repita a nova senha
        <input name="confirm" type="password" autoComplete="new-password" required maxLength={128} />
      </label>
      {needsCode && (
        <label>
          Código do aplicativo autenticador
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        </label>
      )}
      {state && !state.ok && <p className="alert alert-error" role="alert">{state.message}</p>}
      <button className="a-btn a-btn-primary a-btn-block" disabled={pending}>
        {pending ? 'Salvando...' : 'Salvar senha'}
      </button>
    </form>
  );
}

export function MfaChallengeForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState(verifyMfa, null);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="factor_id" value={factorId} />
      <label>
        Código de 6 números
        <input name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
      </label>
      {state && !state.ok && <p className="alert alert-error" role="alert">{state.message}</p>}
      <button className="a-btn a-btn-primary a-btn-block" disabled={pending}>
        {pending ? 'Confirmando...' : 'Confirmar'}
      </button>
    </form>
  );
}

export function MfaEnrollForm() {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);

  useEffect(() => {
    let active = true;
    startMfaEnrollment().then((result) => {
      if (active) setEnrollment(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!enrollment) return <p className="muted">Preparando o código...</p>;
  if ('error' in enrollment) return <p className="alert alert-error" role="alert">{enrollment.error}</p>;

  return (
    <div className="mfa-enroll">
      <ol className="mfa-steps">
        <li>Instale um aplicativo autenticador no celular, como Google Authenticator ou Microsoft Authenticator.</li>
        <li>No aplicativo, escolha adicionar conta e aponte a câmera para o código abaixo.</li>
        <li>Digite os 6 números que aparecerem.</li>
      </ol>
      <img className="mfa-qr" src={enrollment.qrCode} alt="Código QR para o aplicativo autenticador" width={200} height={200} />
      <details className="mfa-secret">
        <summary>Não consegue ler o código?</summary>
        <p>Digite esta chave no aplicativo:</p>
        <code>{enrollment.secret}</code>
      </details>
      <MfaChallengeForm factorId={enrollment.factorId} />
    </div>
  );
}
