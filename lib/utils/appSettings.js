import { supabase } from "@/lib/db/supabase";
import { cached, invalidate } from "@/lib/utils/cache";

const APP_SETTINGS_CACHE_PREFIX = "app_settings:";
const APP_SETTINGS_TTL_MS = 60_000;

function normalizeKeys(keys) {
  return [...new Set((keys || []).filter(Boolean))].sort();
}

export async function getAppSettings(keys) {
  const normalizedKeys = normalizeKeys(keys);
  if (normalizedKeys.length === 0) {
    return {};
  }

  const cacheKey = `${APP_SETTINGS_CACHE_PREFIX}${normalizedKeys.join(",")}`;
  return cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", normalizedKeys);

      if (error) {
        throw new Error(error.message || "Failed to load app settings");
      }

      return Object.fromEntries(
        (data || []).map((entry) => [entry.key, entry.value]),
      );
    },
    APP_SETTINGS_TTL_MS,
  );
}

export async function getAppSetting(key) {
  const settings = await getAppSettings([key]);
  return settings[key];
}

export function invalidateAppSettingsCache() {
  invalidate(APP_SETTINGS_CACHE_PREFIX);
}
