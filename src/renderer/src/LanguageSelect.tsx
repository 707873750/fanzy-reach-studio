import { Languages } from "lucide-react";
import { LANGUAGES, setLanguage, t, useLanguage, type Language } from "./i18n";

export default function LanguageSelect() {
  const language = useLanguage();
  return <label className="language-select">
    <Languages size={16} aria-hidden="true" />
    <span className="sr-only">{t("界面语言")}</span>
    <select aria-label={t("界面语言")} value={language} onChange={event => setLanguage(event.target.value as Language)}>
      {LANGUAGES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.label}</option>)}
    </select>
  </label>;
}
