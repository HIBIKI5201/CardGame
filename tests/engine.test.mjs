import * as G from '../js/game.js';
import assert from 'node:assert/strict';

const cfg = G.normalizeConfig({});
// 得点の例（rules.md）: _ 2 _ 4 _ _ _ _ 9 _ _ _ K
const b = Array(13).fill(null);
for (const r of [2, 4, 9, 13]) b[r - 1] = { rank: r };
assert.equal(G.scoreFor(b, 0, cfg), 2);  // A
assert.equal(G.scoreFor(b, 5, cfg), 4);  // 6
assert.equal(G.scoreFor(b, 10, cfg), 7); // J

let games = 0, stats = { full: 0, deck: 0, draw: 0 };
for (let n = 0; n < 3000; n++) {
  let m = G.newMatch({ handSize: 1 + (n % 6), jokers: n % 9 }, ['a', 'b']);
  let steps = 0;
  while (!m.over && steps++ < 5000) {
    if (m.choice) { m = G.applyMatchAction(m, m.choice.chooser, { type: 'chooseOrder', first: Math.random() < .5 }).match; continue; }
    const g = m.game;
    if (g.over) { m = G.applyMatchAction(m, 0, { type: 'next' }).match; games++; stats[g.endReason]++; continue; }
    const p = g.turn;
    const total = g.deck.length + g.hands[0].length + g.hands[1].length + g.board.filter(Boolean).length + g.removed;
    assert.equal(total, 52 + g.cfg.jokers, 'card conservation');
    const acts = [];
    for (const c of g.hands[p]) for (const t of G.targetsFor(g, c)) acts.push({ type: 'place', cardId: c.id, slot: t.slot });
    if (G.canExchange(g, p) && Math.random() < .2) acts.length = 0, acts.push({ type: 'exchange', cardId: g.hands[p][0].id });
    if (G.canPass(g, p)) acts.push({ type: 'pass' });
    if (G.canRedraw(g, p)) acts.push({ type: 'redraw' }, { type: 'redraw' });
    assert.ok(acts.length > 0, 'player must have some action');
    // illegal: pass while placeable
    if (G.hasPlaceable(g, p)) assert.equal(G.applyMatchAction(m, p, { type: 'pass' }).ok, false);
    // illegal: wrong player
    assert.equal(G.applyMatchAction(m, 1 - p, acts[0]).ok, false);
    const a = acts[Math.floor(Math.random() * acts.length)];
    const r = G.applyMatchAction(m, p, a);
    assert.ok(r.ok, JSON.stringify(a) + ' ' + r.error);
    m = r.match;
    const v = G.viewOf(m);
    if (v.game) assert.equal(v.game.deck, undefined);
  }
  assert.ok(m.over, 'match should finish');
}
console.log('ok', games, 'games', stats);
