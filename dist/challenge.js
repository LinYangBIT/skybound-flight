// Pure scoring rules shared by timed sorties and free flight. Units: m, m/s, s.
export const CHALLENGE_SECONDS = 90;
export function createChallenge() {
  return { elapsed: 0, score: 0, lowTime: 0, chainTime: 0, grace: 0, multiplier: 1, bestMultiplier: 1, active: false, complete: false };
}
export function stepChallenge(run, { speed, agl, grounded = false, crashed = false }, dt, timed = true) {
  if (run.complete || crashed || !Number.isFinite(dt) || dt <= 0) return run;
  const elapsed = timed ? Math.min(dt, Math.max(0, CHALLENGE_SECONDS - run.elapsed)) : dt;
  run.elapsed += elapsed;
  run.active = !grounded && speed >= 180 && agl >= 15 && agl <= 150;
  if (run.active) {
    run.chainTime += elapsed;
    run.grace = 1.5;
    run.multiplier = Math.min(4, 1 + Math.floor((run.chainTime + 1e-6) / 6));
    run.bestMultiplier = Math.max(run.bestMultiplier, run.multiplier);
    run.lowTime += elapsed;
    run.score += elapsed * (speed / 18) * (1 + (150 - agl) / 120) * run.multiplier;
  } else {
    run.grace = Math.max(0, run.grace - elapsed);
    if (!run.grace) { run.chainTime = 0; run.multiplier = 1; }
  }
  run.complete = timed && run.elapsed >= CHALLENGE_SECONDS - 1e-7;
  return run;
}
export function challengeRank(score) {
  return score >= 5000 ? '王牌飞行员' : score >= 2500 ? '精英飞行员' : score >= 1000 ? '熟练飞行员' : '新锐飞行员';
}
