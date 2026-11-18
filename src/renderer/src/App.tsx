import { useEffect, useMemo, useState } from "react";
import {
  Aperture, ArrowUpRight, CalendarClock, Check, CheckCircle2,
  ChevronDown, CircleHelp, Copy, FileImage, FolderOpen, ImagePlus,
  Instagram, LayoutDashboard, Link2, ListChecks, Loader2, Plus,
  Search, Send, Settings, Sparkles, Trash2, Upload, X, Twitter
} from "lucide-react";
import type { Draft, ImageAsset, Platform, SettingsView } from "../../shared/types";

type Page = "library" | "queue" | "settings";
const PLATFORM_META: Record<Platform, { label: string; url: string; icon: typeof Instagram; color: string }> = {
  instagram: { label: "Instagram", url: "https://www.instagram.com/", icon: Instagram, color: "#E879A6" },
  x: { label: "X", url: "https://x.com/compose/post", icon: Twitter, color: "#D8DEE9" },
  pinterest: { label: "Pinterest", url: "https://www.pinterest.com/", icon: Aperture, color: "#E35D68" }
};

function App() {
  const [page, setPage] = useState<Page>("library");
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "x", "pinterest"]);
  const [settings, setSettings] = useState<SettingsView>({ hasDeepSeekKey: false, model: "deepseek-flash" });
  const [apiKey, setApiKey] = useState("");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [altText, setAltText] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [checkedDrafts, setCheckedDrafts] = useState<string[]>([]);
  const [boardName, setBoardName] = useState("");
  const canPublish = (draft: Draft) => draft.status !== "published" && !["running", "uncertain", "succeeded"].includes(draft.browserPublish?.state || "");
  const publishSelected = () => void runBusy("Publishing in browser… Keep this app and browser open.", async () => {
    if (selectedDraft && checkedDrafts.includes(selectedDraft.id)) {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, boardName });
    }
    const result = await window.reach.publishDrafts(checkedDrafts);
    setNotice(`${result.filter((d) => d.status === "published").length}/${result.length} published. Review individual results before retrying.`);
    setCheckedDrafts([]);
  });

  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) || null;
  const filteredImages = useMemo(() => images.filter((image) =>
    image.fileName.toLowerCase().includes(search.toLowerCase())
  ), [images, search]);

  async function refresh() {
    const [nextImages, nextDrafts, nextSettings] = await Promise.all([
      window.reach.listImages(),
      window.reach.listDrafts(),
      window.reach.getSettings()
    ]);
    setImages(nextImages);
    setDrafts(nextDrafts);
    setSettings(nextSettings);
  }

  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
    const off = window.reach.onScheduleReminder((draft) => {
      setNotice(`Scheduled reminder: ${draft.platform} draft is ready for manual publishing.`);
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
    setTitle(selectedDraft.title);
    setAltText(selectedDraft.altText);
    setBoardName(selectedDraft.boardName || "");
    setPublishedUrl(selectedDraft.publishedUrl || "");
  }, [selectedDraftId, selectedDraft?.updatedAt]);

  async function runBusy(label: string, task: () => Promise<void>) {
    setBusy(true);
    setBusyText(label);
    setNotice("");
    try {
      await task();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  const importFiles = () => runBusy("Importing images…", async () => {
    const result = await window.reach.importImages();
    setNotice(`Imported ${result.imported.length} images · ${result.duplicates.length} duplicates · ${result.errors.length} errors`);
  });

  const importFolder = () => runBusy("Scanning folder…", async () => {
    const result = await window.reach.importFolder();
    setNotice(`Imported ${result.imported.length} images · ${result.duplicates.length} duplicates · ${result.errors.length} errors`);
  });

  const createDrafts = () => runBusy("Creating platform drafts…", async () => {
    const created = await window.reach.createDrafts(selectedImages, platforms);
    setSelectedDraftId(created[0]?.id || null);
    setPage("queue");
    setNotice(`Created ${created.length} publishing drafts.`);
  });

  const saveDraft = async () => {
    if (!selectedDraft) return;
    await runBusy("Saving draft…", async () => {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, boardName });
    });
  };

  const generateCaption = () => {
    if (!selectedDraft) return;
    void runBusy("Analyzing images and generating copy…", async () => {
      await window.reach.generateCaption(selectedDraft.id);
    });
  };

  const prepare = () => {
    if (!selectedDraft) return;
    void runBusy("Preparing platform-ready images…", async () => {
      await window.reach.updateDraft(selectedDraft.id, { caption, title, altText, boardName });
      await window.reach.prepareDraft(selectedDraft.id);
      setNotice("Export folder opened and caption copied. Finish publishing on the official platform website.");
    });
  };

  const markPublished = () => {
    if (!selectedDraft) return;
    void runBusy("Updating publishing history…", async () => {
      await window.reach.markPublished(selectedDraft.id, publishedUrl || undefined);
      setNotice("Marked as published. This confirmation is recorded locally.");
    });
  };

  const schedule = () => {
    if (!selectedDraft || !scheduleAt) return;
    void runBusy("Saving reminder…", async () => {
      await window.reach.scheduleDraft(selectedDraft.id, scheduleAt);
      setNotice("Local reminder scheduled. Fanzy Reach must remain running for the reminder to appear.");
    });
  };

  const togglePlatform = (platform: Platform) => {
    setPlatforms((old) => old.includes(platform) ? old.filter((item) => item !== platform) : [...old, platform]);
  };

  const toggleImage = (id: string) => {
    setSelectedImages((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Aperture size={21}/></div>
          <div><strong>FANZY REACH</strong><span>STUDIO</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <button className={`nav-item ${page === "library" ? "active" : ""}`} onClick={() => setPage("library")}>
          <LayoutDashboard size={17}/> Image Library
        </button>
        <button className={`nav-item ${page === "queue" ? "active" : ""}`} onClick={() => setPage("queue")}>
          <ListChecks size={17}/> Publishing Queue <span className="nav-count">{drafts.length}</span>
        </button>
        <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}>
          <Settings size={17}/> Settings & Accounts
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-icon"><CheckCircle2 size={16}/></div>
            <div><strong>Local-first</strong><span>Local library, connected publishing.</span></div>
          </div>
          <div className="version">FANZY REACH · v0.1.0</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> {page === "library" ? "Image Library" : page === "queue" ? "Publishing Queue" : "Settings"}</div>
          <div className="top-actions">
            <span className="online-dot"/> Local workspace
            <div className="avatar">FR</div>
          </div>
        </header>

        <div className="content">
          {notice && <div className="notice"><CircleHelp size={16}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={15}/></button></div>}
          {busy && <div className="busy-bar"><Loader2 className="spin" size={15}/>{busyText}</div>}

          {page === "library" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">YOUR CREATIVE WORKSPACE</div><h1>Image Library</h1><p>Import, organize and prepare images for every platform.</p></div>
                <div className="heading-actions">
                  <button className="button secondary" onClick={importFolder} disabled={busy}><FolderOpen size={16}/> Import Folder</button>
                  <button className="button primary" onClick={importFiles} disabled={busy}><ImagePlus size={16}/> Import Images</button>
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card"><span>Total images</span><strong>{images.length}</strong><small>Stored locally</small></div>
                <div className="stat-card"><span>Selected</span><strong>{selectedImages.length}</strong><small>Ready for a campaign</small></div>
                <div className="stat-card"><span>Drafts created</span><strong>{drafts.length}</strong><small>Across platforms</small></div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div><h2>All images</h2><p>Select images to create platform-specific drafts.</p></div>
                  <div className="search-box"><Search size={15}/><input placeholder="Search images…" value={search} onChange={(e) => setSearch(e.target.value)}/></div>
                </div>
                {images.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon"><Upload size={25}/></div><h3>Your image library is empty</h3><p>Import a folder or select multiple image files to get started.</p><button className="button primary" onClick={importFolder}><FolderOpen size={16}/> Choose image folder</button></div>
                ) : (
                  <div className="image-grid">
                    {filteredImages.map((image) => (
                      <button key={image.id} className={`image-card ${selectedImages.includes(image.id) ? "selected" : ""}`} onClick={() => toggleImage(image.id)}>
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
                <div className="panel-heading"><div><h2>Create publishing drafts</h2><p>Choose destination platforms. Images are grouped using conservative default batch sizes.</p></div></div>
                <div className="platform-options">
                  {(["instagram", "x", "pinterest"] as Platform[]).map((platform) => {
                    const meta = PLATFORM_META[platform];
                    const Icon = meta.icon;
                    return <button key={platform} className={`platform-option ${platforms.includes(platform) ? "chosen" : ""}`} onClick={() => togglePlatform(platform)}>
                      <Icon size={18}/><span>{meta.label}</span>{platforms.includes(platform) && <Check size={15}/>}
                    </button>;
                  })}
                </div>
                <div className="create-footer">
                  <span>{selectedImages.length} images selected · {platforms.length} platforms</span>
                  <button className="button primary" onClick={createDrafts} disabled={busy || !selectedImages.length || !platforms.length}><Plus size={16}/> Create drafts</button>
                </div>
              </section>
            </>
          )}

          {page === "queue" && (
            <>
              <section className="page-heading">
                <div><div className="eyebrow">CONTENT DISTRIBUTION</div><h1>Publishing Queue</h1><p>Select reviewed drafts and publish through your platform browsers.</p></div>
                <button className="button secondary" onClick={() => void refresh()}><ChevronDown size={16}/> Refresh</button>
              </section>
              <section className="panel">
                <h2>Browser publishing · Python</h2>
                <p className="muted">First sign in from Settings. Publishing uploads content and clicks Publish for every selected draft. Login checks or page changes pause that platform. Review uncertain results before retrying.</p>
                <div className="heading-actions">
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts(drafts.filter(canPublish).slice(0, 100).map((d) => d.id))}>Select eligible drafts (max 100)</button>
                  <button className="button secondary" disabled={busy} onClick={() => setCheckedDrafts([])}>Clear selection</button>
                  <button className="button primary" disabled={busy || !checkedDrafts.length} onClick={publishSelected}><Send size={16}/> Publish {checkedDrafts.length} selected now</button>
                </div>
              </section>
              <div className="queue-layout">
                <section className="panel draft-list">
                  <div className="panel-heading"><div><h2>Drafts</h2><p>{drafts.length} platform-specific tasks</p></div></div>
                  {drafts.length === 0 ? <div className="empty-mini">No drafts yet. Import images and create drafts first.</div> :
                    drafts.map((draft) => {
                      const meta = PLATFORM_META[draft.platform];
                      const Icon = meta.icon;
                      return <div key={draft.id} className="draft-select-row"><input type="checkbox" aria-label={`Select ${meta.label} draft ${draft.id}`} checked={checkedDrafts.includes(draft.id)} disabled={busy || !canPublish(draft)} onChange={(e) => setCheckedDrafts((old) => e.target.checked ? [...old, draft.id] : old.filter((id) => id !== draft.id))}/><button disabled={busy} className={`draft-row ${selectedDraftId === draft.id ? "selected" : ""}`} onClick={() => setSelectedDraftId(draft.id)}>
                        <div className="platform-icon" style={{ color: meta.color }}><Icon size={18}/></div>
                        <div className="draft-row-main"><strong>{meta.label}</strong><span>{draft.imageIds.length} image(s) · {draft.browserPublish?.state || draft.status}</span></div>
                        <span className={`status-dot ${draft.status}`}/>
                      </button></div>;
                    })}
                </section>

                <section className="panel draft-detail">
                  {!selectedDraft ? <div className="empty-state"><div className="empty-icon"><ListChecks/></div><h3>Select a draft</h3><p>Choose a publishing task from the list.</p></div> : (
                    <>
                      <div className="detail-heading">
                        <div><div className="eyebrow">PLATFORM DRAFT</div><h2>{PLATFORM_META[selectedDraft.platform].label}</h2><p>{selectedDraft.imageIds.length} image(s) · {selectedDraft.status}</p></div>
                        <button className="icon-button danger" disabled={busy} title="Delete draft" onClick={() => void runBusy("Deleting draft…", async () => { await window.reach.deleteDraft(selectedDraft.id); setCheckedDrafts((old) => old.filter((id) => id !== selectedDraft.id)); setSelectedDraftId(null); })}><Trash2 size={17}/></button>
                      </div>
                      {selectedDraft.browserPublish && <div className="published-box"><strong>{selectedDraft.browserPublish.state}</strong><p className="muted">{selectedDraft.browserPublish.message}</p>
                        {selectedDraft.browserPublish.state === "uncertain" && <div className="detail-actions">
                          <button className="button success" disabled={busy} onClick={() => void runBusy("Saving review…", () => window.reach.resolvePublish(selectedDraft.id, true))}>I verified: published</button>
                          <button className="button secondary" disabled={busy} onClick={() => void runBusy("Saving review…", () => window.reach.resolvePublish(selectedDraft.id, false))}>I verified: not published — allow retry</button>
                        </div>}
                      </div>}
                      {selectedDraft.platform === "pinterest" && <div className="field"><label>Pinterest board name (exact match, required)</label><input disabled={busy} value={boardName} onChange={(e) => setBoardName(e.target.value)}/></div>}
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
                        title={selectedDraft.preparedFolder ? "Drag this card into the platform composer" : "Prepare this draft first"}
                      >
                        <div className="drag-zone-top">
                          <div><strong>Drag images to {PLATFORM_META[selectedDraft.platform].label}</strong><span>{selectedDraft.preparedFolder ? "Drag this card into the post composer" : "Prepare the draft to enable native file drag"}</span></div>
                          <span className="drag-grip">⠿</span>
                        </div>
                        <div className="detail-images">
                          {selectedDraft.imageIds.map((id) => {
                            const image = images.find((item) => item.id === id);
                            return image?.thumbnailDataUrl ? <img key={id} src={image.thumbnailDataUrl} alt={image.fileName}/> : null;
                          })}
                        </div>
                        <div className="drag-zone-foot">{selectedDraft.imageIds.length} prepared image(s) · User completes upload and publication</div>
                      </div>
                      <div className="field">
                        <label>Post title / Pin title</label>
                        <input disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a title (optional)"/>
                      </div>
                      <div className="field">
                        <div className="label-row"><label>Caption</label><button className="text-button" onClick={generateCaption} disabled={busy || !settings.hasDeepSeekKey}><Sparkles size={14}/> Generate with AI</button></div>
                        <textarea disabled={busy} rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write or generate your platform-specific caption…"/>
                      </div>
                      <div className="field">
                        <label>Hashtags (space-separated in caption or generated separately)</label>
                        <input value={selectedDraft.hashtags.join(" ")} readOnly placeholder="Generate with AI to populate hashtags"/>
                      </div>
                      <div className="field">
                        <label>Alt text</label>
                        <input disabled={busy} value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Accessible image description"/>
                      </div>
                      <p className="drag-help">Use batch browser publishing above, or prepare files for manual drag-and-drop. Save edits before selecting another draft.</p>
                      <div className="detail-actions">
                        <button className="button secondary" onClick={() => void saveDraft()} disabled={busy}><Check size={16}/> Save changes</button>
                        <button className="button primary" onClick={prepare} disabled={busy}><FolderOpen size={16}/> Prepare & open platform</button>
                      </div>
                      <div className="schedule-box">
                        <div><strong><CalendarClock size={16}/> Local reminder</strong><p>Reminder appears while this app is running. It does not auto-publish.</p></div>
                        <div className="schedule-controls"><input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}/><button className="button small secondary" onClick={schedule} disabled={!scheduleAt || busy}>Save</button></div>
                      </div>
                      <div className="published-box">
                        <div className="field"><label>Published post URL (optional)</label><input value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} placeholder="https://…"/></div>
                        <button className="button success" onClick={markPublished} disabled={busy}><CheckCircle2 size={16}/> Mark as published</button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {page === "settings" && (
            <>
              <section className="page-heading"><div><div className="eyebrow">PREFERENCES</div><h1>Settings & Accounts</h1><p>Connect an AI provider for image understanding and caption generation.</p></div></section>
              <section className="panel settings-panel">
                <h2>Platform browsers</h2>
                <p className="muted">Requires Python, Playwright and Microsoft Edge. Sign in manually in each dedicated browser. Profiles stay on this PC; your normal browser profile is not used. Platform page changes may require adapter updates.</p>
                <div className="heading-actions">{(["instagram", "x", "pinterest"] as Platform[]).map((platform) => <button key={platform} className="button secondary" disabled={busy} onClick={() => void runBusy("Opening browser…", async () => { await window.reach.openPlatformBrowser(platform); setNotice("Sign in in the opened browser, then return to the publishing queue."); })}>Sign in / inspect {PLATFORM_META[platform].label}</button>)}</div>
              </section>
              <section className="panel settings-panel">
                <div className="settings-title"><div className="provider-mark"><Sparkles/></div><div><h2>DeepSeek Vision</h2><p>Analyze local images and generate platform-specific English copy.</p></div></div>
                <div className="field"><label>API key</label><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.hasDeepSeekKey ? "Key saved securely on this PC" : "sk-…"}/><small>Your key is encrypted using Windows secure storage. It is not stored in plain text in the app data file.</small></div>
                <div className="settings-actions">
                  <button className="button primary" disabled={busy || !apiKey.trim()} onClick={() => void runBusy("Saving encrypted API key…", async () => { const next = await window.reach.saveDeepSeekKey(apiKey); setSettings(next); setApiKey(""); })}>Save API key</button>
                  <button className="button secondary" disabled={busy || !settings.hasDeepSeekKey} onClick={() => void runBusy("Removing API key…", async () => { setSettings(await window.reach.clearDeepSeekKey()); })}>Remove key</button>
                </div>
                <div className="key-status"><span className={`status-dot ${settings.hasDeepSeekKey ? "published" : "draft"}`}/>{settings.hasDeepSeekKey ? "DeepSeek API key is configured" : "AI is optional. You can still create and edit drafts manually."}</div>
                <a href="https://platform.deepseek.com/" onClick={(e) => { e.preventDefault(); void window.reach.openExternal("https://platform.deepseek.com/"); }}>Get a DeepSeek API key <ArrowUpRight size={14}/></a>
              </section>
              <section className="panel"><h2>Privacy</h2><p className="muted">Images, drafts and exports are stored locally. When you generate AI captions, selected images are sent to DeepSeek. Browser publishing uploads content to selected platforms. Login sessions are stored in dedicated local browser profiles.</p></section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
