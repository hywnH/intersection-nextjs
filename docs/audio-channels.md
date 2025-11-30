# Audio Cluster Prototype Notes

## Overview

This prototype adds proximity-based clusters, server-driven audio payloads, and a thin NoiseCraft bridge so that each personal view hears its own noise + cluster chord, while the global view follows the dominant cluster.

## Server

### Clustering
- Runs every ~200 ms (and on player join/leave).
- Breadth-first grouping with a 420 px radius.
- Each cluster stores `clusterId`, centroid, member count, gain, and a fixed C–E–G triad where frequency/gain are scaled by cluster size.

### Audio payloads
- `audioSelf`: `{ noiseLevel (0-1), ambientLevel (0-1), clusterId }`
- `audioCluster`: `{ clusterId, chord: [{ freq, gain }], memberCount, centroid, gain }`
- `audioGlobal`: `{ cluster: audioCluster | null }`
- Players get `audioSelf` + `audioCluster`, spectators get `audioGlobal`.

## Client

### State shape
```ts
audio: {
  self: { noiseLevel, ambientLevel, clusterId, updatedAt } | null;
  cluster: { clusterId, chord, memberCount, centroid, gain, updatedAt, source: "cluster" } | null;
  global:  { ... source: "global" } | null;
}
```

### Socket handlers
- `audioSelf` → `SET_AUDIO` (self)
- `audioCluster` → `SET_AUDIO` (cluster)
- `audioGlobal` → `SET_AUDIO` (global)

### NoiseCraft bridge
- Shared helper builds `SetParam` commands:
  - Self mode: node `0` (freq) & `1` (gain).
  - Cluster/global: nodes `4/6/8` for triad freqs, node `12` for gain.
- Personal view renders a compact NoiseCraft iframe (hidden on small screens) and posts messages with the calculated params.
- Global view reuses its existing iframe and now receives chord data via `postMessage`.

### Embedded patch
- `noisecraft/public/embedded.html` now loads a tiny patch (self sine + three chord sines mixed into audio out) and listens for:
  - `noiseCraft:setParams` → updates `SetParam` on the requested nodes.
  - `noiseCraft:play` / `noiseCraft:stop` → optional remote transport.

## Next Steps
- Replace the placeholder triad/gain logic with production-ready audio design.
- Add real DSP/visual feedback for clusters (e.g., filters per cluster).
- Harden autoplay UX on mobile (surface a dedicated “Start Audio” banner).

