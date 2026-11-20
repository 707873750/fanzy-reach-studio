import { createHash, createHmac } from "node:crypto";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
export function signVisualRequest(action: string, body: string, ak: string, sk: string, now = new Date()) {
  const host = "visual.volcengineapi.com";
  const query = `Action=${encodeURIComponent(action)}&Version=2022-08-31`;
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const digest = hash(body);
  const signed = "content-type;host;x-content-sha256;x-date";
  const headers = `content-type:application/json\nhost:${host}\nx-content-sha256:${digest}\nx-date:${date}\n`;
  const canonical = ["POST", "/", query, headers, signed, digest].join("\n");
  const scope = `${date.slice(0, 8)}/cn-north-1/cv/request`;
  const signingKey = hmac(hmac(hmac(hmac(sk, date.slice(0, 8)), "cn-north-1"), "cv"), "request");
  const signature = hmac(signingKey, ["HMAC-SHA256", date, scope, hash(canonical)].join("\n")).toString("hex");
  return { url: `https://${host}/?${query}`, headers: { "Content-Type": "application/json", "X-Date": date, "X-Content-Sha256": digest,
    Authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${signature}` } };
}
