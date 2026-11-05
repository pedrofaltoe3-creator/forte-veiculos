import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="state-page">
      <p className="kicker mono">Página não encontrada</p>
      <h1>Este carro ou página saiu do pátio.</h1>
      <p>O endereço pode ter mudado, ou o carro já foi vendido. O estoque atual está logo ali.</p>
      <Link className="btn btn-accent" href="/veiculos">Ver estoque</Link>
    </div>
  );
}
