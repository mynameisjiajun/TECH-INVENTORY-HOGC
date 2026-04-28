import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseEnv = process.env.SUPABASE_ENVIRONMENT;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

// Hard environment handshake — the configured Supabase MUST be explicitly
// tagged for the environment it's running in. Stops dev work from accidentally
// reading or writing the production database.
//
// Set in deployment env:
//   - Vercel (production):       SUPABASE_ENVIRONMENT=production
//   - .env.local (developer):    SUPABASE_ENVIRONMENT=dev
//
// To use the dev value, you must also point SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// at a non-production Supabase project (cloud project or `supabase start` local
// instance). See CLAUDE.md → "Dev environment isolation" for setup.
const isProdRuntime = process.env.NODE_ENV === 'production';
const expectedEnv = isProdRuntime ? 'production' : 'dev';

if (supabaseEnv !== expectedEnv) {
  const got = supabaseEnv ? `"${supabaseEnv}"` : '(unset)';
  throw new Error(
    `Supabase environment mismatch: NODE_ENV="${process.env.NODE_ENV}" expects ` +
      `SUPABASE_ENVIRONMENT="${expectedEnv}" but got ${got}. ` +
      `In dev, point SUPABASE_URL at a non-production project and set ` +
      `SUPABASE_ENVIRONMENT=dev in .env.local. ` +
      `In production, set SUPABASE_ENVIRONMENT=production in the Vercel env. ` +
      `See CLAUDE.md → "Dev environment isolation".`,
  );
}

// Single shared client — service role bypasses RLS, safe for server-side only
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const SUPABASE_ENVIRONMENT = supabaseEnv;
