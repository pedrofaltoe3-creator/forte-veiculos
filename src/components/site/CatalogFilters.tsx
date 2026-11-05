'use client';

import { useEffect, useRef } from 'react';
import { CATEGORY_LABEL, FUEL_LABEL, TRANSMISSION_LABEL } from '@/lib/format';
import type { VehicleCategory } from '@/lib/types';

type Props = {
  values: Record<string, string>;
  brands: { name: string; count: number }[];
  categories: { name: VehicleCategory; count: number }[];
  hasFilters: boolean;
};

// Formulário GET comum: funciona sem JavaScript e deixa a busca na URL. O script só envia ao mudar um campo.
export function CatalogFilters({ values, brands, categories, hasFilters }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  // Em telas grandes os filtros já abrem visíveis; no celular ficam recolhidos para o estoque aparecer antes.
  useEffect(() => {
    if (detailsRef.current && matchMedia('(min-width: 721px)').matches) detailsRef.current.open = true;
  }, []);

  return (
    <form className="filters" action="/veiculos" method="get" ref={formRef} role="search" aria-label="Filtrar estoque">
      <div className="filters-search">
        <label htmlFor="q">Buscar</label>
        <input id="q" name="q" type="search" defaultValue={values.q} placeholder="Modelo, marca ou ano" maxLength={60} />
      </div>

      <details className="filters-more" open={hasFilters} ref={detailsRef}>
        <summary>Filtros</summary>
        <div className="filters-grid">
          <div>
            <label htmlFor="marca">Marca</label>
            <select id="marca" name="marca" defaultValue={values.marca ?? ''} onChange={submit}>
              <option value="">Todas</option>
              {brands.map((brand) => (
                <option key={brand.name} value={brand.name}>{brand.name} ({brand.count})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="categoria">Categoria</label>
            <select id="categoria" name="categoria" defaultValue={values.categoria ?? ''} onChange={submit}>
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.name} value={category.name}>{CATEGORY_LABEL[category.name]} ({category.count})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cambio">Câmbio</label>
            <select id="cambio" name="cambio" defaultValue={values.cambio ?? ''} onChange={submit}>
              <option value="">Todos</option>
              {Object.entries(TRANSMISSION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="combustivel">Combustível</label>
            <select id="combustivel" name="combustivel" defaultValue={values.combustivel ?? ''} onChange={submit}>
              <option value="">Todos</option>
              {Object.entries(FUEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ano_min">Ano a partir de</label>
            <input id="ano_min" name="ano_min" type="number" inputMode="numeric" min={1950} max={2100} defaultValue={values.ano_min} />
          </div>
          <div>
            <label htmlFor="preco_max">Preço até (R$)</label>
            <input id="preco_max" name="preco_max" type="number" inputMode="numeric" min={0} step={1000} defaultValue={values.preco_max} />
          </div>
          <div>
            <label htmlFor="km_max">Quilometragem até</label>
            <input id="km_max" name="km_max" type="number" inputMode="numeric" min={0} step={1000} defaultValue={values.km_max} />
          </div>
          <div className="filter-check">
            <label>
              <input type="checkbox" name="oferta" value="1" defaultChecked={values.oferta === '1'} onChange={submit} />
              Só ofertas
            </label>
          </div>
          <div>
            <label htmlFor="ordem">Ordenar por</label>
            <select id="ordem" name="ordem" defaultValue={values.ordem ?? 'recentes'} onChange={submit}>
              <option value="recentes">Mais recentes</option>
              <option value="menor-preco">Menor preço</option>
              <option value="maior-preco">Maior preço</option>
              <option value="menor-km">Menor quilometragem</option>
              <option value="mais-novos">Ano mais novo</option>
            </select>
          </div>
        </div>
      </details>

      <div className="filters-actions">
        <button type="submit" className="btn btn-ink btn-small">Buscar</button>
        {hasFilters && <a className="text-link text-link-ink" href="/veiculos">Limpar</a>}
      </div>
    </form>
  );
}
