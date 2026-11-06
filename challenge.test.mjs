import test from 'node:test';
import assert from 'node:assert/strict';
import {createChallenge, stepChallenge, challengeRank} from './dist/challenge.js';
const flight = {speed: 240, agl: 80};
const advance = (run, seconds, input = flight, hz = 60, timed = true) => {
  for (let n = 0; n < Math.round(seconds * hz); n++) stepChallenge(run, input, 1 / hz, timed);
  return run;
};
test('unsafe, slow and grounded flight never earn low-pass points', () => {
  for (const input of [{...flight,agl:14},{...flight,agl:151},{...flight,speed:179},{...flight,grounded:true},{...flight,crashed:true}]) {
    assert.equal(advance(createChallenge(), 3, input).score, 0);
  }
});
test('sustained low flight builds a capped multiplier; short pull-up preserves it', () => {
  const run = advance(createChallenge(), 18.1);
  assert.equal(run.multiplier, 4);
  advance(run, 1, {...flight, agl:170});
  assert.equal(run.multiplier, 4);
  advance(run, .6, {...flight, agl:170});
  assert.equal(run.multiplier, 1);
  assert.equal(run.bestMultiplier, 4);
});
test('timed run stops exactly at 90 seconds without awarding extra-frame points', () => {
  const run = advance(createChallenge(), 89.9);
  stepChallenge(run, flight, .2);
  assert.ok(Math.abs(run.elapsed - 90) < 1e-6);
  assert.equal(run.complete, true);
  const score = run.score;
  stepChallenge(run, flight, 1);
  assert.equal(run.score, score);
});
test('free flight has no imposed time limit and a new run has no previous combo', () => {
  const run = advance(createChallenge(), 100, flight, 60, false);
  assert.equal(run.complete, false);
  assert.equal(createChallenge().multiplier, 1);
});
test('score remains consistent at representative simulation rates', () => {
  const scores = [30,60,120].map(hz => advance(createChallenge(), 35, flight, hz).score);
  assert.ok(Math.max(...scores)-Math.min(...scores)<5);
  assert.equal(challengeRank(5000), '王牌飞行员');
});
