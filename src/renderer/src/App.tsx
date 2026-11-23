import ImageEditor from "./ImageEditor";
import PublishPreview from "./PublishPreview";
import Accounts, { accountLabel } from "./Accounts";
import type { PlatformAccount } from "../../shared/types";
import { defaultAccountId } from "../../shared/accounts";
import { t, useLanguage } from "./i18n";
import LanguageSelect from "./LanguageSelect";
import { formatDate } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture, ArrowUpRight, CalendarClock, Check, CheckCircle2,
  ChevronDown, CircleHelp, Copy, FileImage, FolderOpen, ImagePlus,
  Instagram, LayoutDashboard, Link2, ListChecks, Loader2, Plus,
  Search, Send, Settings, Sparkles, Trash2, Upload, X, Twitter, Music2, Facebook
} from "lucide-react";
import type { BrowserSettings, Draft, ImageAsset, Platform, SettingsView } from "../../shared/types";
import type { CopyOptions } from "../../shared/types";
import { canEditCopy } from "../../shared/draft-copy";
import { canDeleteDraft, isLocalScheduledDraft, isPublishRecord } from "../../shared/draft-lifecycle";
import { isVideo, videoIssues, VIDEO_RULES } from "../../shared/video-rules";

import RunLogs from "./RunLogs";
import PlatformSettings from "./PlatformSettings";
import ImageGenerator, { ImageGenerationSettings } from "./ImageGenerator";
import PublishHistory from "./PublishHistory";
import LocalSchedules from "./LocalSchedules";
import ContentStudio from "./ContentStudio";
import CaptionTools from "./CaptionTools";
import CaptionEditor from "./CaptionEditor";

type Page = "studio" | "library" | "queue" | "schedules" | "history" | "settings" | "logs";

const PLATFORM_META: Record<Platform, { label: string; url: string; icon: typeof Instagram; color: string }> = {
  facebook: { label: "Facebook", url: "https://www.facebook.com/", icon: Facebook, color: "#1877F2" },
  bluesky: { label: "Bluesky", url: "https://bsky.app/", icon: Twitter, color: "#0085FF" },
  instagram: { label: "Instagram", url: "https://www.instagram.com/", icon: Instagram, color: "#E879A6" },
  x: { label: "X", url: "https://x.com/", icon: Twitter, color: "#D8DEE9" },
  pinterest: { label: "Pinterest", url: "https://www.pinterest.com/", icon: Aperture, color: "#E35D68" },
  tiktok: { label: "TikTok", url: "https://www.tiktok.com/", icon: Music2, color: "#25F4EE" }
};

function App() {
  const language = useLanguage();
  const STATUS_LABEL: Record<string, string> = {draft:t("草稿"),ready:t("待发布"),scheduled:t("已设提醒"),local_scheduled:t("本地待发布"),prepared:t("素材已准备"),published:t("已发布"),reminder_due:t("提醒已到期"),platform_scheduled:t("平台已排程"),running:t("正在发布"),needs_attention:t("需要处理"),uncertain:t("已提交，结果待确认"),succeeded:t("发布成功")};
  const [logDraftId, setLogDraftId] = useState("");
  const [page, setPage] = useState<Page>("library");
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [targetAccounts, setTargetAccounts] = useState<string[]>(["instagram","x","pinterest","tiktok","bluesky","facebook"].map(p=>`default-${p}`));
  const [draftAccount, setDraftAccount] = useState("");
  const accountName = (draft: Draft) => accountLabel(accounts.find(a=>a.id===(draft.accountId || defaultAccountId(draft.platform))));
  const [editingImage, setEditingImage] = useState<ImageAsset>();
  const [draftImageIds, setDraftImageIds] = useState<string[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [pendingImageDeleteIds, setPendingImageDeleteIds] = useState<string[] | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"]);
  const [copyOptions, setCopyOptions] = useState<CopyOptions>({sharedCaption:"", platforms:{facebook:{mode:"shared",caption:""},bluesky:{mode:"shared",caption:""},instagram:{mode:"shared",caption:""},x:{mode:"shared",caption:""},pinterest:{mode:"shared",caption:""},tiktok:{mode:"shared",caption:""}}});
  const [hashtags, setHashtags] = useState("");
  const [settings, setSettings] = useState<SettingsView>({ backendLoggedIn: false });
  const [showImageGenerator, setShowImageGenerator] = useState(false);
  const [caption, setCaption] = useState("");
  const [captionHtml, setCaptionHtml] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [altText, setAltText] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const [cancellingPublish, setCancellingPublish] = useState(false);
  const publishingRef = useRef(false);
  const publishing = publishingIds.length > 0;
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [mediaFilter, setMediaFilter] = useState("");
  const [checkedDrafts, setCheckedDrafts] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [xScheduleAt, setXScheduleAt] = useState("");
  const [tiktokPrivacy, setTikTokPrivacy] = useState<"public" | "self_only">("self_only");
  const [boardName, setBoardName] = useState("");
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>({showBrowser:false,channel:"chrome"});
  const canPublish = (draft: Draft) => canEditCopy(draft) && draft.status !== "local_scheduled";
  const publishSelected = async () => {
    if (publishingRef.current || busy || !canSubmitSelection) return;
    const ids = selectedDrafts.map(draft => draft.id);
    publishingRef.current = true;
    setNotice("");
    try {
    if (selectedDraft && ids.includes(selectedDraft.id)) {
      await window.reach.updateDraft(selectedDraft.id, { imageIds: draftImageIds, accountId: draftAccount, caption, captionHtml, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, publishAt: xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
    }
    const result = await window.reach.publishDrafts(ids);
    setNotice(t("已发布 {0}/{1} 条；本地待发布 {2} 条；平台已排程 {3} 条。重试前请核对各任务结果。", [result.filter((d) => d.status === "published").length, result.length, result.filter(d => d.status === "local_scheduled").length, result.filter((d) => d.browserPublish?.state === "scheduled").length]));
    setCheckedDrafts(old => old.filter(id => !ids.includes(id)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("发布操作失败，请查看运行日志"));
    } finally {
      try { setDrafts(await window.reach.listDrafts()); }
      catch (error) { setNotice(error instanceof Error ? error.message : t("刷新发布结果失败")); }
      publishingRef.current = false;
      setPublishingIds([]);
    }
  };

  const queueDrafts = useMemo(() => drafts.filter(draft => !isPublishRecord(draft) && !isLocalScheduledDraft(draft)), [drafts]);
  const localSchedules = useMemo(() => drafts.filter(isLocalScheduledDraft).sort((a, b) =>
    (Date.parse(a.publishAt || a.xScheduledAt || "") || 0) - (Date.parse(b.publishAt || b.xScheduledAt || "") || 0)), [drafts]);
  const publishRecords = useMemo(() => drafts.filter(isPublishRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [drafts]);
  const selectedDraft = queueDrafts.find((draft) => draft.id === selectedDraftId) || null;
  const lockedGroups = new Set(drafts.filter(d => publishingIds.includes(d.id) || d.browserPublish?.state === "running").map(d => d.copyGroupId).filter(Boolean));
  const draftLocked = (draft: Draft) => publishingIds.includes(draft.id) || draft.browserPublish?.state === "running" || Boolean(draft.copyGroupId && lockedGroups.has(draft.copyGroupId));
  const detailBusy = busy || Boolean(selectedDraft && draftLocked(selectedDraft));
  const browserBusy = busy || publishing;
  const selectedDrafts = queueDrafts.filter(draft => checkedDrafts.includes(draft.id));
  const canSubmitSelection = selectedDrafts.length > 0 && selectedDrafts.length <= 100 && selectedDrafts.every(draft => canPublish(draft) && !draftLocked(draft));
  const canDeleteSelection = selectedDrafts.length > 0 && selectedDrafts.every(draft => canDeleteDraft(draft) && !draftLocked(draft));
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      for (const folder of new Set(image.sourceFolders || [])) counts.set(folder, (counts.get(folder) || 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [images]);
  const ungroupedCount = images.filter(image => !image.sourceFolders?.length).length;
  const filteredImages = useMemo(() => images.filter((image) =>
    image.fileName.toLowerCase().includes(search.toLowerCase()) &&
    (!mediaFilter || (mediaFilter === "video" ? isVideo(image) : !isVideo(image))) &&
    (!folderFilter || (folderFilter === "ungrouped" ? !image.sourceFolders?.length : image.sourceFolders?.includes(folderFilter)))
  ), [images, search, folderFilter, mediaFilter]);
  const selectedVideoIssues = useMemo(() => images.filter(image => selectedImages.includes(image.id) && isVideo(image)).flatMap(image =>
    platforms.flatMap(platform => videoIssues(image, platform).map(issue => `${PLATFORM_META[platform].label} · ${image.fileName}：${t(issue)}`))
  ), [images, selectedImages, platforms, language]);

  useEffect(() => {
    if (folderFilter && (folderFilter === "ungrouped" ? !ungroupedCount : !folders.some(([folder]) => folder === folderFilter))) setFolderFilter("");
  }, [folders, ungroupedCount, folderFilter]);

  useEffect(()=>{setDraftAccount(selectedDraft?.accountId || (selectedDraft ? defaultAccountId(selectedDraft.platform) : ""));},[selectedDraft?.id, selectedDraft?.accountId]);

  async function refresh() {
    const [nextImages, nextDrafts, nextSettings, nextBrowserSettings, nextAccounts] = await Promise.all([
      window.reach.listImages(),
      window.reach.listDrafts(),
      window.reach.getSettings(),
      window.reach.getBrowserSettings(),
      window.reach.listAccounts()
    ]);
    setAccounts(nextAccounts);
    setImages(nextImages);
    setDrafts(nextDrafts);
    setSettings(nextSettings);
    setBrowserSettings(nextBrowserSettings);
  }

  useEffect(() => {
    setCheckedDrafts(old => {
      const next = old.filter(id => queueDrafts.some(draft => draft.id === id && canDeleteDraft(draft)));
      return next.length === old.length ? old : next;
    });
    if (selectedDraftId && !queueDrafts.some(draft => draft.id === selectedDraftId)) setSelectedDraftId(null);
  }, [queueDrafts, selectedDraftId]);

  useEffect(() => {
    setPendingDeleteIds(old => old && (old.length !== selectedDrafts.length || old.some(id => !selectedDrafts.some(draft => draft.id === id))) ? null : old);
  }, [checkedDrafts, queueDrafts]);

  useEffect(() => {
    setPendingDeleteIds(null);
    setPendingImageDeleteIds(null);
  }, [page]);

  useEffect(() => {
    setSelectedImages(old => {
      const next = old.filter(id => images.some(image => image.id === id));
      return next.length === old.length ? old : next;
    });
    setPendingImageDeleteIds(null);
  }, [images]);

  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
    const off = window.reach.onScheduleReminder((draft) => {
      setNotice(t("发布提醒：{0} 草稿已到提醒时间，请手动提交。", [draft.platform]));
      void refresh();
    });
    let receivedBatch = false;
    const offBatch = window.reach.onPublishBatch(ids => { receivedBatch = true; setPublishingIds(ids); });
    void window.reach.getPublishBatch().then(ids => { if (!receivedBatch) setPublishingIds(ids); }).catch(error => setNotice(error.message));
    const offProgress = window.reach.onPublishProgress((draft) => {
      setDrafts((old) => old.map((item) => item.id === draft.id ? draft : item));
    });
    return () => { off(); offProgress(); offBatch(); };
  }, []);

  useEffect(() => {
    if (!selectedDraft) {
      setCaption("");
      setCaptionHtml(undefined);
      setTitle("");
      setAltText("");
      setPublishedUrl("");
      return;
    }
    setDraftImageIds([...selectedDraft.imageIds]);
    setCaption(selectedDraft.caption);
    setCaptionHtml(selectedDraft.captionHtml);
    setHashtags(selectedDraft.hashtags.join(" "));
    setTitle(selectedDraft.title);
    setAltText(selectedDraft.altText);
    setBoardName(selectedDraft.boardName || "");
    setTikTokPrivacy(selectedDraft.tiktokPrivacy || "self_only");
    const time = (selectedDraft.publishAt || selectedDraft.xScheduledAt) ? new Date((selectedDraft.publishAt || selectedDraft.xScheduledAt)!) : null;
    setXScheduleAt(time ? new Date(time.getTime() - time.getTimezoneOffset()*60000).toISOString().slice(0,16) : "");
    setPublishedUrl(selectedDraft.publishedUrl || "");
  }, [selectedDraftId, selectedDraft?.updatedAt, selectedDraft?.captionMode]);

  async function runBusy(label: string, task: () => Promise<void>) {
    setBusy(true);
    setBusyText(label);
    setNotice("");
    try {
      await task();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? t(error.message.replace(/^Error invoking remote method [^:]+: (?:Error: )?/, "")) : t("操作失败，请查看运行日志"));
    } finally {
      await window.reach.getSettings().then(setSettings).catch(() => {});
      setBusy(false);
      setBusyText("");
    }
  }

  const importFiles = () => runBusy(t("正在导入素材…"), async () => {
    const result = await window.reach.importImages();
    setNotice(t("已导入 {0} 项素材 · 重复 {1} 项 · 失败 {2} 项{3}", [result.imported.length, result.duplicates.length, result.errors.length, result.errors.length ? `；${result.errors.slice(0, 3).join("；")}` : ""]));
  });

  const importFolder = () => runBusy(t("正在扫描文件夹…"), async () => {
    const result = await window.reach.importFolder();
    setNotice(t("已导入 {0} 项素材 · 重复 {1} 项 · 失败 {2} 项{3}", [result.imported.length, result.duplicates.length, result.errors.length, result.errors.length ? `；${result.errors.slice(0, 3).join("；")}` : ""]));
  });

  const createDrafts = () => runBusy(t("正在创建平台草稿…"), async () => {
    const created = await window.reach.createDrafts(selectedImages, platforms, copyOptions, targetAccounts.filter(id=>accounts.some(a=>a.id===id&&platforms.includes(a.platform))));
    setSelectedDraftId(created[0]?.id || null);
    setPage("queue");
    setNotice(t("已创建 {0} 条发布草稿。", [created.length]));
  });

  const deleteSelectedImages = () => {
    if (busy || !pendingImageDeleteIds?.length) return;
    const ids = [...pendingImageDeleteIds];
    setPendingImageDeleteIds(null);
    void runBusy(t("正在删除素材…"), async () => {
      const deleted: string[] = [];
      const errors: string[] = [];
      for (const id of ids) {
        try {
          await window.reach.deleteImage(id);
          deleted.push(id);
        } catch (error) {
          const name = images.find(image => image.id === id)?.fileName || id;
          const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : t("删除失败");
          errors.push(`${name}：${message}`);
        }
      }
      setSelectedImages(old => old.filter(id => !deleted.includes(id)));
      setNotice(t("已删除 {0} 项素材。{1}", [deleted.length, errors.length ? t("另有 {0} 张未删除，已保留选择。{1}{2}", [errors.length, errors.slice(0, 3).join("；"), errors.length > 3 ? t("；其余失败项可重试查看。") : ""]) : ""]));
    });
  };

  const saveDraft = async () => {
    if (!selectedDraft) return;
    await runBusy(t("正在保存草稿…"), async () => {
      await window.reach.updateDraft(selectedDraft.id, { imageIds: draftImageIds, accountId: draftAccount, caption, captionHtml, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, publishAt: xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
    });
  };

  const generateCaption = () => {
    if (!selectedDraft) return;
    void runBusy(t("正在分析图片并生成文案…"), async () => {
      await window.reach.generateCaption(selectedDraft.id);
    });
  };

  const generateSelectedCaptions = () => {
    if (busy || publishing || !settings.backendLoggedIn) return;
    const targets = selectedDrafts.filter(draft => canEditCopy(draft) && !draftLocked(draft));
    if (!targets.length) return;
    void runBusy(t("正在批量生成独立文案…"), async () => {
      const succeeded: string[] = [];
      const failures: string[] = [];
      for (const [index, draft] of targets.entries()) {
        setBusyText(t("AI 生成独立文案 {0}/{1} · {2}", [index + 1, targets.length, PLATFORM_META[draft.platform].label]));
        try {
          const updated = await window.reach.generateCaption(draft.id);
          succeeded.push(draft.id);
          setDrafts(old => old.map(item => item.id === updated.id ? updated : item));
        } catch (error) {
          failures.push(`${PLATFORM_META[draft.platform].label}（${draft.id.slice(0, 8)}）：${error instanceof Error ? error.message : t("生成失败")}`);
        }
      }
      const skipped = selectedDrafts.length - targets.length;
      setNotice(t("AI 独立文案已生成 {0}/{1} 条。{2}{3}", [succeeded.length, targets.length, skipped ? t("跳过 {0} 条不可编辑草稿。", [skipped]) : "", failures.length ? t("失败 {0} 条：{1}", [failures.length, failures.slice(0, 3).join("；")]) : t("请核对文案后再发布。")]));
    });
  };
  const generateSelectedSharedCaption = () => {
    if (busy || publishing || !settings.backendLoggedIn || !selectedDrafts.length || selectedDrafts.some(d => !canEditCopy(d) || draftLocked(d))) return;
    void runBusy(t("正在为所选草稿生成统一文案…"), async () => {
      const updated = await window.reach.generateSharedCaption(selectedDrafts.map(d => d.id));
      setNotice(t("已为 {0} 条草稿生成统一正文，并建立共享关联。修改其中一条共享正文会同步到本组；标题、话题等仍分别保留。", [updated.length]));
    });
  };

  const prepare = () => {
    if (!selectedDraft) return;
    void runBusy(t("正在准备发布素材…"), async () => {
      await window.reach.updateDraft(selectedDraft.id, { imageIds: draftImageIds, accountId: draftAccount, caption, captionHtml, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, publishAt: xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
      await window.reach.prepareDraft(selectedDraft.id);
      setNotice(t("已打开素材文件夹并复制文案，请在平台官网完成发布。"));
    });
  };

  const markPublished = () => {
    if (!selectedDraft) return;
    void runBusy(t("正在更新发布记录…"), async () => {
      await window.reach.markPublished(selectedDraft.id, publishedUrl || undefined);
      setNotice(t("已标记为已发布，可在「发布记录」中查看。"));
    });
  };

  const deleteSelectedDrafts = () => {
    if (busy || !pendingDeleteIds || !canDeleteSelection || pendingDeleteIds.length !== selectedDrafts.length || pendingDeleteIds.some(id => !selectedDrafts.some(draft => draft.id === id))) return;
    const ids = pendingDeleteIds;
    setPendingDeleteIds(null);
    void runBusy(t("正在批量删除草稿…"), async () => {
      const count = await window.reach.deleteDrafts(ids);
      setCheckedDrafts(old => old.filter(id => !ids.includes(id)));
      setSelectedDraftId(old => old && ids.includes(old) ? null : old);
      setNotice(t("已删除 {0} 条草稿。", [count]));
    });
  };

  const deletePublishRecords = (ids: string[]) => runBusy(t("正在删除发布记录…"), async () => {
    const count = await window.reach.deletePublishRecords(ids);
    setDrafts(old => old.filter(draft => !ids.includes(draft.id)));
    setNotice(t("已删除 {0} 条本地发布记录。", [count]));
  });

  const schedule = () => {
    if (!selectedDraft || !scheduleAt) return;
    void runBusy(t("正在保存提醒…"), async () => {
      await window.reach.scheduleDraft(selectedDraft.id, scheduleAt);
      setNotice(t("已保存本地提醒，请保持程序运行以接收提醒。"));
    });
  };

  const togglePlatform = (platform: Platform) => {
    setPlatforms((old) => old.includes(platform) ? old.filter((item) => item !== platform) : [...old, platform]);
  };

  const toggleImage = (id: string) => {
    setPendingImageDeleteIds(null);
    setSelectedImages((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  };

  const switchCaptionMode = (mode: "shared" | "independent") => {
    if (!selectedDraft) return;
    void runBusy(t("正在切换文案模式…"), async () => {
      await window.reach.updateDraft(selectedDraft.id, {imageIds: draftImageIds, accountId: draftAccount, caption, captionHtml, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, publishAt: xScheduleAt ? new Date(xScheduleAt).toISOString() : null});
      await window.reach.updateDraft(selectedDraft.id, {captionMode: mode});
    });
  };

  return (
    <div className="app-shell">
      {editingImage&&<ImageEditor key={editingImage.id} image={editingImage} images={images} onClose={()=>setEditingImage(undefined)} onSaved={async image=>{await refresh();setSelectedImages([image.id]);setEditingImage(undefined);setNotice(t("已保存编辑副本，原图保持不变。"));}}/>}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Aperture size={21}/></div>
          <div><strong>FANZY REACH</strong><span>{t("工作室")}</span></div>
        </div>
        <div className="workspace-label">{t("工作空间")}</div>
        <button className={`nav-item ${page === "studio" ? "active" : ""}`} onClick={() => setPage("studio")}><CalendarClock size={17}/> {t("内容工作台")}</button>
        <button className={`nav-item ${page === "library" ? "active" : ""}`} onClick={() => setPage("library")}>
          <LayoutDashboard size={17}/> {t("素材库")}</button>
        <button className={`nav-item ${page === "queue" ? "active" : ""}`} onClick={() => setPage("queue")}>
          <ListChecks size={17}/> {t("发布队列")}<span className="nav-count">{queueDrafts.length}</span>
        </button>
        <button className={`nav-item ${page === "schedules" ? "active" : ""}`} onClick={() => setPage("schedules")}>
          <CalendarClock size={17}/> {t("本地定时任务")}<span className="nav-count">{localSchedules.length}</span>
        </button>
        <button className={`nav-item ${page === "history" ? "active" : ""}`} onClick={() => setPage("history")}>
          <CheckCircle2 size={17}/> {t("发布记录")}<span className="nav-count">{publishRecords.length}</span>
        </button>
        <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}>
          <Settings size={17}/> {t("设置与账号")}</button>
        <button className={`nav-item ${page === "logs" ? "active" : ""}`} onClick={() => { setLogDraftId(""); setPage("logs"); }}><ListChecks size={17}/> {t("运行日志")}</button>
        <nav className="platform-shortcuts" aria-label={t("平台快捷入口")}>
          <div className="workspace-label">{t("平台快捷入口")}</div>
          <p>{t("使用已登录的平台账号查看发布结果。")}</p>
          <div className="platform-shortcut-grid">
            {Object.entries(PLATFORM_META).map(([platform, meta]) => {
              const Icon = meta.icon;
              const account = accounts.find(a=>a.platform===platform);
              if (!account) return null;
              return <button key={platform} className="platform-shortcut-open" disabled={browserBusy} title={t("打开 {0} 网站", [meta.label])} onClick={() => void runBusy(t("正在打开 {0} 专用浏览器…", [meta.label]), () => window.reach.openPlatformBrowser(platform as Platform, true, account.id))}><Icon size={15} style={{ color: meta.color }}/><span>{meta.label} · {accountLabel(account)}</span><ArrowUpRight size={12}/></button>;
            })}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-icon"><CheckCircle2 size={16}/></div>
            <div><strong>{t("本地存储")}</strong><span>{t("本地管理素材，多平台发布。")}</span></div>
          </div>
          <div className="version">FANZY REACH · v0.1.0</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">{t("工作空间")}<span>/</span> {page === "studio" ? t("内容工作台") : page === "library" ? t("素材库") : page === "queue" ? t("发布队列") : page === "schedules" ? t("本地定时任务") : page === "history" ? t("发布记录") : page === "logs" ? t("运行日志") : t("设置")}</div>
          <div className="top-actions">
            <LanguageSelect />
            <span className="online-dot"/> {t("本地工作空间")}<div className="avatar">FR</div>
          </div>
        </header>

        <div className="content">
          {notice && <div className="notice"><CircleHelp size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={15}/></button></div>}
          {busy && <div className="busy-bar"><Loader2 className="spin" size={15}/>{busyText}</div>}
          {publishing && <div className="busy-bar" role="status"><Loader2 className="spin" size={15}/><span>{t("{0} 已提交的内容需到平台核对。", [cancellingPublish ? t("正在停止发布并关闭发布窗口…") : t("正在后台发布 {0} 条草稿，当前批次及关联文案暂时锁定。", [publishingIds.length])])}</span><button className="button danger small" disabled={cancellingPublish} onClick={async () => {
            setCancellingPublish(true);
            try {
              await window.reach.cancelPublishBatch();
              setDrafts(await window.reach.listDrafts());
              setNotice(t("本次发布已停止。尚未提交的任务可重新选择发布；已提交的任务请先到平台核对结果。"));
            } catch (error) { setNotice(error instanceof Error ? error.message : t("停止发布失败，请查看运行日志")); }
            finally { setCancellingPublish(false); }
          }}>{cancellingPublish ? t("正在停止…") : t("停止本次发布")}</button></div>}

          {page === "studio" && <ContentStudio accounts={accounts} images={images} drafts={drafts} refresh={async()=>{setImages(await window.reach.listImages());setDrafts(await window.reach.listDrafts());}}/>}
          {page === "logs" && <RunLogs draftId={logDraftId}/> }
          {page === "schedules" && <LocalSchedules accounts={accounts} tasks={localSchedules} images={images} platforms={PLATFORM_META} busy={busy} isLocked={draftLocked}
            onDelete={ids => runBusy(t("正在删除本地定时任务…"), async () => {
              const count = await window.reach.deleteLocalScheduledDrafts(ids);
              setDrafts(old => old.filter(draft => !ids.includes(draft.id)));
              setNotice(t("已删除 {0} 条本地定时任务，不会再自动发布。", [count]));
            })}
            onCancel={id => runBusy(t("正在取消定时…"), async () => {
              const draft = await window.reach.updateDraft(id, {publishAt:null});
              setDrafts(old => old.map(item => item.id === id ? draft : item));
              setNotice(t("已取消本地定时，草稿已保留。"));
              setSelectedDraftId(id);
              setPage("queue");
            })}
            onLogs={id => { setLogDraftId(id); setPage("logs"); }}/>
          }
          {page === "history" && <PublishHistory accounts={accounts} records={publishRecords} images={images} platforms={PLATFORM_META} busy={busy} isLocked={draftLocked} onDelete={deletePublishRecords} onLogs={id => { setLogDraftId(id); setPage("logs"); }}/>}
          {page === "library" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">{t("素材管理")}</div><h1>{t("素材库")}</h1><p>{t("导入和管理图片、视频，为各个平台准备发布素材。")}</p></div>
                <div className="heading-actions">
                  <button className="button secondary" disabled={busy} onClick={() => setShowImageGenerator(value => !value)}><Sparkles size={16}/> {t("AI 生成图片")}</button>
                  <button className="button secondary" onClick={importFolder} disabled={busy}><FolderOpen size={16}/> {t("导入文件夹")}</button>
                  <button className="button primary" onClick={importFiles} disabled={busy}><ImagePlus size={16}/> {t("导入图片 / 视频")}</button>
                </div>
              </section>

              {showImageGenerator && <ImageGenerator busy={busy} settings={settings} setSettings={setSettings} runBusy={runBusy} images={images} selectedImages={selectedImages} onSettings={() => setPage("settings")} onClose={() => setShowImageGenerator(false)} onResult={result => {
                setSearch(""); setFolderFilter(""); setMediaFilter("");
                if (result.imported.length) setSelectedImages(result.imported.map(image => image.id));
                setNotice(result.imported.length ? t("图片已保存到素材库，可预览或创建发布草稿。") : t("结果与已有素材重复，已保留素材库中的原图。"));
              }}/>}

              <section className="stats-grid">
                <div className="stat-card"><span>{t("素材总数")}</span><strong>{images.length}</strong><small>{t("本地保存")}</small></div>
                <div className="stat-card"><span>{t("已选择")}</span><strong>{selectedImages.length}</strong><small>{t("可创建草稿或删除素材")}</small></div>
                <div className="stat-card"><span>{t("草稿总数")}</span><strong>{queueDrafts.length}</strong><small>{t("涵盖所有平台")}</small></div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div><h2>{t("全部素材")}</h2><p>{t("选择素材，设置统一文案或各平台独立文案。")}</p></div>
                  <div className="library-filters">
                    <label className="folder-filter"><select aria-label={t("素材类型")} value={mediaFilter} onChange={e => setMediaFilter(e.target.value)}><option value="">{t("全部素材")}</option><option value="image">{t("图片")}</option><option value="video">{t("视频")}</option></select></label>
                    <label className="folder-filter"><FolderOpen size={15}/><select aria-label={t("按文件夹筛选")} value={folderFilter} onChange={e => setFolderFilter(e.target.value)} title={folderFilter === "ungrouped" ? t("未记录文件夹") : folderFilter || t("全部文件夹")}>
                      <option value="">{t("全部文件夹（{0}）", [images.length])}</option>
                      {folders.map(([folder, count]) => <option key={folder} value={folder}>{folder}（{count}）</option>)}
                      {ungroupedCount > 0 && <option value="ungrouped">{t("未记录文件夹（{0}）", [ungroupedCount])}</option>}
                    </select></label>
                    <div className="search-box"><Search size={15}/><input placeholder={t("搜索素材…")} value={search} onChange={(e) => setSearch(e.target.value)}/></div>
                  </div>
                </div>
                <div className="library-actions heading-actions">
                  <button className="button secondary" disabled={busy || !filteredImages.length} onClick={() => { setPendingImageDeleteIds(null); setSelectedImages(filteredImages.map(image => image.id)); }}><ListChecks size={16}/> {search || folderFilter || mediaFilter ? t("全选当前结果") : t("全选")}（{filteredImages.length}）</button>
                  <button className="button secondary" disabled={busy || !selectedImages.length} onClick={() => { setPendingImageDeleteIds(null); setSelectedImages([]); }}>{t("清空选择")}</button>
                  <button className="button danger" disabled={busy || !selectedImages.length} onClick={() => setPendingImageDeleteIds([...selectedImages])}><Trash2 size={16}/> {t("删除所选（{0}）", [selectedImages.length])}</button>
                  {selectedImages.some(id => !filteredImages.some(image => image.id === id)) && <span className="muted">{t("包含 {0} 张当前筛选结果外的素材", [selectedImages.filter(id => !filteredImages.some(image => image.id === id)).length])}</span>}
                </div>
                {pendingImageDeleteIds && <div className="delete-confirm" role="group" aria-label={t("确认删除素材")}>
                  <p>{t("确定删除选中的 {0} 项素材？将删除素材库中的素材副本及缩略图，无法恢复，导入前的原文件不受影响。发布记录会保留；仍被未完成草稿使用的图片会跳过。", [pendingImageDeleteIds.length])}</p>
                  <ul className="delete-file-list">{pendingImageDeleteIds.map(id => <li key={id}>{images.find(image => image.id === id)?.fileName || id}</li>)}</ul>
                  <div className="heading-actions"><button className="button danger small" disabled={busy} onClick={deleteSelectedImages}>{t("确认删除素材")}</button><button className="button secondary small" disabled={busy} onClick={() => setPendingImageDeleteIds(null)}>{t("取消")}</button></div>
                </div>}
                {images.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon"><Upload size={25}/></div><h3>{t("素材库暂无素材")}</h3><p>{t("导入文件夹或选择图片、视频开始使用。")}</p><button className="button primary" onClick={importFolder}><FolderOpen size={16}/> {t("选择素材文件夹")}</button></div>
                ) : filteredImages.length === 0 ? <div className="empty-mini">{t("没有匹配的素材，请调整文件夹筛选或搜索内容。")}</div> : (
                  <div className="image-grid">
                    {filteredImages.map((image) => (
                      <button key={image.id} className={`image-card ${selectedImages.includes(image.id) ? "selected" : ""}`} disabled={busy} aria-pressed={selectedImages.includes(image.id)} onClick={() => toggleImage(image.id)}>
                        <div className="image-thumb">
                          {image.thumbnailDataUrl ? <img src={image.thumbnailDataUrl} alt={image.fileName}/> : <FileImage/>}
                          <span className="select-indicator">{selectedImages.includes(image.id) ? <Check size={14}/> : ""}</span>
                        </div>
                        <div className="image-meta"><strong title={image.fileName}>{image.fileName}</strong><span>{isVideo(image) ? t("视频 · {0} 秒 · ", [Math.round(image.video?.duration || 0)]) : ""}{image.width} × {image.height}</span></div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel create-panel">
                <details className="video-rules"><summary>{t("视频上传要求与平台限制")}</summary><p>{t("每条视频单独创建草稿。发布兼容格式：MP4 / H.264、AAC 或无音轨；不自动裁剪或转码。MOV、WebM 可导入查看，但需自行转换后发布。")}</p>{platforms.map(platform => <p key={platform}><strong>{PLATFORM_META[platform].label}：</strong>{t(VIDEO_RULES[platform].note)}</p>)}<p>{t("AI 文案仅参考视频封面，不分析完整视频或音轨。")}</p></details>
                {selectedVideoIssues.length > 0 && <div className="delete-confirm" role="alert">{t("请先处理视频限制，或取消选择不适用的平台：")}<ul>{selectedVideoIssues.slice(0, 8).map((issue, index) => <li key={index}>{issue}</li>)}</ul>{selectedVideoIssues.length > 8 && <p>{t("另有 {0} 项，请分批查看。", [selectedVideoIssues.length - 8])}</p>}</div>}
                {selectedImages.length===1&&images.some(image=>image.id===selectedImages[0]&&!isVideo(image))&&<button className="button secondary small" disabled={busy} onClick={()=>setEditingImage(images.find(image=>image.id===selectedImages[0]))}>{t("编辑所选图片")}</button>}
                {selectedImages.length === 1 && images.some(image => image.id === selectedImages[0] && isVideo(image)) && <button className="button secondary small" onClick={() => void window.reach.previewMedia(selectedImages[0]).catch(error => setNotice(error.message))}>{t("播放所选视频")}</button>}
                <div className="panel-heading"><div><h2>{t("创建发布草稿")}</h2><p>{t("选择发布平台，图片将按各平台的默认数量分组，并带入已保存的图板、标签和定时偏好。")}</p></div><button className="text-button" onClick={()=>setPage("settings")}>{t("配置各平台默认选项")}</button></div>
                <div className="platform-options">
                  {(["instagram", "x", "pinterest", "tiktok", "bluesky", "facebook"] as Platform[]).map((platform) => {
                    const meta = PLATFORM_META[platform];
                    const Icon = meta.icon;
                    return <button key={platform} className={`platform-option ${platforms.includes(platform) ? "chosen" : ""}`} onClick={() => togglePlatform(platform)}>
                      <Icon size={18}/><span>{meta.label}</span>{platforms.includes(platform) && <Check size={15}/>}
                    </button>;
                  })}
                </div>
                <div className="copy-options">
                  <div className="field"><label htmlFor="shared-caption">{t("统一文案")}</label><CaptionEditor id="shared-caption" rows={4} maxLength={5000} disabled={busy} value={copyOptions.sharedCaption} html={copyOptions.sharedCaptionHtml} onChange={(value,html)=>setCopyOptions(old=>({...old,sharedCaption:value,sharedCaptionHtml:html}))} placeholder={t("填写共用文案；下方可为任意平台单独编写")}/></div>
                  <p className="muted">{t("共用文案会关联本次创建的草稿。平台独立文案会在切换时保留；图片按各平台批量大小拆分，视频每条单独创建草稿。")}</p>
                  {platforms.map(platform=><div className="field" key={platform}>
                    <label htmlFor={`copy-mode-${platform}`}>{t("{0} 文案方式", [PLATFORM_META[platform].label])}</label>
                    <select id={`copy-mode-${platform}`} disabled={busy} value={copyOptions.platforms[platform]?.mode || "shared"} onChange={e=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{caption:old.platforms[platform]?.caption || "",captionHtml:old.platforms[platform]?.captionHtml,mode:e.target.value as "shared" | "independent"}}}))}>
                      <option value="shared">{t("使用统一文案")}</option><option value="independent">{t("使用独立文案")}</option>
                    </select>
                    {copyOptions.platforms[platform]?.mode === "independent" && <><CaptionEditor aria-label={t("{0} 独立文案", [PLATFORM_META[platform].label])} rows={3} maxLength={5000} disabled={busy} value={copyOptions.platforms[platform]?.caption || ""} html={copyOptions.platforms[platform]?.captionHtml} onChange={(value,html)=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{mode:"independent",caption:value,captionHtml:html}}}))}/><button className="text-button" disabled={busy} onClick={()=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{mode:"independent",caption:old.sharedCaption,captionHtml:old.sharedCaptionHtml}}}))}>{t("复制统一文案到此平台")}</button></>}
                  </div>)}
                </div>
                <div className="create-footer">
                  <span>{t("已选择 {0} 项素材 · {1} 个平台", [selectedImages.length, platforms.length])}</span>
                  <div className="account-targets"><strong>{t("发布账号")}</strong>{accounts.filter(a=>platforms.includes(a.platform)).map(a=><label key={a.id}><input type="checkbox" disabled={busy} checked={targetAccounts.includes(a.id)} onChange={e=>setTargetAccounts(old=>e.target.checked?[...old,a.id]:old.filter(id=>id!==a.id))}/>{PLATFORM_META[a.platform].label} · {accountLabel(a)}</label>)}</div>
                  <button className="button primary" onClick={createDrafts} disabled={busy || !selectedImages.length || !platforms.length || selectedVideoIssues.length > 0 || platforms.some(p=>!accounts.some(a=>a.platform===p&&targetAccounts.includes(a.id)))}><Plus size={16}/> {t("创建草稿")}</button>
                </div>
              </section>
            </>
          )}

          {page === "queue" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">{t("内容发布")}</div><h1>{t("发布队列")}</h1><p>{t("核对草稿后，选择任务并提交发布。")}</p></div>
                <button className="button secondary" onClick={() => void refresh()}><ChevronDown size={16}/> {t("刷新")}</button>
              </section>
              <section className="panel">
                <h2>{t("多平台自动发布")}</h2>
                <p className="muted">{t("提交选中草稿：定时任务原生优先，不可用时加入本地队列；未设置时间的立即发布。登录检查或页面变化会暂停该平台；结果不确定时请先核对再重试。")}</p>
                <div className="heading-actions">
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts(queueDrafts.filter(d => canPublish(d) && !draftLocked(d)).slice(0, 100).map((d) => d.id))}>{t("选择可发布草稿（最多 100 条）")}</button>
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts([])}>{t("清空选择")}</button>
                  <button className="button primary" disabled={browserBusy || !canSubmitSelection} onClick={publishSelected}><Send size={16}/> {t("提交选中的 {0} 条", [selectedDrafts.length])}</button>
                  <button className="button secondary" disabled={busy || publishing || !settings.backendLoggedIn || !selectedDrafts.some(d => canEditCopy(d) && !draftLocked(d))} onClick={generateSelectedCaptions}><Sparkles size={16}/> {t("AI 批量生成独立文案")}</button>
                  <button className="button secondary" disabled={busy || publishing || !settings.backendLoggedIn || !selectedDrafts.length || selectedDrafts.length > 100 || selectedDrafts.some(d => !canEditCopy(d) || draftLocked(d))} onClick={generateSelectedSharedCaption}><Sparkles size={16}/> {t("AI 生成统一文案")}</button>
                </div>
                <p className="muted">{t("批量 AI 会分别按平台生成并替换所选草稿的标题、正文、话题和图片说明，自动切换为独立文案。生成期间显示进度，单条失败不影响后续草稿。")}</p>
                <p className="muted">{t("统一 AI 使用所选草稿的去重图片（最多 35 张）生成一份共享正文，保留各平台标题和话题，以及原独立正文备份。")}</p>
              </section>
              <div className="queue-layout">
                <section className="panel draft-list">
                  <div className="panel-heading"><div><h2>{t("草稿")}</h2><p>{t("{0} 条平台任务 · 已选 {1} 条", [queueDrafts.length, selectedDrafts.length])}</p></div></div>
                  <div className="draft-bulk-actions">
                    <button className="text-button" disabled={busy || !queueDrafts.some(d => canDeleteDraft(d) && !draftLocked(d))} onClick={() => setCheckedDrafts(queueDrafts.filter(d => canDeleteDraft(d) && !draftLocked(d)).map(d => d.id))}>{t("全选可删除草稿")}</button>
                    <button className="text-button" disabled={busy || !checkedDrafts.length} onClick={() => setCheckedDrafts([])}>{t("清空选择")}</button>
                    <button className="button danger" disabled={busy || !canDeleteSelection} onClick={() => setPendingDeleteIds(selectedDrafts.map(d => d.id))}><Trash2 size={15}/> {t("批量删除（{0}）", [selectedDrafts.length])}</button>
                  </div>
                  {pendingDeleteIds && <div className="delete-confirm" role="group" aria-label={t("确认批量删除草稿")}>
                    <p>{t("确定删除这 {0} 条草稿？删除后无法恢复，素材库中的图片会保留。", [pendingDeleteIds.length])}</p>
                    <div className="heading-actions"><button className="button danger small" disabled={busy || !canDeleteSelection} onClick={deleteSelectedDrafts}>{t("确认删除")}</button><button className="button secondary small" disabled={busy} onClick={() => setPendingDeleteIds(null)}>{t("取消")}</button></div>
                  </div>}
                  {queueDrafts.length === 0 ? <div className="empty-mini">{t("暂无草稿。已完成的任务可在「发布记录」中查看。")}</div> :
                    queueDrafts.map((draft) => {
                      const meta = PLATFORM_META[draft.platform];
                      const Icon = meta.icon;
                      return <div key={draft.id} className="draft-select-row"><input type="checkbox" aria-label={t("选择 {0} 草稿 {1}", [meta.label, draft.id])} checked={checkedDrafts.includes(draft.id)} disabled={busy || draftLocked(draft) || !canDeleteDraft(draft)} onChange={(e) => setCheckedDrafts((old) => e.target.checked ? [...old, draft.id] : old.filter((id) => id !== draft.id))}/><button className={`draft-row ${selectedDraftId === draft.id ? "selected" : ""}`} onClick={() => setSelectedDraftId(draft.id)}>
                        <div className="platform-icon" style={{ color: meta.color }}><Icon size={18}/></div>
                        <div className="draft-row-main"><strong>{meta.label} · {accountName(draft)}</strong><span>{t("{0} 项素材 · {1}", [draft.imageIds.length, STATUS_LABEL[draft.browserPublish?.state || draft.status] || draft.status])}</span></div>
                        <span className={`status-dot ${draft.status}`}/>
                      </button></div>;
                    })}
                </section>

                <section className="panel draft-detail">
                  {!selectedDraft ? <div className="empty-state"><div className="empty-icon"><ListChecks/></div><h3>{t("选择一条草稿")}</h3><p>{t("从左侧列表选择发布任务。")}</p></div> : (
                    <>
                      <div className="detail-heading">
                        <div><div className="eyebrow">{t("平台草稿")}</div><h2>{PLATFORM_META[selectedDraft.platform].label}</h2><p>{t("{0} 项素材 · {1}", [selectedDraft.imageIds.length, STATUS_LABEL[selectedDraft.status]])}</p></div>
                        <button className="icon-button danger" disabled={detailBusy || !canDeleteDraft(selectedDraft)} title={t("删除草稿")} onClick={() => void runBusy(t("正在删除草稿…"), async () => { await window.reach.deleteDraft(selectedDraft.id); setCheckedDrafts((old) => old.filter((id) => id !== selectedDraft.id)); setSelectedDraftId(null); })}><Trash2 size={17}/></button>
                      </div>
                      <PublishPreview key={selectedDraft.id} draft={{...selectedDraft,title,caption,hashtags:hashtags.split(/\s+/).filter(Boolean),altText}} images={images} accountName={accountLabel(accounts.find(a=>a.id===draftAccount))} order={draftImageIds} onOrder={setDraftImageIds} disabled={detailBusy||!canEditCopy(selectedDraft)||selectedDraft.status==="local_scheduled"}/>
                      <div className="field"><label htmlFor="draft-account">{t("发布账号")}</label><select id="draft-account" value={draftAccount} disabled={detailBusy || !canEditCopy(selectedDraft) || selectedDraft.status === "local_scheduled"} onChange={e=>setDraftAccount(e.target.value)}>{accounts.filter(a=>a.platform===selectedDraft.platform).map(a=><option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select><p className="muted">{t("更换账号后请保存修改。本地定时任务需先取消定时。")}</p></div>
                      {selectedDraft.browserPublish && <div className="published-box"><strong>{STATUS_LABEL[selectedDraft.browserPublish.state]}</strong><button className="text-button" onClick={() => { setLogDraftId(selectedDraft.id); setPage("logs"); }}>{t("查看该任务日志")}</button><p className="muted">{t(selectedDraft.browserPublish.message)}</p>
                        {selectedDraft.browserPublish.state === "uncertain" && <div className="detail-actions">
                          <button className="button success" disabled={detailBusy} onClick={() => void runBusy(t("正在保存核对结果…"), () => window.reach.resolvePublish(selectedDraft.id, true))}>{selectedDraft.scheduleMode === "native" ? t("已在平台确认排程存在") : t("已确认发布成功")}</button>
                          <button className="button secondary" disabled={detailBusy} onClick={() => void runBusy(t("正在保存核对结果…"), () => window.reach.resolvePublish(selectedDraft.id, false))}>{selectedDraft.scheduleMode === "native" ? t("已确认平台中无此排程，允许重试") : t("已确认未发布，允许重试")}</button>
                        </div>}
                      </div>}
                      {selectedDraft.platform === "tiktok" && <div className="field"><label htmlFor="tiktok-privacy">{t("谁可以看")}</label><select id="tiktok-privacy" disabled={detailBusy || !canEditCopy(selectedDraft)} value={tiktokPrivacy} onChange={e=>setTikTokPrivacy(e.target.value as "public" | "self_only")}><option value="self_only">{t("仅自己")}</option><option value="public">{t("所有人")}</option></select></div>}
                      {selectedDraft.platform === "pinterest" && <div className="field"><label>{t("Pinterest 图板名称（必填，需完全匹配）")}</label><input disabled={detailBusy} value={boardName} onChange={(e) => setBoardName(e.target.value)}/></div>}
                      {<div className="field">
                        <label htmlFor="x-schedule">{t("定时发布时间（{0}）", [Intl.DateTimeFormat().resolvedOptions().timeZone])}</label>
                        <input id="x-schedule" type="datetime-local" disabled={detailBusy || !canEditCopy(selectedDraft)} value={xScheduleAt} onChange={e=>setXScheduleAt(e.target.value)}/>
                        <p className="muted">{t("留空立即发布。选择至少 5 分钟后的时间，保存后提交任务。原生排程确认后可关闭程序；本地任务需保持电脑唤醒、程序运行、联网和登录有效。退出或休眠期间错过的任务恢复后补发，失败不会自动重试。修改本地任务时间会取消原任务，需要重新提交。已提交的原生排程请前往平台修改。")}</p>
                      </div>}
                      <div
                        className={`native-drag-zone ${selectedDraft.preparedFolder ? "is-ready" : ""}`}
                        draggable={Boolean(selectedDraft.preparedFolder)}
                        onDragStart={(event) => {
                          if (!selectedDraft.preparedFolder) {
                            event.preventDefault();
                            return;
                          }
                          // Electron main process starts a native OS file drag.
                          window.reach.startFileDrag(selectedDraft.id);
                        }}
                        title={selectedDraft.preparedFolder ? t("将此卡片拖入平台发布窗口") : t("请先准备素材")}
                      >
                        <div className="drag-zone-top">
                          <div><strong>{t("拖动素材到 {0}", [PLATFORM_META[selectedDraft.platform].label])}</strong><span>{selectedDraft.preparedFolder ? t("将此卡片拖入平台编辑器") : t("准备素材后可拖动素材")}</span></div>
                          <span className="drag-grip">⠿</span>
                        </div>
                        <div className="detail-images">
                          {selectedDraft.imageIds.map((id) => {
                            const image = images.find((item) => item.id === id);
                            return image?.thumbnailDataUrl ? <img key={id} src={image.thumbnailDataUrl} alt={image.fileName}/> : null;
                          })}
                        </div>
                        <div className="drag-zone-foot">{t("{0} 项素材 · 手动发布时可拖动上传", [selectedDraft.imageIds.length])}</div>
                      </div>
                      <div className="field">
                        <label>{t("帖子标题 / Pin 标题")}</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("填写标题（可选）")}/>
                      </div>
                      <div className="field">
                        {selectedDraft.copyGroupId && <><label htmlFor="draft-copy-mode">{t("文案方式")}</label><select id="draft-copy-mode" disabled={detailBusy || !canEditCopy(selectedDraft)} value={selectedDraft.captionMode || "independent"} onChange={e=>switchCaptionMode(e.target.value as "shared" | "independent")}><option value="shared">{t("使用统一文案")}</option><option value="independent">{t("使用独立文案")}</option></select><p className="muted">{selectedDraft.captionMode === "shared" ? t("保存正文将同步本批次中使用统一文案的 {0} 条可编辑草稿。已发布、已排程及结果待确认的草稿不受影响。", [drafts.filter(d=>d.copyGroupId===selectedDraft.copyGroupId && d.captionMode==="shared" && canEditCopy(d)).length]) : t("仅修改当前草稿；切换为统一文案时会保留独立版本。")}</p></>}
                        <div className="label-row"><label htmlFor="draft-caption">{t("正文文案")}</label><button className="text-button" onClick={generateCaption} disabled={detailBusy || !canEditCopy(selectedDraft) || !settings.backendLoggedIn}><Sparkles size={14}/> {t("AI 生成独立文案")}</button></div>
                        <p className="muted">{t("AI 生成将使用当前平台的独立文案。标题、话题标签、图片说明、图板和定时时间始终分别设置。")}</p>
                        <CaptionTools key={"tools-" + selectedDraft.id + selectedDraft.captionMode} draftId={selectedDraft.id} revision={selectedDraft.updatedAt} value={caption} disabled={detailBusy || !canEditCopy(selectedDraft) || !settings.backendLoggedIn} shared={selectedDraft.captionMode === "shared"} onApply={text=>{setCaption(text);setCaptionHtml(undefined);}}/>
                        <CaptionEditor key={selectedDraft.id + selectedDraft.captionMode} id="draft-caption" maxLength={5000} disabled={detailBusy || !canEditCopy(selectedDraft)} rows={6} value={caption} html={captionHtml} onChange={(value,html)=>{setCaption(value);setCaptionHtml(html);}} placeholder={t("输入文案，或使用 AI 生成…")}/>
                      </div>
                      <div className="field">
                        <label>{t("平台话题标签（发布时附加在正文后，以空格分隔）")}</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder={t("输入话题标签，以空格分隔")}/>
                      </div>
                      <div className="field">
                        <label>{t("图片替代说明")}</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={altText} onChange={(e) => setAltText(e.target.value)} placeholder={t("供无障碍阅读使用的图片描述")}/>
                      </div>
                      <p className="drag-help">{t("批量发布时，不同平台同时执行，同一平台依次执行。也可准备素材后手动拖动上传。切换草稿前请保存修改。")}</p>
                      <div className="detail-actions">
                        <button className="button secondary" onClick={() => void saveDraft()} disabled={detailBusy || !canEditCopy(selectedDraft)}><Check size={16}/> {t("保存修改")}</button>
                        <button className="button primary" onClick={prepare} disabled={detailBusy || !canEditCopy(selectedDraft)}><FolderOpen size={16}/> {t("准备素材并打开平台")}</button>
                      </div>
                      <div className="schedule-box">
                        <div><strong><CalendarClock size={16}/> {t("本地提醒")}</strong><p>{t("程序运行时显示提醒，不会自动发布。")}</p></div>
                        <div className="schedule-controls"><input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}/><button className="button small secondary" onClick={schedule} disabled={!scheduleAt || detailBusy}>{t("保存")}</button></div>
                      </div>
                      <div className="published-box">
                        <div className="field"><label>{t("已发布帖子的链接（可选）")}</label><input value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} placeholder="https://…"/></div>
                        <button className="button success" onClick={markPublished} disabled={detailBusy}><CheckCircle2 size={16}/> {t("标记为已发布")}</button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {page === "settings" && (
            <>
              <section className="page-heading"><div><div className="eyebrow">{t("偏好设置")}</div><h1>{t("设置与账号")}</h1><p>{t("配置浏览器登录和 AI 文案生成功能。")}</p></div></section>
              <section className="panel settings-panel">
                <h2>{t("Python + Playwright 浏览器发布")}</h2>
                <p className="muted">{t("每个账号使用独立登录环境。默认账号沿用原有登录状态和草稿。")}</p>
                <div className="field"><label>{t("登录与发布浏览器")}</label><p>{t("Google Chrome（需已安装）")}</p></div>
                <label><input type="checkbox" disabled={browserBusy} checked={browserSettings.showBrowser} onChange={e=>void runBusy(t("正在保存浏览器设置…"),async()=>{setBrowserSettings(await window.reach.saveBrowserSettings({...browserSettings,showBrowser:e.target.checked}));})}/> {t("显示浏览器（发布时打开可见窗口）")}</label>
                <p className="muted">{t("登录始终使用可见的普通 Chrome；上方开关仅控制发布窗口。各平台配置独立，不影响日常 Chrome。旧 Edge / Chromium 配置保留，但需在 Chrome 中重新登录。保存登录不代表平台允许发布。")}</p>
                <p className="muted">{t("失败截图保存在日志目录的 screenshots 子目录，最多保留 50 张；可能包含账号和草稿内容。可在运行日志中查看路径并打开日志文件夹。")}</p>
              </section>
              <section className="panel settings-panel">
                <div className="settings-title"><div className="provider-mark"><Sparkles/></div><div><h2>{t("图片理解")}</h2><p>{t("分析图片，为各平台生成英文文案。")}</p></div></div>
                <p className="muted">{t("登录账户后即可使用图片理解，无需填写 API 密钥。")}</p>
                <div className="key-status"><span className={`status-dot ${settings.backendLoggedIn ? "published" : "draft"}`}/>{settings.backendLoggedIn ? t("已登录，可生成 AI 文案") : t("请先登录下方账户，也可以手动创建和编辑文案。")}</div>
              </section>
              <Accounts accounts={accounts} busy={browserBusy} run={runBusy} platforms={PLATFORM_META}/>
              <ImageGenerationSettings busy={busy} settings={settings} setSettings={setSettings} runBusy={runBusy}/>
              <PlatformSettings/>
              <section className="panel"><h2>{t("隐私说明")}</h2><p className="muted">{t("图片、草稿和导出文件均保存在本地。生成 AI 文案时，会将压缩后的所选图片发送至服务器，由服务器调用 DeepSeek；发布时将内容上传至所选平台。各平台使用本机独立保存的浏览器配置。")}</p></section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
