/**
 * NCFT File Manager Module
 * Manages separate .ncft files for individual and global audio
 * Handles file loading, copying, and iframe management
 */

export class NcftFileManager {
  constructor(options = {}) {
    this.basePath = options.basePath || '/public/examples';
    this.individualFile = options.individualFile || 'indiv_audio_map.ncft';
    this.globalFile = options.globalFile || 'global_audio_map.ncft';
    this.individualIframe = null;
    this.globalIframe = null;
    this.individualProject = null;
    this.globalProject = null;
  }

  /**
   * Initialize individual audio iframe
   * @param {String} iframeId - ID of iframe element
   * @param {Function} onLoad - Callback when file loads
   */
  async initializeIndividual(iframeId, onLoad = null) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) {
      throw new Error(`Iframe with id "${iframeId}" not found`);
    }

    this.individualIframe = iframe;
    const filePath = `${this.basePath}/${this.individualFile}`;
    
    // Set iframe source
    iframe.src = `/public/embedded.html?src=${filePath}`;
    
    // Load project data
    try {
      this.individualProject = await this.loadProjectFile(filePath);
      console.log('[NCFT Manager] Individual audio file loaded:', this.individualFile);
      
      if (onLoad) {
        onLoad(this.individualProject, iframe);
      }
    } catch (e) {
      console.error('[NCFT Manager] Failed to load individual file:', e);
      throw e;
    }
  }

  /**
   * Initialize global audio iframe (creates copy from individual if needed)
   * @param {String} iframeId - ID of iframe element
   * @param {Function} onLoad - Callback when file loads
   */
  async initializeGlobal(iframeId, onLoad = null) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) {
      throw new Error(`Iframe with id "${iframeId}" not found`);
    }

    this.globalIframe = iframe;
    
    // Check if global file exists, if not create copy from individual
    try {
      this.globalProject = await this.loadProjectFile(`${this.basePath}/${this.globalFile}`);
      console.log('[NCFT Manager] Global audio file loaded:', this.globalFile);
    } catch (e) {
      // File doesn't exist, create copy from individual
      console.log('[NCFT Manager] Global file not found, creating copy from individual...');
      if (!this.individualProject) {
        throw new Error('Individual project must be loaded before creating global copy');
      }
      
      this.globalProject = this.copyProject(this.individualProject);
      await this.saveProjectFile(`${this.basePath}/${this.globalFile}`, this.globalProject);
      console.log('[NCFT Manager] Created global file from individual');
    }

    const filePath = `${this.basePath}/${this.globalFile}`;
    iframe.src = `/public/embedded.html?src=${filePath}`;
    
    if (onLoad) {
      onLoad(this.globalProject, iframe);
    }
  }

  /**
   * Load project file from server
   */
  async loadProjectFile(filePath) {
    const cacheBuster = `?t=${Date.now()}`;
    const url = filePath + cacheBuster;
    
    const resp = await fetch(url, {
      cache: "no-store",
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: Failed to load ${filePath}`);
    }

    const txt = await resp.text();
    return JSON.parse(txt);
  }

  /**
   * Save project file to server (requires server endpoint)
   * Note: This is a placeholder - actual implementation depends on server API
   */
  async saveProjectFile(filePath, projectData) {
    // TODO: Implement server-side save endpoint
    // For now, this would need to be handled server-side
    console.warn('[NCFT Manager] saveProjectFile not implemented - requires server endpoint');
    
    // In development, you might want to use localStorage as fallback
    const key = `ncft_${filePath.replace(/\//g, '_')}`;
    localStorage.setItem(key, JSON.stringify(projectData));
    console.log(`[NCFT Manager] Saved to localStorage: ${key}`);
  }

  /**
   * Deep copy a project (for creating global from individual)
   */
  copyProject(project) {
    // Deep clone to avoid reference issues
    const copied = JSON.parse(JSON.stringify(project));
    
    // Optionally modify title or metadata
    if (copied.title) {
      copied.title = `${copied.title} (Global)`;
    }
    
    return copied;
  }

  /**
   * Get iframe window for individual audio
   */
  getIndividualIframeWindow() {
    return this.individualIframe?.contentWindow || null;
  }

  /**
   * Get iframe window for global audio
   */
  getGlobalIframeWindow() {
    return this.globalIframe?.contentWindow || null;
  }

  /**
   * Get individual project data
   */
  getIndividualProject() {
    return this.globalProject;
  }

  /**
   * Get global project data
   */
  getGlobalProject() {
    return this.globalProject;
  }

  /**
   * Send message to individual iframe
   */
  postMessageToIndividual(message) {
    const window = this.getIndividualIframeWindow();
    if (window) {
      window.postMessage(message, '*');
    } else {
      console.warn('[NCFT Manager] Individual iframe window not available');
    }
  }

  /**
   * Send message to global iframe
   */
  postMessageToGlobal(message) {
    const window = this.getGlobalIframeWindow();
    if (window) {
      window.postMessage(message, '*');
    } else {
      console.warn('[NCFT Manager] Global iframe window not available');
    }
  }

  /**
   * Enable auto-save for individual file
   */
  enableAutoSaveIndividual(enabled = true) {
    this.postMessageToIndividual({
      type: "noiseCraft:enableAutoSave",
      enabled,
      filename: this.individualFile
    });
  }

  /**
   * Enable auto-save for global file
   */
  enableAutoSaveGlobal(enabled = true) {
    this.postMessageToGlobal({
      type: "noiseCraft:enableAutoSave",
      enabled,
      filename: this.globalFile
    });
  }
}

/**
 * Factory function to create file manager
 */
export function createNcftFileManager(options = {}) {
  return new NcftFileManager(options);
}

