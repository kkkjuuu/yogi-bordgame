const express = require("express"), http = require("http"), { Server } = require("socket.io");
const fs = require("fs"), path = require("path");
const app = express(), srv = http.createServer(app), io = new Server(srv);

// Share room via URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use(express.static("public"));

const cardDir = path.join(__dirname, "public", "cardaction");
let IMAGE_CARDS = [];
try {
  IMAGE_CARDS = fs.readdirSync(cardDir).filter(f => f.endsWith(".png")).map(f => f.replace(".png", ""));
} catch(e) {}

const EXTRA_ACTIONS = [
  "ยกแขนขวาขึ้นเหนือหัว",
  "กดนิ้วชี้แตะจมูก",
  "ยกเท้าข้างหนึ่งลอยจากพื้น",
  "กำมือซ้ายแน่น",
  "แลบลิ้นออกมา",
  "ยกคิ้วขึ้นทั้งสองข้าง",
  "เอามือทั้งสองข้างวางบนหัว",
  "นิ้วชี้ขวาชี้ขึ้นฟ้า",
  "กอดอก",
  "เอามือแตะหูซ้าย",
  "ยกไหล่ขวาขึ้น",
  "ทำปากจู๋",
  "เอามือขวาแตะแก้มซ้าย",
  "ยืดหลังตรง",
  "หลับตาข้างเดียว",
  "กางนิ้วมือขวาทั้ง5",
  "เอานิ้วโป้งชี้ขึ้น",
  "เอามือซ้ายแตะไหล่ขวา",
  "เอียงคอไปทางซ้าย",
  "ทำท่าสู้ๆ ✊"
];

const ALL_ACTIONS = [...new Set([...IMAGE_CARDS, ...EXTRA_ACTIONS])];

// Prevent duplicate cards
const getAvailableCards = (p) => {
  const pPoses = p.poses || [];
  const available = ALL_ACTIONS.filter(c => !pPoses.includes(c));
  return available.length > 0 ? available : ALL_ACTIONS;
};

const card = (p) => {
  const available = p ? getAvailableCards(p) : ALL_ACTIONS;
  return available[Math.floor(Math.random() * available.length)];
};

const rooms = {};
const newCode = () => { let c; do c = Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ"[Math.random() * 23 | 0]).join(""); while (rooms[c]); return c; };
app.get("/api/image-cards", (req, res) => res.json(IMAGE_CARDS));
console.log(`Loaded ${IMAGE_CARDS.length} image cards, ${EXTRA_ACTIONS.length} text cards = ${ALL_ACTIONS.length} total`);

function addLog(r, msg) {
  r.log = r.log || [];
  r.log.push(msg);
  if (r.log.length > 20) r.log.shift();
}

function push(r) {
  r.players.forEach(p => p.sock && io.to(p.sock).emit("state", {
    code: r.code, phase: r.phase, turn: r.turn, timer: r.timer,
    msg: r.msg, pile: r.pile, host: r.players[0]?.id,
    opts: r.opts, votes: r.votes, voted: r.voted,
    log: r.log || [], summary: r.summary,
    players: r.players.map(q => ({ 
      id: q.id, name: q.name, on: !!q.sock || q.isBot, 
      ready: q.ready, isBot: q.isBot, alive: q.alive, poses: q.poses || []
    }))
  }));
}

function getAlive(r) { return r.players.filter(p => p.alive); }

function advance(r) {
  if (r.phase === 'over') return;
  let failsafe = 0;
  do {
    r.turn = (r.turn + 1) % r.players.length;
    failsafe++;
  } while (!r.players[r.turn].alive && failsafe < 20);
  
  r.pile = null;
  r.phase = 'playing';
  r.timer = 0;
  const p = r.players[r.turn];
  r.msg = `ตาของ ${p.name} (จั่วไพ่)`;
  push(r);
  
  if (p.isBot) {
    setTimeout(() => { if (r.phase === 'playing' && !r.pile) drawCard(r, p); }, 1500);
  }
}

function eliminate(r, idx, reason) {
  const p = r.players[idx];
  p.alive = false;
  addLog(r, `${p.name} ตกรอบ! (${reason})`);
  let aliveCount = getAlive(r).length;
  if (aliveCount <= 1) {
    r.phase = 'over';
    const winner = getAlive(r)[0];
    r.msg = winner ? `🎉 ${winner.name} เป็นผู้ชนะ! 🎉` : "เสมอ! ไม่มีผู้รอดชีวิต";
    r.players.forEach(q => q.ready = false);
    
    // Post-game summary
    r.summary = r.players.map(q => ({
      name: q.name,
      posesCount: (q.poses || []).length,
      isWinner: winner ? q.id === winner.id : false,
      isAlive: q.alive
    }));
  } else {
    r.phase = 'transition';
    r.msg = `${p.name} ตกรอบ! (${reason})`;
    setTimeout(() => advance(r), 3000);
  }
  push(r);
}

function resolveVote(r) {
  if (r.phase !== 'voting') return;
  r.phase = 'transition';
  const p = r.players[r.turn];
  if (r.votes.fail > r.votes.pass) {
    eliminate(r, r.turn, "เพื่อนโหวตไม่ผ่าน!");
  } else {
    p.poses = p.poses || [];
    p.poses.push(r.pile);
    addLog(r, `${p.name} ทำท่าผ่าน!`);
    r.msg = `${p.name} ทำท่าผ่าน! ✅ (ต้องทำค้างไว้ ${p.poses.length} ท่า)`;
    push(r);
    setTimeout(() => advance(r), 3000);
  }
}

function drawCard(r, p) {
  r.pile = card(p);
  r.timer = r.opts.turnTime || 30; // Use selected time or default to 30
  r.msg = `${p.name} จั่วได้: ${r.pile}`;
  addLog(r, `${p.name} จั่วได้ ${r.pile}`);
  push(r);
  
  if (p.isBot) {
    setTimeout(() => {
      if (r.phase === 'playing' && r.pile) {
         r.phase = 'voting';
         r.timer = 15;
         r.votes = {pass:0, fail:0};
         r.voted = [];
         r.msg = `โหวตให้ ${p.name} ว่าทำท่าผ่านหรือไม่?`;
         push(r);
      }
    }, 4000);
  }
}

io.on("connection", s => {
  const my = () => { const r = rooms[s.data.room]; return r && { r, p: r.players.find(x => x.id === s.data.uid) }; };
  
  s.on("list_rooms", ack => {
    const list = Object.values(rooms)
      .filter(r => r.phase === 'lobby')
      .map(r => ({ code: r.code, players: r.players.length, max: r.opts.maxPlayers }));
    ack(list);
  });

  s.on("join", ({ create, code, uid, name, opts }, ack) => {
    if (typeof ack !== "function" || !uid || !String(name || "").trim()) return;
    let r = create ? (rooms[code = newCode()] = { 
        code, players: [], phase: 'lobby', turn: 0, pile: null, 
        msg: "รอผู้เล่น", opts: opts || { maxPlayers: 6, turnTime: 30 }, 
        timer: 0, votes: {pass:0, fail:0}, voted: [], log: [], chat: [] 
    }) : rooms[String(code || "").toUpperCase()];
    if (!r) return ack({ error: "ไม่พบห้องนี้" });
    let p = r.players.find(x => x.id === uid);
    if (!p) {
      if (r.phase !== 'lobby' && r.phase !== 'over') return ack({ error: "เกมเริ่มไปแล้ว" });
      if (r.players.length >= (r.opts?.maxPlayers || 6)) return ack({ error: `ห้องเต็ม (สูงสุด ${r.opts?.maxPlayers || 6} คน)` });
      p = { id: uid, isBot: false, ready: false, alive: true, poses: [] }; r.players.push(p);
    }
    p.name = String(name).trim().slice(0, 14); p.sock = s.id;
    s.data = { room: r.code, uid }; s.join(r.code); ack({ code: r.code }); push(r);
  });

  // Kick player or remove bot
  s.on("kick", targetId => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'lobby' || r.players[0] !== p) return;
    const targetIndex = r.players.findIndex(x => x.id === targetId);
    if (targetIndex === -1) return;
    const target = r.players[targetIndex];
    if (target === p) return; // Cannot kick oneself
    
    if (target.sock) {
      const targetSock = io.sockets.sockets.get(target.sock);
      if (targetSock) {
        targetSock.emit("alert", "คุณถูกเตะออกจากห้อง");
        targetSock.leave(r.code);
        targetSock.data = {};
      }
    }
    r.players.splice(targetIndex, 1);
    push(r);
  });

  // Chat system
  s.on("chat", msg => {
    const m = my(); if (!m) return; const { r, p } = m;
    const chatMsg = { sender: p.name, msg: String(msg).trim().slice(0, 100) };
    if (!chatMsg.msg) return;
    r.chat = r.chat || [];
    r.chat.push(chatMsg);
    if (r.chat.length > 30) r.chat.shift();
    io.to(r.code).emit("chat_msg", chatMsg);
  });

  s.on("ready", state => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'lobby') return;
    p.ready = !!state;
    push(r);
  });

  s.on("add_bot", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (p !== r.players[0] || r.phase !== 'lobby') return;
    if (r.players.length >= (r.opts?.maxPlayers || 6)) return;
    let botId = "bot-" + Date.now();
    r.players.push({ id: botId, name: "Bot " + (r.players.length + 1), isBot: true, ready: true, alive: true, sock: null, poses: [] });
    push(r);
  });

  s.on("start", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (p !== r.players[0] || r.players.length < 2 || r.phase !== 'lobby') return;
    
    if (!r.players.every(q => q.ready)) {
      s.emit("alert", "ผู้เล่นทุกคนต้องกด 'พร้อม' ก่อนครับ");
      return;
    }
    
    r.players.forEach(q => { q.poses = []; q.alive = true; });
    r.phase = 'countdown';
    r.timer = 5;
    r.log = []; // clear log on new game
    r.summary = null;
    push(r);
  });

  s.on("draw", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'playing' || r.players[r.turn] !== p || r.pile) return;
    drawCard(r, p);
  });

  s.on("action", type => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'playing' || r.players[r.turn] !== p || !r.pile) return;
    
    if (type === 'giveup') {
        r.phase = 'transition';
        eliminate(r, r.turn, "ยอมแพ้");
    } else if (type === 'done') {
        r.phase = 'voting';
        r.timer = 15;
        r.votes = {pass:0, fail:0};
        r.voted = [];
        r.msg = `โหวตให้ ${p.name} ว่าทำท่าผ่านหรือไม่?`;
        push(r);
    }
  });

  s.on("vote", pass => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'voting' || r.players[r.turn] === p || !p.alive || r.voted.includes(p.id)) return;
    
    r.voted.push(p.id);
    if (pass) r.votes.pass++; else r.votes.fail++;
    push(r);
  });

  s.on("play_again", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (r.phase !== 'over') return;
    p.ready = true;
    push(r);
    
    const realPlayers = r.players.filter(q => !q.isBot);
    if (realPlayers.every(q => q.ready)) {
        r.phase = 'lobby';
        r.players.forEach(q => { q.ready = q.isBot; q.alive = true; });
        push(r);
    }
  });

  const out = () => {
    const m = my(); if (!m) return; const { r, p } = m;
    p.sock = null; p.ready = false; s.leave(r.code);
    if (r.phase === 'lobby' || r.phase === 'over') {
        r.players = r.players.filter(x => x !== p);
    } else {
        if (p.alive) eliminate(r, r.players.indexOf(p), "ออกจากเกม");
    }
    s.data = {}; r.players.length ? push(r) : delete rooms[r.code];
  };
  s.on("leave", out); s.on("disconnect", out);
});

// Game Tick Loop
setInterval(() => {
  for (const c in rooms) {
    const r = rooms[c];
    if (r.phase === 'countdown') {
       r.timer--;
       if (r.timer <= 0) {
         r.phase = 'playing';
         r.players.forEach(p => p.alive = true);
         r.turn = Math.floor(Math.random() * r.players.length);
         r.pile = null;
         r.msg = `เริ่มเกมแล้ว! ตาของ ${r.players[r.turn].name}`;
         addLog(r, `เริ่มเกม!`);
         if (r.players[r.turn].isBot) {
           setTimeout(() => { if(r.phase==='playing'&&!r.pile) drawCard(r, r.players[r.turn]); }, 1500);
         }
       }
       push(r);
    } else if (r.phase === 'playing' && r.pile) {
       if (r.opts.turnTime > 0) { // If there's a time limit
           r.timer--; 
           if (r.timer <= 0) {
               r.phase = 'transition';
               eliminate(r, r.turn, "หมดเวลา!");
           } else {
               push(r);
           }
       }
    } else if (r.phase === 'voting') {
       // Bots auto vote pass
       getAlive(r).forEach(q => {
         if (q.isBot && q !== r.players[r.turn] && !r.voted.includes(q.id)) {
            r.voted.push(q.id);
            r.votes.pass++;
         }
       });
       
       const aliveOthers = getAlive(r).filter(q => q !== r.players[r.turn] && !q.isBot); // wait for real alive players
       const realVoted = r.voted.filter(vid => aliveOthers.find(o => o.id === vid));
       
       if (realVoted.length >= aliveOthers.length) {
          resolveVote(r);
       } else {
          r.timer--; 
          if (r.timer <= 0) resolveVote(r); 
          else push(r);
       }
    }
  }
}, 1000);

setInterval(() => { for (const c in rooms) if (!rooms[c].players.some(p => p.sock)) delete rooms[c]; }, 3600e3);
srv.listen(process.env.PORT || 3000, () => console.log("yogi on", process.env.PORT || 3000));
