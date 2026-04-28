import { supabase } from "@/lib/db/supabase";
import { hashPassword } from "@/lib/utils/auth";
import { MINISTRY_OPTIONS } from "@/lib/utils/ministries";

if (process.env.NODE_ENV === "production") {
  throw new Error("lib/devSeedUsers.js must never be imported in production");
}

if (process.env.SUPABASE_ENVIRONMENT !== "dev") {
  throw new Error(
    "lib/devSeedUsers.js refuses to run unless SUPABASE_ENVIRONMENT=dev. " +
      "This file inserts seed rows; running it against a non-dev Supabase " +
      "would pollute that database. Configure a dev Supabase project and " +
      "set SUPABASE_ENVIRONMENT=dev in .env.local — see CLAUDE.md.",
  );
}

export const DEV_PASSWORD = "devpass123";

export const DEV_USERS = [
  {
    username: "dev-admin",
    display_name: "Dev Admin",
    role: "admin",
    ministry: null,
    profile_emoji: "🛠️",
  },
  {
    username: "dev-tech",
    display_name: "Dev Tech",
    role: "tech",
    ministry: "Service Ops Tech",
    profile_emoji: "🔧",
  },
  {
    username: "dev-user",
    display_name: "Dev User",
    role: "user",
    ministry: null,
    profile_emoji: "🧪",
  },
  {
    username: "dev-vp",
    display_name: "Dev VP Lead",
    role: "user",
    ministry: MINISTRY_OPTIONS.includes("Visual Production")
      ? "Visual Production"
      : MINISTRY_OPTIONS[0] ?? null,
    profile_emoji: "🎬",
  },
  {
    username: "dev-projection",
    display_name: "Dev Projection",
    role: "user",
    ministry: MINISTRY_OPTIONS.includes("Projection")
      ? "Projection"
      : MINISTRY_OPTIONS[1] ?? null,
    profile_emoji: "📽️",
  },
];

let seedPromise = null;

async function seedOnce() {
  const hash = await hashPassword(DEV_PASSWORD);

  for (const seed of DEV_USERS) {
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("username", seed.username)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase.from("users").insert({
      username: seed.username,
      password_hash: hash,
      display_name: seed.display_name,
      role: seed.role,
      ministry: seed.ministry,
      profile_emoji: seed.profile_emoji,
    });

    if (error) {
      seedPromise = null;
      throw error;
    }
  }
}

export function ensureDevUsersSeeded() {
  if (!seedPromise) seedPromise = seedOnce();
  return seedPromise;
}
