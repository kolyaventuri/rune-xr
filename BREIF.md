# RuneScape Tabletop AR (WebXR Prototype) – Project Brief

## Overview

Build a **WebXR-based mixed reality prototype** that renders a live, miniature “tabletop” version of Old School RuneScape (via RuneLite) on a real-world surface (e.g., a table), viewable through a Quest headset.

The system will:

* Extract nearby game state from RuneLite
* Stream it to a browser-based 3D renderer
* Render a stylized, real-time diorama anchored in physical space using WebXR

---

## Core Concept

A **living tactical board** representing the player’s immediate surroundings in RuneScape:

* Terrain is represented as a raised tile grid
* Players/NPCs appear as markers or miniatures
* Objects (trees, walls, etc.) appear as simplified proxies
* Interaction is initially passive (view-only)

Think:

> RuneScape × Warhammer tabletop × holographic map

---

## Goals (Phase 1 Prototype)

### Primary Goal

> “View a live 25x25 tile chunk of RuneScape as a 3D tabletop scene in Quest passthrough AR.”

### Secondary Goals

* Real-time updates (~2–10 Hz is fine)
* Stable world anchoring on a detected surface
* Clear visual distinction between terrain, actors, and objects
* Minimal latency between RuneLite and AR scene

---

## Non-Goals (for now)

* Full RuneScape rendering fidelity
* Stereo reprojection of the actual game renderer
* Input/control from XR (no gameplay interaction yet)
* Hand tracking / gesture controls
* Cross-headset support beyond Quest Browser
* Plugin Hub compliance

---

## System Architecture

### 1. RuneLite Plugin (Data Source)

Runs inside RuneLite and exports scene data.

**Responsibilities:**

* Sample local game state (radius ~25 tiles)
* Extract:

  * Player position
  * Nearby NPCs and players
  * Tile heights
  * Basic object data
* Send data over WebSocket (localhost or LAN)

---

### 2. Web Server / Transport Layer

Simple Node.js (or similar) WebSocket server.

**Responsibilities:**

* Receive data from RuneLite plugin
* Broadcast to connected browser clients
* Serve static frontend files

---

### 3. WebXR Client (Quest Browser)

Browser-based 3D app using WebXR.

**Tech Stack:**

* Three.js
* WebXR Device API (`immersive-ar`)
* WebSocket client

**Responsibilities:**

* Receive scene updates
* Build and update 3D scene
* Anchor board to real-world surface
* Render terrain + actors + objects

---

## Data Model (Initial)

### Tile

```json
{
  "x": 3200,
  "y": 3200,
  "plane": 0,
  "height": 12
}
```

### Actor (Player / NPC)

```json
{
  "id": "player_123",
  "type": "player",
  "name": "Kolya",
  "x": 3205,
  "y": 3198,
  "plane": 0
}
```

### Object (Simplified)

```json
{
  "id": 12345,
  "type": "tree",
  "x": 3202,
  "y": 3201,
  "plane": 0
}
```

### Scene Snapshot

```json
{
  "timestamp": 1710000000,
  "baseX": 3190,
  "baseY": 3190,
  "tiles": [...],
  "actors": [...],
  "objects": [...]
}
```

---

## Rendering Approach

### Terrain

* Grid mesh generated from tile heights
* Slight vertical exaggeration for readability
* Optional color by elevation

### Actors

* Phase 1: cylinders or billboards
* Color-coded:

  * Player = green
  * NPC = red
  * Other players = blue

### Objects

* Simple primitives (boxes, cones, etc.)
* Later: map common IDs → stylized meshes

### Scale

* ~1 tile = 2–5 cm in real-world space
* Entire board fits comfortably on a table

---

## WebXR Behavior

### Session Type

* `immersive-ar`

### Features Used

* Plane detection
* Anchors

### Flow

1. User opens site in Quest Browser
2. Enters AR mode
3. Selects a surface (table/floor)
4. Board is anchored and rendered
5. Scene updates in real time

---

## Update Strategy

* RuneLite sends updates at fixed interval (e.g., 5 Hz)
* Client:

  * Rebuilds terrain only when needed
  * Smoothly interpolates actor movement between updates

---

## Milestone Plan

### Milestone 1 – Data Extraction

* RuneLite plugin logs nearby tiles + player position

### Milestone 2 – Desktop Viewer

* Three.js renders static tile grid from sample data

### Milestone 3 – Live Sync

* WebSocket connection with live updates

### Milestone 4 – WebXR Integration

* Scene renders in Quest Browser VR (not AR yet)

### Milestone 5 – AR Anchoring

* Board placed on real-world surface

### Milestone 6 – Visual Polish

* Better terrain shaping
* Actor markers improved
* Basic object rendering

---

## Risks & Constraints

### Technical

* RuneLite does not expose full mesh data → must approximate visuals
* WebXR AR on Quest 2 is grayscale passthrough
* No access to camera pixels in WebXR passthrough mode

### Performance

* Must limit tile radius to maintain frame rate
* Keep geometry lightweight

### UX

* Scale and readability will require tuning
* Too much visual fidelity may hurt clarity

---

## Success Criteria

The prototype is successful if:

* A user can stand over a real table
* See a stable, anchored RuneScape board
* Watch their character and nearby entities move in real time

---

## Future Extensions

* Click-to-highlight tiles (linked back to RuneLite)
* Path visualization (movement lines)
* Combat indicators / overlays
* Stylized assets for common objects
* Multiplayer shared board view
* Quest hand tracking interaction
* Full Unity/OpenXR port if needed

---

## Summary

This project aims to create a **mixed reality RuneScape companion experience** by combining RuneLite’s accessible game state with WebXR’s ability to render spatial content directly in a browser.

The focus is not on replicating RuneScape visually, but on **reinterpreting it as a physical, living tabletop system**.
