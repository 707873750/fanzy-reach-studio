// Numeric aggregates only: never capture event targets, keystrokes or page content.
export function startUiPerformanceMonitor() {
  let frames: number[] = [], timerMax = 0, longCount = 0, longMax = 0, inputMax = 0;
  let lastFrame = 0, lastTimer = performance.now(), since = performance.now();
  let visibilityChanged = false, stopped = false, raf = 0;
  const observers: PerformanceObserver[] = [];
  const observe = (type: string, callback: (entries: PerformanceEntry[]) => void) => {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    const observer = new PerformanceObserver(list => { if (!document.hidden) callback(list.getEntries()); });
    observer.observe({type, buffered: false, ...(type === "event" ? {durationThreshold: 16} : {})});
    observers.push(observer);
  };
  observe("longtask", entries => { for (const e of entries) {longCount++;longMax=Math.max(longMax,e.duration);} });
  observe("event", entries => {for (const e of entries) { const timing = e as PerformanceEntry & {processingStart:number}; inputMax=Math.max(inputMax,timing.processingStart-e.startTime); }});
  const frame = (now: number) => {
    if (!document.hidden && lastFrame && frames.length < 2000) frames.push(now-lastFrame);
    lastFrame = document.hidden ? 0 : now;
    if (!stopped) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const timer = window.setInterval(() => {
    const now=performance.now();
    if (!document.hidden) timerMax=Math.max(timerMax,Math.max(0,now-lastTimer-100));
    lastTimer=now;
  },100);
  const visibility = () => { visibilityChanged=true;lastFrame=0;lastTimer=performance.now(); };
  document.addEventListener("visibilitychange",visibility);
  const report = window.setInterval(() => {
    const now=performance.now(), sorted=[...frames].sort((a,b)=>a-b);
    const sample = {
      visible:!document.hidden, visibilityChanged, windowMs:Math.round(now-since),
      longTaskSupported:PerformanceObserver.supportedEntryTypes.includes("longtask"),
      inputTimingSupported:PerformanceObserver.supportedEntryTypes.includes("event"),
      frameCount:frames.length, frameMaxMs:Math.round(sorted.at(-1)||0),
      frameP95Ms:Math.round(sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]||0),
      timerMaxMs:Math.round(timerMax),longTaskCount:longCount,longTaskMaxMs:Math.round(longMax),inputDelayMaxMs:Math.round(inputMax)
    };
    void window.reach?.reportUiPerformance?.(sample)?.catch(()=>{});
    frames=[];timerMax=longCount=longMax=inputMax=0;since=now;visibilityChanged=false;
  },5000);
  return () => {stopped=true;cancelAnimationFrame(raf);clearInterval(timer);clearInterval(report);observers.forEach(o=>o.disconnect());document.removeEventListener("visibilitychange",visibility);};
}
