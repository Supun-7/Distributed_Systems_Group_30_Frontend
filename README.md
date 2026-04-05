# NexusChat — Frontend
### Fault-Tolerant Distributed Messaging System
**SE2062 Distributed Systems · Group 30**

<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" width="48" title="React"/>
  &nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vitejs/vitejs-original.svg" width="48" title="Vite"/>
  &nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" width="48" title="JavaScript"/>
</div>

---

## Table of Contents

- [Overview](#overview)
- [Team Members](#team-members)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Features](#features)
- [UI Panels](#ui-panels)
- [How It Connects to the Backend](#how-it-connects-to-the-backend)
- [Key State & Logic](#key-state--logic)
- [Screenshots](#screenshots)

---

## Overview

This is the React frontend for **NexusChat** — a visual dashboard that lets you interact with and observe a live Raft-based distributed messaging cluster in real time.

You can:
- Send messages to the cluster and see them replicated across nodes
- Crash and recover individual nodes with one click
- Watch the system queue messages when quorum is lost and auto-deliver them when quorum returns
- Observe Raft leader election, terms, commit indexes, and log lengths
- Trigger Berkeley clock synchronisation and view per-node clock skew
- Read the system event log in a terminal-style view

---

## Team Members

| # | Name | Responsibility |
|---|------|----------------|
| 01 | Supun Dharmaratne | Fault Tolerance — Failure Detection & Recovery |
| 02 | Ruchira Lakshan | Data Replication — Quorum-Based Consistency |
| 03 | Sasiru Sithujaya | Time Synchronisation — Berkeley Algorithm |
| 04 | Sachith Asmadala | Consensus & Agreement — Raft Leader Election |

---

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| React 18 | UI framework with hooks |
| Vite | Development server and build tool |
| Plain CSS (inline `<style>`) | Component styling — no external CSS library |
| Fetch API | HTTP calls to the Flask backend |

No UI component library is used. All styling is custom, embedded in `NexusChat.jsx`.

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Install and run

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

The app will be available at **http://localhost:5173**.

> **Important:** The backend must be running at `http://localhost:8000` before opening the frontend. Start it with `python api.py` in the backend repository.

### Build for production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server.

---

## Project Structure

```
src/
├── main.jsx          # React entry point — mounts <NexusChat /> into #root
├── App.jsx           # Thin wrapper (delegates to NexusChat)
├── NexusChat.jsx     # Entire application — all state, logic, and UI
├── index.css         # Global resets
└── App.css           # Minimal base styles
```

All application logic lives in **`NexusChat.jsx`** — a single-file component with custom inline styles.

---

## Features

### Real-time Cluster Polling
`fetchAll()` runs every **2 seconds** via `setInterval`, fetching:
- `/api/status` — node states, leader, term, quorum, pending count
- `/api/messages` — committed messages (pending messages are excluded from the chat view)
- `/api/logs` — system event log
- `/api/time/report` — live clock skew per node

### Message Queue (No-Quorum Handling)
When the cluster loses quorum (fewer than 2 of 3 nodes alive):
- Typing and sending a message puts it in a **local frontend queue** (shown in the input bar with an hourglass)
- The queued message is displayed with the countdown "Will be sent automatically when majority recovers"
- Once `fetchAll()` detects quorum is restored, it triggers `retryQueuedMessage()` to send the held message
- The backend also maintains its own pending queue and retries independently

### Node Crash / Recovery
Each node card has **Crash** and **Recover** buttons that POST to `/api/servers/<id>/crash` and `/api/servers/<id>/recover`. After each action, `fetchAll()` is called immediately to refresh the UI.

### Quorum Status Banner
Displayed below the node grid:
- **Green** — `✓ Raft consensus active — quorum met`
- **Yellow** — `⚠ No quorum — X/3 alive. Messages held in queue.`
- **Red** — `✕ System completely down`

### User Switching
Four users (Supun, Ruchira, Sachith, Sasiru) can be selected from the header. Each has a unique colour. All messages are sent under the currently selected user's name.

---

## UI Panels

The right panel has four tabs:

### Nodes Tab (default)
Displays a card for each cluster node showing:
- Name, region, alive/crashed status
- Raft role (leader / follower)
- Number of messages stored
- Current term
- Crash and Recover buttons

Below the node cards, the **Alive Nodes** strip shows the quorum count and any pending message count.

### Raft Tab
Shows:
- The current leader name and term
- Per-node stats: role, term, commit index, log length, alive status
- A queued-messages box if any messages are waiting for quorum
- An educational explanation of why messages queue when the majority fails

### Time Tab
Shows:
- A button to trigger Berkeley clock synchronisation (`POST /api/time/sync`)
- Sync result (master time, per-node corrections) after a sync completes
- Live per-node clock skew as a bar chart

### Terminal Tab
A styled terminal view of all backend log events. Events are colour-coded by type:

| Type | Colour |
|------|--------|
| `boot` | Green |
| `store` | Blue |
| `crash` | Red |
| `failover` | Amber |
| `recovery` | Purple |
| `leader` | Amber |
| `pending` | Orange |
| `commit` | Green |

---

## How It Connects to the Backend

All requests go to `http://localhost:8000/api` (the `API` constant at the top of `NexusChat.jsx`).

```
Frontend (localhost:5173)          Backend (localhost:8000)
─────────────────────────          ─────────────────────────
fetchAll() every 2s    ──────────► GET /api/status
                       ◄──────────  { servers, leader, term, hasQuorum, pendingCount }

                       ──────────► GET /api/messages
                       ◄──────────  [ { id, sender, content, status, ... } ]

sendMessage()          ──────────► POST /api/messages  { sender, content }
                       ◄──────────  201 (committed) | 202 (queued)

crashServer(id)        ──────────► POST /api/servers/<id>/crash
recoverServer(id)      ──────────► POST /api/servers/<id>/recover

triggerSync()          ──────────► POST /api/time/sync
                       ◄──────────  { master_time, skews }
```

CORS is handled by the backend (`Access-Control-Allow-Origin: *`).

---

## Key State & Logic

| State variable | Type | Purpose |
|----------------|------|---------|
| `servers` | array | Node list from `/api/status` |
| `messages` | array | Committed messages shown in chat |
| `leader` | string | Name of current Raft leader |
| `currentTerm` | number | Raft term number |
| `hasQuorum` | boolean | Whether majority of nodes are alive |
| `pendingCount` | number | Backend-side pending message count |
| `queuedMsg` | object | Frontend-held message waiting for quorum |
| `timeSkews` | object | Per-node clock skew values |
| `activeTab` | string | Which right-panel tab is selected |

### `fetchAll()` — central polling function
Fetches all four API endpoints in parallel with `Promise.all()`. After updating state, checks if quorum was just restored (`hasQuorum && queuedMsg`) and fires `retryQueuedMessage()` if so.

### `retryQueuedMessage(msg)` — queued message delivery
POSTs the queued message to `/api/messages`. On `201`, clears `queuedMsg`. Uses a `isSendingRef` ref guard to prevent concurrent retries from being triggered by back-to-back polling cycles.

### `sendMessage()` — user-initiated send
If no quorum, stores the message in `queuedMsg` without sending. If quorum is present, POSTs immediately. Handles `201` (committed) and `202` (backend queued) responses.

---

## Screenshots

**Quorum lost — message waiting in queue:**

> Node-02 and Node-03 are crashed. The input bar shows the held message with an hourglass and a "Will be sent automatically" notice. The Alive Nodes strip shows `1/3` in amber with the no-quorum warning.

**Quorum restored — message auto-delivered:**

> Node-02 has recovered. The cluster is back to `2/3`. The queued message is committed and appears in the chat. The Alive Nodes strip turns green with `✓ Raft consensus active`.

---

*SE2062 Distributed Systems · Group 30 · © 2026*