import { useEffect, useState } from 'react';
import { Coins, Gift, LogIn, LogOut, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { t, useLanguage } from './i18n';
import type { ImageAsset, ImportResult, SettingsView } from '../../shared/types';
import type { BackendAccount } from '../../shared/backend';
import { IMAGE_SIZES, IMAGE_PROMPT_LIMIT, type GeneratedImagePreview } from '../../shared/image-generation';

type Props = { busy: boolean; settings: SettingsView; setSettings: (settings: SettingsView) => void;
  runBusy: (text: string, task: () => Promise<void>) => Promise<void> };

function AccountPanel({ busy, settings, setSettings, runBusy, onAccount }: Props & { onAccount?: (account: BackendAccount | null) => void }) {
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [account, setAccount] = useState<BackendAccount | null>(null);
  const [feedback, setFeedback] = useState('');
  const apply = (value: BackendAccount | null) => { setAccount(value); onAccount?.(value); };
  const refresh = async () => {
    try { apply(await window.reach.backendAccount()); setFeedback(''); }
    catch (error) { apply(null); setFeedback(error instanceof Error ? error.message : '无法读取账户'); }
    finally { setSettings(await window.reach.getSettings()); }
  };
  useEffect(() => {
    let active = true;
    if (!settings.backendLoggedIn) { apply(null); return; }
    if (busy) return;
    window.reach.backendAccount().then(async value => {
      if (active) { apply(value); setFeedback(''); }
      const latest = await window.reach.getSettings();
      if (active) setSettings(latest);
    }).catch(error => {
      if (active) { apply(null); setFeedback(error instanceof Error ? error.message : '无法连接后端'); void window.reach.getSettings().then(value => { if (active) setSettings(value); }); }
    });
    return () => { active = false; };
  }, [settings.backendLoggedIn, busy]);
  return <div className="backend-account">
    <div className="settings-title"><div className="provider-mark"><ShieldCheck /></div><div><h2>{t('生图账户')}</h2><p>{t('登录后签到领积分，使用积分生成图片。')}</p></div><span className="backend-demo-tag">DEMO</span></div>
    {!settings.backendLoggedIn ? <form onSubmit={event => {
      event.preventDefault(); setFeedback('');
      if (registering && password !== confirmation) { setFeedback(t('两次输入的密码不一致。')); return; }
      void runBusy(registering ? t('正在创建账号…') : '正在登录生图后端…', async () => {
        try {
          setSettings(await (registering ? window.reach.backendRegister(username, password) : window.reach.backendLogin(username, password)));
          setPassword(''); setConfirmation(''); setRegistering(false);
        }
        catch (error) { setFeedback(error instanceof Error ? error.message : '登录失败'); throw error; }
      });
    }}>
      {registering && <p>{t('创建账号后自动登录，签到即可领取积分。')}</p>}
      <div className="backend-login-fields">
        <div className="field"><label htmlFor="backend-user">{t('账号')}</label><input id="backend-user" autoComplete="username" value={username} disabled={busy} required maxLength={32} pattern={registering ? '[a-zA-Z0-9_]{3,32}' : undefined} onChange={event => setUsername(event.target.value)} />{registering && <small>{t('3–32 位字母、数字或下划线，用户名不区分大小写。')}</small>}</div>
        <div className="field"><label htmlFor="backend-password">{t('密码')}</label><input id="backend-password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} value={password} disabled={busy} required minLength={registering ? 8 : undefined} maxLength={128} onChange={event => setPassword(event.target.value)} placeholder={registering ? t('8–128 个字符') : '本机默认：demo12345'} /></div>
      </div>
      {registering && <div className="field"><label htmlFor="backend-confirm">{t('确认密码')}</label><input id="backend-confirm" type="password" autoComplete="new-password" value={confirmation} disabled={busy} required maxLength={128} onChange={event => setConfirmation(event.target.value)} /></div>}
      <div className="settings-actions"><button type="submit" className="button primary" disabled={busy || !password || !username.trim() || (registering && !confirmation)}><LogIn size={16}/>{registering ? t('注册并登录') : t('登录')}</button><button type="button" className="button secondary" disabled={busy} onClick={() => {
        setRegistering(!registering); setUsername(''); setPassword(''); setConfirmation(''); setFeedback('');
      }}>{registering ? t('已有账号，去登录') : t('没有账号？注册')}</button></div>
      {!registering && <p><small>{t('未登录不可生图。Demo 账号：demo')}</small></p>}
    </form> : <>
      <div className="backend-wallet"><div><span>{account?.user.name || '正在读取账户…'}</span><div className="backend-balance"><Coins size={24}/><strong>{account?.user.balance ?? '—'}</strong><span>{t('积分')}</span></div></div>
        <button className="button primary" disabled={busy || !account || account.checkedIn} onClick={() => void runBusy('正在签到…', async () => {
          try { apply(await window.reach.backendCheckin()); setFeedback('签到成功，积分已到账。'); }
          catch (error) { setFeedback(error instanceof Error ? error.message : '签到失败'); throw error; }
        })}><Gift size={16}/>{account?.checkedIn ? t('今日已签到') : t('签到 +{0} 积分', [account?.config.checkinReward ?? '—'])}</button>
      </div>
      <div className="backend-meta"><span>{t('每张 {0} 积分 · 每日北京时间 00:00 可再次签到', [account?.config.cost ?? '—'])}</span></div>
      {account && !account.config.providerReady && <p role="alert">{t('后端尚未配置火山密钥，请在服务器配置 VOLC_AK / VOLC_SK 后重启。')}</p>}
      {account && !account.config.enabled && <p role="alert">{t('服务端已暂停生图功能。')}</p>}
      <div className="settings-actions"><button className="button secondary small" disabled={busy} onClick={() => void runBusy('正在刷新积分…', refresh)}><RefreshCw size={14}/>{t('刷新积分')}</button><button className="button secondary small" disabled={busy} onClick={() => void runBusy('正在退出登录…', async () => {
        try { setSettings(await window.reach.backendLogout()); apply(null); }
        finally { setSettings(await window.reach.getSettings()); }
      })}><LogOut size={14}/>{t('退出登录')}</button></div>
      {!!account?.ledger.length && <details className="backend-ledger"><summary>{t('最近积分记录')}</summary><ul>{account.ledger.map((entry, index) => <li key={`${entry.created_at}-${index}`}><span>{entry.reason}<small>{new Date(entry.created_at).toLocaleString()}</small></span><strong>{entry.delta > 0 ? '+' : ''}{entry.delta}</strong></li>)}</ul></details>}
    </>}
    {feedback && <p role="status">{feedback}</p>}
  </div>;
}

export function ImageGenerationSettings(props: Props) {
  useLanguage();
  return <section className="panel settings-panel"><AccountPanel {...props}/>
  </section>;
}

export default function ImageGenerator({ busy, settings, setSettings, runBusy, onResult, onClose }: Props & {
  images: ImageAsset[]; selectedImages: string[]; onSettings: () => void; onResult: (result: ImportResult) => void; onClose: () => void;
}) {
  useLanguage();
  const [account, setAccount] = useState<BackendAccount | null>(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<string>('1328x1328');
  const [preview, setPreview] = useState<GeneratedImagePreview | null>(null);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    let active = true;
    if (!settings.backendLoggedIn) { setPreview(null); return; }
    window.reach.getGeneratedImage().then(value => { if (active) setPreview(value); }).catch(() => { if (active) setError('无法恢复预览，请继续查询。'); });
    return () => { active = false; };
  }, [settings.backendLoggedIn]);
  const finish = async (resume = false) => {
    setError('');
    try { setPreview(await (resume ? window.reach.resumeImageTask() : window.reach.generateImage({ mode: 'generate', prompt, size }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '生成失败'); throw cause; }
    finally { setSettings(await window.reach.getSettings()); }
  };
  const canGenerate = settings.backendLoggedIn && account?.config.enabled && account.config.providerReady && account.user.balance >= account.config.cost;
  return <section className="panel settings-panel" aria-label={t('AI 生成图片')}>
    <AccountPanel busy={busy} settings={settings} setSettings={setSettings} runBusy={runBusy} onAccount={setAccount}/>
    <div className="backend-generator-title"><Sparkles size={20}/><h2>{t('AI 图片工作台')}</h2><span>{t('通用 3.0 文生图')}</span></div>
    {preview && <div aria-label={t('生成结果预览')}><h3>{t('生成结果 · 尚未保存')}</h3><img src={preview.dataUrl} alt={t('生成结果预览')} className="backend-preview"/>
      <div className="settings-actions"><button className="button primary" disabled={busy} onClick={() => void runBusy('正在保存到素材库…', async () => {
        try { onResult(await window.reach.saveGeneratedImage(preview.taskId)); setPreview(null); }
        finally { setSettings(await window.reach.getSettings()); }
      })}>{t('保存到素材库')}</button><button className="button secondary" disabled={busy} onClick={() => void runBusy('正在丢弃预览…', async () => {
        setSettings(await window.reach.discardImageTask()); setPreview(null);
      })}>{t('丢弃结果')}</button></div><p>{t('图片链接有时效，建议生成后及时保存。丢弃结果不退积分。')}</p></div>}
    {settings.hasPendingImageTask && !preview && <div className="backend-pending" role="status"><p>{t('有已提交的任务待查询，继续查询不会重复扣分。')}</p><div className="settings-actions"><button className="button primary" disabled={busy || !settings.backendLoggedIn} onClick={() => void runBusy('正在查询生图结果…', () => finish(true))}>{t('继续查询')}</button><button className="button secondary" disabled={busy} onClick={() => setConfirmDiscard(true)}>{t('移除本机记录')}</button></div>
      {confirmDiscard && <div><p>{t('只移除本机记录，不会取消云端任务或退分。未完成任务仍会在登录或刷新账户后恢复。')}</p><button className="button danger" disabled={busy} onClick={() => void runBusy('正在移除本机记录…', async () => { setSettings(await window.reach.discardImageTask()); setConfirmDiscard(false); })}>{t('确认移除')}</button><button className="button secondary" onClick={() => setConfirmDiscard(false)}>{t('保留')}</button></div>}</div>}
    <div className="field"><label htmlFor="image-prompt">{t('图片描述')}</label><textarea id="image-prompt" rows={4} maxLength={IMAGE_PROMPT_LIMIT} value={prompt} disabled={busy || !settings.backendLoggedIn} onChange={event => setPrompt(event.target.value)} placeholder={t('例如：清晨森林中的玻璃小屋，薄雾，温暖光线，电影感构图')}/><small>{prompt.length} / {IMAGE_PROMPT_LIMIT}</small></div>
    <div className="field"><label htmlFor="image-size">{t('图片尺寸')}</label><select id="image-size" value={size} disabled={busy || !settings.backendLoggedIn} onChange={event => setSize(event.target.value)}>{(account?.config.sizes || IMAGE_SIZES).map(value => <option key={value}>{value}</option>)}</select></div>
    {settings.backendLoggedIn && account && account.user.balance < account.config.cost && <p>{t('积分不足，请先签到领取积分。')}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="settings-actions"><button className="button primary" disabled={busy || !canGenerate || !!preview || settings.hasPendingImageTask || !prompt.trim()} onClick={() => void runBusy('后端正在生成图片…', () => finish())}><Sparkles size={16}/>{!settings.backendLoggedIn ? t('请先登录') : t('生成图片 · {0} 积分', [account?.config.cost ?? '—'])}</button><button className="button secondary" disabled={busy} onClick={onClose}>{t('收起')}</button></div>
  </section>;
}
