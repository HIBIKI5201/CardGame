// PeerJS（WebRTC P2P）による通信。シグナリングには PeerJS の無料公開サーバーを使う。
/* global Peer */

const PREFIX = 'hibiki5201-cardgame-';
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (const n of buf) s += chars[n % chars.length];
  return s;
}

// ホスト：部屋を作り、ゲストからの接続を待つ
export function hostRoom(code, h) {
  let peer = null;
  let conn = null;
  let tries = 0;
  let closed = false;

  function start() {
    peer = new Peer(PREFIX + code, { debug: 1, config: RTC_CONFIG });
    peer.on('open', () => {
      tries = 0;
      h.onOpen();
    });
    peer.on('connection', (c) => {
      c.on('open', () => {
        if (conn && conn !== c) {
          try { conn.close(); } catch (e) { /* ignore */ }
        }
        conn = c;
        h.onGuest();
      });
      c.on('data', (d) => { if (c === conn) h.onData(d); });
      c.on('close', () => {
        if (c === conn) {
          conn = null;
          h.onGuestLeft();
        }
      });
    });
    peer.on('disconnected', () => {
      if (!closed && !peer.destroyed) {
        try { peer.reconnect(); } catch (e) { /* ignore */ }
      }
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries++ < 8) {
        // リロード直後は前のIDがまだ残っていることがある
        h.onStatus('部屋IDの解放待ち…');
        peer.destroy();
        setTimeout(() => { if (!closed) start(); }, 2500);
        return;
      }
      h.onError(e.type || String(e));
    });
  }
  start();

  return {
    send(d) {
      if (conn && conn.open) conn.send(d);
    },
    get connected() {
      return !!(conn && conn.open);
    },
    close() {
      closed = true;
      if (peer) peer.destroy();
    },
  };
}

// ゲスト：部屋に参加する（切断時は自動で再接続）
export function joinRoom(code, h) {
  let conn = null;
  let closed = false;
  let retryTimer = null;
  const peer = new Peer({ debug: 1, config: RTC_CONFIG });

  function scheduleRetry() {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 3000);
  }

  function connect() {
    if (closed) return;
    if (conn) {
      try { conn.close(); } catch (e) { /* ignore */ }
    }
    const c = peer.connect(PREFIX + code, { reliable: true });
    conn = c;
    c.on('open', () => { if (c === conn) h.onOpen(); });
    c.on('data', (d) => { if (c === conn) h.onData(d); });
    c.on('close', () => {
      if (c === conn) {
        h.onClose();
        scheduleRetry();
      }
    });
    c.on('error', () => { if (c === conn) scheduleRetry(); });
  }

  peer.on('open', connect);
  peer.on('disconnected', () => {
    if (!closed && !peer.destroyed) {
      try { peer.reconnect(); } catch (e) { /* ignore */ }
    }
  });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      h.onStatus('部屋が見つかりません。ホストを待っています…');
      scheduleRetry();
      return;
    }
    h.onError(e.type || String(e));
    if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') scheduleRetry();
  });

  return {
    send(d) {
      if (conn && conn.open) conn.send(d);
    },
    close() {
      closed = true;
      peer.destroy();
    },
  };
}
