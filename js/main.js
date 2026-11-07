import * as G from './game.js';
import { hostRoom, joinRoom, makeRoomCode } from './net.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

// ===== ストレージ（失敗しても動くように） =====
const store = {
  get(k, s = localStorage) {
    try { return JSON.parse(s.getItem(k)); } catch (e) { return null; }
  },
  set(k, v, s = localStorage) {
    try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  },
  del(k, s = localStorage) {
    try { s.removeItem(k); } catch (e) { /* ignore */ }
  },
};
const SS = (() => { try { return sessionStorage; } catch (e) { return undefined; } })();

const app = {
  screen: 'lobby', // lobby | wait | game
  mode: null, // local | host | guest
  me: 0,
  match: null,
  net: null,
  code: null,
  sel: null,
  peerStatus: '',
  online: false,
  cfg: G.normalizeConfig(store.get('ocg-cfg') || {}),
  name: store.get('ocg-name') || '',
  inviteCode: '',
};

// ===== ユーティリティ =====
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (s, fb) => (String(s ?? '').trim().slice(0, 12) || fb);

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

function shareUrl(code) {
  return `${location.origin}${location.pathname}#join=${code}`;
}

// ===== 画面描画 =====
function render() {
  if (app.screen === 'lobby') $app.innerHTML = renderLobby();
  else if (app.screen === 'wait') $app.innerHTML = renderWait();
  else $app.innerHTML = renderGame();
}

const CFG_FIELDS = [
  ['handSize', '手札の枚数'],
  ['jokers', 'ジョーカーの枚数'],
  ['ptEdge', '得点：片側のみ'],
  ['ptDiff', '得点：両側・空き数が違う'],
  ['ptSame', '得点：両側・空き数が同じ'],
  ['exchangeCost', '交換コスト'],
  ['winsNeeded', '先取勝利数'],
];

function renderLobby() {
  const invite = app.inviteCode
    ? `<section class="panel invite">
        <h2>部屋 <span class="code">${esc(app.inviteCode)}</span> に招待されています</h2>
        <button class="primary big" data-act="join-invite">参加する</button>
      </section>`
    : '';
  const cfgInputs = CFG_FIELDS.map(([k, label]) => `
    <label class="cfg"><span>${label}</span>
      <input type="number" inputmode="numeric" data-cfg="${k}" value="${app.cfg[k]}"></label>`).join('');
  return `
  <header class="top"><h1>13枠カードゲーム</h1></header>
  <main class="lobby">
    <section class="panel">
      <label class="field"><span>あなたの名前</span>
        <input id="name" maxlength="12" placeholder="名前" value="${esc(app.name)}"></label>
    </section>
    ${invite}
    <section class="panel">
      <h2>オンライン対戦</h2>
      <p class="muted">部屋を作って URL を相手に送るだけ。ブラウザ同士が直接つながるので、サーバー代はかかりません。</p>
      <button class="primary" data-act="host">部屋を作る</button>
      <div class="row">
        <input id="joincode" maxlength="6" placeholder="部屋コード" autocapitalize="characters" value="">
        <button data-act="join">参加</button>
      </div>
    </section>
    <section class="panel">
      <h2>ローカル対戦</h2>
      <p class="muted">1台の端末を2人で交代して遊びます。</p>
      <button data-act="local">はじめる</button>
    </section>
    <details class="panel">
      <summary>ルール設定（部屋を作る人・ローカル用）</summary>
      <div class="cfg-grid">${cfgInputs}</div>
      <button class="ghost small" data-act="cfg-reset">初期値に戻す</button>
    </details>
    <details class="panel rules">
      <summary>ルール</summary>
      ${RULES_HTML}
    </details>
  </main>`;
}

const RULES_HTML = `
<ul>
  <li>56枚（4スート×A〜K＋ジョーカー4枚）。スートは関係ありません。</li>
  <li>場は A〜K の13枠。通常のカードは同じランクの枠にだけ置けます。ジョーカーは空いている枠ならどこでも。</li>
  <li>各自4枚ずつ手札。山札から1枚めくって場に置いてスタート。手札は相手に公開です。</li>
  <li>手番：①（任意）2点払って1枚交換 → ②置けるカードがあれば必ず1枚置く → ③4枚まで補充。</li>
  <li>置けるカードがないときは、パスするか、手札を全部捨てて引き直し（その手番は置けません）。</li>
  <li>得点：置いた枠の左右の一番近いカードを見て、片側しかない＝2点、両側あり空き数が違う＝4点、同じ＝7点。</li>
  <li>場のジョーカーと同じランクのカードを持っていれば入れ替えて奪取できます（得点なし・補充なし・手番終了）。</li>
  <li>場がすべて埋まるか山札が尽きたら終了。得点が多い方の勝ち。3本勝負（2勝で勝利）、負けた人が次の先手・後手を選びます。</li>
</ul>`;

function renderWait() {
  const isHost = app.mode === 'host';
  const body = isHost
    ? `<h2>部屋コード <span class="code">${esc(app.code)}</span></h2>
       <p>この URL を相手に送ってください。</p>
       <div class="row"><input id="shareurl" readonly value="${esc(shareUrl(app.code))}">
         <button data-act="copy">コピー</button></div>`
    : `<h2>部屋 <span class="code">${esc(app.code)}</span> に接続中</h2>`;
  return `
  <header class="top"><h1>13枠カードゲーム</h1></header>
  <main class="lobby">
    <section class="panel">
      ${body}
      <p class="status"><span class="spinner"></span>${esc(app.peerStatus || '準備中…')}</p>
      <button class="ghost" data-act="leave">やめる</button>
    </section>
  </main>`;
}

function cardFace(c, cls = '') {
  if (c.rank === 0) {
    return `<span class="face joker ${cls}"><span class="r">JK</span><span class="s">★</span></span>`;
  }
  const red = c.suit === 1 || c.suit === 2 ? 'red' : '';
  return `<span class="face ${red} ${cls}"><span class="r">${G.RANK_LABELS[c.rank - 1]}</span><span class="s">${G.SUITS[c.suit]}</span></span>`;
}

function renderGame() {
  const m = app.match;
  const g = m.game;
  const local = app.mode === 'local';
  const bottom = local ? 0 : app.me;
  const top = 1 - bottom;
  const active = g && !g.over && !m.choice ? g.turn : null;
  const canAct = (p) => active === p && (local || p === app.me);
  const actor = active !== null && canAct(active) ? active : null;

  let selCard = actor !== null ? g.hands[actor].find((c) => c.id === app.sel) : null;
  if (!selCard) app.sel = null;
  const targets = new Map((selCard ? G.targetsFor(g, selCard) : []).map((t) => [t.slot, t]));

  const nameOf = (p) => esc(m.names[p]);
  const you = (p) => (!local && p === app.me ? '<span class="you">あなた</span>' : '');

  const playerPanel = (p, pos) => {
    const clickable = canAct(p);
    const cards = g.hands[p].map((c) => {
      const playable = active === p && G.targetsFor(g, c).length > 0;
      const cls = ['card', playable ? 'ok' : '', app.sel === c.id && clickable ? 'sel' : ''].join(' ');
      return `<button class="${cls}" data-card="${c.id}" ${clickable ? '' : 'disabled'} aria-label="${esc(G.cardLabel(c))}">${cardFace(c)}</button>`;
    }).join('');
    const dots = Array.from({ length: m.cfg.winsNeeded }, (_, i) => `<i class="${i < m.wins[p] ? 'on' : ''}"></i>`).join('');
    return `
    <section class="player ${pos} ${active === p ? 'active' : ''}">
      <div class="pinfo">
        <span class="pname">${nameOf(p)}</span>${you(p)}
        <span class="wins" title="勝利数">${dots}</span>
        ${active === p ? '<span class="turn-badge">手番</span>' : ''}
        <span class="pscore">${g.scores[p]}<small>点</small></span>
      </div>
      <div class="hand">${cards || '<span class="muted">手札なし</span>'}</div>
    </section>`;
  };

  const slots = g.board.map((c, i) => {
    const t = targets.get(i);
    const cls = ['slot', t ? `target ${t.kind}` : '', g.last === i ? 'last' : '', c ? 'filled' : ''].join(' ');
    const badge = t ? `<span class="badge">${t.kind === 'swap' ? '奪取' : '+' + t.pts}</span>` : '';
    return `<button class="${cls}" data-slot="${i}" ${t ? '' : 'tabindex="-1"'} aria-label="${G.RANK_LABELS[i]}の枠">
      <span class="slot-label">${G.RANK_LABELS[i]}</span>
      ${c ? cardFace(c, 'mini') : '<span class="empty"></span>'}
      ${badge}
    </button>`;
  }).join('');

  // ---- 操作エリア ----
  let hint = '';
  let buttons = '';
  if (active !== null) {
    if (actor === null) {
      hint = `${nameOf(active)} の手番です`;
    } else {
      const prefix = local ? `<b>${nameOf(actor)}</b> の手番：` : '';
      const placeable = G.hasPlaceable(g, actor);
      if (placeable) {
        if (selCard) hint = targets.size ? '光っている枠をタップして置きます' : 'このカードは今は置けません';
        else hint = '置くカードを選んでください（置けるカードがあるので必ず1枚置きます）';
      } else if (G.hasSwap(g, actor)) {
        hint = '置けるカードはありません。ジョーカーの奪取・パス・引き直しから選べます';
      } else {
        hint = '置けるカードがありません。交換・パス・引き直しから選んでください';
      }
      hint = prefix + hint;
      const canEx = G.canExchange(g, actor);
      let exLabel = `選んだカードを交換（−${g.cfg.exchangeCost}点）`;
      if (g.exchanged) exLabel = 'この手番は交換済み';
      else if (g.scores[actor] < g.cfg.exchangeCost) exLabel = `交換（${g.cfg.exchangeCost}点必要）`;
      buttons = `
        <button data-act="exchange" ${canEx && selCard ? '' : 'disabled'}>${exLabel}</button>
        <button data-act="pass" ${G.canPass(g, actor) ? '' : 'disabled'}>パス</button>
        <button data-act="redraw" ${G.canRedraw(g, actor) ? '' : 'disabled'}>手札を全部引き直す</button>`;
    }
  }

  // ---- 結果／先手選択シート ----
  let sheet = '';
  if (m.choice) {
    const ch = m.choice.chooser;
    const mine = local || ch === app.me;
    sheet = mine
      ? `<h2>${nameOf(ch)} さん、先手・後手を選んでください</h2>
         <div class="btns"><button class="primary" data-act="first">先手</button><button data-act="second">後手</button></div>`
      : `<h2>${nameOf(ch)} さんが先手・後手を選んでいます…</h2>`;
  } else if (g.over) {
    const w = g.winner;
    const head = w === 'draw' ? '引き分け' : `${nameOf(w)} の勝ち！`;
    const reason = g.endReason === 'full' ? '場がすべて埋まりました' : '山札が尽きました';
    const score = `${nameOf(0)} ${g.scores[0]} 点 − ${g.scores[1]} 点 ${nameOf(1)}`;
    const wins = `マッチ：${m.wins[0]} − ${m.wins[1]}${m.draws ? `（引き分け ${m.draws}）` : ''}`;
    sheet = m.over
      ? `<p class="muted">${reason}</p><h2>${head}</h2><p>${score}</p>
         <h2 class="match-win">🏆 ${nameOf(m.matchWinner)} がマッチに勝利！</h2><p>${wins}</p>
         <div class="btns"><button class="primary" data-act="rematch">もう一度マッチ</button></div>`
      : `<p class="muted">${reason}</p><h2>${head}</h2><p>${score}</p><p>${wins}</p>
         <div class="btns"><button class="primary" data-act="next">次のゲームへ</button></div>`;
  }

  const logItems = g.log.slice().reverse().map((e) =>
    `<li>${e.p === null ? '' : `<b>${nameOf(e.p)}</b> `}${esc(e.msg)}</li>`).join('');

  let conn = '';
  if (app.mode === 'host' || app.mode === 'guest') {
    conn = `<span class="conn ${app.online ? 'on' : 'off'}">${app.online ? '接続中' : '切断中'}</span>`;
  }

  return `
  <header class="top game-top">
    <h1>13枠カードゲーム</h1>
    <span class="gameno">第${m.gameNo}戦 · ${m.cfg.winsNeeded}本先取</span>
    ${conn}
    <button class="ghost small" data-act="leave">退出</button>
  </header>
  <main class="table">
    ${playerPanel(top, 'opp')}
    <section class="board-wrap">
      <div class="board">${slots}</div>
      <div class="meta">山札 <b>${G.deckCount(g)}</b> 枚 · 除外 ${g.removed} 枚</div>
    </section>
    ${playerPanel(bottom, 'self')}
    <section class="controls">
      <p class="hint">${hint}</p>
      <div class="btns">${buttons}</div>
    </section>
    <details class="panel log" open>
      <summary>ログ</summary>
      <ol>${logItems}</ol>
    </details>
  </main>
  ${sheet ? `<div class="sheet">${sheet}</div>` : ''}`;
}

// ===== アクション処理 =====
function actorFor(a) {
  if (app.mode !== 'local') return app.me;
  const m = app.match;
  if (a.type === 'chooseOrder') return m.choice ? m.choice.chooser : 0;
  if (m.game && !m.game.over) return m.game.turn;
  return 0;
}

function dispatch(a) {
  app.sel = null;
  if (app.mode === 'guest') {
    if (!app.online) toast('接続が切れています');
    app.net.send({ t: 'action', a });
    render();
    return;
  }
  const r = G.applyMatchAction(app.match, actorFor(a), a);
  if (!r.ok) {
    toast(r.error);
    render();
    return;
  }
  app.match = r.match;
  if (app.mode === 'host') {
    saveHost();
    broadcast();
  }
  render();
}

function broadcast() {
  if (app.net && app.match) app.net.send({ t: 'state', match: G.viewOf(app.match) });
}

function saveHost() {
  store.set('ocg-host', { code: app.code, name: app.name, cfg: app.cfg, match: app.match }, SS);
}

function readLobbyInputs() {
  const nameEl = document.getElementById('name');
  if (nameEl) {
    app.name = cleanName(nameEl.value, '');
    store.set('ocg-name', app.name);
  }
  const cfg = {};
  document.querySelectorAll('[data-cfg]').forEach((el) => { cfg[el.dataset.cfg] = el.value; });
  if (Object.keys(cfg).length) {
    app.cfg = G.normalizeConfig(cfg);
    store.set('ocg-cfg', app.cfg);
  }
}

// ---- ホスト ----
function startHost(code, savedMatch) {
  app.mode = 'host';
  app.me = 0;
  app.code = code;
  app.match = savedMatch || null;
  app.screen = app.match ? 'game' : 'wait';
  app.online = false;
  app.peerStatus = 'シグナリングサーバーに接続中…';
  render();
  app.net = hostRoom(code, {
    onOpen() {
      app.peerStatus = '相手の参加を待っています…';
      render();
    },
    onGuest() {
      app.online = true;
      app.peerStatus = '接続しました';
      if (app.match) broadcast();
      render();
    },
    onGuestLeft() {
      app.online = false;
      toast('相手の接続が切れました（再接続を待っています）');
      render();
    },
    onData(d) {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'hello') {
        const guestName = cleanName(d.name, 'ゲスト');
        if (!app.match) {
          app.match = G.newMatch(app.cfg, [app.name || 'ホスト', guestName]);
          app.screen = 'game';
        } else {
          app.match.names[1] = guestName;
        }
        saveHost();
        broadcast();
        render();
      } else if (d.t === 'action' && app.match && d.a && typeof d.a.type === 'string') {
        const r = G.applyMatchAction(app.match, 1, d.a);
        if (!r.ok) {
          app.net.send({ t: 'error', msg: r.error });
          return;
        }
        app.match = r.match;
        saveHost();
        broadcast();
        render();
      }
    },
    onStatus(s) {
      app.peerStatus = s;
      render();
    },
    onError(e) {
      toast(`通信エラー：${e}`);
    },
  });
}

// ---- ゲスト ----
function startGuest(code) {
  app.mode = 'guest';
  app.me = 1;
  app.code = code;
  app.match = null;
  app.screen = 'wait';
  app.online = false;
  app.peerStatus = '接続中…';
  store.set('ocg-guest', code, SS);
  render();
  app.net = joinRoom(code, {
    onOpen() {
      app.online = true;
      app.peerStatus = '接続しました。ホストの応答を待っています…';
      app.net.send({ t: 'hello', name: app.name || 'ゲスト' });
      render();
    },
    onData(d) {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'state' && d.match) {
        app.match = d.match;
        app.screen = 'game';
        render();
      } else if (d.t === 'error') {
        toast(d.msg);
      }
    },
    onClose() {
      app.online = false;
      app.peerStatus = '切断されました。再接続中…';
      if (app.screen === 'game') toast('ホストとの接続が切れました。再接続中…');
      render();
    },
    onStatus(s) {
      app.peerStatus = s;
      render();
    },
    onError(e) {
      toast(`通信エラー：${e}`);
    },
  });
}

function leave() {
  const inGame = app.screen === 'game' && app.match && !app.match.over;
  if (inGame && !confirm('対戦をやめてロビーに戻りますか？')) return;
  if (app.net) app.net.close();
  store.del('ocg-host', SS);
  store.del('ocg-guest', SS);
  history.replaceState(null, '', location.pathname + location.search);
  Object.assign(app, { screen: 'lobby', mode: null, match: null, net: null, code: null, sel: null, online: false, inviteCode: '' });
  render();
}

function setHash(h) {
  history.replaceState(null, '', `${location.pathname}${location.search}#${h}`);
}

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-card],[data-slot]');
  if (!el || el.disabled) return;

  if (el.dataset.card !== undefined) {
    const id = Number(el.dataset.card);
    app.sel = app.sel === id ? null : id;
    render();
    return;
  }
  if (el.dataset.slot !== undefined) {
    if (app.sel === null) return;
    const g = app.match.game;
    const p = app.mode === 'local' ? g.turn : app.me;
    const card = g.hands[p].find((c) => c.id === app.sel);
    const slot = Number(el.dataset.slot);
    if (card && G.targetsFor(g, card).some((t) => t.slot === slot)) {
      dispatch({ type: 'place', cardId: card.id, slot });
    }
    return;
  }

  switch (el.dataset.act) {
    case 'host': {
      readLobbyInputs();
      if (typeof Peer === 'undefined') { toast('通信ライブラリを読み込めませんでした'); return; }
      const code = makeRoomCode();
      setHash(`host=${code}`);
      startHost(code, null);
      saveHost();
      break;
    }
    case 'join':
    case 'join-invite': {
      readLobbyInputs();
      const raw = el.dataset.act === 'join-invite' ? app.inviteCode : (document.getElementById('joincode')?.value || '');
      const code = raw.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) { toast('6文字の部屋コードを入力してください'); return; }
      if (typeof Peer === 'undefined') { toast('通信ライブラリを読み込めませんでした'); return; }
      setHash(`join=${code}`);
      startGuest(code);
      break;
    }
    case 'local': {
      readLobbyInputs();
      app.mode = 'local';
      app.me = 0;
      app.match = G.newMatch(app.cfg, [app.name || 'プレイヤー1', 'プレイヤー2']);
      app.screen = 'game';
      render();
      break;
    }
    case 'cfg-reset':
      app.cfg = { ...G.DEFAULT_CONFIG };
      store.set('ocg-cfg', app.cfg);
      render();
      break;
    case 'copy': {
      const url = shareUrl(app.code);
      try {
        await navigator.clipboard.writeText(url);
        toast('URL をコピーしました');
      } catch (err) {
        const inp = document.getElementById('shareurl');
        if (inp) { inp.select(); }
        toast('コピーできませんでした。手動でコピーしてください');
      }
      break;
    }
    case 'leave':
      leave();
      break;
    case 'exchange':
      if (app.sel !== null) dispatch({ type: 'exchange', cardId: app.sel });
      break;
    case 'pass':
      dispatch({ type: 'pass' });
      break;
    case 'redraw':
      dispatch({ type: 'redraw' });
      break;
    case 'first':
      dispatch({ type: 'chooseOrder', first: true });
      break;
    case 'second':
      dispatch({ type: 'chooseOrder', first: false });
      break;
    case 'next':
      dispatch({ type: 'next' });
      break;
    case 'rematch':
      dispatch({ type: 'rematch' });
      break;
    default:
      break;
  }
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'joincode') {
    document.querySelector('[data-act="join"]')?.click();
  }
});

// ===== 起動 =====
function boot() {
  const h = new URLSearchParams(location.hash.slice(1));
  const hostCode = h.get('host');
  const joinCode = (h.get('join') || '').toUpperCase();
  if (hostCode) {
    const saved = store.get('ocg-host', SS);
    if (saved && saved.code === hostCode && typeof Peer !== 'undefined') {
      app.name = saved.name || app.name;
      if (saved.cfg) app.cfg = G.normalizeConfig(saved.cfg);
      startHost(hostCode, saved.match);
      return;
    }
    history.replaceState(null, '', location.pathname + location.search);
  } else if (/^[A-Z0-9]{6}$/.test(joinCode)) {
    if (store.get('ocg-guest', SS) === joinCode && typeof Peer !== 'undefined') {
      startGuest(joinCode);
      return;
    }
    app.inviteCode = joinCode;
  }
  render();
}

boot();
