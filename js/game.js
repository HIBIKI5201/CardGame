// ゲームエンジン（純粋ロジック）。ホスト／ローカルで状態を持ち、ゲストは表示用ビューのみ受け取る。

export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export const SLOTS = 13;

export const DEFAULT_CONFIG = {
  handSize: 4,
  jokers: 4,
  ptEdge: 2,
  ptDiff: 4,
  ptSame: 7,
  exchangeCost: 2,
  winsNeeded: 2,
};

const LIMITS = {
  handSize: [1, 8],
  jokers: [0, 8],
  ptEdge: [0, 99],
  ptDiff: [0, 99],
  ptSame: [0, 99],
  exchangeCost: [0, 99],
  winsNeeded: [1, 5],
};

export function normalizeConfig(c = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    let v = parseInt(c[k], 10);
    if (Number.isNaN(v)) v = DEFAULT_CONFIG[k];
    const [lo, hi] = LIMITS[k];
    out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function cardLabel(c) {
  if (!c) return '';
  return c.rank === 0 ? 'ジョーカー' : RANK_LABELS[c.rank - 1] + SUITS[c.suit];
}

export function deckCount(g) {
  return g.deck ? g.deck.length : g.deckCount;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck(cfg) {
  const cards = [];
  let id = 0;
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) cards.push({ id: id++, rank: r, suit: s });
  for (let j = 0; j < cfg.jokers; j++) cards.push({ id: id++, rank: 0, suit: -1 });
  return cards;
}

function draw(g, p, n) {
  const got = [];
  for (let i = 0; i < n && g.deck.length > 0; i++) {
    const c = g.deck.pop();
    g.hands[p].push(c);
    got.push(c);
  }
  return got;
}

function log(g, p, msg) {
  g.log.push({ p, msg });
  if (g.log.length > 200) g.log.shift();
}

export function newGame(cfg, first, rng = Math.random) {
  const deck = shuffle(createDeck(cfg), rng);
  const g = {
    cfg,
    board: Array(SLOTS).fill(null),
    deck,
    hands: [[], []],
    scores: [0, 0],
    turn: first,
    first,
    exchanged: false,
    over: false,
    winner: null,
    endReason: null,
    removed: 0,
    last: null,
    log: [],
  };
  // 1. 各プレイヤーが手札を引く
  for (let i = 0; i < cfg.handSize; i++) {
    draw(g, 0, 1);
    draw(g, 1, 1);
  }
  // 2. 1枚めくって場に置く（ジョーカーなら山札の一番下へ戻して引き直す）
  for (let guard = 0; guard <= g.deck.length && g.deck.length > 0; guard++) {
    const c = g.deck.pop();
    if (c.rank !== 0) {
      g.board[c.rank - 1] = c;
      g.last = c.rank - 1;
      log(g, null, `最初のカード：${cardLabel(c)}`);
      break;
    }
    g.deck.unshift(c);
  }
  return g;
}

// その枠に置いたときの得点
export function scoreFor(board, slot, cfg) {
  let l = -1;
  for (let i = slot - 1; i >= 0; i--) if (board[i]) { l = i; break; }
  let r = -1;
  for (let i = slot + 1; i < SLOTS; i++) if (board[i]) { r = i; break; }
  if (l < 0 || r < 0) return cfg.ptEdge;
  const gapL = slot - l - 1;
  const gapR = r - slot - 1;
  return gapL === gapR ? cfg.ptSame : cfg.ptDiff;
}

// カードを置ける／奪取できる枠の一覧
export function targetsFor(g, card) {
  const out = [];
  if (!card) return out;
  if (card.rank === 0) {
    for (let i = 0; i < SLOTS; i++) {
      if (!g.board[i]) out.push({ slot: i, kind: 'place', pts: scoreFor(g.board, i, g.cfg) });
    }
  } else {
    const i = card.rank - 1;
    const b = g.board[i];
    if (!b) out.push({ slot: i, kind: 'place', pts: scoreFor(g.board, i, g.cfg) });
    else if (b.rank === 0) out.push({ slot: i, kind: 'swap', pts: 0 });
  }
  return out;
}

export function canPlaceCard(g, card) {
  return targetsFor(g, card).some((t) => t.kind === 'place');
}

export function hasPlaceable(g, p) {
  return g.hands[p].some((c) => canPlaceCard(g, c));
}

export function hasSwap(g, p) {
  return g.hands[p].some((c) => targetsFor(g, c).some((t) => t.kind === 'swap'));
}

export function canExchange(g, p) {
  return !g.over && g.turn === p && !g.exchanged && g.scores[p] >= g.cfg.exchangeCost && deckCount(g) > 0;
}

export function canPass(g, p) {
  return !g.over && g.turn === p && !hasPlaceable(g, p);
}

export function canRedraw(g, p) {
  return canPass(g, p) && !g.exchanged && deckCount(g) > 0;
}

function finish(g, reason) {
  g.over = true;
  g.endReason = reason;
  const [a, b] = g.scores;
  g.winner = a === b ? 'draw' : a > b ? 0 : 1;
  log(g, null, reason === 'full' ? '場がすべて埋まりました。ゲーム終了' : '山札が尽きました。ゲーム終了');
}

function endTurn(g) {
  if (g.over) return;
  if (g.deck.length === 0) {
    finish(g, 'deck');
    return;
  }
  g.turn = 1 - g.turn;
  g.exchanged = false;
}

function takeFromHand(g, p, cardId) {
  const idx = g.hands[p].findIndex((c) => c.id === cardId);
  if (idx < 0) return null;
  return g.hands[p].splice(idx, 1)[0];
}

// ゲーム内アクション。成功なら {ok:true, game}、失敗なら {ok:false, error}
export function applyGameAction(g0, p, a) {
  if (g0.over) return { ok: false, error: 'ゲームは終了しています' };
  if (g0.turn !== p) return { ok: false, error: 'あなたの手番ではありません' };
  const g = structuredClone(g0);
  const hand = g.hands[p];

  switch (a.type) {
    case 'exchange': {
      if (!canExchange(g, p)) return { ok: false, error: '交換できません' };
      const c = takeFromHand(g, p, a.cardId);
      if (!c) return { ok: false, error: 'そのカードは手札にありません' };
      g.scores[p] -= g.cfg.exchangeCost;
      g.removed++;
      g.exchanged = true;
      const [nc] = draw(g, p, 1);
      log(g, p, `${cardLabel(c)} を捨てて交換（−${g.cfg.exchangeCost}点）→ ${cardLabel(nc)} を引いた`);
      if (!hasPlaceable(g, p) && !hasSwap(g, p)) {
        log(g, p, '置けるカードがないため手番終了');
        endTurn(g);
      }
      return { ok: true, game: g };
    }
    case 'place': {
      const card = hand.find((c) => c.id === a.cardId);
      if (!card) return { ok: false, error: 'そのカードは手札にありません' };
      const t = targetsFor(g, card).find((x) => x.slot === a.slot);
      if (!t) return { ok: false, error: 'その枠には置けません' };
      takeFromHand(g, p, card.id);
      if (t.kind === 'swap') {
        const joker = g.board[t.slot];
        g.board[t.slot] = card;
        hand.push(joker);
        g.last = t.slot;
        log(g, p, `${cardLabel(card)} でジョーカーを奪取（得点なし・補充なし）`);
        endTurn(g);
        return { ok: true, game: g };
      }
      g.board[t.slot] = card;
      g.scores[p] += t.pts;
      g.last = t.slot;
      const where = card.rank === 0 ? `${RANK_LABELS[t.slot]}の枠に ` : '';
      log(g, p, `${where}${cardLabel(card)} を置いた（+${t.pts}点）`);
      if (g.board.every(Boolean)) {
        finish(g, 'full');
        return { ok: true, game: g };
      }
      draw(g, p, g.cfg.handSize - hand.length);
      endTurn(g);
      return { ok: true, game: g };
    }
    case 'pass': {
      if (!canPass(g, p)) return { ok: false, error: '置けるカードがあるときはパスできません' };
      log(g, p, 'パス');
      endTurn(g);
      return { ok: true, game: g };
    }
    case 'redraw': {
      if (!canRedraw(g, p)) return { ok: false, error: '引き直しはできません' };
      g.removed += hand.length;
      hand.length = 0;
      draw(g, p, g.cfg.handSize);
      log(g, p, '手札をすべて捨てて引き直した');
      endTurn(g);
      return { ok: true, game: g };
    }
    default:
      return { ok: false, error: '不明なアクション' };
  }
}

// ===== マッチ（N本先取）=====

export function newMatch(cfg, names, rng = Math.random) {
  const m = {
    cfg: normalizeConfig(cfg),
    names: [...names],
    wins: [0, 0],
    draws: 0,
    gameNo: 0,
    history: [],
    game: null,
    choice: null,
    over: false,
    matchWinner: null,
  };
  prepareNext(m, rng);
  return m;
}

function startGame(m, first, rng) {
  m.gameNo++;
  m.choice = null;
  m.game = newGame(m.cfg, first, rng);
}

function prepareNext(m, rng) {
  const last = m.history[m.history.length - 1];
  if (!last || last === 'draw') {
    // コイントス
    startGame(m, rng() < 0.5 ? 0 : 1, rng);
  } else {
    // 前のゲームで負けた人が先手・後手を選ぶ
    m.choice = { chooser: 1 - last };
  }
}

export function applyMatchAction(m0, p, a, rng = Math.random) {
  const m = structuredClone(m0);
  switch (a.type) {
    case 'chooseOrder': {
      if (!m.choice || m.choice.chooser !== p) return { ok: false, error: '選択権がありません' };
      startGame(m, a.first ? p : 1 - p, rng);
      return { ok: true, match: m };
    }
    case 'next': {
      if (!m.game || !m.game.over || m.over || m.choice) return { ok: false, error: 'まだ次のゲームへ進めません' };
      prepareNext(m, rng);
      return { ok: true, match: m };
    }
    case 'rematch': {
      if (!m.over) return { ok: false, error: 'マッチは終わっていません' };
      return { ok: true, match: newMatch(m.cfg, m.names, rng) };
    }
    default: {
      if (!m.game || m.choice) return { ok: false, error: 'ゲームが始まっていません' };
      const r = applyGameAction(m.game, p, a);
      if (!r.ok) return r;
      m.game = r.game;
      if (m.game.over) {
        const w = m.game.winner;
        m.history.push(w);
        if (w === 'draw') m.draws++;
        else {
          m.wins[w]++;
          if (m.wins[w] >= m.cfg.winsNeeded) {
            m.over = true;
            m.matchWinner = w;
          }
        }
      }
      return { ok: true, match: m };
    }
  }
}

// ゲストに送るビュー（山札の中身は隠す）
export function viewOf(m) {
  const v = structuredClone(m);
  if (v.game) {
    v.game.deckCount = v.game.deck.length;
    delete v.game.deck;
  }
  return v;
}
