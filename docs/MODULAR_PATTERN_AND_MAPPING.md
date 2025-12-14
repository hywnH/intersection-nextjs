# Modular Pattern Assignment and Cross-Browser Mapping Storage

## Overview

This document describes the new modular architecture for:
1. **Pattern Assignment**: Centralized sequencer pattern generation for individual and global audio
2. **Mapping Storage**: Cross-browser storage with import/export and .ncft file integration

---

## 1. Pattern Assignment Module

### Location
`/noisecraft/public/pattern-assignment.js`

### Purpose
Consolidates all sequencer pattern assignment logic into a single module that can integrate with Tonal.js.

### Features

- ✅ **Modular Design**: Single module for all pattern generation
- ✅ **Tonal.js Ready**: Can integrate with Tonal.js when available
- ✅ **Individual & Global**: Supports both individual and global audio modes
- ✅ **Harmonization**: Uses existing music theory or Tonal.js for harmonious patterns

### Usage

```javascript
import { createPatternAssignmentManager } from '/public/pattern-assignment.js';

// Create manager
const patternManager = createPatternAssignmentManager({
  mode: 'individual', // or 'global'
  key: 'C',
  scale: 'major'
});

// Generate pattern for new particle
const existingPatterns = patternManager.getAllPatterns().map(p => p.pattern);
const newPattern = patternManager.generateUniquePattern(particleId, existingPatterns);

// Assign to particle
patternManager.assignPattern(particleId, newPattern);
particle.sequencerPattern = newPattern;
```

### Integration with Tonal.js

```javascript
// When Tonal.js is available
import * as Tonal from '@tonaljs/tonal';

const patternManager = createPatternAssignmentManager({ mode: 'individual' });
patternManager.setTonalLibrary(Tonal);

// Now patterns will use Tonal.js for sophisticated harmonization
const pattern = patternManager.generateUniquePattern(particleId, existingPatterns);
```

---

## 2. Mapping Storage Module

### Location
`/noisecraft/public/mapping-storage.js`

### Purpose
Provides cross-browser storage for stream-to-node mappings with import/export functionality.

### Features

- ✅ **localStorage**: Local browser storage (backward compatible)
- ✅ **Project File**: Store mappings in .ncft file metadata
- ✅ **Export/Import**: JSON file export/import for portability
- ✅ **Cross-Browser**: Works on any browser/device

### Storage Locations

1. **localStorage** (default, backward compatible)
   - Key: `noisecraftMappings_{filename}`
   - Fast, local only

2. **Project File** (.ncft metadata)
   - Stored in `project.metadata.streamMappings`
   - Portable, travels with project file

3. **JSON Export/Import**
   - Download/upload mappings as JSON file
   - Share mappings across devices

### Usage

```javascript
import { createMappingStorage } from '/public/mapping-storage.js';

// Create storage instance
const mappingStorage = createMappingStorage('indiv_audio_map.ncft');

// Load mappings (from project file or localStorage)
const mappings = await mappingStorage.loadMappings(projectData);

// Save mappings (to localStorage and/or project file)
const updatedProject = await mappingStorage.saveMappings(
  mappings, 
  projectData,  // Optional: embed in project file
  true          // Also save to localStorage
);

// Export mappings as JSON
mappingStorage.exportAsJSON(mappings, 'my-mappings.json');

// Import mappings from file
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json';
fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  const importedMappings = await mappingStorage.importFromJSON(file);
  // Use imported mappings
};
```

### Storing in .ncft File

Mappings are stored in the project's `metadata` field:

```json
{
  "title": "Individual Audio",
  "nodes": { ... },
  "metadata": {
    "streamMappings": [
      {
        "id": "mapping-123",
        "nodeId": "183",
        "paramName": "value",
        "enabled": true,
        "streams": [
          {
            "stream": "attraction",
            "interpolation": "linear",
            "inputMin": 0,
            "inputMax": 1,
            "outputMin": 0,
            "outputMax": 1
          }
        ],
        "operation": "none"
      }
    ],
    "streamMappingsVersion": "1.0",
    "streamMappingsUpdated": "2024-01-01T12:00:00.000Z"
  }
}
```

---

## 3. Integration Steps

### Step 1: Update StreamNodeMapper

Replace the inline `StreamNodeMapper` class in `test-workspace.html` with the new storage module:

```javascript
import { createMappingStorage } from '/public/mapping-storage.js';

class StreamNodeMapper {
  constructor(filename = null) {
    this.storage = createMappingStorage(filename);
    this.mappings = [];
    this.loadMappings();
  }

  async loadMappings() {
    // Try loading from project file first, then localStorage
    const projectData = await this.loadProjectData(); // Load current .ncft
    this.mappings = await this.storage.loadMappings(projectData);
  }

  async saveMappings(embedInProject = false) {
    // Save to localStorage
    this.storage.saveToLocalStorage(this.mappings);
    
    // Optionally embed in project file
    if (embedInProject) {
      const projectData = await this.loadProjectData();
      const updatedProject = this.storage.saveToProjectFile(projectData, this.mappings);
      await this.saveProjectData(updatedProject);
    }
  }
}
```

### Step 2: Add Export/Import UI

Add buttons to the mapping panel:

```html
<div class="mapping-actions">
  <button id="export-mappings-btn">Export Mappings</button>
  <button id="import-mappings-btn">Import Mappings</button>
  <input type="file" id="import-file-input" accept=".json" style="display: none;">
</div>
```

```javascript
// Export mappings
document.getElementById('export-mappings-btn').addEventListener('click', () => {
  const filename = `mappings-${new Date().toISOString().split('T')[0]}.json`;
  streamMapper.storage.exportAsJSON(streamMapper.mappings, filename);
});

// Import mappings
document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    try {
      const mappings = await streamMapper.storage.importFromJSON(file);
      streamMapper.mappings = mappings;
      streamMapper.saveMappings();
      renderMappings(); // Re-render UI
    } catch (error) {
      alert('Failed to import mappings: ' + error.message);
    }
  }
});
```

### Step 3: Integrate Pattern Assignment

Replace inline pattern generation with the modular manager:

```javascript
import { createPatternAssignmentManager } from '/public/pattern-assignment.js';

// Create pattern manager
const patternManager = createPatternAssignmentManager({
  mode: 'individual',
  key: 'C',
  scale: 'major'
});

// When creating particles
particle0.sequencerPattern = patternManager.generateUniquePattern(0, []);

// For subsequent particles
const existingPatterns = patternManager.getAllPatterns().map(p => p.pattern);
particle1.sequencerPattern = patternManager.generateUniquePattern(1, existingPatterns);
patternManager.assignPattern(1, particle1.sequencerPattern);
```

### Step 4: Auto-save Mappings to Project File

Update the save logic to include mappings:

```javascript
// In embedded.html or test-workspace.html
async function saveProjectWithMappings() {
  // Get current project data
  const projectData = model.serialize();
  
  // Embed mappings into project
  const updatedProject = mappingStorage.saveToProjectFile(projectData, streamMapper.mappings);
  
  // Save to server
  await fetch(`/save-ncft/${filename}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: JSON.stringify(updatedProject) })
  });
}
```

---

## 4. Benefits

### Pattern Assignment
- ✅ **Single Source of Truth**: All pattern logic in one module
- ✅ **Easy to Test**: Modular design makes testing easier
- ✅ **Tonal.js Ready**: Easy integration with advanced music theory
- ✅ **Reusable**: Can be used in individual and global workspaces

### Mapping Storage
- ✅ **Portable**: Mappings travel with project file
- ✅ **Shareable**: Export/import JSON files
- ✅ **Cross-Browser**: Works on any device/browser
- ✅ **Backward Compatible**: Still uses localStorage as fallback

---

## 5. Migration Guide

### For Pattern Assignment

**Before:**
```javascript
// Scattered across files
particle.sequencerPattern = generateHarmoniousPattern(...);
// In sequencer-logic.js
generateIndividualPattern(...);
```

**After:**
```javascript
import { createPatternAssignmentManager } from '/public/pattern-assignment.js';
const patternManager = createPatternAssignmentManager({ mode: 'individual' });
particle.sequencerPattern = patternManager.generateUniquePattern(id, existing);
```

### For Mapping Storage

**Before:**
```javascript
// Only localStorage
localStorage.setItem("noisecraftStreamMappings", JSON.stringify(mappings));
```

**After:**
```javascript
import { createMappingStorage } from '/public/mapping-storage.js';
const storage = createMappingStorage('indiv_audio_map.ncft');
await storage.saveMappings(mappings, projectData, true); // localStorage + project file
```

---

## Next Steps

1. **Integrate Modules**: Update `test-workspace.html` to use new modules
2. **Add UI**: Add export/import buttons to mapping panel
3. **Tonal.js Integration**: Install Tonal.js and integrate with pattern manager
4. **Testing**: Test cross-browser mapping portability

