// Injected into a dedicated Playwright page by the Python publisher.
(() => {
  if (globalThis.fanzyPublisher) return;
  let current = null;
  const facebookPostLabel = /^(Post|Publish|发布|发帖|發帖|發布|發佈|發表|發佈貼文|发布帖子)$/i;
  const facebookNextLabel = /^(Next|下一步)$/i;
  const hosts = {facebook:'www.facebook.com',bluesky:'bsky.app',x:'x.com',instagram:'www.instagram.com',pinterest:'www.pinterest.com',tiktok:'www.tiktok.com'};
  async function trace(step,message,level='info',detail) {
    try { await globalThis.fanzyTrace({step,message,level,detail}); } catch {}
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const visible = node => Boolean(node?.isConnected && !node.closest('[aria-hidden="true"],[inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const labelText = label => { const copy=label.cloneNode(true); copy.querySelectorAll('select,input,textarea').forEach(node=>node.remove()); return copy.textContent; };
  const name = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.textContent || '').join(' ').trim() || node.getAttribute('placeholder') || node.getAttribute('aria-placeholder') || node.getAttribute('data-placeholder') || (node.labels ? [...node.labels].map(labelText).join(' ') : '') || node.innerText?.trim() || node.querySelector('svg[aria-label],img[alt]')?.getAttribute('aria-label') || node.querySelector('img[alt]')?.getAttribute('alt') || node.innerText || '';
  const all = (selector, root=document) => [...root.querySelectorAll(selector)];
  const unique = (nodes, label='页面控件') => { if(nodes.length>1) throw Error(`${label}匹配到 ${nodes.length} 个控件，已停止自动操作`); return nodes[0]; };
  function checkAccount() {
    if(current?.platform!=='x') return;
    const restricted=all('h1,h2,h3,[role="heading"]').some(node=>visible(node)&&!node.closest('article,[data-testid="tweet"]')&&/Your account is suspended|你的账号已被冻结|你的帳戶已遭停用|您的帳戶已被暫停|你的账号已被暂停/i.test(node.textContent));
    if(restricted) throw Error('X 账号已被暂停或设为只读，无法发帖。请先在 X 处理账号限制，再重新发布');
  }
  function controlsRoot() {
    if(current?.platform==='facebook' && current.composer) {
      if(!current.composer.isConnected) throw Error('Facebook 发帖窗口已关闭，请检查页面后重试');
      return current.composer;
    }
    if(current?.platform!=='instagram'||!current.composer) return document;
    if(!current.composer.isConnected) throw Error('Instagram 发帖窗口已关闭或重新加载');
    return current.composer;
  }
  function instagramOpenState() {
    if (/\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(location.pathname)) throw Error('Instagram 需要重新登录或验证');
    const dialogs=all('[role="dialog"],[aria-modal="true"]').filter(visible);
    const uploadDialogs=dialogs.filter(node=>all('input[type="file"]',node).some(input=>!input.disabled&&!input.closest('[aria-hidden="true"],[inert]')));
    const composer=unique(uploadDialogs.filter(node=>!uploadDialogs.some(other=>other!==node&&node.contains(other))),'Instagram 发帖弹窗');
    if(composer) { current.composer=composer; return 'open'; }
    // A menu/loading dialog is a transition, never permission to click Create again.
    if(dialogs.length || all('[role="menu"]').some(visible)) return 'transition';
    if(document.readyState==='loading') return 'loading';
    if(location.pathname!=='/') throw Error('Instagram 已离开首页，停止重复点击创建');
    const create=unique(all('a,[role="link"],button,[role="button"]').filter(node=>visible(node)&&!node.closest('article')&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&/^(New post|Create|创建|新帖子|新貼文|建立|建立貼文)$/i.test(name(node).trim())),'Instagram 创建入口');
    all('[data-fanzy-create]').forEach(node=>node.removeAttribute('data-fanzy-create'));
    if(!create) return 'loading';
    create.setAttribute('data-fanzy-create','instagram');
    return 'ready';
  }
  function xEditors(root) {
    // Some X layouts put the same test id on a wrapper and its editable child.
    return [...new Set(all('[data-testid="tweetTextarea_0"]',root).map(node=>node.matches('[contenteditable="true"],textarea') ? node : node.querySelector('[contenteditable="true"],textarea')).filter(visible))];
  }
  function selectXComposer() {
    const dialogs=all('[role="dialog"],[aria-modal="true"]').filter(node=>visible(node)&&xEditors(node).length);
    const innermost=dialogs.filter(node=>!dialogs.some(other=>other!==node&&node.contains(other)));
    // The home composer can render before the /compose/post modal mounts.
    // Never fall back to the background editor while waiting for that modal.
    if(!innermost.length && /^\/compose\/(post|tweet)\/?$/.test(location.pathname)) return null;
    const root=unique(innermost,'X 发帖弹窗') || document;
    const editor=unique(xEditors(root),'X 发帖窗口内的文案框');
    if(!editor) return null;
    return {root,editor};
  }
  function xAll(selector) {
    if(!current.composer || (current.composer!==document&&!current.composer.isConnected)) throw Error('X 发帖窗口已关闭或重新加载，请检查后重试');
    return all(selector,current.composer);
  }
  function xPhotoPreviews() {
    // X layouts do not always nest tweetPhoto under an attachments wrapper.
    // Scope to the selected composer; never count timeline photos or avatars.
    const nodes=xAll('[data-testid="tweetPhoto"],[data-testid="attachments"] img').filter(visible);
    return nodes.filter(node=>!nodes.some(parent=>parent!==node&&parent.contains(node)))
      .filter(node=>{
        const images=node.matches('img')?[node]:all('img',node);
        return images.every(img=>img.complete&&img.naturalWidth>0);
      });
  }
  async function wait(find, label, timeout=20000) {
    const started=Date.now();
    await trace('control.wait', '等待：'+label);
    try {
      while(Date.now()<started+timeout) { checkAccount(); const value=find(); if(value) { await trace('control.ready', label+'已就绪（'+(Date.now()-started)+' ms）'); return value; } await pause(500); }
      throw Error('未找到或未就绪：'+label+'。请检查登录、验证或平台页面变化');
    } catch(error) {
      const root=current?.composer?.isConnected?current.composer:document;
      const fields=all('input:not([type="file"]):not([type="password"]),textarea,[contenteditable]',root).filter(visible).slice(0,20).map(node=>({tag:node.tagName,role:node.getAttribute('role'),label:node.getAttribute('aria-label'),placeholder:node.getAttribute('placeholder')||node.getAttribute('aria-placeholder')||node.getAttribute('data-placeholder')}));
      await trace('control.failed',label+'：'+error.message,'error',error.stack+'\n可见字段标签（不含输入值）：'+JSON.stringify(fields)); throw error;
    }
  }
  const findButton = pattern => unique(all('button,[role="button"]',controlsRoot()).filter(node=>visible(node)&&pattern.test(name(node).trim())));
  const findField = pattern => unique(all('input:not([type="file"]),textarea,[contenteditable]:not([contenteditable="false"])',controlsRoot()).filter(node=>visible(node)&&pattern.test(name(node).trim())));
  async function click(pattern) { const node=await wait(()=>findButton(pattern),'按钮 '+pattern); await wait(()=>!node.disabled && node.getAttribute('aria-disabled')!=='true','按钮可用'); await trace('control.click','点击按钮 '+pattern); node.click(); }
  async function fill(node,text) {
    await trace('content.fill','填写文本字段（不记录正文）');
    node.focus();
    if(node.isContentEditable) {
      const range=document.createRange(); range.selectNodeContents(node);
      const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if(!document.execCommand('insertText',false,text)) { node.textContent=text; node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text})); }
    } else {
      const proto=node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(node,text);
      node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  async function field(pattern,text) { await fill(await wait(()=>findField(pattern),'文本框'),text); }
  async function pinterestAltText(text) {
    const label=/(Alt(?:ernative)? text|替代文本|替代文字|备用文本|替換文字|描述你\s*Pin\s*图的视觉详细信息|Describe your Pin.s visual details)/i;
    const direct=/^(Add alt text|Add alternative text|添加替代文本|添加替代文字|替代文本|替代文字)$/i;
    const more=/^(More options|更多选项|更多選項)$/i;
    const entry=await wait(()=>{
      const input=findField(label);
      if(input) return {input};
      const button=findButton(direct);
      if(button) return {button};
      const section=findButton(more);
      return section?{section}:null;
    },'Pinterest 替代文本入口或更多选项');
    if(entry.section) {
      if(entry.section.getAttribute('aria-expanded')!=='true') {
        await trace('pinterest.options','展开更多选项，查找替代文本');
        entry.section.click();
      }
      const expanded=await wait(()=>{
        const input=findField(label);
        if(input) return {input};
        const button=findButton(direct);
        return button?{button}:null;
      },'更多选项中的替代文本字段');
      Object.assign(entry,expanded);
    }
    if(entry.button) {
      await wait(()=>!entry.button.disabled&&entry.button.getAttribute('aria-disabled')!=='true','替代文本按钮可用');
      entry.button.click();
    }
    const input=await wait(()=>findField(label),'Pinterest 替代文本字段');
    await fill(input,text);
    await wait(()=>input.isConnected&&(input.isContentEditable?input.innerText:input.value)===text,'Pinterest 替代文本填写确认');
    await trace('pinterest.alt_text','已填写并核对替代文本（不记录正文）');
  }
  function caption(job,withTitle=true) { return [withTitle?job.title:'',job.caption,job.hashtags.join(' ')].filter(Boolean).join('\n\n'); }
  function success(platform,root=document) {
    if(platform==='facebook') {
      const selector='[role="status"],[role="alert"]';
      return [...(root.matches?.(selector)?[root]:[]),...all(selector,root)].some(node=>visible(node)&&/^(Your post has been shared|Your post was published|Post published|你的帖子已发布|帖子已发布|貼文已發佈|已分享你的貼文)[.!。！]?$/i.test(node.textContent.trim()));
    }
    if(current?.scheduleAt && ['instagram','pinterest'].includes(platform)) {
      return all('[role="status"],[role="alert"],h1,h2,h3,span,p',root).some(node=>visible(node)&&/^(?:(?:Your\s+)?(?:Pin|post|reel)\s+(?:has been\s+)?(?:successfully\s+)?scheduled|(?:你的)?(?:帖子|貼文|Pin\s*图|Pin\s*圖)已(?:排程|安排|定时)|已安排定时发布)[.!。！]?$/i.test(node.textContent.trim()));
    }
    if(platform==='bluesky') return Boolean(current?.confirmedUrl);
    if(platform==='tiktok') {
      const nodes=[...(root.nodeType===1?[root]:[]),...all('[role="status"],[role="alert"],h1,h2,h3,span,p,div',root)];
      if(nodes.some(node=>visible(node)&&/^(Your (?:post|photos) (?:has|have) been published|Post published|已发布|发布成功)[.!。！]?$/i.test(node.textContent.trim()))) return true;
      if(!current?.submitted||location.pathname===current.uploadPath||current.control?.isConnected) return false;
      // A redirect alone is not proof. Require the submitted cover in a row
      // with an explicit platform review state, not an unrelated old post.
      return all('img').filter(visible).some(img=>{
        if(!current.photoSources?.includes(img.currentSrc||img.src)) return false;
        let row=img.parentElement;
        for(let i=0;i<4&&row&&row!==document.body;i++,row=row.parentElement) {
          const text=row.textContent.trim();
          if(text.length<500&&/内容审核中|Under review/i.test(text)) return true;
        }
        return false;
      });
    }
    if(platform==='x' && current.scheduleAt) return all('[data-testid="toast"]').some(node=>visible(node)&&/Your post (will be sent|was scheduled)|你的(帖子|推文)将于|你的(貼文|推文)將於|已排程|已安排定时/i.test(node.textContent));
    const patterns={x:/^(Your post was sent\.?|你的帖子已发送[。！]?|你的推文已发送[。！]?)$/i,instagram:/^(Your post has been shared[.!]?|你的帖子已分享[。！]?|你的貼文已分享[。！]?|已分享你的貼文[。！]?)$/i,pinterest:/^(?:(?:Your\s+)?Pin\s+(?:has been\s+)?(?:successfully\s+)?published|(?:你[的]?\s*)?Pin\s*(?:图|圖)?\s*(?:已成功发布|已發佈|已發布|已发布|发布成功|發佈成功|發布成功))[.!。！]?$/i};
    const selector=platform==='x'?'[data-testid="toast"] *,[data-testid="toast"]':'h1,h2,h3,[role="status"],[role="alert"],span,p';
    return [...(root.matches?.(selector)?[root]:[]),...all(selector,root)].some(node=>visible(node)&&patterns[platform].test(node.textContent.trim()));
  }
  async function upload(selector, root=document) {
    const input=await wait(()=>unique(all(selector,root).filter(node=>!node.disabled&&!node.closest('[aria-hidden="true"],[inert]')),'图片上传控件'),'图片上传控件');
    await trace('images.upload',`上传 ${current.files.length} 张图片到平台页面`);
    const transfer=new DataTransfer(); current.files.forEach(file=>transfer.items.add(file));
    input.files=transfer.files;
    if(input.files.length!==current.files.length) throw Error('图片上传数量不一致');
    // Platforms may clear the FileList synchronously after consuming change.
    // Validate assignment before dispatch; preview/next-step checks verify processing.
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await trace('images.attached','图片已交给平台上传控件，等待平台处理');
  }
  function finalButton(platform) {
    if(platform==='facebook') return findButton(facebookPostLabel);
    if(current?.scheduleAt && ['instagram','pinterest'].includes(platform)) return findButton(/^(Schedule|Schedule Pin|Schedule post|排程|定时发布|安排发布时间|安排發布時間|預約發布)$/i);
    if(platform==='bluesky') return unique(all('[data-testid="composerPublishBtn"]',current.composer).filter(visible),'Bluesky 发布按钮');
    if(platform==='tiktok') return findButton(/^(Post|Publish|发布|發佈)$/i);
    if(platform==='x') {
      const node=unique(xAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]').filter(visible),'X 发帖窗口内的发布按钮');
      if(current.scheduleAt && node && !/^(Schedule|排程|安排|定时|預約|預定)$/i.test(name(node).trim())) return null;
      return node;
    }
    return findButton(platform==='instagram'?/^(Share|分享)$/i:/^(Publish|发布)$/i);
  }
  async function scheduleX(iso) {
    const date=new Date(iso);
    if(!Number.isFinite(date.getTime()) || date.getTime()<Date.now()+60000) throw Error('X 定时时间已过期或不足 1 分钟，请重新设置');
    await trace('schedule.open','设置 X 原生排程：'+date.toISOString()+'；浏览器时区：'+Intl.DateTimeFormat().resolvedOptions().timeZone);
    const opener=await wait(()=>unique(xAll('button,[role="button"]').filter(node=>visible(node)&&/^(Schedule post|Schedule Tweet|Schedule|预定帖子|定时发布|排程貼文|安排貼文|安排推文)$/i.test(name(node).trim())),'X 排程入口'),'X 排程入口');
    opener.click();
    const root=await wait(()=>{
      const nodes=all('[role="dialog"]').filter(node=>visible(node)&&all('select',node).some(visible));
      return unique(nodes.filter(node=>!nodes.some(other=>other!==node&&node.contains(other))),'X 时间弹窗');
    },'X 时间弹窗');
    const select=pattern=>unique(all('select',root).filter(node=>visible(node)&&pattern.test(name(node).trim())),'X 时间字段 '+pattern);
    const set=async (pattern,match)=>{
      const node=await wait(()=>select(pattern),'X 时间字段 '+pattern);
      const option=unique([...node.options].filter(item=>!item.disabled&&match(item.textContent.trim())),'X 时间选项 '+pattern);
      if(!option) throw Error('X 排程时间选项不支持：'+pattern);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,option.value);
      node.dispatchEvent(new Event('change',{bubbles:true}));
      await pause(100);
      if(!match(select(pattern)?.selectedOptions[0]?.textContent.trim() || '')) throw Error('X 排程时间未生效：'+pattern);
    };
    const numeric=value=>text=>/^\d+(?:年|月|日|時|时|分)?$/.test(text)&&parseInt(text,10)===value;
    const year=/^(Year|年)$/i, month=/^(Month|月)$/i, day=/^(Day|日|天)$/i, hour=/^(Hour|小时|小時|時|时)$/i, minute=/^(Minute|分钟|分鐘|分)$/i;
    await set(day,numeric(1));
    await set(year,numeric(date.getFullYear()));
    const months=['en-US','zh-CN','zh-TW'].flatMap(locale=>['long','short'].map(format=>new Intl.DateTimeFormat(locale,{month:format}).format(date)));
    await set(month,text=>months.includes(text)||numeric(date.getMonth()+1)(text));
    await set(day,numeric(date.getDate()));
    const period=/^(AM\/PM|Period|上午\/下午|上午／下午|時段|时段)$/i;
    const hasPeriod=Boolean(select(period));
    await set(hour,numeric(hasPeriod ? date.getHours()%12||12 : date.getHours()));
    await set(minute,numeric(date.getMinutes()));
    if(hasPeriod) await set(period,text=>(date.getHours()<12 ? /^(AM|上午)$/i : /^(PM|下午)$/i).test(text));
    const checks=[[year,numeric(date.getFullYear())],[month,text=>months.includes(text)||numeric(date.getMonth()+1)(text)],[day,numeric(date.getDate())],[hour,numeric(hasPeriod?date.getHours()%12||12:date.getHours())],[minute,numeric(date.getMinutes())]];
    if(checks.some(([pattern,match])=>!match(select(pattern)?.selectedOptions[0]?.textContent.trim() || ''))) throw Error('X 排程时间在填写期间发生变化，已停止提交');
    const confirm=await wait(()=>unique(all('button,[role="button"]',root).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&/^(Confirm|确认|確認)$/i.test(name(node).trim())),'X 确认时间按钮'),'X 确认时间按钮');
    confirm.click();
    current.scheduleAt=iso;
    await wait(()=>finalButton('x'),'X 最终排程按钮');
    await trace('schedule.ready','X 排程时间已填写，等待提交许可：'+date.toISOString());
  }
  async function scheduleNative(iso) {
    const date=new Date(iso);
    if(!Number.isFinite(date.getTime()) || date.getTime()<Date.now()+60000) throw Error('定时时间已过期，请重新设置');
    const root=controlsRoot();
    const entry=unique(all('button,[role="button"],input[type="checkbox"],[role="switch"],[role="checkbox"],input[type="radio"]',root).filter(node=>visible(node)&&/^(Publish at a later date|Publish later|Schedule for later|Schedule this post|Schedule date|稍后发布|稍後發佈|定时发布|安排发布时间|安排發布時間)$/i.test(name(node).trim())),'原生排程入口');
    if(!entry) return false;
    if(entry.disabled||entry.getAttribute('aria-disabled')==='true') return false;
    if(!entry.checked && entry.getAttribute('aria-checked')!=='true' && entry.getAttribute('aria-expanded')!=='true') entry.click();
    // Only use unambiguous browser date/time fields. Unknown custom pickers fall
    // back before submission instead of guessing locale-dependent date strings.
    await pause(500);
    const dateInput=unique(all('input[type="date"]',root).filter(visible),'排程日期');
    const timeInput=unique(all('input[type="time"]',root).filter(visible),'排程时间');
    const combined=unique(all('input[type="datetime-local"]',root).filter(visible),'排程日期时间');
    if(!combined&&(!dateInput||!timeInput)) return false;
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
    const pairs=combined?[[combined,local]]:[[dateInput,local.slice(0,10)],[timeInput,local.slice(11)]];
    for(const [node,value] of pairs) {if(node.disabled||node.readOnly) return false; await fill(node,value);}
    const valid=()=>pairs.every(([node,value])=>visible(node)&&node.value===value&&node.checkValidity());
    if(!valid()) return false;
    current.scheduleAt=iso;
    if(!finalButton(current.platform)) {current.scheduleAt=null;return false;}
    current.checkSchedule=valid;
    await trace('schedule.ready','原生排程已填写并核对：'+iso+'；浏览器时区：'+Intl.DateTimeFormat().resolvedOptions().timeZone);
    return true;
  }
  globalThis.fanzyPublisher=async (phase,job,extra) => {
    if(location.protocol!=='https:'||location.hostname!==hosts[job.platform]) throw Error('当前页面不是指定平台');
    if(phase==='begin') {
      if(current && current.id!==job.id) throw Error('该标签页已有任务');
      current={id:job.id,platform:job.platform,files:[],prepared:false,submitted:false};await trace('page.begin','Playwright 页面发布任务初始化');return;
    }
    if(phase==='confirm_pinterest') {
      if(current?.platform==='pinterest'&&current.submitted&&/^https:\/\/www\.pinterest\.com\/pin\/\d+\/$/.test(extra?.url||'')) current.confirmedUrl=extra.url;
      return;
    }
    if(phase==='confirm_bluesky') {
      if(current?.platform==='bluesky'&&current.submitted&&/^https:\/\/bsky\.app\/profile\/did:[^/]+\/post\/[A-Za-z0-9_-]+$/.test(extra?.url||'')) current.confirmedUrl=extra.url;
      return;
    }
    if(phase==='confirm_tiktok') {
      if(current?.platform==='tiktok'&&current.submitted) current.confirmedTikTok=true;
      return;
    }
    if(!current||current.id!==job.id) throw Error('任务上下文已丢失');
    if(phase==='instagram_open_state') {
      if(job.platform!=='instagram') throw Error('非 Instagram 任务');
      return instagramOpenState();
    }
    if(phase==='asset') {
      if(current.prepared||current.files.length>=job.fileCount) throw Error('图片数量或任务阶段错误');
      const bytes=Uint8Array.from(atob(extra.data),character=>character.charCodeAt(0));
      current.files.push(new File([bytes],extra.name,{type:extra.type}));return;
    }
    if(phase==='prepare') {
      if(current.prepared||current.submitted||current.files.length!==job.fileCount) throw Error('任务阶段或图片数量错误');
      if(job.platform==='facebook') {
        if(job.nativeScheduledAt) throw Error('Facebook 请使用本地定时发布');
        if(job.altText) throw Error('Facebook 暂不支持自动填写替代文本，请清空替代文本后重试，或手动发布');
        const composer=()=>unique(all('[role="dialog"]').filter(node=>visible(node)&&all('[contenteditable="true"][role="textbox"]',node).some(visible)),'Facebook 发帖窗口');
        // Facebook localizes this prompt and may prefix it with the account name.
        // Keep the whole label anchored so timeline text cannot act as an entry.
        if(!composer()) await click(/^(What['’]s on your mind(?:,\s*[^\n]+)?\??|(?:[^\n，,]+[，,]\s*)?(?:你在想什么|在想些什麼|在想什么)[？?]?|(?:[^\n，,]+[，,]\s*)?(?:分享你的新鲜事吧|分享你的新鮮事吧)[！!。.]?)$/i);
        current.composer=await wait(composer,'Facebook 发帖窗口');
        const editor=await wait(()=>unique(all('[contenteditable="true"][role="textbox"]',current.composer).filter(visible),'Facebook 文案框'),'Facebook 文案框');
        editor.setAttribute('data-fanzy-facebook-editor','true');
        await globalThis.fanzyFacebookInput();
        await wait(()=>editor.innerText.replace(/\r\n/g,'\n').trim()===caption(job).trim(),'Facebook 文案确认');
        const fileSelector='input[type="file"][accept*="image"]';
        if(!all(fileSelector,current.composer).length) await click(/^(Photo\/video|Photo\/Video|照片\/视频|照片／视频|相片\/影片|相片／影片)$/i);
        await upload(fileSelector,current.composer);
        await wait(()=>{
          const previews=all('img',current.composer).filter(img=>visible(img)&&/^(blob:|data:)/.test(img.src)&&img.complete&&img.naturalWidth>0);
          const removing=all('button,[role="button"]',current.composer).filter(node=>visible(node)&&/^(Remove photo|Remove image|移除照片|删除照片|移除相片)/i.test(name(node)));
          return (previews.length===job.fileCount||removing.length===job.fileCount)&&!all('[role="progressbar"],[aria-busy="true"]',current.composer).some(visible);
        },'Facebook 图片上传完成',60000);
        // Upload completion can precede the footer rendering. Wait for either
        // known step; an absent Post button alone is not evidence of a Next step.
        const step=await wait(()=>finalButton('facebook')?'post':findButton(facebookNextLabel)?'next':null,'Facebook 发帖或下一步按钮');
        if(step==='next') {
          await click(facebookNextLabel);
          current.composer=await wait(()=>unique(all('[role="dialog"]').filter(node=>visible(node)&&all('button,[role="button"]',node).some(button=>visible(button)&&facebookPostLabel.test(name(button).trim()))),'Facebook 发布设置窗口'),'Facebook 发布设置窗口');
        }
      } else if(job.platform==='bluesky') {
        const text=caption(job);
        if([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length>300) throw Error('Bluesky 正文与话题合计最多 300 字符，请缩短文案');
        current.composer=await wait(()=>unique(all('[data-testid="composePostView"]').filter(visible),'Bluesky 发帖窗口'),'Bluesky 发帖窗口');
        const editor=await wait(()=>unique(all('[contenteditable="true"]',current.composer).filter(visible),'Bluesky 文案框'),'Bluesky 文案框');
        await globalThis.fanzyBlueskyInput('text');
        await wait(()=>editor.innerText.replace(/\r\n/g,'\n').trim()===text.trim(),'Bluesky 文案填写确认');
        await globalThis.fanzyBlueskyInput('images');
        await wait(()=>all('[data-testid="selectedPhotosView"] [data-testid="removePhotoButton"]',current.composer).filter(visible).length===job.fileCount,'Bluesky 图片数量确认');
        if(job.altText) await globalThis.fanzyBlueskyInput('alt');
      } else if(job.platform==='x') {
        const composer=await wait(selectXComposer,'X 发帖窗口');
        current.composer=composer.root;
        await trace('composer.selected','已锁定当前 X 发帖窗口');
        await fill(composer.editor,caption(job));
        await upload('input[data-testid="fileInput"]',current.composer);
        await wait(()=>xPhotoPreviews().length===job.fileCount,'发帖窗口内的图片预览');
        await trace('images.preview_ready','已确认发帖窗口内 '+job.fileCount+' 张图片预览');
        if(job.altText) {
          for(let index=0;index<job.fileCount;index++) {
            const descriptions=xAll('button,[role="button"]').filter(node=>visible(node)&&/^(Add description|Add alt text|添加描述|添加替代文本)$/i.test(name(node).trim()));
            if(!descriptions.length) throw Error('缺少图片替代文本控件');
            descriptions[0].click(); await field(/(Description|Alt text|描述|替代文本)/i,job.altText); await click(/^(Save|Done|保存|完成)$/i);
          }
        }
        if(job.nativeScheduledAt || job.xScheduledAt) await scheduleX(job.nativeScheduledAt || job.xScheduledAt);
      } else if(job.platform==='instagram') {
        if(instagramOpenState()!=='open') throw Error('Instagram 上传弹窗尚未确认打开，禁止上传');
        await upload('input[type="file"]',current.composer);
        const nextStep=/^(Next|Continue|下一步|继续|繼續)$/i;
        await trace('instagram.crop','图片已交给平台，等待裁剪页面的继续按钮');
        await click(nextStep); await pause(700);
        await trace('instagram.edit','等待编辑页面的继续按钮');
        await click(nextStep);
        await trace('instagram.caption','等待文案编辑框（添加配文 / 说明 / caption）');
        await field(/(Write a caption|Add a caption|添加配文|新增配文|撰写配文|撰寫配文|撰写说明|添加说明|撰寫說明|新增說明|輸入說明)/i,caption(job));
        if(job.altText) {
          const altFields=()=>all('input:not([type="hidden"]),textarea',controlsRoot()).filter(node=>visible(node)&&!node.disabled&&/(Alt text|替代文本|替代文字)/i.test(name(node)));
          if(!altFields().length) {
            const section=await wait(()=>unique(all('button,[role="button"],summary',controlsRoot()).filter(node=>visible(node)&&!node.disabled&&/^(Accessibility|无障碍|辅助功能|無障礙|輔助使用)$/i.test(name(node).trim())),'Instagram 辅助功能入口'),'Instagram 辅助功能入口');
            if(section.getAttribute('aria-expanded')!=='true') {
              await trace('instagram.accessibility','展开辅助功能，等待图片替代文本字段');
              section.click();
            }
          }
          const fields=await wait(()=>{
            const nodes=altFields();
            if(nodes.length>job.fileCount) throw Error('图片替代文本字段数量多于图片，已停止避免误填');
            return nodes.length===job.fileCount?nodes:null;
          },'Instagram 图片替代文本字段');
          for (const node of fields) {
            await fill(node,job.altText);
            if(node.value!==job.altText) throw Error('图片替代文本填写未生效');
          }
          await trace('instagram.alt_text','已填写并核对 '+fields.length+' 个图片替代文本字段（不记录正文）');
        }
      } else if(job.platform==='tiktok') {
        const imageInput=()=>unique(all('input[type="file"]').filter(node=>!node.disabled&&!node.closest('[aria-hidden="true"],[inert]')&&/(image\/|\.(?:jpe?g|png|webp)(?:,|$))/i.test(node.accept)), 'TikTok 图片上传控件');
        let photoModeClicked=false;
        let input;
        try { input=await wait(()=>{
          const ready=imageInput();
          if(ready) return ready;
          if(!photoModeClicked) {
            const candidates=all('button,[role="button"],[role="tab"],a,div,span').filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&/^(Photos|Photo|Upload photos|图片|照片|上传照片|上传图片)$/i.test(name(node).trim()));
            // Nested labels represent one control. Prefer the innermost label;
            // its click bubbles to the tab, including tabs without ARIA roles.
            const photos=unique(candidates.filter(node=>!candidates.some(other=>other!==node&&node.contains(other))), 'TikTok 图片模式');
            if(photos) { photoModeClicked=true; photos.click(); }
          }
          return null;
        },'TikTok 图片上传入口',15000); }
        catch { throw Error('当前 TikTok 网页端未提供可识别的图片上传入口。请确认登录并开启图片模式；仅支持视频时，请将准备好的图片通过 TikTok 手机端发布。未提交任何内容。'); }
        if(job.fileCount>1&&!input.multiple) throw Error('当前 TikTok 上传入口不支持多图轮播，未提交');
        input.setAttribute('data-fanzy-photo-input','true');
        await upload('input[data-fanzy-photo-input="true"]');
        // Require one visible local preview for every photo; unrelated remote avatars do not count.
        await wait(()=>{
          const counts=all('div,span,p').filter(visible).map(node=>{
            // Read the platform's upload summary, not the phone preview or avatar.
            const text=node.textContent.trim();
            if(text.length>100) return null;
            return text.match(/^已上传\s*(\d+)\s*张照片(?:[，,。.\s]|$)/)||text.match(/^(\d+)\s*photos? uploaded(?:[,.\s]|$)/i);
          }).filter(Boolean);
          if(counts.length) return counts.every(match=>Number(match[1])===job.fileCount);
          return all('img').filter(node=>visible(node)&&/^(blob:|data:image\/)/i.test(node.currentSrc||node.src)).length===job.fileCount;
        },'TikTok 全部图片预览');
        if(job.title) {
          const title=await wait(()=>findField(/^(Title|Add title|Add a title|标题|添加标题|添加一个吸睛标题)$/i),'TikTok 标题');
          title.setAttribute('data-fanzy-native-field','title');
          await globalThis.fanzyTikTokInput('title');
        }
        const findDescription=()=>findField(/^(Description|Caption|Add a description|描述|说明|添加描述|添加说明|写详细描述，浏览量可平均提高\s*3\s*倍以上)[.…]*$/i)||unique(all('[contenteditable="true"][role="combobox"]').filter(visible),'TikTok 描述编辑框');
        const description=await wait(findDescription,'TikTok 描述');
        description.setAttribute('data-fanzy-native-field','description');
        await globalThis.fanzyTikTokInput('description');
        await wait(()=>{
          if(all('h1,h2,h3,[role="heading"]').some(node=>visible(node)&&/^(出错了|Something went wrong)[.!！。]?$/i.test(node.textContent.trim()))) throw Error('TikTok 编辑页面显示“出错了”，已停止，未点击发布');
          const node=findDescription();
          const normalize=text=>text.replace(/\r\n/g,'\n').replace(/\u00a0/g,' ');
          if(node?.isContentEditable&&caption(job,false)==='') {
            // Empty rich editors retain BR blocks or zero-width caret sentinels.
            // Do not treat these as user copy, but never accept real text as empty.
            return (node.textContent||'').replace(/[\r\n\u200b\ufeff]/g,'')==='';
          }
          return node&&normalize(node.isContentEditable?node.innerText:node.value)===normalize(caption(job,false));
        },'TikTok 描述填写确认');
        if(job.altText) {
          const fields=all('input,textarea').filter(node=>visible(node)&&/(Alt text|替代文本|替代文字)/i.test(name(node)));
          if(fields.length!==job.fileCount) throw Error('TikTok 替代文本字段不完整，请在平台确认后再发布');
          for(const node of fields) await fill(node,job.altText);
        }
        if(job.tiktokPrivacy) {
          const anyPrivacy=/^(Everyone|Public|Only you|Only me|所有人|公开|公開|仅自己|僅自己|只有你)$/i;
          const target=job.tiktokPrivacy==='public'?/^(Everyone|Public|所有人|公开|公開)$/i:/^(Only you|Only me|仅自己|僅自己|只有你)$/i;
          const picker=()=>unique(all('button,[role="button"],[role="combobox"]:not([contenteditable="true"]),select').filter(node=>visible(node)&&(node.tagName==='SELECT'?/Who can|谁可以看|誰可以看/i.test(name(node)):anyPrivacy.test(name(node).trim()))),'TikTok 隐私选择器');
          const selected=node=>node?.tagName==='SELECT'?node.selectedOptions[0]?.textContent.trim():node?name(node).trim():'';
          const control=await wait(picker,'TikTok 谁可以看');
          if(!target.test(selected(control))) {
            if(control.tagName==='SELECT') {
              const option=unique([...control.options].filter(option=>!option.disabled&&target.test(option.textContent.trim())),'TikTok 隐私选项');
              if(!option) throw Error('当前账号不支持所选 TikTok 隐私选项');
              control.value=option.value;control.dispatchEvent(new Event('change',{bubbles:true}));
            } else {
              control.click();
              const option=await wait(()=>unique(all('[role="option"],[role="menuitem"],[role="radio"],button,div,span').filter(node=>visible(node)&&target.test(name(node).trim())).filter((node,_,nodes)=>!nodes.some(other=>other!==node&&node.contains(other))),'TikTok 目标隐私选项'),'TikTok 目标隐私选项');
              option.click();
            }
          }
          current.checkPrivacy=()=>target.test(selected(picker()));
          await wait(current.checkPrivacy,'TikTok 隐私设置确认');
          await trace('tiktok.privacy_verified',job.tiktokPrivacy==='public'?'已确认：所有人可见':'已确认：仅自己可见');
        }
        await trace('tiktok.photos_ready','已核对图片数量与描述，等待提交检查点');
        current.uploadPath=location.pathname;
        current.photoSources=all('img').filter(node=>visible(node)&&node.width>=80&&node.height>=80).map(node=>node.currentSrc||node.src);
      } else {
        if(!job.boardName.trim()) throw Error('请填写 Pinterest 画板名称');
        await upload('input[type="file"]');
        await trace('pinterest.title','等待 Pinterest 标题字段');
        await field(/^(Title|Add your title|标题|添加标题|简要描述你的\s*Pin\s*图)$/i,job.title);
        await trace('pinterest.description','等待 Pinterest 描述字段');
        await field(/^(Description|Add a description|Tell everyone(?: what your Pin is about)?|描述|说明|描述你的\s*Pin\s*图)[.…]*$/i,caption(job,false));
        if(job.altText) await pinterestAltText(job.altText);
        const boardPattern=/^(?:(?:Board|画板|图板)\s*)?(Choose a board|Select a board|选择画板|选择一块图板|选择图板|Board|画板|图板)$/i;
        const picker=await wait(()=>{
          const usable=node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true';
          // Once Pinterest remembers a board, its name replaces "Choose a board".
          // Use the observed stable control marker, then retain older-layout labels.
          const marked=unique(all('[data-test-id="board-dropdown-select-button"]').filter(usable),'Pinterest 图板入口');
          return marked || unique(all('button,[role="button"],[role="combobox"]').filter(node=>usable(node)&&boardPattern.test(name(node).trim())),'Pinterest 图板入口');
        },'Pinterest 图板入口');
        picker.click();
        let boardRoot=document;
        const matchBoard=()=>unique(all('button,[role="button"],[role="option"],[role="menuitem"]',boardRoot).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&name(node).trim()===job.boardName.trim()),'目标图板');
        const opened=await wait(()=>{
          const search=findField(/^(Search your boards|Search through your boards|通过你的图板搜索)$/i);
          if(search) return {search};
          const board=matchBoard();
          return board?{board}:null;
        },'图板搜索或目标图板');
        if(opened.search) {
          boardRoot=opened.search.closest('section,[role="dialog"],[role="listbox"]');
          if(!boardRoot) throw Error('无法确定图板搜索结果区域，已停止避免误选');
          await fill(opened.search,job.boardName.trim());
          await trace('pinterest.board_search','已搜索目标图板，等待匹配结果');
          await pause(700);
        }
        const board=await wait(()=>{
          const node=matchBoard();
          if(node) return node;
          if(boardRoot!==document&&/(未找到图板|No boards found|No results found)/i.test(boardRoot.textContent)) throw Error('Pinterest 未找到目标图板：'+job.boardName.trim()+'。请先创建该图板或修改草稿中的图板名称；未点击发布');
          return null;
        },'目标图板');board.click();
      }
      if(job.nativeScheduledAt && ['instagram','pinterest'].includes(job.platform)) {
        if(!await scheduleNative(job.nativeScheduledAt)) return {state:'local_scheduled',message:'当前发布页面没有可用的原生排程控件，已转为本地定时；尚未提交帖子'};
      }
      current.control=await wait(()=>finalButton(job.platform),'发布按钮');
      await wait(()=>!current.control.disabled&&current.control.getAttribute('aria-disabled')!=='true','发布按钮可用');
      if(success(job.platform)) throw Error('发现旧的发布成功提示，无法确认本次结果');
      current.prepared=true; current.files=[];return;
    }
    if(phase==='submit') {
      checkAccount();
      if(current.checkSchedule&&!current.checkSchedule()) throw Error('排程时间在提交前发生变化，已停止发布');
      if(current.checkPrivacy&&!current.checkPrivacy()) throw Error('TikTok 隐私设置在提交前发生变化，已停止发布');
      if(current.scheduleAt && Date.parse(current.scheduleAt)<=Date.now()+30000) throw Error('排程时间即将到达，已停止提交，请重新设置');
      if(!current.prepared||current.submitted) throw Error('禁止重复提交');
      const control=finalButton(job.platform);
      if(control!==current.control||!visible(control)||control.disabled||control.getAttribute('aria-disabled')==='true'||success(job.platform)) throw Error('提交前页面发生变化');
      await trace('submit.click',current.scheduleAt?'点击最终排程按钮':'点击最终发布按钮');
      let observed=false;
      const capture=()=>{if(success(job.platform)) observed=true;};
      const observer=new MutationObserver(records=>{
        if(observed) return;
        for(const record of records) {
          const nodes=record.type==='childList'?[...record.addedNodes]:[record.target];
          if(nodes.some(node=>{const root=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;return root&&success(job.platform,root);})) {observed=true;break;}
        }
      });
      if(['facebook','pinterest','tiktok'].includes(job.platform)) observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden']});
      try {
        current.submitted=true;control.click();capture();
        await trace('control.wait',current.scheduleAt?'等待：平台排程成功确认':'等待：平台发布成功确认');
        const deadline=Date.now()+45000;
        while(Date.now()<deadline) {
          if(observed||current.confirmedUrl||current.confirmedTikTok||success(job.platform)) {
            await trace('submit.success',current.confirmedUrl?'平台已返回本次发布的帖子链接':current.scheduleAt?'平台已确认排程：'+current.scheduleAt:'平台发布成功确认已出现');
            return {state:'succeeded',url:current.confirmedUrl||(job.platform==='facebook'?null:location.href)};
          }
          await pause(250);
        }
        await trace('submit.unconfirmed','已提交，结果待确认','warn');
        return {state:'uncertain',message:'已提交，结果待确认'};
      } finally {observer.disconnect();}
    }
    throw Error('未知任务阶段');
  };
})();
