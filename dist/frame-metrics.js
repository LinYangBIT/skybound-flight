// Optional, local-only QA counters. No telemetry is transmitted or persisted.
// RAF intervals include scheduling; CPU submission timing is not GPU time.
export function createFrameMetrics(canvas, renderer) {
  if (!new URLSearchParams(location.search).has('qa')) return null;
  renderer.info.autoReset = false;
  let current = '', started = 0, previous = 0, samples = [], cpu = [], calls = [], triangles = [];
  const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)] || 0;
  return {
    begin() { renderer.info.reset(); return performance.now(); },
    end(now, cpuStart, phase) {
      if (phase !== current || document.hidden) { current=phase; started=now; previous=0; samples=[]; cpu=[]; calls=[]; triangles=[]; }
      if (now-started>1500 && previous) {
        samples.push(now-previous); cpu.push(performance.now()-cpuStart);
        calls.push(renderer.info.render.calls); triangles.push(renderer.info.render.triangles);
      }
      previous=now;
      if(now-started>=11500 && samples.length) {
        canvas.dataset.frameStats=JSON.stringify({phase,width:canvas.width,height:canvas.height,frames:samples.length,
          rafMedianMs:percentile(samples,.5),rafP95Ms:percentile(samples,.95),over33msPercent:100*samples.filter(x=>x>33).length/samples.length,
          cpuSubmitMedianMs:percentile(cpu,.5),cpuSubmitP95Ms:percentile(cpu,.95),drawCalls:percentile(calls,.5),triangles:percentile(triangles,.5)});
        started=now; samples=[]; cpu=[]; calls=[]; triangles=[];
      }
    }
  };
}
