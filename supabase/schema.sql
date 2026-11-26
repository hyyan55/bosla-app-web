-- بوصلة التطبيقات — Supabase Postgres Schema, RLS, and RPCs

create sequence if not exists public.wallet_seq start 2001;

-- 1. Settings table (live pricing, gift points, admin WhatsApp, admin credentials)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  point_price_sdg int not null default 50,
  gift_points int not null default 20,
  admin_whatsapp text not null default '249912345678',
  admin_username text not null default 'admin',
  admin_password_hash text not null default '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
  updated_at timestamptz not null default now()
);

insert into public.settings (id, point_price_sdg, gift_points, admin_whatsapp, admin_username, admin_password_hash)
values (1, 50, 20, '249912345678', 'admin', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92')
on conflict (id) do nothing;

-- 2. Profiles & Wallets
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text unique not null,
  email text not null,
  phone text,
  wallet_number text unique,
  points_balance int not null default 0 check (points_balance >= 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3. Immutable Points Transactions
create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('gift', 'topup', 'build_debit', 'refund', 'admin_credit', 'admin_debit')),
  amount int not null,
  balance_after int not null check (balance_after >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

-- 4. Top-up Requests
create table if not exists public.topup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_number text not null,
  user_name text not null,
  method text not null check (method in ('bankak', 'sahil', 'mycashy')),
  points int not null check (points > 0),
  price_sdg int not null check (price_sdg > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- 5. Builds
create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  description text not null,
  complexity text not null check (complexity in ('simple', 'medium', 'complex')),
  points_spent int not null check (points_spent > 0),
  status text not null default 'building' check (status in ('building', 'ready', 'failed')),
  apk_url text,
  error_message text,
  branch_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.points_transactions enable row level security;
alter table public.topup_requests enable row level security;
alter table public.builds enable row level security;

-- Helper: check if current auth user is admin
create or replace function public.is_admin_user()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

-- RLS Policies
create policy "settings_read_all" on public.settings for select using (true);
create policy "settings_admin_update" on public.settings for update using (public.is_admin_user());

create policy "profiles_own_select" on public.profiles for select
  using (auth.uid() = id or public.is_admin_user());
create policy "profiles_own_update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "tx_own_select" on public.points_transactions for select
  using (auth.uid() = user_id or public.is_admin_user());

create policy "topup_own_select" on public.topup_requests for select
  using (auth.uid() = user_id or public.is_admin_user());
create policy "topup_own_insert" on public.topup_requests for insert
  with check (auth.uid() = user_id);

create policy "builds_own_select" on public.builds for select
  using (auth.uid() = user_id or public.is_admin_user());

-- RPC: ensure_wallet() — creates profile + BOS-XXXX wallet + 20 gift points on first verified login
create or replace function public.ensure_wallet()
returns public.profiles
language plpgsql
security definer
as $$
declare
  uid uuid := auth.uid();
  u_email text;
  u_name text;
  u_username text;
  prof public.profiles;
  gift int;
  new_wallet text;
begin
  if uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into prof from public.profiles where id = uid;

  if prof.id is null then
    select email,
           coalesce(raw_user_meta_data->>'full_name', 'مستخدم بوصلة'),
           coalesce(raw_user_meta_data->>'username', 'user_' || substr(uid::text, 1, 6))
      into u_email, u_name, u_username
      from auth.users where id = uid;

    select gift_points into gift from public.settings where id = 1;
    gift := coalesce(gift, 20);
    new_wallet := 'BOS-' || nextval('public.wallet_seq')::text;

    insert into public.profiles (id, full_name, username, email, wallet_number, points_balance)
    values (uid, u_name, u_username, coalesce(u_email, ''), new_wallet, gift)
    returning * into prof;

    if gift > 0 then
      insert into public.points_transactions (user_id, type, amount, balance_after, description)
      values (uid, 'gift', gift, gift, 'هدية ترحيبية عند إنشاء المحفظة');
    end if;
  elsif prof.wallet_number is null then
    select gift_points into gift from public.settings where id = 1;
    gift := coalesce(gift, 20);
    new_wallet := 'BOS-' || nextval('public.wallet_seq')::text;

    update public.profiles
       set wallet_number = new_wallet,
           points_balance = points_balance + gift
     where id = uid
     returning * into prof;

    if gift > 0 then
      insert into public.points_transactions (user_id, type, amount, balance_after, description)
      values (uid, 'gift', gift, prof.points_balance, 'هدية ترحيبية عند إنشاء المحفظة');
    end if;
  end if;

  return prof;
end;
$$;

-- RPC: credit_points()
create or replace function public.credit_points(
  target_user_id uuid,
  points_amount int,
  tx_type text default 'topup',
  tx_description text default 'شحن نقاط'
)
returns int
language plpgsql
security definer
as $$
declare
  next_bal int;
begin
  if points_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if auth.role() <> 'service_role' and not public.is_admin_user() then
    raise exception 'Forbidden';
  end if;

  update public.profiles
     set points_balance = points_balance + points_amount
   where id = target_user_id
   returning points_balance into next_bal;

  if next_bal is null then
    raise exception 'Profile not found';
  end if;

  insert into public.points_transactions (user_id, type, amount, balance_after, description)
  values (target_user_id, tx_type, points_amount, next_bal, tx_description);

  return next_bal;
end;
$$;

-- RPC: debit_points()
create or replace function public.debit_points(
  target_user_id uuid,
  points_amount int,
  tx_type text default 'build_debit',
  tx_description text default 'خصم نقاط لبناء تطبيق'
)
returns int
language plpgsql
security definer
as $$
declare
  cur_bal int;
  next_bal int;
begin
  if points_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if auth.role() <> 'service_role' and not public.is_admin_user() and auth.uid() <> target_user_id then
    raise exception 'Forbidden';
  end if;

  select points_balance into cur_bal from public.profiles where id = target_user_id for update;
  if cur_bal is null then
    raise exception 'Profile not found';
  end if;

  if cur_bal < points_amount then
    raise exception 'insufficient_points';
  end if;

  update public.profiles
     set points_balance = points_balance - points_amount
   where id = target_user_id
   returning points_balance into next_bal;

  insert into public.points_transactions (user_id, type, amount, balance_after, description)
  values (target_user_id, tx_type, -points_amount, next_bal, tx_description);

  return next_bal;
end;
$$;

-- RPC: approve_topup_request()
create or replace function public.approve_topup_request(
  req_id uuid,
  is_approved boolean,
  note_text text default null
)
returns void
language plpgsql
security definer
as $$
declare
  req public.topup_requests;
begin
  if not public.is_admin_user() then
    raise exception 'Forbidden';
  end if;

  select * into req from public.topup_requests where id = req_id for update;
  if req.id is null or req.status <> 'pending' then
    raise exception 'Request not found or already processed';
  end if;

  update public.topup_requests
     set status = case when is_approved then 'approved' else 'rejected' end,
         admin_note = note_text,
         reviewed_at = now()
   where id = req_id;

  if is_approved then
    perform public.credit_points(
      req.user_id,
      req.points,
      'topup',
      'شحن رصيد عبر ' || req.method
    );
  end if;
end;
$$;

-- RPC: change_admin_password()
create or replace function public.change_admin_password(
  old_hash text,
  new_hash text
)
returns boolean
language plpgsql
security definer
as $$
declare
  cur_hash text;
begin
  select admin_password_hash into cur_hash from public.settings where id = 1 for update;
  if cur_hash is null or cur_hash <> old_hash then
    return false;
  end if;

  update public.settings
     set admin_password_hash = new_hash,
         updated_at = now()
   where id = 1;

  return true;
end;
$$;
