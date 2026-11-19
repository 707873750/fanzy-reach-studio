// Injected into a dedicated Playwright page by the Python publisher.
(() => {
  if (globalThis.fanzyPublisher) return;
  let current = null;
  const hosts = {x:'x.com',instagram:'www.instagram.com',pinterest:'www.pinterest.com',tiktok:'www.tiktok.com'};
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
    if(platform==='tiktok') return all('[role="status"],[role="alert"],h1,h2,h3').some(node=>visible(node)&&/^(Your (?:post|photos) (?:has|have) been published|Post published|已发布|发布成功)[.!。！]?$/i.test(node.textContent.trim()));
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
      if(job.platform==='x') {
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
        if(job.xScheduledAt) await scheduleX(job.xScheduledAt);
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
        if(!imageInput()) {
          const photos=unique(all('button,[role="button"],[role="tab"]').filter(node=>visible(node)&&/^(Photos|Photo|Upload photos|图片|照片|上传照片|上传图片)$/i.test(name(node).trim())), 'TikTok 图片模式');
          if(photos) photos.click();
        }
        let input;
        try { input=await wait(imageInput,'TikTok 图片上传入口',15000); }
        catch { throw Error('当前 TikTok 网页端未提供可识别的图片上传入口。请确认登录并开启图片模式；仅支持视频时，请将准备好的图片通过 TikTok 手机端发布。未提交任何内容。'); }
        if(job.fileCount>1&&!input.multiple) throw Error('当前 TikTok 上传入口不支持多图轮播，未提交');
        input.setAttribute('data-fanzy-photo-input','true');
        await upload('input[data-fanzy-photo-input="true"]');
        // Require one visible local preview for every photo; unrelated remote avatars do not count.
        await wait(()=>all('img').filter(node=>visible(node)&&/^(blob:|data:image\/)/i.test(node.currentSrc||node.src)).length===job.fileCount,'TikTok 全部图片预览');
        if(job.title) await field(/^(Title|Add title|Add a title|标题|添加标题)$/i,job.title);
        const description=await wait(()=>findField(/^(Description|Caption|Add a description|描述|说明|添加描述|添加说明)[.…]*$/i),'TikTok 描述');
        await fill(description,caption(job,false));
        await wait(()=>description.isConnected&&(description.isContentEditable?description.innerText:description.value)===caption(job,false),'TikTok 描述填写确认');
        if(job.altText) {
          const fields=all('input,textarea').filter(node=>visible(node)&&/(Alt text|替代文本|替代文字)/i.test(name(node)));
          if(fields.length!==job.fileCount) throw Error('TikTok 替代文本字段不完整，请在平台确认后再发布');
          for(const node of fields) await fill(node,job.altText);
        }
        await trace('tiktok.photos_ready','已核对图片数量与描述，等待提交检查点');
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
      current.control=await wait(()=>finalButton(job.platform),'发布按钮');
      await wait(()=>!current.control.disabled&&current.control.getAttribute('aria-disabled')!=='true','发布按钮可用');
      if(success(job.platform)) throw Error('发现旧的发布成功提示，无法确认本次结果');
      current.prepared=true; current.files=[];return;
    }
    if(phase==='submit') {
      checkAccount();
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
      if(job.platform==='pinterest') observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden']});
      try {
        current.submitted=true;control.click();capture();
        await trace('control.wait',current.scheduleAt?'等待：X 排程成功确认':'等待：平台发布成功确认');
        const deadline=Date.now()+45000;
        while(Date.now()<deadline) {
          if(observed||current.confirmedUrl||success(job.platform)) {
            await trace('submit.success',current.confirmedUrl?'Pinterest 已返回本次创建的 Pin 链接':current.scheduleAt?'X 已确认排程：'+current.scheduleAt:'平台发布成功确认已出现');
            return {state:'succeeded',url:current.confirmedUrl||location.href};
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
