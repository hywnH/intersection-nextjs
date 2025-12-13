# Workspace Issues Analysis

## Issues Identified

### 1. NoiseCraft Components Not Being Modulated

**Location**: `test-workspace.html` and `individual-workspace.html`

**Root Cause Analysis**:

The `sendToNoiseCraft` function has three conditions that must all be true for parameters to be sent:

```javascript
function sendToNoiseCraft(params) {
  if (!iframe || !noisecraftReady || !params.length) return;
  // ... send params
}
```

**Potential Issues**:

1. **`noisecraftReady` flag not set correctly**:
   - The flag is set in the iframe `load` event handler (line ~2480 in test-workspace.html)
   - If the iframe loads before the event handler is attached, the flag might never be set
   - If the iframe reloads, the flag might be reset but not set again

2. **`params.length === 0`**:
   - `generateParams()` only returns params for **enabled** mappings
   - If no mappings exist or all mappings are disabled, params array will be empty
   - The function filters out mappings where `mapping.enabled === false`

3. **`iframe` not available**:
   - Iframe might not be found or might be null
   - Iframe might be reloading, causing it to be temporarily unavailable

**Code Flow**:
- `update()` loop calls `streamMapper.generateParams(signals0)` (line ~1961)
- `generateParams()` iterates through `this.mappings` and only includes enabled ones (line ~757)
- If no enabled mappings exist, `params` array is empty
- `sendToNoiseCraft(params)` returns early if `params.length === 0`

### 2. Webpage Reloading Repeatedly

**Location**: `embedded.html` and workspace files

**Root Cause Analysis**:

**Potential Causes**:

1. **Auto-save mechanism triggering reloads**:
   - Auto-save is enabled for `indiv_audio_map.ncft` (line ~2492 in test-workspace.html)
   - Auto-save triggers on every model update (debounced, line ~666 in embedded.html)
   - When file is saved, the iframe might be trying to reload to get the latest version
   - The `loadProjectFromSrc` function uses cache-busting (`?t=${Date.now()}`) for `.ncft` files (line ~350 in embedded.html)

2. **Iframe src being modified**:
   - If the iframe src is being changed programmatically, it would cause a reload
   - No direct evidence of this in the code, but could be happening indirectly

3. **Error handling causing reloads**:
   - If there's an uncaught error in the iframe, it might cause a reload
   - The animation loop has error handling that restarts it, but doesn't cause page reloads

4. **Model update loop**:
   - The model.update function is called frequently (every frame potentially)
   - Auto-save is debounced but still triggers frequently
   - If saving causes the iframe to reload, this would create a reload loop

**Key Code Locations**:

- Auto-save enabled: `test-workspace.html:2492`
- Auto-save trigger: `embedded.html:666` (debounced, 1000ms)
- Cache-busting: `embedded.html:350` (for .ncft files)
- Iframe load handler: `test-workspace.html:2479`

## Recommended Fixes

### Fix 1: Add Debug Logging

Add console logging to `sendToNoiseCraft` to identify which condition is failing:

```javascript
function sendToNoiseCraft(params) {
  if (!iframe) {
    console.warn('[sendToNoiseCraft] Iframe not available');
    return;
  }
  if (!noisecraftReady) {
    console.warn('[sendToNoiseCraft] NoiseCraft not ready');
    return;
  }
  if (!params.length) {
    console.warn('[sendToNoiseCraft] No params to send (mappings might be empty or disabled)');
    return;
  }
  // ... send params
}
```

### Fix 2: Verify Mappings Are Enabled

Check if mappings exist and are enabled:

```javascript
console.log('[Debug] Mappings:', streamMapper.mappings);
console.log('[Debug] Enabled mappings:', streamMapper.mappings.filter(m => m.enabled));
console.log('[Debug] Generated params:', params);
```

### Fix 3: Prevent Reload Loop

If auto-save is causing reloads, we need to:

1. **Disable auto-save during parameter updates**:
   - Parameter updates shouldn't trigger auto-save
   - Only user-initiated changes should trigger auto-save

2. **Prevent iframe reload on save**:
   - Don't reload the iframe when file is saved
   - The file is already loaded, no need to reload

3. **Add reload prevention**:
   - Track if a reload is in progress
   - Prevent multiple simultaneous reloads

### Fix 4: Ensure noisecraftReady Flag is Set

Add a check to ensure the flag is set correctly:

```javascript
iframe.addEventListener("load", async () => {
  console.log('[Iframe] Load event fired');
  statusEl.textContent = "Ready. Click Start to begin.";
  noisecraftReady = true;
  console.log('[Iframe] noisecraftReady set to true');
  // ... rest of code
});
```

## Next Steps

1. Add debug logging to identify the exact issue
2. Check browser console for error messages
3. Verify mappings are configured and enabled
4. Check if iframe is reloading (network tab)
5. Verify `noisecraftReady` flag is being set


