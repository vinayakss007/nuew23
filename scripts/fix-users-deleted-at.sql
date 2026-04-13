-- ═══════════════════════════════════════════════════════════════
-- Fix: Add deleted_at to users table
-- Run: psql $DATABASE_URL -f scripts/fix-users-deleted-at.sql
-- ═══════════════════════════════════════════════════════════════

-- Add deleted_at and deleted_by columns to users table
alter table public.users
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users on delete set null;

-- Create index for soft delete queries
create index if not exists users_deleted_idx on public.users(deleted_at) where deleted_at is not null;

-- Add updated_at trigger for users
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_users_updated_at on public.users;
create trigger update_users_updated_at
  before update on public.users
  for each row
  execute function public.update_updated_at_column();
