'use client';

export default function SiteError({ reset }: { reset: () => void }) {
  return (
    <div className="state-page">
      <p className="kicker mono">Algo saiu errado</p>
      <h1>Não conseguimos carregar esta página.</h1>
      <p>Tente de novo. Se continuar, fale com a loja pelo WhatsApp (28) 99909-7412.</p>
      <button type="button" className="btn btn-accent" onClick={reset}>Tentar de novo</button>
    </div>
  );
}
