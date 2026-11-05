/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    requestId: string;
    supabase: import('@supabase/supabase-js').SupabaseClient;
    user: import('@supabase/supabase-js').User | null;
    roles: string[];
    permissions: string[];
  }
}
