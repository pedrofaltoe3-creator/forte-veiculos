export type MemberRole = 'master' | 'owner';
export type VehicleStatus = 'draft' | 'available' | 'reserved' | 'sold';
export type VehicleCategory = 'suv' | 'sedan' | 'hatch' | 'pickup' | 'premium' | 'other';
export type VehicleTransmission = 'automatic' | 'manual' | 'cvt' | 'automated';
export type VehicleFuel = 'flex' | 'gasoline' | 'ethanol' | 'diesel' | 'hybrid' | 'electric';
export type LeadType = 'contact' | 'vehicle_interest' | 'evaluation';
export type LeadStatus = 'new' | 'in_progress' | 'answered' | 'won' | 'lost';
export type PaymentMethod = 'pix' | 'cash' | 'card' | 'financing' | 'trade_in' | 'transfer' | 'other';
export type FinancialKind = 'sale' | 'income' | 'expense';

export type BusinessHours = { days: number[]; open: string; close: string; label: string };

export type SiteSettings = {
  company_id: string;
  display_name: string;
  whatsapp: string;
  phone_display: string | null;
  email: string | null;
  address_street: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  hours: BusinessHours[];
  instagram_url: string | null;
  facebook_url: string | null;
  about_text: string | null;
  images: Record<string, string>;
};

export type TechnicalSettings = {
  company_id: string;
  canonical_url: string | null;
  ga4_id: string | null;
  meta_pixel_id: string | null;
  legal_name: string | null;
  cnpj: string | null;
  dpo_name: string | null;
  dpo_email: string | null;
};

export type SiteData = {
  company: { id: string; slug: string; name: string };
  settings: SiteSettings;
  technical: TechnicalSettings;
};

export type VehiclePhoto = {
  id: string;
  storage_path: string;
  thumb_path: string;
  width: number;
  height: number;
  position: number;
  is_primary: boolean;
  alt: string | null;
};

export type Vehicle = {
  id: string;
  company_id: string;
  slug: string;
  brand: string;
  model: string;
  version: string | null;
  category: VehicleCategory;
  model_year: number;
  mileage_km: number | null;
  transmission: VehicleTransmission | null;
  fuel: VehicleFuel | null;
  color: string | null;
  price_cents: number;
  offer_price_cents: number | null;
  offer_until: string | null;
  description: string | null;
  features: string[];
  status: VehicleStatus;
  is_featured: boolean;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
  vehicle_photos: VehiclePhoto[];
};

export type Lead = {
  id: string;
  company_id: string;
  type: LeadType;
  status: LeadStatus;
  name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  evaluation: Record<string, string | number | null> | null;
  source_path: string | null;
  notes: string | null;
  created_at: string;
};

export type InstagramPost = { id: string; permalink: string; position: number; is_active: boolean; video_path: string | null };

// Campos que só o painel lê: o acesso anônimo não tem permissão nessas colunas.
export type VehiclePrivateFields = {
  purchase_cost_cents: number | null;
  fipe_code: string | null;
  fipe_price_cents: number | null;
  fipe_reference: string | null;
};

export type FinancialEntry = {
  id: string;
  kind: FinancialKind;
  description: string;
  amount_cents: number;
  cost_cents: number | null;
  occurred_on: string;
  vehicle_id: string | null;
  payment_method: PaymentMethod | null;
};

export type FormState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;
