import type { Platform, PlatformDefaults } from "../shared/types";
import { readPlatformDefaults, validatePlatformDefaults } from "../shared/platform-defaults";
import { getStore, persistStore } from "./store";

export function getPlatformDefaults() {
  return readPlatformDefaults(getStore().settings.platformDefaults);
}

export async function savePlatformDefaults(platform: Platform, input: PlatformDefaults) {
  const value = validatePlatformDefaults(platform, input);
  const settings = getStore().settings;
  settings.platformDefaults = {...settings.platformDefaults, [platform]: value};
  await persistStore();
  return value;
}
