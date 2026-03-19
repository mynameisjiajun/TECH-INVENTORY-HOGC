import { createClient } from "@supabase/supabase-js";

// Browser-safe client — uses the anon (public) key.
// Only used for Realtime subscriptions. All data mutations go through
// server-side API routes which use the service_role key.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 2,
    },
  },
});
