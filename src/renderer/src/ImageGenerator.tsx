import { t, useLanguage } from "./i18n";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { ImageAsset, ImportResult, SettingsView } from "../../shared/types";
import { IMAGE_SIZES, IMAGE_PROMPT_LIMIT } from "../../shared/image-generation";
import type { GeneratedImagePreview, EditImageUpload } from "../../shared/image-generation";

type Props = { busy: boolean; settings: SettingsView; setSettings: (settings: SettingsView) => void;
  runBusy: (text: string, task: () => Promise<void>) => Promise<void>; };

export function ImageGenerationSettings({ busy, settings, setSettings, runBusy }: Props) {
  useLanguage();
  const [ak, setAk] = useState("");
  const [sk, setSk] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const save = () => {
    if (!ak.trim() || !sk.trim()) {
      setFeedback({ error: true, text: t("请填写 Access Key ID 和 Secret Access Key 后保存。") });
      return;
    }
    setFeedback(null);
    void runBusy(t("正在保存火山密钥…"), async () => {
      try {
        if (typeof window.reach.saveVolcKeys !== "function") throw new Error(t("请完全退出并重新启动应用，再保存密钥。"));
        setSettings(await window.reach.saveVolcKeys(ak, sk));
        setAk(""); setSk("");
        setFeedback({ error: false, text: t("保存成功，密钥已加密保存在本机。可前往素材库生成或编辑图片。") });
      } catch (error) {
        setFeedback({ error: true, text: error instanceof Error ? error.message : t("保存失败，请重试。") });
        throw error;
      }
    });
  };
  return <section className="panel settings-panel">
    <div className="settings-title"><div className="provider-mark"><Sparkles/></div><div><h2>{t("火山引擎图片生成与编辑")}</h2><p>{t("开通视觉智能的通用 3.0 文生图、SeedEdit 3.0 服务后，配置 AK/SK。")}</p></div></div>
    <div className="field"><label htmlFor="volc-ak">Access Key ID</label><input id="volc-ak" type="password" autoComplete="off" value={ak} onChange={e => setAk(e.target.value)} placeholder={settings.hasVolcKeys ? t("已加密保存，重新输入可更换") : t("输入 Access Key ID")}/></div>
    <div className="field"><label htmlFor="volc-sk">Secret Access Key</label><input id="volc-sk" type="password" autoComplete="off" value={sk} onChange={e => setSk(e.target.value)} placeholder={t("输入 Secret Access Key")}/><small>{t("密钥使用系统安全存储加密保存在本机。这里使用视觉智能 AK/SK，不是方舟 API Key。")}</small></div>
    <div className="settings-actions"><button className="button primary" disabled={busy} onClick={save}>{t("保存密钥")}</button><button className="button secondary" disabled={busy || !settings.hasVolcKeys} onClick={() => { setFeedback(null); void runBusy(t("正在移除密钥…"), async () => {
      try { setSettings(await window.reach.clearVolcKeys()); setAk(""); setSk(""); setFeedback({ error: false, text: t("密钥已从本机移除。") }); }
      catch (error) { setFeedback({ error: true, text: error instanceof Error ? error.message : t("移除失败，请重试。") }); throw error; }
    }); }}>{t("移除密钥")}</button></div>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    <p>{t("{0} 体验额度和收费以控制台为准。", [settings.hasVolcKeys ? t("已配置火山密钥。") : t("尚未配置火山密钥。")])}</p>
  </section>;
}

export default function ImageGenerator({ busy, settings, setSettings, runBusy, images, selectedImages, onSettings, onResult, onClose }: Props & {
  images: ImageAsset[]; selectedImages: string[]; onSettings: () => void; onResult: (result: ImportResult) => void; onClose: () => void;
}) {
  useLanguage();
  const [mode, setMode] = useState<"generate" | "edit">("generate");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<string>("1328x1328");
  const [imageId, setImageId] = useState(selectedImages.length === 1 ? selectedImages[0] : "");
  const [upload, setUpload] = useState<EditImageUpload | null>(null);
  const [scale, setScale] = useState(0.5);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preview, setPreview] = useState<GeneratedImagePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    let active = true;
    window.reach.getGeneratedImage().then(value => { if (active) setPreview(value); }).catch(() => {
      if (active) setPreviewError(t("无法恢复预览，请尝试继续查询，或重启应用后再试。"));
    });
    return () => { active = false; };
  }, []);
  const source = upload || images.find(image => image.id === imageId);
  const finish = async (resume = false) => {
    try { setPreview(await (resume ? window.reach.resumeImageTask() : window.reach.generateImage({ mode, prompt, size, imageId: upload ? undefined : imageId, uploadId: upload?.id, scale }))); setPreviewError(""); }
    finally { setSettings(await window.reach.getSettings()); }
  };
  return <section className="panel settings-panel" aria-label={t("AI 生成图片")}>
    <div className="settings-title"><div className="provider-mark"><Sparkles/></div><div><h2>{t("AI 图片工作台")}</h2><p>{t("先生成并预览，满意后再保存到素材库。")}</p></div></div>
    {previewError && <p role="alert">{previewError}</p>}
    {preview && <div aria-label={t("生成结果预览")}>
      <h3>{t("生成结果 · 尚未保存")}</h3>
      <img src={preview.dataUrl} alt={t("生成结果预览")} style={{ display: "block", maxWidth: "100%", maxHeight: 560, objectFit: "contain", marginBottom: 16 }}/>
      <div className="settings-actions"><button className="button primary" disabled={busy} onClick={() => void runBusy(t("正在保存到素材库…"), async () => {
        try { const result = await window.reach.saveGeneratedImage(preview.taskId); setPreview(null); onResult(result); }
        catch (error) { setPreviewError(error instanceof Error ? error.message : t("保存失败，请重试。")); throw error; }
        finally { setSettings(await window.reach.getSettings()); }
      })}>{t("保存到素材库")}</button><button className="button secondary" disabled={busy} onClick={() => void runBusy(t("正在丢弃预览…"), async () => {
        setSettings(await window.reach.discardImageTask()); setPreview(null); setPreviewError("");
      })}>{t("丢弃结果")}</button></div>
      <p>{t("收起面板后仍可查看预览；退出应用后需继续查询云端任务恢复结果。")}</p>
    </div>}
    {!settings.hasVolcKeys && <p>{t("请先")}<button className="button secondary small" onClick={onSettings}>{t("前往设置")}</button>{t("配置火山引擎 AK/SK。")}</p>}
    {settings.hasPendingImageTask && !preview && <div role="status"><p>{t("有已提交的任务待查询。继续查询不会重新提交生成请求。")}</p><div className="settings-actions"><button className="button primary" disabled={busy || !settings.hasVolcKeys} onClick={() => void runBusy(t("正在查询火山图片任务…"), () => finish(true))}>{t("继续查询")}</button><button className="button secondary" disabled={busy} onClick={() => setConfirmDiscard(true)}>{t("放弃任务记录")}</button></div>
      {confirmDiscard && <div><p>{t("放弃后无法在应用中恢复该任务。这不会取消云端任务或撤销可能的计费。")}</p><button className="button danger" disabled={busy} onClick={() => void runBusy(t("正在移除任务记录…"), async () => { setSettings(await window.reach.discardImageTask()); setConfirmDiscard(false); })}>{t("确认放弃")}</button><button className="button secondary" onClick={() => setConfirmDiscard(false)}>{t("保留")}</button></div>}</div>}
    <div className="field"><label htmlFor="generation-mode">{t("功能")}</label><select id="generation-mode" value={mode} disabled={busy} onChange={e => setMode(e.target.value as typeof mode)}><option value="generate">{t("通用 3.0 文生图")}</option><option value="edit">{t("SeedEdit 3.0 图片编辑")}</option></select></div>
    {mode === "edit" && <><div className="field"><label htmlFor="edit-image">{t("底图")}</label>
      <div className="settings-actions"><button className="button secondary" disabled={busy} onClick={() => void runBusy(t("正在读取本地底图…"), async () => {
        try { const picked = await window.reach.pickEditImage(); if (picked) { setUpload(picked); setImageId(""); setPreviewError(""); } }
        catch (error) { setPreviewError(error instanceof Error ? error.message : t("读取图片失败，请重试。")); throw error; }
      })}>{t("上传本地图片")}</button>{upload && <><span>{upload.fileName}</span><button className="button secondary small" disabled={busy} onClick={() => setUpload(null)}>{t("移除底图")}</button></>}</div>
      <select id="edit-image" value={imageId} disabled={busy} onChange={e => { setImageId(e.target.value); if (e.target.value) setUpload(null); }}><option value="">{t("或从素材库选择一张图片")}</option>{images.filter(image => ["image/jpeg", "image/png"].includes(image.mimeType)).map(image => <option key={image.id} value={image.id}>{image.fileName}</option>)}</select><small>{t("JPEG / PNG，最大 5 MB，宽高不超过 4096，长短边比例不超过 3。本地底图不会加入素材库，点击生成时才与编辑指令一起发送至火山引擎。")}</small></div>
      {source?.thumbnailDataUrl && <img src={source.thumbnailDataUrl} alt={t("编辑底图预览")} style={{ maxWidth: 220, maxHeight: 180, objectFit: "contain" }}/>}
      <small>{t("按图片实际内容识别格式。静态 WebP、AVIF 等会在本机转换成 PNG；转换后的底图也需小于 5 MB。")}</small>
      <div className="field"><label htmlFor="edit-scale">{t("编辑强度：{0}", [scale])}</label><input id="edit-scale" type="range" min={0} max={1} step={0.1} value={scale} disabled={busy} onChange={e => setScale(Number(e.target.value))}/><small>{t("强度越大，文字指令影响越大。输出比例接近底图。")}</small></div></>}
    <div className="field"><label htmlFor="image-prompt">{mode === "edit" ? t("编辑指令") : t("图片描述")}</label><textarea id="image-prompt" rows={4} maxLength={IMAGE_PROMPT_LIMIT} disabled={busy} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={mode === "edit" ? t("例如：把背景换成海边，保留人物和服装") : t("描述主体、环境、风格和构图")}/><small>{t("{0} / {1} · 描述将发送至火山引擎。", [prompt.length, IMAGE_PROMPT_LIMIT])}</small></div>
    {mode === "generate" && <div className="field"><label htmlFor="image-size">{t("图片尺寸")}</label><select id="image-size" value={size} disabled={busy} onChange={e => setSize(e.target.value)}>{IMAGE_SIZES.map(value => <option key={value}>{value}</option>)}</select></div>}
    <div className="settings-actions"><button className="button primary" disabled={busy || !!preview || !settings.hasVolcKeys || settings.hasPendingImageTask || !prompt.trim() || (mode === "edit" && !source)} onClick={() => void runBusy(t("正在生成图片预览…"), () => finish())}><Sparkles size={16}/> {mode === "edit" ? t("生成编辑预览") : t("生成图片")}</button><button className="button secondary" disabled={busy} onClick={onClose}>{t("收起")}</button></div>
  </section>;
}
