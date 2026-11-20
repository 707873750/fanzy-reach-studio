const allowed = new Set(["B", "STRONG", "I", "EM", "U", "P", "DIV", "BR", "UL", "OL", "LI", "A"]);
export function safeLink(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !/\s/.test(value) ? url.href : null; } catch { return null; }
}
export function plainHtml(text: string) {
  const node = document.createElement("div"); node.textContent = text;
  return node.innerHTML.replace(/\n/g, "<br>");
}
// Rebuild a formatting allowlist for both stored and pasted HTML.
export function cleanCaption(html: string) {
  const source = new DOMParser().parseFromString(html, "text/html");
  const target = document.createElement("div");
  function copy(node: Node, parent: Node) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || "")); return; }
    if (!(node instanceof Element) || ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH", "TEMPLATE"].includes(node.tagName)) return;
    const tag = node.tagName;
    const href = tag === "A" ? safeLink(node.getAttribute("href") || "") : null;
    const element = allowed.has(tag) && (tag !== "A" || href) ? document.createElement(tag.toLowerCase()) : null;
    if (element && href) element.setAttribute("href", href);
    if (element) parent.appendChild(element);
    for (const child of node.childNodes) copy(child, element || parent);
  }
  for (const child of source.body.childNodes) copy(child, target);
  return target.innerHTML;
}
export function captionText(html: string) {
  const container = document.createElement("div"); container.innerHTML = cleanCaption(html);
  function children(parent: Node): string {
    let result = "";
    for (const node of parent.childNodes) {
      if (node instanceof Element && ["P", "DIV", "UL", "OL"].includes(node.tagName) && result && !result.endsWith("\n")) result += "\n";
      result += read(node);
    }
    return result;
  }
  function read(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof Element)) return "";
    if (node.tagName === "BR") return "\n";
    const text = children(node);
    if (node.tagName === "A") { const href = node.getAttribute("href")!; return text === href ? text : text + "（" + href + "）"; }
    if (node.tagName === "LI") {
      const number = Array.from(node.parentElement!.children).indexOf(node) + 1;
      return (node.parentElement?.tagName === "OL" ? number + "." : "•") + " " + text.trimEnd() + "\n";
    }
    return ["P", "DIV", "UL", "OL"].includes(node.tagName) ? text.replace(/\n$/, "") + "\n" : text;
  }
  return children(container).replace(/\n$/, "");
}
