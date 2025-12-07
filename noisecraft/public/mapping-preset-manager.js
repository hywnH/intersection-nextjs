/**
 * Mapping Preset Manager Module
 * Manages stream-to-node mappings for individual and global audio
 * Supports export/import as JSON files
 */

export class MappingPresetManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'noisecraftStreamMappings';
    this.presets = new Map(); // presetName -> mappings array
    this.currentPreset = null;
    this.currentMappings = [];
  }

  /**
   * Load mappings from localStorage
   */
  loadFromStorage() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        this.currentMappings = JSON.parse(stored);
        console.log(`[PresetManager] Loaded ${this.currentMappings.length} mappings from storage`);
      } catch (e) {
        console.warn('[PresetManager] Failed to load mappings from storage', e);
        this.currentMappings = [];
      }
    }
  }

  /**
   * Save mappings to localStorage
   */
  saveToStorage() {
    localStorage.setItem(
      this.storageKey,
      JSON.stringify(this.currentMappings)
    );
  }

  /**
   * Get current mappings
   */
  getMappings() {
    return this.currentMappings;
  }

  /**
   * Set current mappings
   */
  setMappings(mappings) {
    this.currentMappings = Array.isArray(mappings) ? mappings : [];
    this.saveToStorage();
  }

  /**
   * Add a mapping
   */
  addMapping(mapping) {
    const id = mapping.id || `mapping-${Date.now()}`;
    this.currentMappings.push({ ...mapping, id });
    this.saveToStorage();
    return id;
  }

  /**
   * Update a mapping
   */
  updateMapping(id, updates) {
    const index = this.currentMappings.findIndex(m => m.id === id);
    if (index !== -1) {
      this.currentMappings[index] = { ...this.currentMappings[index], ...updates };
      this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Remove a mapping
   */
  removeMapping(id) {
    this.currentMappings = this.currentMappings.filter(m => m.id !== id);
    this.saveToStorage();
  }

  /**
   * Export current mappings to JSON file
   */
  exportMappings(filename = null) {
    if (this.currentMappings.length === 0) {
      throw new Error('No mappings to export');
    }

    const data = {
      mappings: this.currentMappings,
      metadata: {
        exportTime: new Date().toISOString(),
        version: '1.0',
        presetName: this.currentPreset || 'default'
      }
    };

    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `noisecraft-mappings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[PresetManager] Exported ${this.currentMappings.length} mappings`);
    return data;
  }

  /**
   * Import mappings from JSON file
   */
  async importMappings(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          
          // Support both old format (array) and new format (object with metadata)
          let mappings;
          if (Array.isArray(data)) {
            mappings = data;
          } else if (data.mappings && Array.isArray(data.mappings)) {
            mappings = data.mappings;
            if (data.metadata?.presetName) {
              this.currentPreset = data.metadata.presetName;
            }
          } else {
            throw new Error('Invalid file format: expected array of mappings or object with mappings property');
          }

          // Validate mappings
          const validMappings = mappings.filter(m => {
            return m && typeof m === 'object' && m.nodeId !== undefined;
          });

          if (validMappings.length === 0) {
            throw new Error('No valid mappings found in file');
          }

          // Replace current mappings
          this.setMappings(validMappings);
          
          console.log(`[PresetManager] Imported ${validMappings.length} mappings`);
          resolve(validMappings);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }

  /**
   * Save current mappings as a named preset
   */
  savePreset(name, description = '') {
    if (!name || name.trim() === '') {
      throw new Error('Preset name cannot be empty');
    }

    this.presets.set(name, {
      name,
      description,
      mappings: JSON.parse(JSON.stringify(this.currentMappings)), // Deep copy
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    this.savePresetsToStorage();
    console.log(`[PresetManager] Saved preset: ${name}`);
  }

  /**
   * Load a named preset
   */
  loadPreset(name) {
    const preset = this.presets.get(name);
    if (!preset) {
      throw new Error(`Preset "${name}" not found`);
    }

    this.currentPreset = name;
    this.setMappings(preset.mappings);
    console.log(`[PresetManager] Loaded preset: ${name}`);
    return preset;
  }

  /**
   * Delete a preset
   */
  deletePreset(name) {
    const deleted = this.presets.delete(name);
    if (deleted) {
      this.savePresetsToStorage();
      console.log(`[PresetManager] Deleted preset: ${name}`);
    }
    return deleted;
  }

  /**
   * List all presets
   */
  listPresets() {
    return Array.from(this.presets.values());
  }

  /**
   * Save presets to localStorage
   */
  savePresetsToStorage() {
    const presetsData = Array.from(this.presets.entries()).map(([name, preset]) => ({
      name,
      ...preset
    }));
    localStorage.setItem(`${this.storageKey}_presets`, JSON.stringify(presetsData));
  }

  /**
   * Load presets from localStorage
   */
  loadPresetsFromStorage() {
    const stored = localStorage.getItem(`${this.storageKey}_presets`);
    if (stored) {
      try {
        const presetsData = JSON.parse(stored);
        presetsData.forEach(({ name, ...preset }) => {
          this.presets.set(name, { name, ...preset });
        });
        console.log(`[PresetManager] Loaded ${this.presets.size} presets from storage`);
      } catch (e) {
        console.warn('[PresetManager] Failed to load presets from storage', e);
      }
    }
  }

  /**
   * Initialize - load from storage
   */
  initialize() {
    this.loadFromStorage();
    this.loadPresetsFromStorage();
  }
}

/**
 * Factory function to create preset manager
 */
export function createMappingPresetManager(options = {}) {
  const manager = new MappingPresetManager(options);
  manager.initialize();
  return manager;
}

