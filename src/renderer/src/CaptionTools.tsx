import { t, useLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import type { CaptionPreviewInput } from "../../shared/backend";

export default function CaptionTools({draftId, revision, value, disabled, shared, onApply}: {
  draftId: string; revision: string; value: string; disabled: boolean; shared: boolean;
  onApply: (text: string) => void;
}) {
  useLanguage();
  const [language, setLanguage] = useState("简体中文");
  const [limit, setLimit] = useState(140);
  const [choices, setChoices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  // Invalidate pending results on edits, mode switches, publishing or navigation.
  useEffect(() => {
    request.current++; setChoices([]); setBusy(false); setError("");
    return () => { request.current++; };
  }, [draftId, revision, value, disabled, shared]);
  async function generate(action: CaptionPreviewInput["action"]) {
    if (busy || disabled) return;
    const token = ++request.current;
    setBusy(true); setChoices([]); setError("");
    try {
      const result = await window.reach.previewCaption(draftId, {action, text:value, language, maxLength:limit});
      if (token === request.current) setChoices(result);
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (token === request.current) setBusy(false); }
  }
  function cancel() { request.current++; setBusy(false); setChoices([]); setError(""); }
  return <section className="caption-tools" aria-label={t('AI 文案助手')}>
    <div className="heading-actions">
      <button type="button" className="button secondary small" disabled={disabled||busy} onClick={()=>void generate("variants")}>{t('生成三个候选')}</button>
      <label>{t('目标语言')}<select aria-label={t('翻译目标语言')} disabled={disabled||busy} value={language} onChange={e=>{setLanguage(e.target.value);setChoices([]);}}>
        {["简体中文","繁體中文","English","日本語","한국어","Español","Français","Deutsch","Português"].map(l=><option key={l}>{l}</option>)}
      </select></label>
      <button type="button" className="button secondary small" disabled={disabled||busy||!value.trim()} onClick={()=>void generate("translate")}>{t('翻译')}</button>
      <label>{t('最多字符')}<input aria-label={t('缩短目标字符数')} type="number" min={10} max={5000} value={limit} disabled={disabled||busy} onChange={e=>{setLimit(Number(e.target.value));setChoices([]);}}/></label>
      <button type="button" className="button secondary small" disabled={disabled||busy||!value.trim()||!Number.isInteger(limit)||limit<10||limit>5000} onClick={()=>void generate("shorten")}>{t('缩短')}</button>
    </div>
    <p className="muted">{t("基于当前编辑内容预览，仅替换正文；采用后请保存修改。")}{shared ? t("保存将按现有统一文案规则同步关联草稿。") : t("标题、标签和图片说明保持不变。")}</p>
    {busy&&<p role="status">{t('正在生成预览…')}<button type="button" className="text-button" onClick={cancel}>{t('取消等待')}</button></p>}
    {error&&<p role="alert">{t(error.replace(/^Error invoking remote method [^:]+: (?:Error: )?/, ""))}</p>}
    {!!choices.length&&<div className="caption-candidates">{choices.map((text,index)=><article key={index}>
      <strong>{choices.length===3?t("候选 {0}",[index+1]):t("预览结果")} · {t("{0} 字符",[Array.from(text).length])}</strong>
      <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{text}</p>
      <button type="button" className="button secondary small" disabled={disabled||busy} onClick={()=>{onApply(text);cancel();}}>{t('采用此文案')}</button>
    </article>)}<button type="button" className="text-button" onClick={cancel}>{t('放弃预览')}</button></div>}
  </section>;
}
