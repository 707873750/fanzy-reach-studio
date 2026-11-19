import { app, ipcMain } from "electron";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { log } from "./run-logger";

let publishing = false;
export function setPerformancePublishing(value: boolean) {publishing=value;}

export function startPerformanceMonitor() {
  const delay=monitorEventLoopDelay({resolution:20});delay.enable();
  let tick=0;
  const lastReport=new Map<number,number>();
  const onUi = (event: Electron.IpcMainInvokeEvent, input: unknown) => {
    const now=Date.now(), id=event.sender.id;
    if(now-(lastReport.get(id)||0)<4000 || !input || typeof input!=="object") return;
    lastReport.set(id,now);
    const source=input as Record<string,unknown>, sample: Record<string,number|boolean>={publishing,visible:source.visible===true,visibilityChanged:source.visibilityChanged===true};
    sample.longTaskSupported=source.longTaskSupported===true;sample.inputTimingSupported=source.inputTimingSupported===true;
    for(const key of ["windowMs","frameCount","frameMaxMs","frameP95Ms","timerMaxMs","longTaskCount","longTaskMaxMs","inputDelayMaxMs"]) {
      const value=source[key];if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>3600000) return;sample[key]=value;
    }
    const slow=sample.visible && !sample.visibilityChanged && (Number(sample.timerMaxMs)>150 || Number(sample.longTaskMaxMs)>150 || Number(sample.inputDelayMaxMs)>100 || Number(sample.frameMaxMs)>250);
    void log({source:"app",level:slow?"warn":"info",step:"performance.ui",message:slow?"界面检测到卡顿峰值，请结合主线程与 GPU 同时段记录判断":"界面响应采样：帧间隔 / 定时器延迟 / 长任务 / 输入等待",detail:JSON.stringify(sample)});
  };
  ipcMain.handle("performance:ui",onUi);
  const timer=setInterval(()=>{
    const maxMs=Math.round(delay.max/1e6),p95Ms=Math.round(delay.percentile(95)/1e6);
    delay.reset();tick++;
    if(!publishing && tick%6!==0 && maxMs<150) return;
    try {
      const processes=app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpuPercent:p.cpu.percentCPUUsage,workingSetMB:Math.round(p.memory.workingSetSize/1024)}));
      void log({source:"app",level:maxMs>150?"warn":"info",step:"performance.desktop",message:"桌面程序采样：主线程延迟及界面 / GPU 进程 CPU、内存（非 GPU 硬件利用率）",detail:JSON.stringify({publishing,mainLoopMaxMs:maxMs,mainLoopP95Ms:p95Ms,processes})});
    } catch { /* Monitoring must never interrupt publishing. */ }
  },5000);
  timer.unref();
  const gpuGone=(_event: Electron.Event, details: Electron.Details) => {
    if(details.type==="GPU") void log({source:"app",level:"warn",step:"performance.gpu_exit",message:"GPU 进程退出",detail:JSON.stringify({reason:details.reason,exitCode:details.exitCode})});
  };
  app.on("child-process-gone",gpuGone);
  void app.getGPUInfo("basic").then(info=>log({source:"app",level:"info",step:"performance.gpu_info",message:"GPU 驱动及硬件加速状态",detail:JSON.stringify({features:app.getGPUFeatureStatus(),info})})).catch(()=>{});
  return ()=>{clearInterval(timer);delay.disable();ipcMain.removeHandler("performance:ui");app.removeListener("child-process-gone",gpuGone);lastReport.clear();};
}
