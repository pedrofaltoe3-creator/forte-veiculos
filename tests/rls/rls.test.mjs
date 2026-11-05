import { beforeAll, describe, expect, it } from 'vitest';
import { anon, createDb, service, user } from './harness.mjs';

const A = { company: '', owner: '', master: '', vehicle: '', draft: '', lead: '', photo: '' };
const B = { company: '', owner: '', master: '', vehicle: '', lead: '', photo: '' };
let db;
let outsider;

const one = async (client, sql, params) => (await client.query(sql, params)).rows[0];
const rows = async (client, sql, params) => (await client.query(sql, params)).rows;
const denied = (promise) => expect(promise).rejects.toThrow(/permission denied|row-level security|violates row-level/i);

async function newUser(email) {
  const { id } = await one(db, 'insert into auth.users (email) values ($1) returning id', [email]);
  return id;
}

async function seedCompany(target, slug) {
  target.company = (await one(db, `insert into public.companies (slug, name) values ($1, $1) returning id`, [slug])).id;
  await db.query(
    `insert into public.site_settings (company_id, display_name, whatsapp) values ($1, $2, '5528999990000')`,
    [target.company, slug],
  );
  await db.query(`insert into public.technical_settings (company_id) values ($1)`, [target.company]);
  target.owner = await newUser(`owner@${slug}.test`);
  target.master = await newUser(`master@${slug}.test`);
  await db.query(
    `insert into public.company_members (company_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'master')`,
    [target.company, target.owner, target.master],
  );
  target.vehicle = (await one(db,
    `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status)
     values ($1, 'carro-a', 'Toyota', 'Corolla', 2023, 12999000, 'available') returning id`,
    [target.company])).id;
  target.draft = (await one(db,
    `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status)
     values ($1, 'rascunho', 'Honda', 'Civic', 2020, 9000000, 'draft') returning id`,
    [target.company])).id;
  target.photo = (await one(db,
    `insert into public.vehicle_photos (company_id, vehicle_id, storage_path, thumb_path, width, height)
     values ($1, $2, $3, $4, 800, 600) returning id`,
    [target.company, target.vehicle, `${target.company}/${target.vehicle}/a.webp`, `${target.company}/${target.vehicle}/a-800.webp`])).id;
  target.lead = (await one(db,
    `insert into public.leads (company_id, type, name, phone, consent_version)
     values ($1, 'contact', 'Cliente', '28999990000', 'v1') returning id`,
    [target.company])).id;
}

beforeAll(async () => {
  db = await createDb();
  await seedCompany(A, 'empresa-a');
  await seedCompany(B, 'empresa-b');
  outsider = await newUser('ninguem@fora.test');
}, 120_000);

describe('cobertura de RLS', () => {
  it('toda tabela do schema public tem RLS ativo', async () => {
    const missing = await rows(db,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(missing).toEqual([]);
  });

  it('funções SECURITY DEFINER fixam o search_path', async () => {
    const unsafe = await rows(db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(unsafe).toEqual([]);
  });
});

describe('visitante anônimo', () => {
  it('vê veículos publicados, nunca rascunhos', async () => {
    const list = await anon(db, (c) => rows(c, `select slug, status from public.vehicles where company_id = $1`, [A.company]));
    expect(list.map((v) => v.slug)).toEqual(['carro-a']);
  });

  it('não lê leads, histórico, consentimentos, vínculos nem perfis', async () => {
    for (const table of ['leads', 'audit_logs', 'cookie_consents', 'company_members', 'profiles']) {
      await denied(anon(db, (c) => c.query(`select * from public.${table}`)));
    }
  });

  it('não lê colunas internas do veículo', async () => {
    await denied(anon(db, (c) => c.query(`select created_by from public.vehicles`)));
  });

  it('não escreve em nada', async () => {
    await denied(anon(db, (c) => c.query(
      `insert into public.leads (company_id, type, name, consent_version) values ($1, 'contact', 'Spam', 'v1')`, [A.company])));
    await denied(anon(db, (c) => c.query(
      `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents) values ($1, 'x', 'x', 'x', 2020, 1)`, [A.company])));
    await denied(anon(db, (c) => c.query(`update public.vehicles set price_cents = 1`)));
    await denied(anon(db, (c) => c.query(`delete from public.vehicles`)));
    await denied(anon(db, (c) => c.query(`update public.site_settings set whatsapp = '5500000000000'`)));
  });

  it('não chama funções reservadas ao servidor', async () => {
    await denied(anon(db, (c) => c.query(`select public.check_rate_limit('x', 1, 60)`)));
    await denied(anon(db, (c) => c.query(`select public.revoke_user_sessions($1)`, [A.owner])));
    await denied(anon(db, (c) => c.query(`select public.log_admin_event($1, null, null, 'x')`, [A.company])));
    await denied(anon(db, (c) => c.query(`select public.purge_expired_personal_data()`)));
    await denied(anon(db, (c) => c.query(`select public.set_primary_photo($1)`, [A.photo])));
  });

  it('não acessa o schema private', async () => {
    await denied(anon(db, (c) => c.query(`select * from private.rate_limits`)));
  });

  it('não envia arquivos ao Storage', async () => {
    await denied(anon(db, (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${A.company}/${A.vehicle}/x.webp`])));
  });
});

describe('MFA obrigatório (aal2)', () => {
  it('proprietário com sessão aal1 não opera o painel', async () => {
    const leads = await user(db, A.owner, 'aal1', (c) => rows(c, `select id from public.leads`));
    expect(leads).toEqual([]);
    await denied(user(db, A.owner, 'aal1', (c) => c.query(
      `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents) values ($1, 'novo', 'x', 'x', 2020, 1)`, [A.company])));
    const updated = await user(db, A.owner, 'aal1', (c) => c.query(
      `update public.vehicles set price_cents = 1 where id = $1`, [A.vehicle]));
    expect(updated.affectedRows).toBe(0);
  });

  it('rascunhos ficam ocultos em aal1 e visíveis em aal2', async () => {
    const aal1 = await user(db, A.owner, 'aal1', (c) => rows(c, `select id from public.vehicles where id = $1`, [A.draft]));
    expect(aal1).toEqual([]);
    const aal2 = await user(db, A.owner, 'aal2', (c) => rows(c, `select id from public.vehicles where id = $1`, [A.draft]));
    expect(aal2).toHaveLength(1);
  });

  it('o próprio vínculo é legível em aal1 para o servidor decidir o redirecionamento', async () => {
    const own = await user(db, A.owner, 'aal1', (c) => rows(c, `select role from public.company_members`));
    expect(own).toEqual([{ role: 'owner' }]);
  });
});

describe('proprietário (aal2)', () => {
  it('cadastra, edita preço, muda status e exclui veículo da sua empresa', async () => {
    const id = await user(db, A.owner, 'aal2', async (c) => {
      const created = await one(c,
        `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status)
         values ($1, 'novo-carro', 'Ford', 'Ranger', 2019, 12999000, 'available') returning id, created_by`, [A.company]);
      expect(created.created_by).toBe(A.owner);
      return created.id;
    });
    await user(db, A.owner, 'aal2', async (c) => {
      const sold = await one(c,
        `update public.vehicles set price_cents = 11000000, status = 'sold', is_featured = true where id = $1
         returning price_cents, status, sold_at, is_featured`, [id]);
      expect(Number(sold.price_cents)).toBe(11000000);
      expect(sold.status).toBe('sold');
      expect(sold.sold_at).not.toBeNull();
      expect(sold.is_featured).toBe(false);
      const reserved = await one(c, `update public.vehicles set status = 'reserved' where id = $1 returning sold_at`, [id]);
      expect(reserved.sold_at).toBeNull();
      const removed = await c.query(`delete from public.vehicles where id = $1`, [id]);
      expect(removed.affectedRows).toBe(1);
    });
  });

  it('não altera configurações técnicas nem usuários', async () => {
    const tech = await user(db, A.owner, 'aal2', (c) => c.query(
      `update public.technical_settings set ga4_id = 'G-HACK123' where company_id = $1`, [A.company]));
    expect(tech.affectedRows).toBe(0);
    await denied(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into public.company_members (company_id, user_id, role) values ($1, $2, 'master')`, [A.company, outsider])));
    const promote = await user(db, A.owner, 'aal2', (c) => c.query(
      `update public.company_members set role = 'master' where user_id = $1`, [A.owner]));
    expect(promote.affectedRows).toBe(0);
    const removeMaster = await user(db, A.owner, 'aal2', (c) => c.query(
      `delete from public.company_members where user_id = $1`, [A.master]));
    expect(removeMaster.affectedRows).toBe(0);
  });

  it('altera dados comerciais, mas não o conteúdo de um lead', async () => {
    await user(db, A.owner, 'aal2', async (c) => {
      const r = await c.query(`update public.site_settings set phone_display = '(28) 3333-3333' where company_id = $1`, [A.company]);
      expect(r.affectedRows).toBe(1);
      const lead = await c.query(`update public.leads set status = 'in_progress' where id = $1`, [A.lead]);
      expect(lead.affectedRows).toBe(1);
    });
    await denied(user(db, A.owner, 'aal2', (c) => c.query(`update public.leads set phone = '000' where id = $1`, [A.lead])));
  });

  it('troca as fotos do site só na própria empresa e com MFA', async () => {
    const set = (images, company) => (c) => c.query(`update public.site_settings set images = $1 where company_id = $2`, [images, company]);
    await user(db, A.owner, 'aal2', async (c) => {
      expect((await set('{"comprar": "a/site/x.webp"}', A.company)(c)).affectedRows).toBe(1);
      expect((await set('{"comprar": "invasao"}', B.company)(c)).affectedRows).toBe(0);
      expect((await set('{}', A.company)(c)).affectedRows).toBe(1);
    });
    await user(db, A.owner, 'aal1', async (c) => {
      expect((await set('{"comprar": "sem-mfa"}', A.company)(c)).affectedRows).toBe(0);
    });
    await expect(user(db, A.owner, 'aal2', set('[]', A.company))).rejects.toThrow(/check constraint/i);
    await denied(anon(db, set('{}', A.company)));
  });

  it('não insere lead direto e não altera sua própria empresa de veículo', async () => {
    await denied(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into public.leads (company_id, type, name, consent_version) values ($1, 'contact', 'x y', 'v1')`, [A.company])));
    await denied(user(db, A.owner, 'aal2', (c) => c.query(
      `update public.vehicles set company_id = $1 where id = $2`, [B.company, A.vehicle])));
  });
});

describe('isolamento entre empresas', () => {
  it('não lê leads, histórico nem rascunhos de outra empresa', async () => {
    await user(db, A.owner, 'aal2', async (c) => {
      expect(await rows(c, `select id from public.leads where company_id = $1`, [B.company])).toEqual([]);
      expect(await rows(c, `select id from public.audit_logs where company_id = $1`, [B.company])).toEqual([]);
      expect(await rows(c, `select id from public.vehicles where id = $1`, [B.draft])).toEqual([]);
      expect(await rows(c, `select user_id from public.company_members where company_id = $1`, [B.company])).toEqual([]);
    });
  });

  it('não altera nem exclui nada de outra empresa, mesmo sendo master', async () => {
    await user(db, A.master, 'aal2', async (c) => {
      expect((await c.query(`update public.vehicles set price_cents = 1 where id = $1`, [B.vehicle])).affectedRows).toBe(0);
      expect((await c.query(`delete from public.vehicles where id = $1`, [B.vehicle])).affectedRows).toBe(0);
      expect((await c.query(`update public.leads set status = 'lost' where id = $1`, [B.lead])).affectedRows).toBe(0);
      expect((await c.query(`delete from public.leads where id = $1`, [B.lead])).affectedRows).toBe(0);
      expect((await c.query(`update public.site_settings set display_name = 'x y' where company_id = $1`, [B.company])).affectedRows).toBe(0);
      expect((await c.query(`update public.technical_settings set cnpj = null where company_id = $1`, [B.company])).affectedRows).toBe(0);
      expect((await c.query(`delete from public.company_members where company_id = $1`, [B.company])).affectedRows).toBe(0);
    });
  });

  it('não cria dados na empresa alheia', async () => {
    await denied(user(db, A.master, 'aal2', (c) => c.query(
      `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents) values ($1, 'x', 'x', 'x', 2020, 1)`, [B.company])));
    await denied(user(db, A.master, 'aal2', (c) => c.query(
      `insert into public.company_members (company_id, user_id, role) values ($1, $2, 'master')`, [B.company, A.master])));
  });

  it('a FK composta impede foto apontando para veículo de outra empresa', async () => {
    await expect(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into public.vehicle_photos (company_id, vehicle_id, storage_path, thumb_path, width, height)
       values ($1, $2, $3, $4, 10, 10)`,
      [A.company, B.vehicle, `${A.company}/${B.vehicle}/x.webp`, `${A.company}/${B.vehicle}/x-800.webp`]))).rejects.toThrow();
  });

  it('o caminho da foto precisa ser da própria empresa e veículo', async () => {
    await expect(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into public.vehicle_photos (company_id, vehicle_id, storage_path, thumb_path, width, height)
       values ($1, $2, $3, $3, 10, 10)`,
      [A.company, A.vehicle, `${B.company}/${B.vehicle}/x.webp`]))).rejects.toThrow();
  });

  it('não define foto principal de outra empresa', async () => {
    await expect(user(db, A.owner, 'aal2', (c) => c.query(`select public.set_primary_photo($1)`, [B.photo]))).rejects.toThrow();
    const photo = await one(db, `select is_primary from public.vehicle_photos where id = $1`, [B.photo]);
    expect(photo.is_primary).toBe(true);
  });

  it('Storage: só envia e apaga na pasta da própria empresa', async () => {
    await user(db, A.owner, 'aal2', (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${A.company}/${A.vehicle}/ok.webp`]));
    await denied(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${B.company}/${B.vehicle}/invasao.webp`])));
    await denied(user(db, A.owner, 'aal1', (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${A.company}/${A.vehicle}/aal1.webp`])));
    await denied(user(db, A.owner, 'aal2', (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, ['nao-e-uuid/x/y.webp'])));
    await db.query(`insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [`${B.company}/${B.vehicle}/alvo.webp`]);
    const removed = await user(db, A.owner, 'aal2', (c) => c.query(
      `delete from storage.objects where name = $1`, [`${B.company}/${B.vehicle}/alvo.webp`]));
    expect(removed.affectedRows).toBe(0);
  });

  it('usuário sem vínculo não acessa nada, mesmo com aal2', async () => {
    await user(db, outsider, 'aal2', async (c) => {
      expect(await rows(c, `select id from public.leads`)).toEqual([]);
      expect(await rows(c, `select id from public.audit_logs`)).toEqual([]);
      expect(await rows(c, `select company_id from public.company_members`)).toEqual([]);
      expect((await c.query(`update public.vehicles set price_cents = 1`)).affectedRows).toBe(0);
      expect((await rows(c, `select id from public.vehicles where status = 'draft'`))).toEqual([]);
    });
  });
});

describe('master', () => {
  it('administra vínculos e dados técnicos da sua empresa', async () => {
    await user(db, A.master, 'aal2', async (c) => {
      const tech = await c.query(`update public.technical_settings set ga4_id = 'G-ABC1234' where company_id = $1`, [A.company]);
      expect(tech.affectedRows).toBe(1);
      const members = await rows(c, `select user_id from public.company_members where company_id = $1`, [A.company]);
      expect(members).toHaveLength(2);
    });
  });

  it('não remove o último master ativo', async () => {
    await expect(user(db, A.master, 'aal2', (c) => c.query(
      `update public.company_members set is_active = false where user_id = $1`, [A.master]))).rejects.toThrow(/master/);
    await expect(user(db, A.master, 'aal2', (c) => c.query(
      `delete from public.company_members where user_id = $1`, [A.master]))).rejects.toThrow(/master/);
  });

  it('usuário desativado perde o acesso na hora', async () => {
    const before = await user(db, B.owner, 'aal2', (c) => rows(c, `select id from public.leads`));
    expect(before).toHaveLength(1);
    await db.query(`update public.profiles set is_active = false where id = $1`, [B.owner]);
    const after = await user(db, B.owner, 'aal2', (c) => rows(c, `select id from public.leads`));
    expect(after).toEqual([]);
    await db.query(`update public.profiles set is_active = true where id = $1`, [B.owner]);
  });
});

describe('histórico de alterações', () => {
  it('registra autor e diferença, sem dados pessoais de lead', async () => {
    await user(db, A.owner, 'aal2', (c) => c.query(`update public.vehicles set price_cents = 12000000 where id = $1`, [A.vehicle]));
    const log = await user(db, A.master, 'aal2', (c) =>
      one(c, `select * from public.audit_logs where entity_id = $1 and action = 'vehicles.update' order by id desc limit 1`, [A.vehicle]));
    expect(log.actor_id).toBe(A.owner);
    expect(log.actor_email).toBe('owner@empresa-a.test');
    expect(Object.keys(log.after)).toEqual(['price_cents']);

    const leadLog = await user(db, A.master, 'aal2', (c) => one(c,
      `select * from public.audit_logs where entity_id = $1 and action = 'leads.update' order by id desc limit 1`, [A.lead]));
    expect(leadLog.after).toEqual({ status: 'in_progress' });
    expect(JSON.stringify(leadLog)).not.toContain('28999990000');
  });

  it('só o master lê: o proprietário não vê nenhuma linha', async () => {
    expect(await user(db, A.owner, 'aal2', (c) => rows(c, `select id from public.audit_logs`))).toEqual([]);
    expect((await user(db, A.master, 'aal2', (c) => rows(c, `select id from public.audit_logs where company_id = $1`, [A.company]))).length).toBeGreaterThan(0);
  });

  it('não pode ser alterado nem apagado por ninguém', async () => {
    await denied(user(db, A.master, 'aal2', (c) => c.query(`delete from public.audit_logs`)));
    await denied(user(db, A.master, 'aal2', (c) => c.query(`update public.audit_logs set action = 'x'`)));
    await denied(user(db, A.master, 'aal2', (c) => c.query(
      `insert into public.audit_logs (company_id, action, entity) values ($1, 'x', 'x')`, [A.company])));
    await expect(db.query(`delete from public.audit_logs`)).rejects.toThrow(/histórico/);
  });
});

describe('fotos', () => {
  it('a primeira é principal, a troca é única e a próxima assume ao excluir', async () => {
    const second = await user(db, A.owner, 'aal2', async (c) => {
      const inserted = await one(c,
        `insert into public.vehicle_photos (company_id, vehicle_id, storage_path, thumb_path, width, height, position)
         values ($1, $2, $3, $4, 10, 10, 1) returning id, is_primary`,
        [A.company, A.vehicle, `${A.company}/${A.vehicle}/b.webp`, `${A.company}/${A.vehicle}/b-800.webp`]);
      expect(inserted.is_primary).toBe(false);
      await c.query(`select public.set_primary_photo($1)`, [inserted.id]);
      return inserted.id;
    });
    const primaries = await rows(db, `select id from public.vehicle_photos where vehicle_id = $1 and is_primary`, [A.vehicle]);
    expect(primaries).toEqual([{ id: second }]);
    await user(db, A.owner, 'aal2', (c) => c.query(`delete from public.vehicle_photos where id = $1`, [second]));
    const after = await rows(db, `select id from public.vehicle_photos where vehicle_id = $1 and is_primary`, [A.vehicle]);
    expect(after).toEqual([{ id: A.photo }]);
  });
});

describe('limite de tentativas', () => {
  it('bloqueia depois do limite', async () => {
    const hit = () => service(db, (c) => one(c, `select public.check_rate_limit('teste', 2, 60) as ok`));
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(false);
  });
});

describe('dados públicos do site', () => {
  it('get_public_site resolve por domínio e cai no padrão', async () => {
    const byHost = await anon(db, (c) => one(c, `select public.get_public_site('www.forteveiculoscachoeiro.com.br', 'nao-existe') as s`));
    expect(byHost.s.company.slug).toBe('forte-veiculos');
    expect(byHost.s.settings.whatsapp).toBe('5528999097412');
    const fallback = await anon(db, (c) => one(c, `select public.get_public_site('outro.host.test', 'forte-veiculos') as s`));
    expect(fallback.s.company.slug).toBe('forte-veiculos');
  });

  it('empresa suspensa some do site público', async () => {
    await db.query(`update public.companies set status = 'suspended' where id = $1`, [B.company]);
    const list = await anon(db, (c) => rows(c, `select id from public.vehicles where company_id = $1`, [B.company]));
    expect(list).toEqual([]);
    const blocked = await user(db, B.owner, 'aal2', (c) => rows(c, `select id from public.leads`));
    expect(blocked).toEqual([]);
    await db.query(`update public.companies set status = 'active' where id = $1`, [B.company]);
  });
});

describe('oferta, custo e financeiro', () => {
  const sale = (company, vehicle) => (c) => c.query(
    `select public.confirm_vehicle_sale(p_company => $1, p_vehicle => $2, p_amount_cents => 11000000, p_sold_on => '2026-11-03', p_payment => 'pix')`,
    [company, vehicle],
  );

  it('visitante lê a oferta, mas nunca o custo nem a FIPE', async () => {
    await user(db, A.owner, 'aal2', (c) => c.query(
      `update public.vehicles set offer_price_cents = 10000000, offer_until = '2030-01-01', purchase_cost_cents = 9000000, fipe_price_cents = 11500000 where id = $1`, [A.vehicle]));
    const row = await anon(db, (c) => one(c, `select offer_price_cents, offer_until from public.vehicles where id = $1`, [A.vehicle]));
    expect(Number(row.offer_price_cents)).toBe(10000000);
    await denied(anon(db, (c) => c.query(`select purchase_cost_cents from public.vehicles where id = $1`, [A.vehicle])));
    await denied(anon(db, (c) => c.query(`select fipe_price_cents from public.vehicles where id = $1`, [A.vehicle])));
    await denied(anon(db, (c) => c.query(`update public.vehicles set offer_price_cents = 1 where id = $1`, [A.vehicle])));
  });

  it('oferta acima do preço não vale, e o banco a descarta', async () => {
    const row = await user(db, A.owner, 'aal2', (c) => one(c,
      `update public.vehicles set offer_price_cents = 99000000 where id = $1 returning offer_price_cents, offer_until`, [A.vehicle]));
    expect(row.offer_price_cents).toBeNull();
    expect(row.offer_until).toBeNull();
  });

  it('confirmar venda grava o valor e o custo da época, e o carro sai de oferta', async () => {
    const vehicle = await one(db,
      `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status, offer_price_cents, purchase_cost_cents, is_featured)
       values ($1, 'para-vender', 'Fiat', 'Uno', 2020, 5000000, 'reserved', 4500000, 3000000, true) returning id`, [A.company]);
    await user(db, A.owner, 'aal2', sale(A.company, vehicle.id));
    const after = await one(db, `select status, offer_price_cents, is_featured from public.vehicles where id = $1`, [vehicle.id]);
    expect(after).toMatchObject({ status: 'sold', offer_price_cents: null, is_featured: false });
    const entry = await user(db, A.owner, 'aal2', (c) => one(c, `select * from public.financial_entries where vehicle_id = $1`, [vehicle.id]));
    expect(entry.kind).toBe('sale');
    expect(Number(entry.amount_cents)).toBe(11000000);
    expect(Number(entry.cost_cents)).toBe(3000000);
    expect(entry.description).toBe('Fiat Uno 2020');

    await expect(user(db, A.owner, 'aal2', sale(A.company, vehicle.id))).rejects.toThrow(/duplicate|unique/i);

    await user(db, A.owner, 'aal2', (c) => c.query(`select public.undo_vehicle_sale(p_company => $1, p_entry => $2)`, [A.company, entry.id]));
    const undone = await one(db, `select status from public.vehicles where id = $1`, [vehicle.id]);
    expect(undone.status).toBe('available');
    expect((await db.query(`select id from public.financial_entries where vehicle_id = $1`, [vehicle.id])).rows).toEqual([]);
  });

  it('venda continua no financeiro mesmo se o carro for excluído', async () => {
    const vehicle = await one(db,
      `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status) values ($1, 'vai-sumir', 'Ford', 'Ka', 2019, 4000000, 'available') returning id`, [A.company]);
    await user(db, A.owner, 'aal2', sale(A.company, vehicle.id));
    await user(db, A.owner, 'aal2', (c) => c.query(`delete from public.vehicles where id = $1`, [vehicle.id]));
    const entry = await one(db, `select vehicle_id, description from public.financial_entries where description = 'Ford Ka 2019'`);
    expect(entry).toEqual({ vehicle_id: null, description: 'Ford Ka 2019' });
  });

  it('financeiro é isolado por empresa, exige MFA e não abre para visitante', async () => {
    const entry = (company) => (c) => c.query(
      `insert into public.financial_entries (company_id, kind, description, amount_cents, occurred_on) values ($1, 'expense', 'Aluguel', 100000, '2026-11-01')`, [company]);
    await user(db, A.owner, 'aal2', entry(A.company));
    await denied(user(db, B.owner, 'aal2', entry(A.company)));
    await denied(user(db, A.owner, 'aal1', entry(A.company)));
    await denied(anon(db, (c) => c.query(`select id from public.financial_entries`)));
    expect(await user(db, B.master, 'aal2', (c) => rows(c, `select id from public.financial_entries where company_id = $1`, [A.company]))).toEqual([]);
    expect(await user(db, A.owner, 'aal1', (c) => rows(c, `select id from public.financial_entries`))).toEqual([]);
    expect((await user(db, B.master, 'aal2', (c) => c.query(`delete from public.financial_entries where company_id = $1`, [A.company]))).affectedRows).toBe(0);
  });

  it('não confirma venda de carro de outra empresa, e visitante não chama a função', async () => {
    await expect(user(db, B.owner, 'aal2', sale(B.company, A.vehicle))).rejects.toThrow(/não encontrado/);
    await expect(user(db, B.owner, 'aal2', sale(A.company, A.vehicle))).rejects.toThrow(/não encontrado/);
    await denied(anon(db, sale(A.company, A.vehicle)));
    const status = await one(db, `select status from public.vehicles where id = $1`, [A.vehicle]);
    expect(status.status).not.toBe('sold');
  });

  it('lead aceita atendimento concluído', async () => {
    const row = await user(db, A.owner, 'aal2', (c) => one(c, `update public.leads set status = 'answered' where id = $1 returning status`, [A.lead]));
    expect(row.status).toBe('answered');
  });

  it('vídeo do Instagram só entra na pasta da própria empresa', async () => {
    const upload = (company) => (c) => c.query(
      `insert into storage.objects (bucket_id, name) values ('site-videos', $1)`, [`${company}/instagram/x-${company}.mp4`]);
    await user(db, A.owner, 'aal2', upload(A.company));
    await denied(user(db, A.owner, 'aal2', upload(B.company)));
    await denied(user(db, A.owner, 'aal1', upload(A.company)));
    await denied(anon(db, upload(A.company)));
    const post = await user(db, A.owner, 'aal2', (c) => one(c,
      `insert into public.instagram_posts (company_id, permalink, video_path) values ($1, 'https://www.instagram.com/reel/ABC/', 'a.mp4') returning video_path`, [A.company]));
    expect(post.video_path).toBe('a.mp4');
    const visible = await anon(db, (c) => one(c, `select video_path from public.instagram_posts where company_id = $1`, [A.company]));
    expect(visible.video_path).toBe('a.mp4');
  });
});

