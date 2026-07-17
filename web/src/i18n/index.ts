import { ja, type TranslationKey } from "./ja";
export type { TranslationKey };
import { en } from "./en";
import { zh } from "./zh";
import { ko } from "./ko";
import { es } from "./es";
import { de } from "./de";
import { nl } from "./nl";

export type Lang = "ja" | "en" | "zh" | "ko" | "es" | "de" | "nl";

const DICTS: Record<Lang, Record<TranslationKey, string>> = { ja, en, zh, ko, es, de, nl };

/** ブラウザの言語設定から対応言語を選ぶ（未対応なら日本語＝原文にフォールバック） */
function detectLang(): Lang {
  const raw = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const tag of raw) {
    const code = tag.toLowerCase().split("-")[0];
    if (code in DICTS) return code as Lang;
  }
  return "ja";
}

export const currentLang: Lang = detectLang();
const dict = DICTS[currentLang];

/** キーに対応する現在言語の文字列を返す。{name} 形式のプレースホルダーは vars で置換できる。
 *  未翻訳キーは日本語（原文）にフォールバックする。 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? ja[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
