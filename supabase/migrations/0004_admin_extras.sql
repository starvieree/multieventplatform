-- 0004_admin_extras.sql — pembatalan oleh admin (hanya yang belum dibayar). Admin tidak punya jalur untuk memaksa status "paid".
create function public.admin_cancel_registration(p_actor uuid, p_registration uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare reg registrations;
begin
  select * into reg from registrations where id = p_registration for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if reg.registration_status not in ('draft','awaiting_payment') or reg.payment_status = 'paid' then raise exception 'INVALID_STATE'; end if;
  update quota_reservations set status = 'released', released_at = now(), release_reason = 'admin_cancel' where registration_id = reg.id and status = 'reserved';
  update registrations set registration_status = 'cancelled', payment_status = case when payment_status = 'pending' then 'cancelled' else payment_status end, admin_note = left(p_reason, 500) where id = reg.id;
  insert into activity_logs (actor_user_id, action, resource_type, resource_id, before_data, after_data, reason)
  values (p_actor, 'registration.cancel', 'registration', reg.id::text, jsonb_build_object('status', reg.registration_status), jsonb_build_object('status', 'cancelled'), p_reason);
  insert into notifications (user_id, title, body, type, related_type, related_id) values (reg.user_id, 'Pendaftaran dibatalkan', 'Pendaftaran Anda dibatalkan oleh admin.', 'registration_cancelled', 'registration', reg.id);
  return jsonb_build_object('status', 'cancelled');
end $$;
revoke execute on function public.admin_cancel_registration from public, anon, authenticated;
