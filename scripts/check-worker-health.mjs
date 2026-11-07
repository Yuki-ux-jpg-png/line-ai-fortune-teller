const base=process.env.APP_BASE_URL;
if(!base)throw new Error('APP_BASE_URL is required');
try {
 const r=await fetch(new URL('/health/worker',base),{signal:AbortSignal.timeout(15000)});
 const health=await r.json();
 if(!r.ok||health.ok!==true)throw new Error('Worker health check failed');
 console.log('JP worker health: healthy');
} catch {console.error('JP worker health is unhealthy or unreachable; inspect heartbeat and unheld queue.');process.exitCode=1;}
