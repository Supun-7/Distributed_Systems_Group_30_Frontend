import { useState, useEffect, useRef } from "react";

const API = "http://localhost:8000/api";
const USERS = ["Supun", "Ruchira", "Sachith", "Sasiru"];

const USER_CONFIG = {
  Supun: { avatar: "SP", color: "#818cf8" },
  Ruchira: { avatar: "RU", color: "#f472b6" },
  Sachith: { avatar: "SA", color: "#38bdf8" },
  Sasiru: { avatar: "SS", color: "#34d399" },
};

const LOG_COLORS = {
  boot: "#4ade80", store: "#60a5fa", crash: "#f87171", failover: "#fbbf24",
  recovery: "#c084fc", error: "#f87171", heartbeat: "#34d399", leader: "#fbbf24",
  sync: "#38bdf8", consensus: "#c084fc", time: "#38bdf8", pending: "#fb923c", commit: "#4ade80",
};

async function apiFetch(path, options = {}) {
  return fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
}

export default function NexusChat() {
  const [servers, setServers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [input, setInput] = useState("");
  const [currentUser, setCurrentUser] = useState("Supun");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [leader, setLeader] = useState(null);
  const [currentTerm, setCurrentTerm] = useState(0);
  const [hasQuorum, setHasQuorum] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [timeSkews, setTimeSkews] = useState({});
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("nodes");

  // Queue state: message waiting in the input bar (not sent to chat yet)
  const [queuedMsg, setQueuedMsg] = useState(null);  // { content, sender, id, time }
  const [sendError, setSendError] = useState(null);

  const chatEndRef = useRef(null);
  const termEndRef = useRef(null);
  const inputRef = useRef(null);
  const isSendingRef = useRef(false);   // ← ADD THIS

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (activeTab === "logs") termEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, activeTab]);

  async function fetchAll() {
    try {
      const [sr, mr, lr, tr] = await Promise.all([
        apiFetch("/status"), apiFetch("/messages"),
        apiFetch("/logs"), apiFetch("/time/report"),
      ]);
      const s = await sr.json();
      const m = await mr.json();
      const l = await lr.json();
      const tr2 = await tr.json();

      setServers(s.servers || []);
      // Filter out pending messages from chat — they stay in the input bar only
      setMessages((m || []).filter(msg => msg.status !== "pending"));
      setLogs(l);
      setLeader(s.leader);
      setCurrentTerm(s.currentTerm || 0);

      const quorum = s.hasQuorum ?? true;
      setHasQuorum(quorum);
      setPendingCount(s.pendingCount ?? 0);
      setTimeSkews(tr2.skews || {});
      setConnected(true);

      // If quorum is restored and we had a queued message, auto-retry
      // if (quorum && queuedMsg) {
      // retryQueuedMessage(queuedMsg);
      //}
      // AFTER (fixed):
      if (quorum && queuedMsg && !isSendingRef.current) {
        retryQueuedMessage(queuedMsg);
      }
    } catch { setConnected(false); }
  }

  /*async function retryQueuedMessage(msg) {
    try {
      const res  = await apiFetch("/messages", {
        method: "POST",
        body: JSON.stringify({ sender: msg.sender, content: msg.content }),
      });
      if (res.status === 201) {
        setQueuedMsg(null);
        setSendError(null);
        await fetchAll();
      }
    } catch {}
  }*/
  // AFTER (fixed):
  async function retryQueuedMessage(msg) {
    isSendingRef.current = true;   // lock: prevent re-entry
    try {
      const res = await apiFetch("/messages", {
        method: "POST",
        body: JSON.stringify({ sender: msg.sender, content: msg.content }),
      });
      if (res.status === 201) {
        setQueuedMsg(null);        // clear the queue
        setSendError(null);
        // DO NOT call fetchAll() here — the interval will pick it up naturally
      }
    } catch { }
    isSendingRef.current = false;  // unlock
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || loading) return;

    // If no quorum — put message in the input queue bar, don't send
    if (!hasQuorum && !allDown) {
      setQueuedMsg({ content, sender: currentUser, id: Date.now(), time: new Date().toLocaleTimeString() });
      setInput("");
      setSendError(null);
      return;
    }

    setLoading(true);
    setSendError(null);
    try {
      const res = await apiFetch("/messages", {
        method: "POST",
        body: JSON.stringify({ sender: currentUser, content }),
      });
      const data = await res.json();

      if (res.status === 201) {
        setInput("");
        setQueuedMsg(null);
        setSendError(null);
        await fetchAll();
      } else if (res.status === 202) {
        // Backend also says no quorum — keep in queue bar
        setQueuedMsg({ content, sender: currentUser, id: data.id || Date.now(), time: new Date().toLocaleTimeString() });
        setInput("");
        setSendError(null);
        await fetchAll();
      } else {
        setSendError("Send failed: " + (data.error || "unknown"));
        await fetchAll();
      }
    } catch {
      setSendError("Cannot reach backend.");
    }
    setLoading(false);
    inputRef.current?.focus();
  }

  async function crashServer(id) {
    try { await apiFetch("/servers/" + id + "/crash", { method: "POST" }); await fetchAll(); } catch { }
  }
  async function recoverServer(id) {
    try { await apiFetch("/servers/" + id + "/recover", { method: "POST" }); await fetchAll(); } catch { }
  }
  async function triggerSync() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await apiFetch("/time/sync", { method: "POST" });
      setSyncResult(await res.json());
      await fetchAll();
    } catch { }
    setSyncing(false);
  }

  const aliveCount = servers.filter(s => s.alive).length;
  const allDown = aliveCount === 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; width: 100%; overflow: hidden; background: #0a0a0f; }
        * { font-family: 'Inter', sans-serif; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2d2d3d; border-radius: 10px; }

        .root { height: 100vh; width: 100vw; display: flex; flex-direction: column; overflow: hidden; background: #0a0a0f; }

        /* TOPBAR */
        .topbar {
          background: #111118; height: 68px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 24px; border-bottom: 1px solid #1e1e2e;
          box-shadow: 0 2px 20px rgba(0,0,0,.5);
        }
        .tl { display: flex; align-items: center; gap: 14px; }
        .app-icon {
          width: 44px; height: 44px; border-radius: 13px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; box-shadow: 0 4px 16px rgba(99,102,241,.4); flex-shrink: 0;
        }
        .app-title { font-size: 22px; font-weight: 800; color: #f8fafc; letter-spacing: -.5px; }
        .app-title span { color: #818cf8; }
        .app-sub { font-size: 12px; color: #4b5563; font-weight: 500; margin-top: 2px; }

        .tr { display: flex; align-items: center; gap: 8px; }
        .pill { padding: 6px 14px; border-radius: 22px; font-size: 13px; font-weight: 700; white-space: nowrap; }
        .p-ok     { background: rgba(52,211,153,.15);  color: #34d399; border: 1px solid rgba(52,211,153,.25); }
        .p-warn   { background: rgba(251,191,36,.12);  color: #fbbf24; border: 1px solid rgba(251,191,36,.2); }
        .p-bad    { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.2); }
        .p-blue   { background: rgba(129,140,248,.12); color: #818cf8; border: 1px solid rgba(129,140,248,.2); }
        .p-purple { background: rgba(167,139,250,.12); color: #a78bfa; border: 1px solid rgba(167,139,250,.2); }
        .p-orange { background: rgba(251,146,60,.15);  color: #fb923c; border: 1px solid rgba(251,146,60,.25); animation: pulse-p 1.4s ease-in-out infinite; }
        @keyframes pulse-p { 0%,100%{opacity:1} 50%{opacity:.45} }

        .usr-sw { display: flex; gap: 3px; background: #1a1a27; padding: 4px; border-radius: 12px; border: 1px solid #2d2d3d; }
        .usr-btn { padding: 6px 14px; border-radius: 9px; border: none; background: transparent; font-size: 13px; font-weight: 600; cursor: pointer; color: #6b7280; transition: all .15s; }
        .usr-btn:hover { background: #25253a; color: #e2e8f0; }
        .usr-btn.active { background: #25253a; box-shadow: 0 1px 6px rgba(0,0,0,.3); }

        /* MAIN */
        .main { display: flex; flex: 1; overflow: hidden; min-height: 0; }

        /* CHAT */
        .chat { width: 50%; flex-shrink: 0; display: flex; flex-direction: column; background: #0d0d16; border-right: 1px solid #1e1e2e; }
        .msgs { flex: 1; overflow-y: auto; padding: 20px 28px; display: flex; flex-direction: column; gap: 4px; }

        .dc { text-align: center; margin: 10px 0; }
        .dc span { background: #16162a; color: #4b5563; font-size: 12px; font-weight: 600; padding: 4px 16px; border-radius: 10px; border: 1px solid #1e1e2e; }

        /* NO QUORUM BANNER */
        .nq-banner {
          margin: 8px 0; padding: 14px 18px;
          background: rgba(251,146,60,.07); border: 1.5px solid rgba(251,146,60,.28);
          border-radius: 14px; display: flex; align-items: flex-start; gap: 10px;
        }
        .nq-icon  { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
        .nq-title { font-size: 15px; font-weight: 800; color: #fb923c; margin-bottom: 3px; }
        .nq-sub   { font-size: 13px; color: #d97706; font-weight: 500; line-height: 1.5; }

        /* MESSAGES */
        .mr { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 3px; animation: pop .17s ease-out; }
        .mr.mine { flex-direction: row-reverse; }
        @keyframes pop { from{opacity:0;transform:scale(.95) translateY(5px)} to{opacity:1;transform:scale(1) translateY(0)} }

        .mav { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; flex-shrink: 0; }
        .mw { max-width: 62%; display: flex; flex-direction: column; gap: 2px; }
        .mine .mw { align-items: flex-end; }
        .msender { font-size: 12px; font-weight: 700; margin-left: 4px; margin-bottom: 2px; }
        .mb { padding: 10px 14px 8px; border-radius: 14px; word-break: break-word; box-shadow: 0 2px 12px rgba(0,0,0,.3); }
        .mb.theirs { background: #1e1e2e; border-top-left-radius: 4px; }
        .mb.mine   { border-top-right-radius: 4px; }
        .mtext { font-size: 15px; font-weight: 500; line-height: 1.55; }
        .mtext.mine   { color: #fff; }
        .mtext.theirs { color: #e2e8f0; }
        .mfoot { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 4px; }
        .mtime { font-size: 11px; font-weight: 500; }
        .mtime.mine   { color: rgba(255,255,255,.5); }
        .mtime.theirs { color: #4b5563; }
        .mnode { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; }
        .mnode.mine   { color: rgba(255,255,255,.5); background: rgba(255,255,255,.1); }
        .mnode.theirs { color: #6b7280; background: rgba(255,255,255,.05); }

        .alldown { margin: auto; text-align: center; padding: 28px 36px; background: rgba(248,113,113,.08); border: 1.5px solid rgba(248,113,113,.2); border-radius: 18px; color: #f87171; font-size: 16px; font-weight: 700; }
        .conn-msg { margin: auto; color: #374151; font-size: 14px; font-weight: 600; animation: blink 1.5s infinite; }
        @keyframes blink { 0%,100%{opacity:.3} 50%{opacity:1} }

        /* INPUT AREA */
        .inp-area { flex-shrink: 0; border-top: 1px solid #1e1e2e; }

        /* QUEUED MESSAGE BAR */
        .queue-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px;
          background: rgba(251,146,60,.07);
          border-bottom: 1px solid rgba(251,146,60,.2);
          animation: slideIn .25s ease-out;
        }
        @keyframes slideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .queue-icon { font-size: 18px; flex-shrink: 0; }
        .queue-info { flex: 1; min-width: 0; }
        .queue-label { font-size: 11px; font-weight: 800; color: #fb923c; text-transform: uppercase; letter-spacing: .8px; }
        .queue-text  { font-size: 14px; font-weight: 500; color: #d97706; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .queue-sub   { font-size: 11px; color: #92400e; font-weight: 500; margin-top: 2px; }
        .queue-cancel { padding: 5px 10px; border: 1px solid rgba(251,146,60,.3); border-radius: 8px; background: transparent; color: #fb923c; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
        .queue-cancel:hover { background: rgba(251,146,60,.1); }

        /* ERROR BAR */
        .err-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 16px;
          background: rgba(248,113,113,.07);
          border-bottom: 1px solid rgba(248,113,113,.2);
        }
        .err-text { flex: 1; font-size: 13px; font-weight: 600; color: #f87171; }
        .err-x { cursor: pointer; color: #f87171; opacity: .6; font-size: 16px; }
        .err-x:hover { opacity: 1; }

        .inp-bar { padding: 12px 16px; display: flex; align-items: center; gap: 10px; background: #0d0d16; }
        .inp-wrap { flex: 1; background: #16162a; border-radius: 28px; display: flex; align-items: center; padding: 0 18px; border: 1.5px solid #2d2d3d; transition: border-color .18s; }
        .inp-wrap:focus-within { border-color: #6366f1; }
        .inp-wrap.nq { border-color: rgba(251,146,60,.4); background: rgba(251,146,60,.04); }
        .inp { flex: 1; border: none; outline: none; padding: 13px 0; font-size: 15px; font-weight: 500; color: #f8fafc; background: transparent; }
        .inp::placeholder { color: #374151; font-weight: 400; }
        .inp:disabled { opacity: .35; cursor: not-allowed; }
        .snd { width: 48px; height: 48px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; transition: all .17s; flex-shrink: 0; }
        .snd-ok   { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.4); }
        .snd-ok:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 20px rgba(99,102,241,.5); }
        .snd-nq   { background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff; box-shadow: 0 4px 14px rgba(245,158,11,.3); }
        .snd-nq:hover:not(:disabled) { transform: scale(1.08); }
        .snd:disabled { background: #1e1e2e; color: #374151; box-shadow: none; cursor: not-allowed; }

        /* RIGHT PANEL */
        .right { width: 50%; flex-shrink: 0; background: #111118; display: flex; flex-direction: column; overflow: hidden; }
        .rtabs { display: flex; border-bottom: 1px solid #1e1e2e; flex-shrink: 0; }
        .rtab { flex: 1; padding: 15px 4px; border: none; background: transparent; font-size: 13px; font-weight: 700; color: #4b5563; cursor: pointer; border-bottom: 2.5px solid transparent; transition: all .15s; }
        .rtab:hover { color: #9ca3af; }
        .rtab.active { color: #818cf8; border-bottom-color: #818cf8; }
        .pbody { flex: 1; overflow-y: auto; }

        /* NODES TAB */
        .ng { padding: 16px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .nc { border-radius: 16px; padding: 16px; border: 1.5px solid; transition: all .22s; }
        .nc.alive-c { border-color: rgba(52,211,153,.2);  background: rgba(52,211,153,.04); }
        .nc.dead-c  { border-color: rgba(248,113,113,.2); background: rgba(248,113,113,.04); }
        .nc.lead-c  { border-color: rgba(250,204,21,.3);  background: rgba(250,204,21,.05); box-shadow: 0 0 0 3px rgba(250,204,21,.08); }
        .nc-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
        .nc-nr  { display: flex; align-items: center; gap: 8px; }
        .ncdot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .ncdot.alive { background: #34d399; box-shadow: 0 0 0 4px rgba(52,211,153,.2); animation: hb 2s infinite; }
        .ncdot.dead  { background: #374151; }
        @keyframes hb { 0%,100%{box-shadow:0 0 0 4px rgba(52,211,153,.18)} 50%{box-shadow:0 0 0 7px rgba(52,211,153,.06)} }
        .nc-name { font-size: 15px; font-weight: 800; color: #f8fafc; }
        .nc-reg  { font-size: 11px; color: #4b5563; font-weight: 600; letter-spacing: .4px; text-align: right; }
        .nctags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 12px; }
        .tag { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 7px; }
        .tag.alive     { background: rgba(52,211,153,.15);  color: #34d399; }
        .tag.dead      { background: rgba(248,113,113,.12); color: #f87171; }
        .tag.leader    { background: rgba(250,204,21,.12);  color: #facc15; }
        .tag.follower  { background: rgba(99,102,241,.1);   color: #818cf8; }
        .tag.candidate { background: rgba(56,189,248,.1);   color: #38bdf8; }
        .tag.unknown,.tag.gray { background: #1a1a27; color: #6b7280; }
        .ncbtns { display: flex; gap: 8px; }
        .ncbtn { flex: 1; padding: 9px 4px; border-radius: 10px; font-size: 12px; font-weight: 700; border: none; cursor: pointer; transition: all .17s; }
        .ncbtn.crash { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.2); }
        .ncbtn.crash:hover:not(:disabled) { background: rgba(248,113,113,.2); transform: translateY(-1px); }
        .ncbtn.rec   { background: rgba(52,211,153,.12); color: #34d399; border: 1px solid rgba(52,211,153,.2); }
        .ncbtn.rec:hover:not(:disabled)   { background: rgba(52,211,153,.2); transform: translateY(-1px); }
        .ncbtn:disabled { opacity: .25; cursor: not-allowed; transform: none; }

        .rfstrip { margin: 0 16px 16px; padding: 18px 22px; border-radius: 16px; border: 1.5px solid; display: flex; align-items: center; justify-content: space-between; }
        .rfstrip.good { background: rgba(52,211,153,.05); border-color: rgba(52,211,153,.2); }
        .rfstrip.warn { background: rgba(251,191,36,.05); border-color: rgba(251,191,36,.2); }
        .rfstrip.bad  { background: rgba(248,113,113,.05); border-color: rgba(248,113,113,.2); }
        .rfnum { font-size: 32px; font-weight: 900; letter-spacing: -1.5px; font-family: 'JetBrains Mono', monospace; }
        .rflbl { font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 1.2px; }
        .rfsub { font-size: 13px; font-weight: 700; margin-top: 3px; }

        /* RAFT TAB */
        .raftbody { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .raft-hero { background: linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.08)); border: 1.5px solid rgba(129,140,248,.2); border-radius: 16px; padding: 20px; }
        .rh-top  { font-size: 12px; font-weight: 800; color: #6366f1; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; }
        .rh-name { font-size: 24px; font-weight: 900; color: #f8fafc; }
        .rh-meta { font-size: 13px; color: #6b7280; font-weight: 600; margin-top: 6px; }
        .raft-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .rn { background: #16162a; border: 1.5px solid #1e1e2e; border-radius: 14px; padding: 14px; }
        .rn.rnlead { border-color: rgba(250,204,21,.3); background: rgba(250,204,21,.05); }
        .rn-top  { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .rn-name { font-size: 13px; font-weight: 800; color: #f8fafc; }
        .rn-role { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 7px; }
        .rn-role.leader    { background: rgba(250,204,21,.15); color: #facc15; }
        .rn-role.follower  { background: rgba(99,102,241,.1);  color: #818cf8; }
        .rn-role.candidate { background: rgba(56,189,248,.1);  color: #38bdf8; }
        .rn-role.unknown   { background: #1e1e2e; color: #4b5563; }
        .rn-stats { display: flex; flex-direction: column; gap: 5px; }
        .rn-row { display: flex; justify-content: space-between; align-items: center; }
        .rn-k { font-size: 11px; font-weight: 600; color: #4b5563; }
        .rn-v { font-size: 12px; font-weight: 700; color: #9ca3af; font-family: 'JetBrains Mono', monospace; }

        .pend-box { background: rgba(251,146,60,.08); border: 1.5px solid rgba(251,146,60,.25); border-radius: 14px; padding: 16px; }
        .pend-title { font-size: 13px; font-weight: 800; color: #fb923c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .pend-item { background: rgba(255,255,255,.04); border: 1px solid rgba(251,146,60,.15); border-radius: 10px; padding: 10px 12px; margin-bottom: 7px; }
        .pend-sender  { font-size: 13px; font-weight: 700; color: #f8fafc; }
        .pend-content { font-size: 13px; color: #9ca3af; margin-top: 3px; }
        .pend-note    { font-size: 12px; color: #fb923c; margin-top: 10px; font-weight: 600; }

        .infobox { background: #16162a; border: 1px solid #1e1e2e; border-radius: 14px; padding: 16px; font-size: 13px; color: #6b7280; line-height: 1.9; }
        .infobox strong { color: #9ca3af; font-weight: 700; }

        /* TIME TAB */
        .timebody { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .syncbtn { width: 100%; padding: 14px; border-radius: 14px; border: none; background: linear-gradient(135deg,#0ea5e9,#0891b2); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: all .17s; box-shadow: 0 4px 16px rgba(14,165,233,.25); }
        .syncbtn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(14,165,233,.38); }
        .syncbtn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
        .sync-res { background: rgba(14,165,233,.06); border: 1.5px solid rgba(14,165,233,.2); border-radius: 14px; padding: 14px 16px; }
        .sync-res-title { font-size: 12px; font-weight: 800; color: #0ea5e9; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; }
        .sync-res-time  { font-size: 22px; font-weight: 800; color: #38bdf8; font-family: 'JetBrains Mono', monospace; }
        .sync-nodes { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
        .sync-node  { font-size: 12px; color: #38bdf8; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        .skew-card { background: #16162a; border: 1px solid #1e1e2e; border-radius: 14px; padding: 16px; }
        .skew-title { font-size: 12px; font-weight: 800; color: #4b5563; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 14px; }
        .skew-row { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-bottom: 1px solid #1e1e2e; }
        .skew-row:last-child { border-bottom: none; }
        .skew-srv { font-size: 13px; font-weight: 700; color: #9ca3af; min-width: 68px; }
        .skew-bw  { flex: 1; height: 8px; background: #1e1e2e; border-radius: 4px; overflow: hidden; }
        .skew-b   { height: 100%; border-radius: 4px; transition: width .5s ease; }
        .skew-val { font-size: 13px; font-weight: 800; font-family: 'JetBrains Mono', monospace; min-width: 68px; text-align: right; }
        .skew-val.pos { color: #fbbf24; } .skew-val.neg { color: #60a5fa; } .skew-val.zero { color: #34d399; }

        /* TERMINAL TAB */
        .term { background: #080810; height: 100%; display: flex; flex-direction: column; font-family: 'JetBrains Mono', monospace; }
        .term-hdr { background: #0d0d1a; padding: 12px 18px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #1e1e2e; flex-shrink: 0; }
        .tdots { display: flex; gap: 7px; }
        .tdot   { width: 13px; height: 13px; border-radius: 50%; }
        .tdot.r { background: #ff5f57; } .tdot.y { background: #ffbd2e; } .tdot.g { background: #28c840; }
        .ttitle { font-size: 13px; color: #4b5563; font-weight: 500; margin-left: 6px; }
        .tcount { margin-left: auto; font-size: 11px; color: #374151; }
        .tbody { flex: 1; overflow-y: auto; padding: 12px 18px; display: flex; flex-direction: column; }
        .tbody::-webkit-scrollbar { width: 4px; }
        .tbody::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 2px; }
        .tline { display: flex; line-height: 1.8; font-size: 13px; animation: tapp .12s ease-out; }
        @keyframes tapp { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:translateX(0)} }
        .tts  { color: #374151; flex-shrink: 0; margin-right: 6px; }
        .tpr  { color: #1e1e2e; flex-shrink: 0; }
        .ttype { font-weight: 700; flex-shrink: 0; min-width: 120px; margin-right: 8px; }
        .tmsg { color: #9ca3af; flex: 1; word-break: break-word; }
        .tcursor { display: inline-block; width: 9px; height: 14px; background: #818cf8; margin-left: 4px; animation: blink-c 1s step-end infinite; vertical-align: middle; }
        @keyframes blink-c { 0%,100%{opacity:1} 50%{opacity:0} }
        .tfooter { background: #0d0d1a; padding: 9px 18px; border-top: 1px solid #1e1e2e; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .tfp { color: #818cf8; font-size: 13px; font-weight: 600; }
        .tft { color: #374151; font-size: 12px; }
      `}</style>

      <div className="root">

        {/* TOPBAR */}
        <div className="topbar">
          <div className="tl">
            <div className="app-icon">💬</div>
            <div>
              <div className="app-title">Nexus<span>Chat</span></div>
              <div className="app-sub">Distributed Messaging · SE2062 · Group 30</div>
            </div>
          </div>
          <div className="tr">
            {!connected
              ? <span className="pill p-warn">⏳ Connecting...</span>
              : allDown
                ? <span className="pill p-bad">✕ All Nodes Down</span>
                : hasQuorum
                  ? <span className="pill p-ok">✓ {aliveCount}/{servers.length} Online · Quorum</span>
                  : <span className="pill p-warn">⚠ {aliveCount}/{servers.length} · No Quorum</span>
            }
            {leader && <span className="pill p-blue">👑 {leader}</span>}
            {currentTerm > 0 && <span className="pill p-purple">Term {currentTerm}</span>}
            {/* pendingCount reflects server-side queue — always fresh from fetchAll */}
            {(pendingCount > 0 || queuedMsg) && (
              <span className="pill p-orange">⏳ {pendingCount + (queuedMsg ? 1 : 0)} Pending</span>
            )}
            <div className="usr-sw">
              {USERS.map(u => (
                <button key={u}
                  className={"usr-btn" + (currentUser === u ? " active" : "")}
                  style={currentUser === u ? { color: USER_CONFIG[u].color } : {}}
                  onClick={() => setCurrentUser(u)}
                >{u}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="main">

          {/* CHAT */}
          <div className="chat">
            <div className="msgs">
              <div className="dc"><span>Today — NexusChat Cluster</span></div>

              {/* No-quorum warning inside chat */}
              {!hasQuorum && !allDown && (
                <div className="nq-banner">
                  <span className="nq-icon">⚠️</span>
                  <div>
                    <div className="nq-title">No Quorum — Majority of Nodes Are Down</div>
                    <div className="nq-sub">
                      Raft needs {Math.floor(servers.length / 2) + 1}/{servers.length} nodes to commit.
                      Only {aliveCount} alive. Messages are queued — not visible until committed.
                    </div>
                  </div>
                </div>
              )}

              {!connected && <div className="conn-msg">CONNECTING TO CLUSTER...</div>}

              {/* Only committed messages appear here */}
              {messages.map((msg, i) => {
                const isMe = msg.sender === currentUser;
                const cfg = USER_CONFIG[msg.sender] || { avatar: msg.sender.slice(0, 2).toUpperCase(), color: "#6b7280" };
                const prev = i > 0 ? messages[i - 1].sender : null;
                const showAv = !isMe && prev !== msg.sender;
                return (
                  <div key={msg.id} className={"mr" + (isMe ? " mine" : "")}>
                    {!isMe && (
                      <div className="mav" style={{ background: showAv ? cfg.color : "transparent", visibility: showAv ? "visible" : "hidden" }}>
                        {cfg.avatar}
                      </div>
                    )}
                    <div className="mw">
                      {!isMe && showAv && <div className="msender" style={{ color: cfg.color }}>{msg.sender}</div>}
                      <div className={"mb " + (isMe ? "mine" : "theirs")}
                        style={isMe ? { background: cfg.color } : {}}>
                        <div className={"mtext " + (isMe ? "mine" : "theirs")}>{msg.content}</div>
                        <div className="mfoot">
                          <span className={"mnode " + (isMe ? "mine" : "theirs")}>{msg.server}</span>
                          <span className={"mtime " + (isMe ? "mine" : "theirs")}>{msg.time}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {allDown && connected && <div className="alldown">⚠️ All nodes offline — messaging unavailable</div>}
              <div ref={chatEndRef} />
            </div>

            {/* INPUT AREA */}
            <div className="inp-area">

              {/* QUEUED MESSAGE BAR — shown instead of going to chat */}
              {queuedMsg && (
                <div className="queue-bar">
                  <span className="queue-icon">⏳</span>
                  <div className="queue-info">
                    <div className="queue-label">Queued — Waiting for Quorum</div>
                    <div className="queue-text">"{queuedMsg.content}"</div>
                    <div className="queue-sub">Will be sent automatically when majority recovers · {queuedMsg.time}</div>
                  </div>
                  <button className="queue-cancel" onClick={() => setQueuedMsg(null)}>✕ Cancel</button>
                </div>
              )}

              {/* ERROR BAR */}
              {sendError && (
                <div className="err-bar">
                  <span className="err-text">❌ {sendError}</span>
                  <span className="err-x" onClick={() => setSendError(null)}>✕</span>
                </div>
              )}

              <div className="inp-bar">
                <div className={"inp-wrap" + (!hasQuorum && !allDown ? " nq" : "")}>
                  <input
                    ref={inputRef}
                    className="inp"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendMessage()}
                    placeholder={
                      allDown ? "All nodes down — cannot send" :
                        queuedMsg ? "Another message is already queued..." :
                          !hasQuorum ? `Type message — will queue until quorum restored...` :
                            `Message as ${currentUser}...`
                    }
                    disabled={allDown || loading || !!queuedMsg}
                  />
                </div>
                <button
                  className={"snd " + (!hasQuorum && !allDown ? "snd-nq" : "snd-ok")}
                  onClick={sendMessage}
                  disabled={allDown || loading || !!queuedMsg}
                >
                  {loading ? "⏳" : !hasQuorum && !allDown ? "⏳" : "➤"}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="right">
            <div className="rtabs">
              {[["nodes", "🖥  Nodes"], ["raft", "🤝  Raft"], ["time", "⏱  Time"], ["logs", "⬛  Terminal"]].map(([k, l]) => (
                <button key={k} className={"rtab" + (activeTab === k ? " active" : "")} onClick={() => setActiveTab(k)}>{l}</button>
              ))}
            </div>

            <div className="pbody">

              {/* NODES TAB */}
              {activeTab === "nodes" && <>
                <div className="ng">
                  {servers.map(s => {
                    const isLead = s.name === leader;
                    const cls = isLead && s.alive ? "lead-c" : s.alive ? "alive-c" : "dead-c";
                    return (
                      <div key={s.id} className={"nc " + cls}>
                        <div className="nc-top">
                          <div className="nc-nr">
                            <div className={"ncdot " + (s.alive ? "alive" : "dead")} />
                            <span className="nc-name">{s.name}</span>
                          </div>
                          <span className="nc-reg">{s.region}{isLead && s.alive ? " 👑" : ""}</span>
                        </div>
                        <div className="nctags">
                          <span className={"tag " + (s.alive ? "alive" : "dead")}>{s.alive ? "● Online" : "✕ Crashed"}</span>
                          <span className={"tag " + (s.role || "unknown")}>{s.role || "unknown"}</span>
                          <span className="tag gray">{s.messages?.length ?? 0} msgs</span>
                          <span className="tag gray">T={s.term ?? 0}</span>
                        </div>
                        <div className="ncbtns">
                          <button className="ncbtn crash" onClick={() => crashServer(s.id)} disabled={!s.alive}>💥 Crash</button>
                          <button className="ncbtn rec" onClick={() => recoverServer(s.id)} disabled={s.alive}>✅ Recover</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const cls = hasQuorum ? "good" : aliveCount === 0 ? "bad" : "warn";
                  const col = hasQuorum ? "#34d399" : aliveCount === 0 ? "#f87171" : "#fbbf24";
                  const sub = hasQuorum
                    ? "✓ Raft consensus active — quorum met"
                    : aliveCount === 0
                      ? "✕ System completely down"
                      : `⚠ No quorum — ${aliveCount}/${servers.length} alive. Messages held in queue.`;
                  return (
                    <div className={"rfstrip " + cls}>
                      <div>
                        <div className="rflbl">Alive Nodes</div>
                        <div className="rfnum" style={{ color: col }}>{aliveCount}/{servers.length}</div>
                      </div>
                      <div style={{ textAlign: "right", maxWidth: "60%" }}>
                        <div className="rfsub" style={{ color: col }}>{sub}</div>
                        {(pendingCount > 0 || queuedMsg) && (
                          <div style={{ fontSize: "13px", color: "#fb923c", marginTop: "4px", fontWeight: "700" }}>
                            ⏳ {pendingCount + (queuedMsg ? 1 : 0)} message(s) in queue
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>}

              {/* RAFT TAB */}
              {activeTab === "raft" && (
                <div className="raftbody">
                  <div className="raft-hero">
                    <div className="rh-top">👑 Raft Leader</div>
                    <div className="rh-name">
                      {leader ? leader : hasQuorum ? "Electing..." : "No leader — no quorum"}
                    </div>
                    <div className="rh-meta">
                      Term: {currentTerm} · Needs {Math.floor(servers.length / 2) + 1}/{servers.length} for quorum · {hasQuorum ? "✓ Consensus active" : "✕ Consensus suspended"}
                    </div>
                  </div>

                  <div className="raft-grid">
                    {servers.map(s => {
                      const role = s.role || "unknown";
                      return (
                        <div key={s.id} className={"rn" + (s.name === leader && s.alive ? " rnlead" : "")}>
                          <div className="rn-top">
                            <span className="rn-name">{s.name}</span>
                            <span className={"rn-role " + role}>{role}</span>
                          </div>
                          <div className="rn-stats">
                            <div className="rn-row"><span className="rn-k">Term</span><span className="rn-v">{s.term ?? 0}</span></div>
                            <div className="rn-row"><span className="rn-k">Commit</span><span className="rn-v">{s.commitIndex ?? 0}</span></div>
                            <div className="rn-row"><span className="rn-k">Log</span><span className="rn-v">{s.logLen ?? 0}</span></div>
                            <div className="rn-row"><span className="rn-k">Status</span><span className="rn-v" style={{ color: s.alive ? "#34d399" : "#f87171" }}>{s.alive ? "alive" : "dead"}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(pendingCount > 0 || queuedMsg) && (
                    <div className="pend-box">
                      <div className="pend-title">⏳ Queued Messages ({pendingCount + (queuedMsg ? 1 : 0)})</div>
                      {queuedMsg && (
                        <div className="pend-item">
                          <div className="pend-sender">{queuedMsg.sender} <span style={{ fontSize: "10px", color: "#fb923c", fontWeight: "600" }}>· local queue</span></div>
                          <div className="pend-content">"{queuedMsg.content}"</div>
                        </div>
                      )}
                      <div className="pend-note">Will auto-commit through Raft when majority ({Math.floor(servers.length / 2) + 1}/{servers.length} nodes) recovers.</div>
                    </div>
                  )}

                  <div className="infobox">
                    <strong>Why messages queue when majority fails:</strong><br />
                    Raft requires <strong>majority ({Math.floor(servers.length / 2) + 1}/{servers.length} nodes)</strong> to commit any log entry.
                    With only 1 node alive, the leader cannot confirm replication safely.
                    Messages are held in a local queue and committed automatically when quorum returns.<br /><br />
                    <strong style={{ color: "#34d399" }}>✅ committed</strong> = replicated to majority, visible to everyone<br />
                    <strong style={{ color: "#fb923c" }}>⏳ queued</strong> = held locally, NOT yet committed or visible
                  </div>
                </div>
              )}

              {/* TIME TAB */}
              {activeTab === "time" && (
                <div className="timebody">
                  <button className="syncbtn" onClick={triggerSync} disabled={syncing || allDown}>
                    {syncing ? "⏳ Synchronising..." : "⏱  Run Berkeley Clock Sync"}
                  </button>
                  {syncResult && (
                    <div className="sync-res">
                      <div className="sync-res-title">✅ Sync Complete</div>
                      <div className="sync-res-time">{syncResult.master_readable || new Date((syncResult.master_time || 0) * 1000).toLocaleTimeString()}</div>
                      <div className="sync-nodes">
                        {Object.entries(syncResult.skews || {}).map(([n, v]) => (
                          <div key={n} className="sync-node">{n}: correction {v > 0 ? "+" : ""}{v.toFixed(3)}s</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="skew-card">
                    <div className="skew-title">Live Clock Skew per Node</div>
                    {Object.keys(timeSkews).length === 0
                      ? <div style={{ color: "#374151", fontSize: "13px" }}>Connecting...</div>
                      : Object.entries(timeSkews).map(([name, skew]) => {
                        const pct = Math.min(Math.abs(skew) / 2 * 100, 100);
                        const bc = skew > 0.05 ? "#fbbf24" : skew < -0.05 ? "#60a5fa" : "#34d399";
                        const cls = skew > 0.05 ? "pos" : skew < -0.05 ? "neg" : "zero";
                        return (
                          <div key={name} className="skew-row">
                            <span className="skew-srv">{name}</span>
                            <div className="skew-bw"><div className="skew-b" style={{ width: pct + "%", background: bc }} /></div>
                            <span className={"skew-val " + cls}>{skew > 0 ? "+" : ""}{skew.toFixed(3)}s</span>
                          </div>
                        );
                      })
                    }
                  </div>
                  <div className="infobox">
                    <strong>Berkeley Algorithm (Member 03 — Sasiru):</strong><br />
                    1. Master polls every alive node for its local time<br />
                    2. Calculates the <strong>average</strong> of all replies<br />
                    3. Sends each node its correction offset (+ or −)<br />
                    4. Messages re-sorted by corrected timestamp<br /><br />
                    <strong style={{ color: "#fbbf24" }}>Orange</strong> = clock fast &nbsp;·&nbsp;
                    <strong style={{ color: "#60a5fa" }}>Blue</strong> = clock slow &nbsp;·&nbsp;
                    <strong style={{ color: "#34d399" }}>Green</strong> = accurate
                  </div>
                </div>
              )}

              {/* TERMINAL TAB */}
              {activeTab === "logs" && (
                <div className="term">
                  <div className="term-hdr">
                    <div className="tdots">
                      <div className="tdot r" /><div className="tdot y" /><div className="tdot g" />
                    </div>
                    <span className="ttitle">nexuschat@cluster — system log</span>
                    <span className="tcount">{logs.length} events</span>
                  </div>
                  <div className="tbody">
                    {logs.map(log => {
                      const col = LOG_COLORS[log.type] || "#4b5563";
                      const typeStr = ("[" + log.type.toUpperCase() + "]").padEnd(12);
                      return (
                        <div key={log.id} className="tline">
                          <span className="tts">{log.time} </span>
                          <span className="tpr">$ </span>
                          <span className="ttype" style={{ color: col }}>{typeStr} </span>
                          <span className="tmsg">{log.text}</span>
                        </div>
                      );
                    })}
                    <div className="tline">
                      <span className="tts">{"         "}</span>
                      <span className="tpr">$ </span>
                      <span className="tmsg" style={{ color: "#818cf8" }}>_<span className="tcursor" /></span>
                    </div>
                    <div ref={termEndRef} />
                  </div>
                  <div className="tfooter">
                    <span className="tfp">nexuschat@cluster:~$</span>
                    <span className="tft">
                      {aliveCount}/{servers.length} nodes · {hasQuorum ? "quorum active" : "NO QUORUM"} · {pendingCount + (queuedMsg ? 1 : 0)} pending
                    </span>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
