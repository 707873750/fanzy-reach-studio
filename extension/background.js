// Jobs are leased once. Durable local markers prevent replay after worker restarts.
const URLS = {x:'https://x.com/compose/post',instagram:'https://www.instagram.com/',pinterest:'https://www.pinterest.com/pin-creation-tool/'};
let polling = false;
let executing = false;
let activeTrace = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state(status) { await chrome.storage.local.set({status}); }
function validConfig(config) {
  if (!config || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(config.url) || !/^[\w-]{40,100}$/.test(config.token)) throw Error('配对信息无效，请从桌面应用重新复制');
  return {url:config.url,token:config.token};
}
async function api(config, path, data = {}, timeout = 24000) {
  const {clientId} = await chrome.storage.local.get('clientId');
  const response = await fetch(config.url + path, {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.token,'X-Fanzy-Client':clientId},body:JSON.stringify(data),signal:AbortSignal.timeout(timeout),credentials:'omit',cache:'no-store'});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '本地服务连接失败');
  return result;
}
async function trace(config, job, step, message, level='info', detail, source='extension') {
  try { await api(config,'/log',{id:job.id,step,message,level,detail,source},2000); }
  catch { /* Logging failure must never change submission decisions. */ }
}
async function inject(tabId, phase, job, extra) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || new URL(tab.url).origin !== new URL(URLS[job.platform]).origin) throw Error('平台页面发生跳转，请检查登录或验证');
  const results = await chrome.scripting.executeScript({target:{tabId},func: async (phase, job, extra) => {
    try { return {ok:true,value:await globalThis.fanzyPublisher(phase,job,extra)}; }
    catch (error) { return {ok:false,error:error.message,detail:error.stack}; }
  },args:[phase,job,extra ?? null]});
  if (!results[0]?.result?.ok) { const error = Error(results[0]?.result?.error || '页面执行被中断'); error.pageStack = results[0]?.result?.detail; throw error; }
  return results[0].result.value;
}
async function execute(config, job) {
  executing = true;
  let submitted = false;
  let heartbeat;
  try {
    if (!URLS[job.platform] || !['login','publish'].includes(job.action)) throw Error('不支持的任务');
    await chrome.storage.local.set({activeJob:{id:job.id,submitted:false}});
    // Extension API activity keeps this finite (<3 min) operation alive in MV3.
    heartbeat = setInterval(() => { void chrome.storage.local.get('activeJob'); }, 15000);
    await trace(config,job,'tab.open','在已登录的浏览器中打开平台标签页');
    const tab = await chrome.tabs.create({url:'about:blank',active:true});
    activeTrace = {config,job,tabId:tab.id};
    await chrome.tabs.update(tab.id,{url:URLS[job.platform]});
    if (job.action === 'login') {
      await trace(config,job,'tab.opened','平台账号标签页已打开');
      await api(config,'/result',{id:job.id,state:'opened'});
      return;
    }
    await state('正在准备 '+job.platform+'；请勿操作发布标签页');
    const deadline = Date.now()+45000;
    while (true) {
      const loaded = await chrome.tabs.get(tab.id);
      if (loaded.status === 'complete' && loaded.url?.startsWith(URLS[job.platform])) break;
      if (Date.now()>deadline) throw Error('页面加载超时');
      await sleep(250);
    }
    await trace(config,job,'tab.loaded','平台页面加载完成，注入发布脚本');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    await inject(tab.id,'begin',job);
    for (let index=0;index<job.fileCount;index++) {
      await trace(config,job,'asset.request',`请求图片 ${index+1}/${job.fileCount}`);
      const asset = await api(config,'/asset',{id:job.id,index});
      await inject(tab.id,'asset',job,asset);
    }
    await trace(config,job,'page.prepare','开始适配平台页面、填写内容并上传图片');
    await inject(tab.id,'prepare',job);
    await trace(config,job,'page.ready','页面已准备好，等待桌面端提交许可');
    // Mark uncertain locally BEFORE asking the desktop for permission.
    submitted = true;
    await chrome.storage.local.set({activeJob:{id:job.id,submitted:true}});
    const permission = await api(config,'/checkpoint',{id:job.id});
    if (!permission.permit) throw Error('桌面端未允许提交');
    await trace(config,job,'submit.permitted',job.xScheduledAt?'已获得提交许可，即将提交 X 排程':'已获得提交许可，即将点击发布');
    const result = await inject(tab.id,'submit',job);
    await trace(config,job,'submit.confirmed',job.xScheduledAt?'已检测到 X 排程成功提示':'已检测到平台发布成功提示');
    await api(config,'/result',{id:job.id,state:'succeeded',url:result.url,message:job.xScheduledAt?'X 已确认定时排程：'+job.xScheduledAt+'。尚未实际发布；修改或取消请前往 X。':'Platform displayed its publication confirmation.'});
    await state((job.xScheduledAt?'排程已确认：':'发布已确认：')+job.platform);
  } catch (error) {
    await trace(config,job,'task.failed',error.message,'error',error.pageStack || error.stack);
    await state((submitted ? '结果待确认：' : '需要处理：')+error.message);
    try { await api(config,'/result',{id:job.id,state:submitted?'uncertain':'needs_attention',message:error.message}); }
    catch { /* Parent timeout remains conservative; never retry submission. */ }
  } finally {
    clearInterval(heartbeat);
    await chrome.storage.local.remove('activeJob');
    activeTrace = null;
    executing = false;
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    let {config,activeJob} = await chrome.storage.local.get(['config','activeJob']);
    if (!config) return;
    if (activeJob) {
      // An interrupted worker must report, never replay, its previous job.
      try { await api(config,'/result',{id:activeJob.id,state:activeJob.submitted?'uncertain':'needs_attention',message:'Browser extension restarted during the task. Inspect the platform before retrying.'}); } catch {}
      await chrome.storage.local.remove('activeJob');
    }
    // An alarm wakes polling again; each fetch finishes within Chrome's limit.
    for (let count=0;count<3;count++) {
      const saved = await chrome.storage.local.get('config');
      if (!saved.config || saved.config.token !== config.token) return;
      const result = await api(config,'/poll',{xNativeSchedule:true});
      const latest = await chrome.storage.local.get('config');
      if (!latest.config || latest.config.token !== config.token) return;
      if (result.job) await execute(config,result.job);
    }
  } catch (error) { await state('未连接：'+error.message); }
  finally { polling = false; }
}
chrome.alarms.onAlarm.addListener(() => { void poll(); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create('poll',{periodInMinutes:0.5}); void poll(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('poll',{periodInMinutes:0.5}); void poll(); });
chrome.runtime.onMessage.addListener((message,_sender,respond) => {
  if (message.action === 'trace') {
    if (!activeTrace || _sender.tab?.id !== activeTrace.tabId || message.jobId !== activeTrace.job.id) { respond({ok:false}); return; }
    void trace(activeTrace.config,activeTrace.job,String(message.step).slice(0,100),String(message.message).slice(0,2000),message.level,message.detail,'page').then(()=>respond({ok:true}));
    return true;
  }
  if (!['pair','disconnect'].includes(message.action)) return;
  void (async () => {
    if (executing) throw Error('发布任务执行中，请等待结束后切换连接');
    if (message.action === 'disconnect') {
      await chrome.storage.local.remove('config');
      await state('已断开');
    } else {
      const config = validConfig(message.config);
      const saved = await chrome.storage.local.get('clientId');
      if (!saved.clientId) await chrome.storage.local.set({clientId:crypto.randomUUID()});
      await api(config,'/pair');
      await chrome.storage.local.set({config});
      await state('已配对，使用当前浏览器的登录状态');
      await chrome.alarms.create('poll',{periodInMinutes:0.5});
      void poll();
    }
    respond({ok:true});
  })().catch(error => respond({ok:false,error:error.message}));
  return true;
});
