// Settings' own look is now the shared menu look (src/lib/ui-kit/menu-look.ts): one style, see-through, blur
// and colour for every menu. Kept as a thin alias so existing imports keep working.

import { DEFAULT_MENU_LOOK, MENU_BLUR_MAX, MENU_SWATCHES, getMenuLook, glassStyle, sanitizeMenuLook, setMenuLook, useMenuLook, type MenuLook } from './ui-kit/menu-look'

export type SettingsLook = MenuLook
export const DEFAULT_SETTINGS_LOOK = DEFAULT_MENU_LOOK
export const SETTINGS_BLUR_MAX = MENU_BLUR_MAX
export const SETTINGS_SWATCHES = MENU_SWATCHES
export const sanitizeSettingsLook = sanitizeMenuLook
export const getSettingsLook = getMenuLook
export const setSettingsLook = setMenuLook
export const useSettingsLook = useMenuLook

/** The Settings panel's background and backdrop filter (glass); textured styles draw their own frame. */
export function settingsLookStyle(look: MenuLook): ReturnType<typeof glassStyle> {
  return glassStyle(look)
}
