import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Chainable no-op used when env vars are missing (e.g. local dev without .env.local).
// Callers use supabaseClient unchanged; realtime subscriptions just don't fire.
const noopChannel = { on: () => noopChannel, subscribe: () => noopChannel };
const noopClient = { channel: () => noopChannel, removeChannel: () => {} };

let supabaseClient = noopClient;
try {
  if (url && key) {
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 2 } },
    });
  }
} catch {}

export { supabaseClient };
