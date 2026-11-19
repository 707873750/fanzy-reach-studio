import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture, ArrowUpRight, CalendarClock, Check, CheckCircle2,
  ChevronDown, CircleHelp, Copy, FileImage, FolderOpen, ImagePlus,
  Instagram, LayoutDashboard, Link2, ListChecks, Loader2, Plus,
  Search, Send, Settings, Sparkles, Trash2, Upload, X, Twitter, Music2
} from "lucide-react";
import type { BrowserSettings, Draft, ImageAsset, Platform, SettingsView } from "../../shared/types";
import type { CopyOptions } from "../../shared/types";
import { canEditCopy } from "../../shared/draft-copy";
import { canDeleteDraft, isPublishRecord } from "../../shared/draft-lifecycle";

import RunLogs from "./RunLogs";
import PlatformSettings from "./PlatformSettings";
import PublishHistory from "./PublishHistory";

type Page = "library" | "queue" | "history" | "settings" | "logs";
const STATUS_LABEL: Record<string, string> = {draft:"草稿",ready:"待发布",scheduled:"已定时",prepared:"素材已准备",published:"已发布",reminder_due:"提醒已到期",platform_scheduled:"平台已排程",running:"正在发布",needs_attention:"需要处理",uncertain:"已提交，结果待确认",succeeded:"发布成功"};
const PLATFORM_META: Record<Platform, { label: string; url: string; icon: typeof Instagram; color: string }> = {
  instagram: { label: "Instagram", url: "https://www.instagram.com/", icon: Instagram, color: "#E879A6" },
  x: { label: "X", url: "https://x.com/compose/post", icon: Twitter, color: "#D8DEE9" },
  pinterest: { label: "Pinterest", url: "https://www.pinterest.com/", icon: Aperture, color: "#E35D68" },
  tiktok: { label: "TikTok", url: "https://www.tiktok.com/tiktokstudio/upload", icon: Music2, color: "#25F4EE" }
};

function App() {
  const [logDraftId, setLogDraftId] = useState("");
  const [page, setPage] = useState<Page>("library");
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [pendingImageDeleteIds, setPendingImageDeleteIds] = useState<string[] | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "x", "pinterest", "tiktok"]);
  const [copyOptions, setCopyOptions] = useState<CopyOptions>({sharedCaption:"", platforms:{instagram:{mode:"shared",caption:""},x:{mode:"shared",caption:""},pinterest:{mode:"shared",caption:""},tiktok:{mode:"shared",caption:""}}});
  const [hashtags, setHashtags] = useState("");
  const [settings, setSettings] = useState<SettingsView>({ hasDeepSeekKey: false, model: "deepseek-flash" });
  const [apiKey, setApiKey] = useState("");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [altText, setAltText] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const publishingRef = useRef(false);
  const publishing = publishingIds.length > 0;
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [checkedDrafts, setCheckedDrafts] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [xScheduleAt, setXScheduleAt] = useState("");
  const [tiktokPrivacy, setTikTokPrivacy] = useState<"public" | "self_only">("self_only");
  const [boardName, setBoardName] = useState("");
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>({showBrowser:false,channel:"chrome"});
  const canPublish = canEditCopy;
  const publishSelected = async () => {
    if (publishingRef.current || busy || !canSubmitSelection) return;
    const ids = selectedDrafts.map(draft => draft.id);
    publishingRef.current = true;
    setPublishingIds(ids);
    setNotice("");
    try {
    if (selectedDraft && ids.includes(selectedDraft.id)) {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, xScheduledAt: selectedDraft.platform === "x" && xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
    }
    const result = await window.reach.publishDrafts(ids);
    setNotice(`已发布 ${result.filter((d) => d.status === "published").length}/${result.length} 条；X 已排程 ${result.filter((d) => d.browserPublish?.state === "scheduled").length} 条。重试前请核对各任务结果。`);
    setCheckedDrafts(old => old.filter(id => !ids.includes(id)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发布操作失败，请查看运行日志");
    } finally {
      try { setDrafts(await window.reach.listDrafts()); }
      catch (error) { setNotice(error instanceof Error ? error.message : "刷新发布结果失败"); }
      publishingRef.current = false;
      setPublishingIds([]);
    }
  };

  const queueDrafts = useMemo(() => drafts.filter(draft => !isPublishRecord(draft)), [drafts]);
  const publishRecords = useMemo(() => drafts.filter(isPublishRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [drafts]);
  const selectedDraft = queueDrafts.find((draft) => draft.id === selectedDraftId) || null;
  const lockedGroups = new Set(drafts.filter(d => publishingIds.includes(d.id)).map(d => d.copyGroupId).filter(Boolean));
  const draftLocked = (draft: Draft) => publishingIds.includes(draft.id) || Boolean(draft.copyGroupId && lockedGroups.has(draft.copyGroupId));
  const detailBusy = busy || Boolean(selectedDraft && draftLocked(selectedDraft));
  const browserBusy = busy || publishing;
  const selectedDrafts = queueDrafts.filter(draft => checkedDrafts.includes(draft.id));
  const canSubmitSelection = selectedDrafts.length > 0 && selectedDrafts.length <= 100 && selectedDrafts.every(draft => canPublish(draft) && !draftLocked(draft));
  const canDeleteSelection = selectedDrafts.length > 0 && selectedDrafts.every(draft => canDeleteDraft(draft) && !draftLocked(draft));
  const filteredImages = useMemo(() => images.filter((image) =>
    image.fileName.toLowerCase().includes(search.toLowerCase())
  ), [images, search]);

  async function refresh() {
    const [nextImages, nextDrafts, nextSettings, nextBrowserSettings] = await Promise.all([
      window.reach.listImages(),
      window.reach.listDrafts(),
      window.reach.getSettings(),
      window.reach.getBrowserSettings()
    ]);
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
      setNotice(`发布提醒：${draft.platform} 草稿已到提醒时间，请手动提交。`);
      void refresh();
    });
    const offProgress = window.reach.onPublishProgress((draft) => {
      setDrafts((old) => old.map((item) => item.id === draft.id ? draft : item));
    });
    return () => { off(); offProgress(); };
  }, []);

  useEffect(() => {
    if (!selectedDraft) {
      setCaption("");
      setTitle("");
      setAltText("");
      setPublishedUrl("");
      return;
    }
    setCaption(selectedDraft.caption);
    setHashtags(selectedDraft.hashtags.join(" "));
    setTitle(selectedDraft.title);
    setAltText(selectedDraft.altText);
    setBoardName(selectedDraft.boardName || "");
    setTikTokPrivacy(selectedDraft.tiktokPrivacy || "self_only");
    const time = selectedDraft.xScheduledAt ? new Date(selectedDraft.xScheduledAt) : null;
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
      setNotice(error instanceof Error ? error.message : "操作失败，请查看运行日志");
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  const importFiles = () => runBusy("正在导入图片…", async () => {
    const result = await window.reach.importImages();
    setNotice(`已导入 ${result.imported.length} 张图片 · 重复 ${result.duplicates.length} 张 · 失败 ${result.errors.length} 张`);
  });

  const importFolder = () => runBusy("正在扫描文件夹…", async () => {
    const result = await window.reach.importFolder();
    setNotice(`已导入 ${result.imported.length} 张图片 · 重复 ${result.duplicates.length} 张 · 失败 ${result.errors.length} 张`);
  });

  const createDrafts = () => runBusy("正在创建平台草稿…", async () => {
    const created = await window.reach.createDrafts(selectedImages, platforms, copyOptions);
    setSelectedDraftId(created[0]?.id || null);
    setPage("queue");
    setNotice(`已创建 ${created.length} 条发布草稿。`);
  });

  const deleteSelectedImages = () => {
    if (busy || !pendingImageDeleteIds?.length) return;
    const ids = [...pendingImageDeleteIds];
    setPendingImageDeleteIds(null);
    void runBusy("正在删除素材…", async () => {
      const deleted: string[] = [];
      const errors: string[] = [];
      for (const id of ids) {
        try {
          await window.reach.deleteImage(id);
          deleted.push(id);
        } catch (error) {
          const name = images.find(image => image.id === id)?.fileName || id;
          const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "删除失败";
          errors.push(`${name}：${message}`);
        }
      }
      setSelectedImages(old => old.filter(id => !deleted.includes(id)));
      setNotice(`已删除 ${deleted.length} 张素材。${errors.length ? `另有 ${errors.length} 张未删除，已保留选择。${errors.slice(0, 3).join("；")}${errors.length > 3 ? "；其余失败项可重试查看。" : ""}` : ""}`);
    });
  };

  const saveDraft = async () => {
    if (!selectedDraft) return;
    await runBusy("正在保存草稿…", async () => {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, xScheduledAt: selectedDraft.platform === "x" && xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
    });
  };

  const generateCaption = () => {
    if (!selectedDraft) return;
    void runBusy("正在分析图片并生成文案…", async () => {
      await window.reach.generateCaption(selectedDraft.id);
    });
  };

  const prepare = () => {
    if (!selectedDraft) return;
    void runBusy("正在准备发布素材…", async () => {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, xScheduledAt: selectedDraft.platform === "x" && xScheduleAt ? new Date(xScheduleAt).toISOString() : null });
      await window.reach.prepareDraft(selectedDraft.id);
      setNotice("已打开素材文件夹并复制文案，请在平台官网完成发布。");
    });
  };

  const markPublished = () => {
    if (!selectedDraft) return;
    void runBusy("正在更新发布记录…", async () => {
      await window.reach.markPublished(selectedDraft.id, publishedUrl || undefined);
      setNotice("已标记为已发布，可在「发布记录」中查看。");
    });
  };

  const deleteSelectedDrafts = () => {
    if (busy || !pendingDeleteIds || !canDeleteSelection || pendingDeleteIds.length !== selectedDrafts.length || pendingDeleteIds.some(id => !selectedDrafts.some(draft => draft.id === id))) return;
    const ids = pendingDeleteIds;
    setPendingDeleteIds(null);
    void runBusy("正在批量删除草稿…", async () => {
      const count = await window.reach.deleteDrafts(ids);
      setCheckedDrafts(old => old.filter(id => !ids.includes(id)));
      setSelectedDraftId(old => old && ids.includes(old) ? null : old);
      setNotice(`已删除 ${count} 条草稿。`);
    });
  };

  const deletePublishRecords = (ids: string[]) => runBusy("正在删除发布记录…", async () => {
    const count = await window.reach.deletePublishRecords(ids);
    setDrafts(old => old.filter(draft => !ids.includes(draft.id)));
    setNotice(`已删除 ${count} 条本地发布记录。`);
  });

  const schedule = () => {
    if (!selectedDraft || !scheduleAt) return;
    void runBusy("正在保存提醒…", async () => {
      await window.reach.scheduleDraft(selectedDraft.id, scheduleAt);
      setNotice("已保存本地提醒，请保持程序运行以接收提醒。");
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
    void runBusy("正在切换文案模式…", async () => {
      await window.reach.updateDraft(selectedDraft.id, {caption, title, altText, hashtags: hashtags.split(/\s+/).filter(Boolean), boardName, tiktokPrivacy: selectedDraft.platform === "tiktok" ? tiktokPrivacy : undefined, xScheduledAt: selectedDraft.platform === "x" && xScheduleAt ? new Date(xScheduleAt).toISOString() : null});
      await window.reach.updateDraft(selectedDraft.id, {captionMode: mode});
    });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Aperture size={21}/></div>
          <div><strong>FANZY REACH</strong><span>工作室</span></div>
        </div>
        <div className="workspace-label">工作空间</div>
        <button className={`nav-item ${page === "library" ? "active" : ""}`} onClick={() => setPage("library")}>
          <LayoutDashboard size={17}/> 素材库
        </button>
        <button className={`nav-item ${page === "queue" ? "active" : ""}`} onClick={() => setPage("queue")}>
          <ListChecks size={17}/> 发布队列 <span className="nav-count">{queueDrafts.length}</span>
        </button>
        <button className={`nav-item ${page === "history" ? "active" : ""}`} onClick={() => setPage("history")}>
          <CheckCircle2 size={17}/> 发布记录 <span className="nav-count">{publishRecords.length}</span>
        </button>
        <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}>
          <Settings size={17}/> 设置与账号
        </button>
        <button className={`nav-item ${page === "logs" ? "active" : ""}`} onClick={() => { setLogDraftId(""); setPage("logs"); }}><ListChecks size={17}/> 运行日志</button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-icon"><CheckCircle2 size={16}/></div>
            <div><strong>本地存储</strong><span>本地管理素材，多平台发布。</span></div>
          </div>
          <div className="version">FANZY REACH · v0.1.0</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">工作空间 <span>/</span> {page === "library" ? "素材库" : page === "queue" ? "发布队列" : page === "history" ? "发布记录" : page === "logs" ? "运行日志" : "设置"}</div>
          <div className="top-actions">
            <span className="online-dot"/> 本地工作空间
            <div className="avatar">FR</div>
          </div>
        </header>

        <div className="content">
          {notice && <div className="notice"><CircleHelp size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={15}/></button></div>}
          {busy && <div className="busy-bar"><Loader2 className="spin" size={15}/>{busyText}</div>}
          {publishing && <div className="busy-bar" role="status"><Loader2 className="spin" size={15}/>正在后台发布 {publishingIds.length} 条草稿，可继续浏览素材、设置和日志。当前批次及关联文案暂时锁定。</div>}

          {page === "logs" && <RunLogs draftId={logDraftId}/> }
          {page === "history" && <PublishHistory records={publishRecords} images={images} platforms={PLATFORM_META} busy={busy} isLocked={draftLocked} onDelete={deletePublishRecords} onLogs={id => { setLogDraftId(id); setPage("logs"); }}/>}
          {page === "library" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">素材管理</div><h1>素材库</h1><p>导入和管理图片，为各个平台准备发布素材。</p></div>
                <div className="heading-actions">
                  <button className="button secondary" onClick={importFolder} disabled={busy}><FolderOpen size={16}/> 导入文件夹</button>
                  <button className="button primary" onClick={importFiles} disabled={busy}><ImagePlus size={16}/> 导入图片</button>
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card"><span>图片总数</span><strong>{images.length}</strong><small>本地保存</small></div>
                <div className="stat-card"><span>已选择</span><strong>{selectedImages.length}</strong><small>可创建草稿或删除素材</small></div>
                <div className="stat-card"><span>草稿总数</span><strong>{queueDrafts.length}</strong><small>涵盖所有平台</small></div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div><h2>全部图片</h2><p>选择素材，设置统一文案或各平台独立文案。</p></div>
                  <div className="search-box"><Search size={15}/><input placeholder="搜索图片…" value={search} onChange={(e) => setSearch(e.target.value)}/></div>
                </div>
                <div className="library-actions heading-actions">
                  <button className="button secondary" disabled={busy || !filteredImages.length} onClick={() => { setPendingImageDeleteIds(null); setSelectedImages(filteredImages.map(image => image.id)); }}><ListChecks size={16}/> {search ? "全选当前结果" : "全选"}（{filteredImages.length}）</button>
                  <button className="button secondary" disabled={busy || !selectedImages.length} onClick={() => { setPendingImageDeleteIds(null); setSelectedImages([]); }}>清空选择</button>
                  <button className="button danger" disabled={busy || !selectedImages.length} onClick={() => setPendingImageDeleteIds([...selectedImages])}><Trash2 size={16}/> 删除所选（{selectedImages.length}）</button>
                  {selectedImages.some(id => !filteredImages.some(image => image.id === id)) && <span className="muted">包含 {selectedImages.filter(id => !filteredImages.some(image => image.id === id)).length} 张当前搜索结果外的素材</span>}
                </div>
                {pendingImageDeleteIds && <div className="delete-confirm" role="group" aria-label="确认删除素材">
                  <p>确定删除选中的 {pendingImageDeleteIds.length} 张素材？将删除素材库中的图片副本及缩略图，无法恢复，导入前的原文件不受影响。发布记录会保留；仍被未完成草稿使用的图片会跳过。</p>
                  <ul className="delete-file-list">{pendingImageDeleteIds.map(id => <li key={id}>{images.find(image => image.id === id)?.fileName || id}</li>)}</ul>
                  <div className="heading-actions"><button className="button danger small" disabled={busy} onClick={deleteSelectedImages}>确认删除素材</button><button className="button secondary small" disabled={busy} onClick={() => setPendingImageDeleteIds(null)}>取消</button></div>
                </div>}
                {images.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon"><Upload size={25}/></div><h3>素材库暂无图片</h3><p>导入文件夹或选择多张图片开始使用。</p><button className="button primary" onClick={importFolder}><FolderOpen size={16}/> 选择图片文件夹</button></div>
                ) : filteredImages.length === 0 ? <div className="empty-mini">没有匹配的图片，请调整搜索内容。</div> : (
                  <div className="image-grid">
                    {filteredImages.map((image) => (
                      <button key={image.id} className={`image-card ${selectedImages.includes(image.id) ? "selected" : ""}`} disabled={busy} aria-pressed={selectedImages.includes(image.id)} onClick={() => toggleImage(image.id)}>
                        <div className="image-thumb">
                          {image.thumbnailDataUrl ? <img src={image.thumbnailDataUrl} alt={image.fileName}/> : <FileImage/>}
                          <span className="select-indicator">{selectedImages.includes(image.id) ? <Check size={14}/> : ""}</span>
                        </div>
                        <div className="image-meta"><strong title={image.fileName}>{image.fileName}</strong><span>{image.width} × {image.height}</span></div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel create-panel">
                <div className="panel-heading"><div><h2>创建发布草稿</h2><p>选择发布平台，图片将按各平台的默认数量分组，并带入已保存的图板、标签和定时偏好。</p></div><button className="text-button" onClick={()=>setPage("settings")}>配置各平台默认选项</button></div>
                <div className="platform-options">
                  {(["instagram", "x", "pinterest", "tiktok"] as Platform[]).map((platform) => {
                    const meta = PLATFORM_META[platform];
                    const Icon = meta.icon;
                    return <button key={platform} className={`platform-option ${platforms.includes(platform) ? "chosen" : ""}`} onClick={() => togglePlatform(platform)}>
                      <Icon size={18}/><span>{meta.label}</span>{platforms.includes(platform) && <Check size={15}/>}
                    </button>;
                  })}
                </div>
                <div className="copy-options">
                  <div className="field"><label htmlFor="shared-caption">统一文案</label><textarea id="shared-caption" rows={4} maxLength={5000} disabled={busy} value={copyOptions.sharedCaption} onChange={e=>setCopyOptions(old=>({...old,sharedCaption:e.target.value}))} placeholder="填写共用文案；下方可为任意平台单独编写"/></div>
                  <p className="muted">共用文案会关联本次创建的草稿。平台独立文案会在切换时保留；素材按各平台批量大小拆分。</p>
                  {platforms.map(platform=><div className="field" key={platform}>
                    <label htmlFor={`copy-mode-${platform}`}>{PLATFORM_META[platform].label} 文案方式</label>
                    <select id={`copy-mode-${platform}`} disabled={busy} value={copyOptions.platforms[platform]?.mode || "shared"} onChange={e=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{caption:old.platforms[platform]?.caption || "",mode:e.target.value as "shared" | "independent"}}}))}>
                      <option value="shared">使用统一文案</option><option value="independent">使用独立文案</option>
                    </select>
                    {copyOptions.platforms[platform]?.mode === "independent" && <><textarea aria-label={`${PLATFORM_META[platform].label} 独立文案`} rows={3} maxLength={5000} disabled={busy} value={copyOptions.platforms[platform]?.caption || ""} onChange={e=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{mode:"independent",caption:e.target.value}}}))}/><button className="text-button" disabled={busy} onClick={()=>setCopyOptions(old=>({...old,platforms:{...old.platforms,[platform]:{mode:"independent",caption:old.sharedCaption}}}))}>复制统一文案到此平台</button></>}
                  </div>)}
                </div>
                <div className="create-footer">
                  <span>已选择 {selectedImages.length} 张图片 · {platforms.length} 个平台</span>
                  <button className="button primary" onClick={createDrafts} disabled={busy || !selectedImages.length || !platforms.length}><Plus size={16}/> 创建草稿</button>
                </div>
              </section>
            </>
          )}

          {page === "queue" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">内容发布</div><h1>发布队列</h1><p>核对草稿后，选择任务并提交发布。</p></div>
                <button className="button secondary" onClick={() => void refresh()}><ChevronDown size={16}/> 刷新</button>
              </section>
              <section className="panel">
                <h2>多平台自动发布</h2>
                <p className="muted">提交选中草稿：已设置时间的 X 草稿提交到 X 排程，其余草稿立即发布。登录检查或页面变化会暂停该平台；结果不确定时请先核对再重试。</p>
                <div className="heading-actions">
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts(queueDrafts.filter(d => canPublish(d) && !draftLocked(d)).slice(0, 100).map((d) => d.id))}>选择可发布草稿（最多 100 条）</button>
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts([])}>清空选择</button>
                  <button className="button primary" disabled={browserBusy || !canSubmitSelection} onClick={publishSelected}><Send size={16}/> 提交选中的 {selectedDrafts.length} 条</button>
                </div>
              </section>
              <div className="queue-layout">
                <section className="panel draft-list">
                  <div className="panel-heading"><div><h2>草稿</h2><p>{queueDrafts.length} 条平台任务 · 已选 {selectedDrafts.length} 条</p></div></div>
                  <div className="draft-bulk-actions">
                    <button className="text-button" disabled={busy || !queueDrafts.some(d => canDeleteDraft(d) && !draftLocked(d))} onClick={() => setCheckedDrafts(queueDrafts.filter(d => canDeleteDraft(d) && !draftLocked(d)).map(d => d.id))}>全选可删除草稿</button>
                    <button className="text-button" disabled={busy || !checkedDrafts.length} onClick={() => setCheckedDrafts([])}>清空选择</button>
                    <button className="button danger" disabled={busy || !canDeleteSelection} onClick={() => setPendingDeleteIds(selectedDrafts.map(d => d.id))}><Trash2 size={15}/> 批量删除（{selectedDrafts.length}）</button>
                  </div>
                  {pendingDeleteIds && <div className="delete-confirm" role="group" aria-label="确认批量删除草稿">
                    <p>确定删除这 {pendingDeleteIds.length} 条草稿？删除后无法恢复，素材库中的图片会保留。</p>
                    <div className="heading-actions"><button className="button danger small" disabled={busy || !canDeleteSelection} onClick={deleteSelectedDrafts}>确认删除</button><button className="button secondary small" disabled={busy} onClick={() => setPendingDeleteIds(null)}>取消</button></div>
                  </div>}
                  {queueDrafts.length === 0 ? <div className="empty-mini">暂无草稿。已完成的任务可在「发布记录」中查看。</div> :
                    queueDrafts.map((draft) => {
                      const meta = PLATFORM_META[draft.platform];
                      const Icon = meta.icon;
                      return <div key={draft.id} className="draft-select-row"><input type="checkbox" aria-label={`选择 ${meta.label} 草稿 ${draft.id}`} checked={checkedDrafts.includes(draft.id)} disabled={busy || draftLocked(draft) || !canDeleteDraft(draft)} onChange={(e) => setCheckedDrafts((old) => e.target.checked ? [...old, draft.id] : old.filter((id) => id !== draft.id))}/><button className={`draft-row ${selectedDraftId === draft.id ? "selected" : ""}`} onClick={() => setSelectedDraftId(draft.id)}>
                        <div className="platform-icon" style={{ color: meta.color }}><Icon size={18}/></div>
                        <div className="draft-row-main"><strong>{meta.label}</strong><span>{draft.imageIds.length} 张图片 · {STATUS_LABEL[draft.browserPublish?.state || draft.status] || draft.status}</span></div>
                        <span className={`status-dot ${draft.status}`}/>
                      </button></div>;
                    })}
                </section>

                <section className="panel draft-detail">
                  {!selectedDraft ? <div className="empty-state"><div className="empty-icon"><ListChecks/></div><h3>选择一条草稿</h3><p>从左侧列表选择发布任务。</p></div> : (
                    <>
                      <div className="detail-heading">
                        <div><div className="eyebrow">平台草稿</div><h2>{PLATFORM_META[selectedDraft.platform].label}</h2><p>{selectedDraft.imageIds.length} 张图片 · {STATUS_LABEL[selectedDraft.status]}</p></div>
                        <button className="icon-button danger" disabled={detailBusy || !canDeleteDraft(selectedDraft)} title="删除草稿" onClick={() => void runBusy("正在删除草稿…", async () => { await window.reach.deleteDraft(selectedDraft.id); setCheckedDrafts((old) => old.filter((id) => id !== selectedDraft.id)); setSelectedDraftId(null); })}><Trash2 size={17}/></button>
                      </div>
                      {selectedDraft.browserPublish && <div className="published-box"><strong>{STATUS_LABEL[selectedDraft.browserPublish.state]}</strong><button className="text-button" onClick={() => { setLogDraftId(selectedDraft.id); setPage("logs"); }}>查看该任务日志</button><p className="muted">{selectedDraft.browserPublish.message}</p>
                        {selectedDraft.browserPublish.state === "uncertain" && <div className="detail-actions">
                          <button className="button success" disabled={detailBusy} onClick={() => void runBusy("正在保存核对结果…", () => window.reach.resolvePublish(selectedDraft.id, true))}>{selectedDraft.xScheduledAt ? "已在 X 确认排程存在" : "已确认发布成功"}</button>
                          <button className="button secondary" disabled={detailBusy} onClick={() => void runBusy("正在保存核对结果…", () => window.reach.resolvePublish(selectedDraft.id, false))}>{selectedDraft.xScheduledAt ? "已确认 X 中无此排程 — 允许重试" : "已确认未发布，允许重试"}</button>
                        </div>}
                      </div>}
                      {selectedDraft.platform === "tiktok" && <div className="field"><label htmlFor="tiktok-privacy">谁可以看</label><select id="tiktok-privacy" disabled={detailBusy || !canEditCopy(selectedDraft)} value={tiktokPrivacy} onChange={e=>setTikTokPrivacy(e.target.value as "public" | "self_only")}><option value="self_only">仅自己</option><option value="public">所有人</option></select></div>}
                      {selectedDraft.platform === "pinterest" && <div className="field"><label>Pinterest 图板名称（必填，需完全匹配）</label><input disabled={detailBusy} value={boardName} onChange={(e) => setBoardName(e.target.value)}/></div>}
                      {selectedDraft.platform === "x" && <div className="field">
                        <label htmlFor="x-schedule">X 定时发布时间（{Intl.DateTimeFormat().resolvedOptions().timeZone}）</label>
                        <input id="x-schedule" type="datetime-local" disabled={detailBusy || !canPublish(selectedDraft)} value={xScheduleAt} onChange={e=>setXScheduleAt(e.target.value)}/>
                        <p className="muted">留空立即发布。选择至少 5 分钟后的时间，保存并提交草稿后，由 X 原生排程；收到排程确认后无需保持本程序运行。修改或取消已提交排程请前往 X。</p>
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
                        title={selectedDraft.preparedFolder ? "将此卡片拖入平台发布窗口" : "请先准备素材"}
                      >
                        <div className="drag-zone-top">
                          <div><strong>拖动图片到 {PLATFORM_META[selectedDraft.platform].label}</strong><span>{selectedDraft.preparedFolder ? "将此卡片拖入平台编辑器" : "准备素材后可拖动图片"}</span></div>
                          <span className="drag-grip">⠿</span>
                        </div>
                        <div className="detail-images">
                          {selectedDraft.imageIds.map((id) => {
                            const image = images.find((item) => item.id === id);
                            return image?.thumbnailDataUrl ? <img key={id} src={image.thumbnailDataUrl} alt={image.fileName}/> : null;
                          })}
                        </div>
                        <div className="drag-zone-foot">{selectedDraft.imageIds.length} 张图片 · 手动发布时可拖动上传</div>
                      </div>
                      <div className="field">
                        <label>帖子标题 / Pin 标题</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="填写标题（可选）"/>
                      </div>
                      <div className="field">
                        {selectedDraft.copyGroupId && <><label htmlFor="draft-copy-mode">文案方式</label><select id="draft-copy-mode" disabled={detailBusy || !canEditCopy(selectedDraft)} value={selectedDraft.captionMode || "independent"} onChange={e=>switchCaptionMode(e.target.value as "shared" | "independent")}><option value="shared">使用统一文案</option><option value="independent">使用独立文案</option></select><p className="muted">{selectedDraft.captionMode === "shared" ? `保存正文将同步本批次中使用统一文案的 ${drafts.filter(d=>d.copyGroupId===selectedDraft.copyGroupId && d.captionMode==="shared" && canEditCopy(d)).length} 条可编辑草稿。已发布、已排程及结果待确认的草稿不受影响。` : "仅修改当前草稿；切换为统一文案时会保留独立版本。"}</p></>}
                        <div className="label-row"><label htmlFor="draft-caption">正文文案</label><button className="text-button" onClick={generateCaption} disabled={detailBusy || !canEditCopy(selectedDraft) || !settings.hasDeepSeekKey}><Sparkles size={14}/> AI 生成独立文案</button></div>
                        <p className="muted">AI 生成将使用当前平台的独立文案。标题、话题标签、图片说明、图板和定时时间始终分别设置。</p>
                        <textarea id="draft-caption" maxLength={5000} disabled={detailBusy || !canEditCopy(selectedDraft)} rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="输入文案，或使用 AI 生成…"/>
                      </div>
                      <div className="field">
                        <label>平台话题标签（发布时附加在正文后，以空格分隔）</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder="输入话题标签，以空格分隔"/>
                      </div>
                      <div className="field">
                        <label>图片替代说明</label>
                        <input disabled={detailBusy || !canEditCopy(selectedDraft)} value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="供无障碍阅读使用的图片描述"/>
                      </div>
                      <p className="drag-help">批量发布时，不同平台同时执行，同一平台依次执行。也可准备素材后手动拖动上传。切换草稿前请保存修改。</p>
                      <div className="detail-actions">
                        <button className="button secondary" onClick={() => void saveDraft()} disabled={detailBusy || !canEditCopy(selectedDraft)}><Check size={16}/> 保存修改</button>
                        <button className="button primary" onClick={prepare} disabled={detailBusy || !canEditCopy(selectedDraft)}><FolderOpen size={16}/> 准备素材并打开平台</button>
                      </div>
                      <div className="schedule-box">
                        <div><strong><CalendarClock size={16}/> 本地提醒</strong><p>程序运行时显示提醒，不会自动发布。</p></div>
                        <div className="schedule-controls"><input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}/><button className="button small secondary" onClick={schedule} disabled={!scheduleAt || detailBusy}>保存</button></div>
                      </div>
                      <div className="published-box">
                        <div className="field"><label>已发布帖子的链接（可选）</label><input value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} placeholder="https://…"/></div>
                        <button className="button success" onClick={markPublished} disabled={detailBusy}><CheckCircle2 size={16}/> 标记为已发布</button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {page === "settings" && (
            <>
              <section className="page-heading"><div><div className="eyebrow">偏好设置</div><h1>设置与账号</h1><p>配置浏览器登录和 AI 文案生成功能。</p></div></section>
              <section className="panel settings-panel">
                <h2>Python + Playwright 浏览器发布</h2>
                <p className="muted">三个平台均使用普通 Google Chrome 的独立窗口登录。完成后点击“完成登录 / 关闭窗口”，程序关闭窗口并加密保存登录状态，再由 Playwright 复用同一配置发布，默认无头运行。</p>
                <div className="field"><label>登录与发布浏览器</label><p>Google Chrome（需已安装）</p></div>
                <label><input type="checkbox" disabled={browserBusy} checked={browserSettings.showBrowser} onChange={e=>void runBusy("正在保存浏览器设置…",async()=>{setBrowserSettings(await window.reach.saveBrowserSettings({...browserSettings,showBrowser:e.target.checked}));})}/> 显示浏览器（发布时打开可见窗口）</label>
                <p className="muted">登录始终使用可见的普通 Chrome；上方开关仅控制发布窗口。各平台配置独立，不影响日常 Chrome。旧 Edge / Chromium 配置保留，但需在 Chrome 中重新登录。保存登录不代表平台允许发布。</p>
                {(["instagram","x","pinterest","tiktok"] as Platform[]).map(platform=><div className="settings-actions" key={platform}>
                  <button className="button secondary" disabled={browserBusy} onClick={()=>void runBusy("正在打开登录窗口…",()=>window.reach.openPlatformBrowser(platform))}>登录 {PLATFORM_META[platform].label}</button>
                  <button className="button secondary" disabled={browserBusy} onClick={()=>void runBusy("正在保存登录配置…",async()=>{await window.reach.closePlatformBrowser(platform);setNotice("窗口已关闭，浏览器配置已保存。发布时将检查登录是否有效。");})}>完成 {PLATFORM_META[platform].label} 登录 / 关闭窗口</button>
                </div>)}
                <p className="muted">失败截图保存在日志目录的 screenshots 子目录，最多保留 50 张；可能包含账号和草稿内容。可在运行日志中查看路径并打开日志文件夹。</p>
              </section>
              <section className="panel settings-panel">
                <div className="settings-title"><div className="provider-mark"><Sparkles/></div><div><h2>DeepSeek 图片理解</h2><p>分析图片，为各平台生成英文文案。</p></div></div>
                <div className="field"><label>API 密钥</label><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.hasDeepSeekKey ? "密钥已安全保存在本机" : "sk-…"}/><small>密钥使用 Windows 安全存储加密，不会以明文保存在应用数据中。</small></div>
                <div className="settings-actions">
                  <button className="button primary" disabled={busy || !apiKey.trim()} onClick={() => void runBusy("正在加密保存 API 密钥…", async () => { const next = await window.reach.saveDeepSeekKey(apiKey); setSettings(next); setApiKey(""); })}>保存 API 密钥</button>
                  <button className="button secondary" disabled={busy || !settings.hasDeepSeekKey} onClick={() => void runBusy("正在移除 API 密钥…", async () => { setSettings(await window.reach.clearDeepSeekKey()); })}>移除密钥</button>
                </div>
                <div className="key-status"><span className={`status-dot ${settings.hasDeepSeekKey ? "published" : "draft"}`}/>{settings.hasDeepSeekKey ? "已配置 DeepSeek API 密钥" : "AI 为可选功能，也可以手动创建和编辑文案。"}</div>
                <a href="https://platform.deepseek.com/" onClick={(e) => { e.preventDefault(); void window.reach.openExternal("https://platform.deepseek.com/"); }}>获取 DeepSeek API 密钥 <ArrowUpRight size={14}/></a>
              </section>
              <PlatformSettings/>
              <section className="panel"><h2>隐私说明</h2><p className="muted">图片、草稿和导出文件均保存在本地。生成 AI 文案时，会将所选图片发送至 DeepSeek；发布时将内容上传至所选平台。各平台使用本机独立保存的浏览器配置。</p></section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
