import { useEffect, useRef, useState } from "react";
import { captionText, cleanCaption, plainHtml, safeLink } from "./rich-caption";
type Props = {
  value: string; html?: string; onChange: (value: string, html: string) => void;
  disabled?: boolean; maxLength?: number; rows?: number; id?: string;
  "aria-label"?: string; placeholder?: string;
};
export default function CaptionEditor({ value, html, onChange, disabled, maxLength = 5000, rows = 4, ...props }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const lastHtml = useRef("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const next = html === undefined ? plainHtml(value) : cleanCaption(html);
    if (editor.current && next !== lastHtml.current) editor.current.innerHTML = next;
    lastHtml.current = next;
  }, [value, html]);
  const saveRange = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode) && editor.current.contains(selection.focusNode)) range.current = selection.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    editor.current?.focus();
    const selection = window.getSelection();
    if (range.current && editor.current?.contains(range.current.commonAncestorContainer)) { selection?.removeAllRanges(); selection?.addRange(range.current); }
  };
  const commit = () => {
    if (!editor.current) return;
    const next = cleanCaption(editor.current.innerHTML);
    const text = captionText(next);
    if (text.length > maxLength || next.length > 100000) {
      editor.current.innerHTML = lastHtml.current; range.current = null;
      setError("文案（含链接地址）不能超过 " + maxLength + " 字符。"); return;
    }
    lastHtml.current = next; setError(""); onChange(text, next); saveRange();
  };
  const command = (name: string, argument?: string) => {
    if (disabled) return;
    restore(); document.execCommand(name, false, argument); commit();
  };
  const insertLink = () => {
    if (disabled) return;
    const href = safeLink(url.trim());
    if (!href) { setError("请输入完整的 http:// 或 https:// 网址。"); return; }
    restore();
    if (window.getSelection()?.isCollapsed) {
      const link = document.createElement("a"); link.href = href; link.textContent = href;
      command("insertHTML", link.outerHTML);
    } else command("createLink", href);
    setAdding(false); setUrl("");
  };
  return <div className="caption-editor">
    <div className="caption-toolbar" role="toolbar" aria-label="文案格式">
      {[["bold", "粗体"], ["italic", "斜体"], ["underline", "下划线"], ["insertUnorderedList", "无序列表"], ["insertOrderedList", "有序列表"], ["unlink", "移除链接"], ["removeFormat", "清除格式"]].map(([name, label]) => <button type="button" key={name} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command(name)}>{label}</button>)}
      <button type="button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { saveRange(); setAdding(true); setError(""); }}>文字链接</button>
    </div>
    <div ref={editor} id={props.id} role="textbox" aria-label={props["aria-label"] || "正文文案"} aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning className="caption-rich-input" style={{ minHeight: rows * 24 }} data-placeholder={props.placeholder} onInput={event => { if (!(event.nativeEvent as InputEvent).isComposing) commit(); }} onCompositionEnd={commit} onKeyUp={saveRange} onMouseUp={saveRange} onBlur={saveRange} onClick={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }} onPaste={event => {
      event.preventDefault(); saveRange();
      const rich = event.clipboardData.getData("text/html");
      command("insertHTML", rich ? cleanCaption(rich) : plainHtml(event.clipboardData.getData("text/plain")));
    }} onDrop={event => event.preventDefault()}/>
    {adding && <div className="caption-link-controls" role="group" aria-label="设置文字链接">
      <input type="url" aria-label="链接网址" placeholder="https://example.com" autoFocus disabled={disabled} value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); insertLink(); } if (event.key === "Escape") { setAdding(false); restore(); } }}/>
      <button type="button" className="text-button" disabled={disabled} onClick={insertLink}>确认</button><button type="button" className="text-button" onClick={() => { setAdding(false); restore(); }}>取消</button>
    </div>}
    {error && <p role="alert" className="muted">{error}</p>}
    <p className="muted">格式保存在草稿中；当前发布使用纯文本，文字链接将展开为文字和网址。</p>
  </div>;
}
