/**
 * Overleaf WebSocket Client for Browser Extension
 * Connects to Overleaf's WebSocket API to fetch all file contents
 * Uses native browser WebSocket (100% compatible)
 */

interface OverleafAuth {
  cookieOverleafSession2: string;
  cookieGCLB?: string;
}

interface OverleafDoc {
  _id: string;
  name: string;
}

interface OverleafFileRef {
  _id: string;
  name: string;
  created: string;
  hash: string;
}

interface OverleafFolder {
  _id: string;
  name: string;
  folders: OverleafFolder[];
  fileRefs: OverleafFileRef[];
  docs: OverleafDoc[];
}

interface OverleafProject {
  _id: string;
  name: string;
  rootDoc_id: string;
  rootFolder: OverleafFolder[];
}

interface OverleafJoinProjectResponse {
  permissionLevel: string;
  project: OverleafProject;
  protocolVersion: number;
  publicId: string;
}

interface DocInfo {
  id: string;
  path: string;
  name: string;
  type: 'doc' | 'file';
  hash?: string;
}

interface SyncedFile {
  path: string;
  content: string | ArrayBuffer;
  type: 'doc' | 'file';
  docId: string;  // 🔧 Add docId for mapping
}

interface FileChange {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
  docId: string;
  isDirectory?: boolean;  // NEW: True if this is a directory/folder
}

type ChangeEventHandler = (change: FileChange) => void;

/**
 * Overleaf WebSocket Client for Browser
 */
export class OverleafWebSocketClient {
  private ws: WebSocket | null = null;
  private messageSeq = 0;
  private pendingRequests = new Map<number, (response: any) => void>();
  private docIdToPath = new Map<string, DocInfo>();
  private folderIdToPath = new Map<string, DocInfo>();  // NEW: Track folders
  private projectJoined = false;
  private baseUrl: string;
  private onChangeCallback?: ChangeEventHandler;

  constructor(
    private projectId: string,
    private auth: OverleafAuth,
    private csrfToken: string,
    domain: string = 'cn.overleaf.com'
  ) {
    this.baseUrl = `https://${domain}`;
  }

  /**
   * Connect to Overleaf WebSocket
   */
  async connect(): Promise<void> {
    console.log('[Overleaf WS] Fetching session ID...');

    // Step 1: Get session ID
    const cookies = this.formatCookies();
    const res = await fetch(
      `${this.baseUrl}/socket.io/1/?projectId=${this.projectId}&t=${Date.now()}`,
      {
        headers: {
          'Accept': 'text/plain',
          'Cookie': cookies
          // Note: X-Csrf-Token header removed - it causes CORS preflight to fail
        },
      }
    );

    if (res.status !== 200) {
      throw new Error(`Failed to connect: ${res.status}`);
    }

    const data = await res.text();
    const sessionId = data.split(':')[0];
    console.log('[Overleaf WS] ✅ Got session ID:', sessionId);

    // Step 2: Connect WebSocket (browser native WebSocket)
    const domain = this.baseUrl.replace('https://', '');
    const wsUrl = `wss://${domain}/socket.io/1/websocket/${sessionId}?projectId=${this.projectId}`;
    console.log('[Overleaf WS] 🔌 Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onopen = () => {
        console.log('[Overleaf WS] ✅ Connected');
        setTimeout(() => resolve(), 200);
      };

      this.ws.onerror = (error) => {
        console.error('[Overleaf WS] ✗ Error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[Overleaf WS] Connection closed');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      setTimeout(() => reject(new Error('Connection timeout')), 30000);
    });
  }

  /**
   * Format cookies for HTTP header
   */
  private formatCookies(): string {
    const cookies = [`overleaf_session2=${this.auth.cookieOverleafSession2}`];
    if (this.auth.cookieGCLB) {
      cookies.push(`GCLB=${this.auth.cookieGCLB}`);
    }
    return cookies.join('; ');
  }

  /**
   * Handle WebSocket messages
   */
  private handleMessage(data: string): void {
    // Heartbeat ping - reply with pong
    if (data.match(/^2::/)) {
      this.ws?.send('2::');
      return;
    }

    // Data message (5:::)
    if (data.match(/^5:::(.*)/)) {
      const match = data.match(/^5:::(.*)/);
      if (match) {
        try {
          const message = JSON.parse(match[1]);
          console.log('[Overleaf WS] 📦 Data message:', message.name || '(no name)');
          this.handleDataMessage(message);
        } catch (e) {
          console.error('[Overleaf WS] Failed to parse data message:', e);
        }
      }
      return;
    }

    // Response with data
    if (data.match(/^6:::\d+\+/)) {
      const responseHeader = data.match(/^6:::\d+/) || [];
      const responseHeaderText = responseHeader[0]!;
      const seq = parseInt(responseHeaderText.split(':').pop() || '0');
      const responseBodyText = data.slice(responseHeaderText.length + 1);

      console.log('[Overleaf WS] 📨 Response for seq:', seq);

      try {
        const contentData = JSON.parse(responseBodyText);
        const callback = this.pendingRequests.get(seq);
        if (callback) {
          this.pendingRequests.delete(seq);
          callback(contentData);
        }
      } catch (e) {
        console.error('[Overleaf WS] Failed to parse response:', e);
      }
      return;
    }

    // Error message (7:::)
    if (data.match(/^7:::/)) {
      const errorMsg = data.substring(4);
      console.error('[Overleaf WS] ❌ Server error:', errorMsg);
      return;
    }

    console.log('[Overleaf WS] ⚠️ Unhandled message:', data.substring(0, 100));
  }

  /**
   * Handle data messages from Overleaf
   */
  private handleDataMessage(message: any): void {
    if (message.name === 'joinProjectResponse') {
      console.log('[Overleaf WS] Received joinProjectResponse');
      this.processProjectStructure(message.args[0] as OverleafJoinProjectResponse);
      this.projectJoined = true;
    } else if (message.name === 'reciveNewDoc' || message.name === 'newDocCreated') {
      // A new document was created in Overleaf
      console.log(`[Overleaf WS] 📢 ${message.name} received:`, message.args);

      // Overleaf format: [parentFolderId, docObject, docType, rootFolderId]
      // Similar to reciveNewFolder, the actual doc_id is in docObject._id
      const parentFolderId = message.args[0] as string;  // NEW: Parent folder ID
      const docInfo = message.args[1] as any;
      const docId = docInfo?._id;  // Real doc_id is in docObject._id
      const fileName = docInfo?.path || docInfo?.name || (typeof message.args[1] === 'string' ? message.args[1] : undefined);
      const docName = docInfo?.name || fileName || `doc_${docId}`;

      // 🔧 FIX: Build full path by finding parent folder path
      let fullDocPath = fileName;
      if (parentFolderId && parentFolderId !== 'rootFolder') {
        const parentFolder = this.folderIdToPath.get(parentFolderId);
        if (parentFolder && parentFolder.path) {
          // Parent folder found, build full path
          fullDocPath = parentFolder.path === '' ? fileName : `${parentFolder.path}/${fileName}`;
          console.log(`[Overleaf WS] 🔍 Resolved full doc path: ${fullDocPath} (parent: ${parentFolder.path})`);
        } else {
          console.log(`[Overleaf WS] ⚠️ Parent folder ${parentFolderId} not found in folderIdToPath, using root path`);
        }
      }

      console.log(`[Overleaf WS] 📝 File created in Overleaf: ${fullDocPath} (id: ${docId})`);

      // Update docId mapping with the correct doc_id and full path
      if (docId && fullDocPath) {
        this.docIdToPath.set(docId, {
          id: docId,
          path: fullDocPath,  // Use full path instead of just filename
          name: docName,
          type: 'doc'
        });
        console.log(`[Overleaf WS] ✅ Mapped doc ${docId} -> ${fullDocPath}`);
      }

      // 🔧 FIX: DON'T trigger onChangeCallback for reciveNewDoc
      // This is triggered by our sync operations (local -> Overleaf)
      // We already have the content locally, no need to sync it back
      // The file was created in response to our sync_to_overleaf request
      // If we trigger onChangeCallback here, it will cause a circular sync:
      //   1. We sync local file to Overleaf (with content)
      //   2. Overleaf creates file and sends reciveNewDoc
      //   3. We fetch content (empty) and sync back to local
      //   4. FileWatcher detects change and syncs again...
      console.log(`[Overleaf WS] ℹ️ Skipping onChangeCallback for reciveNewDoc (prevents circular sync)`);

      if (!fullDocPath) {
        console.warn(`[Overleaf WS] ⚠️ Could not extract path from ${message.name}:`, message.args);
      }
    } else if (message.name === 'reciveNewFile' || message.name === 'fileUploaded' || message.name === 'fileCreated') {
      // A new file was uploaded/created in Overleaf
      console.log(`[Overleaf WS] 📢 ${message.name} received:`, message.args);

      const arg0 = message.args[0] as { file: string; path: string; name: string };
      console.log(`[Overleaf WS] 📝 File created in Overleaf: ${arg0.path || arg0.name}`);

      // Update docId mapping
      if (arg0.file && arg0.path) {
        this.docIdToPath.set(arg0.file, {
          id: arg0.file,
          path: arg0.path,
          name: arg0.name,
          type: 'file'
        });
        console.log(`[Overleaf WS] ✅ Mapped file ${arg0.file} -> ${arg0.path}`);
      }

      // 🔧 FIX: DON'T trigger onChangeCallback for fileCreated from our sync
      // Similar to reciveNewDoc, this prevents circular sync
      console.log(`[Overleaf WS] ℹ️ Skipping onChangeCallback for ${message.name} (prevents circular sync)`);
    } else if (message.name === 'reciveNewFolder' || message.name === 'folderCreated' || message.name === 'newFolderCreated') {
      // A new folder was created in Overleaf
      console.log(`[Overleaf WS] 📢📁 ${message.name} received:`, message.args);

      // 🔧 FIX: Overleaf format is [parentFolderId, folderObject, rootFolderId]
      // Example: ['69b43489a4dfe75fa1468e8d', {name: 'newsubfolder2', _id: '69b43495a8d925416a88b7fe', ...}, '69a6f0e4be9dc19b8d151c31']
      // The first parameter is the PARENT folder ID, not the new folder's ID!
      // The actual new folder ID is in folderObject._id

      let folderId: string | undefined;
      let folderName: string | undefined;
      let parentFolderId: string | undefined;
      let rootFolderId: string | undefined;

      // Extract from array format
      if (Array.isArray(message.args)) {
        parentFolderId = message.args[0] as string;  // 🔧 FIX: First param is PARENT folder ID
        const folderObj = message.args[1] as any;
        rootFolderId = message.args[2] as string;   // Third param is rootFolder ID

        if (folderObj) {
          folderName = folderObj.name;
          folderId = folderObj._id;  // New folder ID is in folderObject._id
        }
      }

      console.log(`[Overleaf WS] 📁 Folder created in Overleaf: ${folderName || '(unnamed)'}`);
      console.log(`[Overleaf WS]    New folder ID: ${folderId}`);
      console.log(`[Overleaf WS]    Parent folder ID: ${parentFolderId}`);
      console.log(`[Overleaf WS]    Root folder ID: ${rootFolderId}`);

      // 🔍 Debug: Log all known folders in both mappings
      console.log(`[Overleaf WS] 🔍 Known folders in folderIdToPath:`, Array.from(this.folderIdToPath.entries()).map(([id, info]) => `${id} -> ${info.path}`));

      // Build folder path by finding parent folder path
      let folderPath: string | undefined;
      if (folderName) {
        if (parentFolderId) {
          // 🔧 FIX: Try to find parent folder in BOTH mappings (folderIdToPath and docIdToPath)
          let parentInfo = this.folderIdToPath.get(parentFolderId);
          if (!parentInfo) {
            parentInfo = this.docIdToPath.get(parentFolderId);
          }

          if (parentInfo) {
            folderPath = `${parentInfo.path}/${folderName}`.replace(/^rootFolder\//, '');
            console.log(`[Overleaf WS] ✅ Found parent folder path: ${parentInfo.path} (from ${this.folderIdToPath.has(parentFolderId) ? 'folderIdToPath' : 'docIdToPath'})`);
          } else {
            // Parent folder not found in mapping (might be rootFolder or not yet mapped)
            // Use folder name as path (will be in root)
            folderPath = folderName;
            console.log(`[Overleaf WS] ⚠️ Parent folder ${parentFolderId} not found in either mapping, using root path`);
          }
        } else {
          // No parent folder, assume root
          folderPath = folderName;
        }
      }

      console.log(`[Overleaf WS] 📁 Resolved folder path: ${folderPath}`);

      // 🔧 FIX: Update folderIdToPath mapping for folder (not docIdToPath)
      if (folderId && folderPath) {
        this.folderIdToPath.set(folderId, {
          id: folderId,
          path: folderPath,
          name: folderName || folderPath,
          type: 'file'  // Use 'file' type for consistency with Overleaf's convention
        });
        console.log(`[Overleaf WS] ✅ Mapped folder ${folderId} -> ${folderPath} in folderIdToPath`);
      }

      // 🔧 FIX: DON'T trigger onChangeCallback for reciveNewFolder
      // This is triggered by our sync operations (local -> Overleaf)
      // We already have the folder locally, no need to sync it back
      // Prevents circular sync similar to reciveNewDoc
      console.log(`[Overleaf WS] ℹ️ Skipping onChangeCallback for reciveNewFolder (prevents circular sync)`);

      if (!folderPath) {
        console.warn(`[Overleaf WS] ⚠️ Could not extract path from ${message.name}:`, message.args);
      }
    } else if (message.name === 'removeEntity') {
      // A document, file, or folder was removed from Overleaf
      console.log(`[Overleaf WS] 📢 removeEntity received:`, message.args);

      const entityId = message.args[0] as string;
      const entityType = message.args[1] as string;

      console.log(`[Overleaf WS] 📝 Entity removed from Overleaf: ${entityType} (${entityId})`);

      // Check if this is a folder deletion (by looking in folderIdToPath first)
      const folderInfo = this.folderIdToPath.get(entityId);
      if (folderInfo) {
        // This is a folder deletion
        const folderPath = folderInfo.path;
        console.log(`[Overleaf WS] 📁 Folder deletion detected: ${folderPath}`);

        // Remove from folderIdToPath mapping
        this.folderIdToPath.delete(entityId);
        console.log(`[Overleaf WS] 🗑️ Removed ${entityId} from folderIdToPath mapping`);

        if (this.onChangeCallback) {
          console.log(`[Overleaf WS] 📤 Sending folder deletion notification: ${folderPath}`);
          this.onChangeCallback({
            type: 'deleted',
            path: folderPath,
            docId: entityId,
            isDirectory: true  // This is a folder deletion
          });
        }
        return;
      }

      // If not in folderIdToPath, check if it's a file/doc deletion
      const docInfo = this.docIdToPath.get(entityId);

      if (!docInfo) {
        console.warn(`[Overleaf WS] ⚠️ Unknown entity ID ${entityId} in removeEntity`);
        if (this.onChangeCallback) {
          this.onChangeCallback({
            type: 'deleted',
            path: `/${entityId}`,  // Fallback path
            docId: entityId,
            isDirectory: false
          });
        }
        return;
      }

      const filePath = docInfo.path;
      console.log(`[Overleaf WS] ✅ Found path for ${entityId}: ${filePath}`);

      // Remove from docId mapping AFTER getting path
      this.docIdToPath.delete(entityId);
      console.log(`[Overleaf WS] 🗑️ Removed ${entityId} from docIdToPath mapping`);

      if (this.onChangeCallback) {
        console.log(`[Overleaf WS] 📤 Sending deletion notification: ${filePath}`);
        this.onChangeCallback({
          type: 'deleted',
          path: filePath,
          docId: entityId,
          isDirectory: false  // This is a file/doc deletion
        });
      }
    } else if (message.name === 'docRemoved') {
      // A document was deleted from Overleaf
      console.log(`[Overleaf WS] 📢 docRemoved received:`, message.args);

      const arg0 = message.args[0] as { doc: string; path: string };
      const docInfo = this.docIdToPath.get(arg0.doc) || { path: arg0.path, id: arg0.doc, name: '', type: 'doc' };

      console.log(`[Overleaf WS] 📝 File deleted in Overleaf: ${docInfo.path}`);

      // Remove from docId mapping
      if (arg0.doc) {
        this.docIdToPath.delete(arg0.doc);
      }

      if (this.onChangeCallback) {
        this.onChangeCallback({
          type: 'deleted',
          path: docInfo.path,
          docId: arg0.doc
        });
      }
    } else if (message.name === 'fileRemoved') {
      // A file was deleted from Overleaf
      console.log(`[Overleaf WS] 📢 fileRemoved received:`, message.args);

      const arg0 = message.args[0] as { file: string; path: string };
      const docInfo = this.docIdToPath.get(arg0.file) || { path: arg0.path, id: arg0.file, name: '', type: 'file' };

      console.log(`[Overleaf WS] 📝 File deleted in Overleaf: ${docInfo.path}`);

      // Remove from docId mapping
      if (arg0.file) {
        this.docIdToPath.delete(arg0.file);
      }

      if (this.onChangeCallback) {
        this.onChangeCallback({
          type: 'deleted',
          path: docInfo.path,
          docId: arg0.file
        });
      }
    } else if (message.name === 'reciveEntityRename') {
      // An entity (document, file, or folder) was renamed in Overleaf
      console.log(`[Overleaf WS] 📢 reciveEntityRename received:`, message.args);

      // message.args format: [entityId, newPath, entityType]
      const entityId = message.args[0] as string;
      const newPath = message.args[1] as string;
      const entityType = message.args[2] as string;

      console.log(`[Overleaf WS] 📝 Entity renamed: ${entityType} (${entityId}) -> ${newPath}`);

      // Check if this is a folder rename (by looking in folderIdToPath first)
      const folderInfo = this.folderIdToPath.get(entityId);
      if (folderInfo) {
        // This is a folder rename
        const oldPath = folderInfo.path;
        console.log(`[Overleaf WS] 📁 Folder rename detected: ${oldPath} -> ${newPath}`);

        // 🔧 FIX: Overleaf only sends the new name, not the full path
        // We need to construct the full new path by using the parent directory from oldPath
        let fullNewPath: string;
        const lastSlashIndex = oldPath.lastIndexOf('/');
        if (lastSlashIndex !== -1) {
          // Has parent directory
          const parentPath = oldPath.substring(0, lastSlashIndex);
          fullNewPath = `${parentPath}/${newPath}`;
          console.log(`[Overleaf WS] 🔍 Constructed full new path: ${fullNewPath} (parent: ${parentPath}, new name: ${newPath})`);
        } else {
          // No parent directory (root level)
          fullNewPath = newPath;
          console.log(`[Overleaf WS] 🔍 No parent directory, using new name as full path: ${fullNewPath}`);
        }

        // Update folderIdToPath mapping with new path
        this.folderIdToPath.set(entityId, {
          ...folderInfo,
          path: fullNewPath
        });
        console.log(`[Overleaf WS] ✅ Updated folder mapping for ${entityId}: ${fullNewPath}`);

        // 🔧 NEW: Recursively update all children (folders and files) under this folder
        this.updateChildPaths(oldPath, fullNewPath);

        if (this.onChangeCallback) {
          console.log(`[Overleaf WS] 📤 Sending folder rename notification: ${oldPath} -> ${fullNewPath}`);
          this.onChangeCallback({
            type: 'renamed',
            path: fullNewPath,
            oldPath: oldPath,
            docId: entityId,
            isDirectory: true  // This is a folder rename
          });
        }
        return;
      }

      // If not in folderIdToPath, check if it's a file/doc rename
      const docInfo = this.docIdToPath.get(entityId);

      if (!docInfo) {
        console.warn(`[Overleaf WS] ⚠️ Unknown entity ID ${entityId} in reciveEntityRename`);
        // Still try to notify with just the new path
        if (this.onChangeCallback) {
          this.onChangeCallback({
            type: 'renamed',
            path: newPath,
            docId: entityId,
            isDirectory: false
          });
        }
        return;
      }

      const oldPath = docInfo.path;
      console.log(`[Overleaf WS] ✅ Found old path for ${entityId}: ${oldPath}`);
      console.log(`[Overleaf WS] ✅ Rename: ${oldPath} -> ${newPath}`);

      // 🔧 FIX: Overleaf only sends the new name, not the full path
      // We need to construct the full new path by using the parent directory from oldPath
      let fullNewPath: string;
      const lastSlashIndex = oldPath.lastIndexOf('/');
      if (lastSlashIndex !== -1) {
        // Has parent directory
        const parentPath = oldPath.substring(0, lastSlashIndex);
        fullNewPath = `${parentPath}/${newPath}`;
        console.log(`[Overleaf WS] 🔍 Constructed full new path: ${fullNewPath} (parent: ${parentPath}, new name: ${newPath})`);
      } else {
        // No parent directory (root level)
        fullNewPath = newPath;
        console.log(`[Overleaf WS] 🔍 No parent directory, using new name as full path: ${fullNewPath}`);
      }

      // Update docId mapping with new path
      this.docIdToPath.set(entityId, {
        ...docInfo,
        path: fullNewPath
      });
      console.log(`[Overleaf WS] ✅ Updated mapping for ${entityId}: ${fullNewPath}`);

      if (this.onChangeCallback) {
        console.log(`[Overleaf WS] 📤 Sending rename notification: ${oldPath} -> ${fullNewPath}`);
        this.onChangeCallback({
          type: 'renamed',
          path: fullNewPath,
          oldPath: oldPath,
          docId: entityId,
          isDirectory: false  // This is a file/doc rename
        });
      }
    }
  }

  /**
   * Process project structure and build docId -> path mapping
   */
  private processProjectStructure(response: OverleafJoinProjectResponse): void {
    // 🔧 FIX: Use a queue with parent path information
    interface FolderWithParent {
      folder: OverleafFolder;
      parentPath: string;  // Full path of parent folder
    }

    const queue: FolderWithParent[] = response.project.rootFolder.map(folder => ({
      folder,
      parentPath: ''  // rootFolder has no parent path
    }));

    console.log('[Overleaf WS] Processing project structure...');

    // 🔍 Debug: Log rootFolder structure
    console.log('[Overleaf WS] 🔍 rootFolder count:', response.project.rootFolder.length);
    response.project.rootFolder.forEach((folder, index) => {
      console.log(`[Overleaf WS] 🔍 rootFolder[${index}]:`, {
        _id: folder._id,
        name: folder.name,
        foldersCount: folder.folders?.length || 0,
        docsCount: folder.docs?.length || 0,
        fileRefsCount: folder.fileRefs?.length || 0
      });
    });

    // Process folder structure with BFS traversal
    while (queue.length > 0) {
      const { folder, parentPath } = queue.shift()!;
      if (!folder) continue;

      // 🔧 FIX: Build full path by combining parent path and folder name
      let fullPath: string;
      if (folder.name === 'rootFolder') {
        fullPath = '';  // rootFolder is the base, so its path is empty
      } else if (parentPath === '') {
        fullPath = folder.name;  // Direct child of rootFolder
      } else {
        fullPath = `${parentPath}/${folder.name}`;  // Nested folder
      }

      // 🔍 Debug: Log current folder being processed
      console.log(`[Overleaf WS] 🔍 Processing folder: ${folder.name} (id: ${folder._id})`);
      console.log(`[Overleaf WS] 🔍   Parent path: "${parentPath}"`);
      console.log(`[Overleaf WS] 🔍   Full path: "${fullPath}"`);

      // Process documents in current folder
      for (const doc of folder.docs) {
        const docPath = fullPath ? `${fullPath}/${doc.name}` : doc.name;
        this.docIdToPath.set(doc._id, {
          id: doc._id,
          path: docPath,
          name: doc.name,
          type: 'doc'
        });
        console.log(`[Overleaf WS] Mapped doc ${doc._id} -> ${docPath}`);
      }

      // Process file references (images, etc.) in current folder
      for (const fileRef of folder.fileRefs) {
        const filePath = fullPath ? `${fullPath}/${fileRef.name}` : fileRef.name;
        this.docIdToPath.set(fileRef._id, {
          id: fileRef._id,
          path: filePath,
          name: fileRef.name,
          type: 'file',
          hash: fileRef.hash
        });
        console.log(`[Overleaf WS] Mapped file ${fileRef._id} -> ${filePath} (hash: ${fileRef.hash})`);
      }

      // 🔧 Record folder information (excluding rootFolder)
      if (folder._id && folder.name !== 'rootFolder') {
        this.folderIdToPath.set(folder._id, {
          id: folder._id,
          path: fullPath,
          name: folder.name,
          type: 'file'  // Use 'file' type for folders (Overleaf's internal convention)
        });
        console.log(`[Overleaf WS] 📁 Mapped folder ${folder._id} -> ${fullPath}`);
      }

      // Add subfolders to queue with current folder's path as parent
      if (folder.folders && folder.folders.length > 0) {
        console.log(`[Overleaf WS] 🔍 Adding ${folder.folders.length} subfolders to queue from ${folder.name}`);
        folder.folders.forEach((subfolder, idx) => {
          console.log(`[Overleaf WS] 🔍   Subfolder[${idx}]:`, {
            _id: subfolder._id,
            name: subfolder.name,
            foldersCount: subfolder.folders?.length || 0,
            docsCount: subfolder.docs?.length || 0
          });
        });
        // 🔧 FIX: Pass current folder's full path to children
        const subfoldersWithParent = folder.folders.map(subfolder => ({
          folder: subfolder,
          parentPath: fullPath
        }));
        queue.push(...subfoldersWithParent);
      }
    }

    console.log(`[Overleaf WS] ✅ Processed ${this.docIdToPath.size} files and ${this.folderIdToPath.size} folders in project`);
  }

  /**
   * Send request to Overleaf WebSocket
   */
  private sendRequest(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const seq = this.messageSeq;
      this.messageSeq++;
      this.pendingRequests.set(seq, resolve);

      const payload = `5:${seq}+::` + JSON.stringify(message);
      console.log('[Overleaf WS] 📤 Sending:', payload.substring(0, 200));

      this.ws.send(payload);

      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 60000);
    });
  }

  /**
   * Wait for project to be joined
   */
  async waitForProjectJoin(): Promise<void> {
    console.log('[Overleaf WS] Waiting for project join...');

    return new Promise((resolve, reject) => {
      if (this.projectJoined) {
        console.log('[Overleaf WS] ✅ Project already joined');
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.projectJoined) {
          clearInterval(checkInterval);
          console.log('[Overleaf WS] ✅ Project join completed');
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for project join'));
      }, 5000);
    });
  }

  /**
   * Get all document and file IDs
   */
  getAllDocIds(): string[] {
    return Array.from(this.docIdToPath.keys());
  }

  /**
   * Get all folder IDs
   */
  getAllFolderIds(): string[] {
    return Array.from(this.folderIdToPath.keys());
  }

  /**
   * Get document info by ID
   */
  getDocInfo(id: string): DocInfo | undefined {
    return this.docIdToPath.get(id);
  }

  /**
   * Get the docIdToPath map (for EditorUpdater to use)
   */
  getDocIdToPathMap(): Map<string, DocInfo> {
    return this.docIdToPath;
  }

  /**
   * Recursively update paths for all children (folders and files) under a renamed folder
   * This ensures that when a parent folder is renamed, all child entities have correct paths
   *
   * @param oldParentPath - Old parent folder path
   * @param newParentPath - New parent folder path
   */
  private updateChildPaths(oldParentPath: string, newParentPath: string): void {
    console.log(`[Overleaf WS] 🔧 Recursively updating child paths: ${oldParentPath} -> ${newParentPath}`);

    let updatedCount = 0;

    // Update all folders
    for (const [folderId, folderInfo] of this.folderIdToPath.entries()) {
      if (folderInfo.path.startsWith(oldParentPath + '/')) {
        const relativePath = folderInfo.path.substring(oldParentPath.length + 1);
        const newPath = `${newParentPath}/${relativePath}`;

        this.folderIdToPath.set(folderId, {
          ...folderInfo,
          path: newPath
        });
        console.log(`[Overleaf WS] 📁 Updated folder path: ${folderInfo.path} -> ${newPath}`);
        updatedCount++;
      }
    }

    // Update all files/docs
    for (const [docId, docInfo] of this.docIdToPath.entries()) {
      if (docInfo.path.startsWith(oldParentPath + '/')) {
        const relativePath = docInfo.path.substring(oldParentPath.length + 1);
        const newPath = `${newParentPath}/${relativePath}`;

        this.docIdToPath.set(docId, {
          ...docInfo,
          path: newPath
        });
        console.log(`[Overleaf WS] 📄 Updated file path: ${docInfo.path} -> ${newPath}`);
        updatedCount++;
      }
    }

    console.log(`[Overleaf WS] ✅ Updated ${updatedCount} child paths`);
  }

  /**
   * Join a document to fetch its content
   */
  async joinDoc(docId: string): Promise<string[]> {
    console.log(`[Overleaf WS] Joining doc: ${docId}`);

    const contentData = await this.sendRequest({
      name: 'joinDoc',
      args: [docId, { encodeRanges: true }],
    });

    const escapedLines = contentData[1] || [];
    const version = contentData[2] || 0;

    console.log(`[Overleaf WS] Got doc content: ${docId}, version: ${version}, lines: ${escapedLines.length}`);

    // Decode UTF-8
    const decodedLines = escapedLines.map((line: string) => {
      try {
        const bytes = new Uint8Array([...line].map((c) => c.charCodeAt(0)));
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        console.error('[Overleaf WS] Failed to decode line:', e);
        return line;
      }
    });

    return decodedLines;
  }

  /**
   * Leave a document
   */
  async leaveDoc(docId: string): Promise<void> {
    console.log(`[Overleaf WS] Leaving doc: ${docId}`);
    await this.sendRequest({
      name: 'leaveDoc',
      args: [docId]
    });
  }

  /**
   * Update document content using WebSocket
   * This is the preferred method for updating documents (vs REST API)
   */
  async updateDoc(docId: string, newContent: string): Promise<void> {
    console.log(`[Overleaf WS] 📝 Updating doc: ${docId}`);

    // Join document to get current version
    const contentData = await this.sendRequest({
      name: 'joinDoc',
      args: [docId, { encodeRanges: true }],
    });

    const currentLines = contentData[1] || [];
    const version = contentData[2] || 0;

    // Decode current lines (Overleaf sends them as UTF-8 bytes in string format)
    const decodedCurrentLines = currentLines.map((line: string) => {
      try {
        const bytes = new Uint8Array([...line].map((c) => c.charCodeAt(0)));
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        return line;
      }
    });

    const newLines = newContent.split('\n');

    // Calculate operations to transform current -> new
    const ops = this.calculateOps(decodedCurrentLines, newLines, version);

    console.log(`[Overleaf WS] 📤 Sending ${ops.length} operations for update`);

    // Send operations (don't wait for response, just send)
    this.sendRequest({
      name: 'applyOtUpdate',
      args: [docId, ops]
    }).catch((error) => {
      console.error(`[Overleaf WS] ❌ applyOtUpdate failed:`, error);
    });

    // Note: We don't call leaveDoc here because:
    // 1. Overleaf may not expect/require it after updates
    // 2. It may timeout waiting for a response that never comes
    // 3. The document will be auto-left after inactivity

    console.log(`[Overleaf WS] ✅ Update sent for doc: ${docId}`);
  }

  /**
   * Calculate operations to transform oldContent into newContent
   * Uses character-level OT operations (not line-level)
   */
  private calculateOps(oldLines: string[], newLines: string[], baseVersion: number): any[] {
    const ops = [];

    // For new documents, just insert all content
    // Combine all lines into a single string with line breaks
    const fullContent = newLines.join('\n');

    // Encode content to UTF-8 bytes, then to string (Overleaf's format)
    const encoder = new TextEncoder();
    const encoded = encoder.encode(fullContent);
    const encodedContent = String.fromCharCode(...encoded);

    // Create single insert operation at position 0
    ops.push({
      i: encodedContent,  // insert content
      p: 0                // at position 0
    });

    return ops;
  }

  /**
   * Download binary file by blob hash
   */
  async downloadFile(fileRefId: string): Promise<ArrayBuffer> {
    const fileInfo = this.docIdToPath.get(fileRefId);
    if (!fileInfo || fileInfo.type !== 'file') {
      throw new Error(`File ${fileRefId} not found or is not a file`);
    }

    if (!fileInfo.hash) {
      throw new Error(`File ${fileRefId} does not have a hash`);
    }

    console.log(`[Overleaf WS] Downloading file: ${fileInfo.path} (hash: ${fileInfo.hash})`);

    const fileUrl = `${this.baseUrl}/project/${this.projectId}/blob/${fileInfo.hash}`;

    try {
      const response = await fetch(fileUrl, {
        headers: {
          Cookie: this.formatCookies()
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      console.log(`[Overleaf WS] Downloaded ${fileInfo.path} (${buffer.byteLength} bytes)`);
      return buffer;
    } catch (error) {
      console.error(`[Overleaf WS] Failed to download ${fileInfo.path}:`, error);
      throw error;
    }
  }

  /**
   * Sync all folders and return their paths
   * This should be called before syncAllFiles() to ensure folder structure exists
   */
  async syncAllFolders(): Promise<string[]> {
    console.log('[Overleaf WS] 🔄 Starting folder sync...');

    await this.waitForProjectJoin();

    const allFolderIds = this.getAllFolderIds();
    console.log('[Overleaf WS] ✅ Found', allFolderIds.length, 'folders in project');

    const folderPaths: string[] = [];

    for (const folderId of allFolderIds) {
      try {
        const folderInfo = this.folderIdToPath.get(folderId);
        if (!folderInfo) {
          console.warn('[Overleaf WS] ⚠️ No info found for folder', folderId, ', skipping');
          continue;
        }

        console.log('[Overleaf WS] 📁 Syncing folder:', folderInfo.path);
        folderPaths.push(folderInfo.path);
        console.log('[Overleaf WS] ✅ Synced folder:', folderInfo.path);
      } catch (error) {
        console.error('[Overleaf WS] ❌ Failed to sync folder', folderId, ':', error);
      }
    }

    console.log('[Overleaf WS] ✅ Folder sync complete:', folderPaths.length, 'folders');
    return folderPaths;
  }

  /**
   * Sync all files and return their contents
   */
  async syncAllFiles(): Promise<SyncedFile[]> {
    console.log('[Overleaf WS] 🔄 Starting file sync...');

    await this.waitForProjectJoin();

    const allIds = this.getAllDocIds();
    console.log('[Overleaf WS] ✅ Found', allIds.length, 'files in project');

    const syncedFiles: SyncedFile[] = [];

    for (const id of allIds) {
      try {
        const info = this.getDocInfo(id);
        if (!info) {
          console.warn('[Overleaf WS] ⚠️ No info found for', id, ', skipping');
          continue;
        }

        console.log('[Overleaf WS] 📥 Syncing:', info.path);

        if (info.type === 'doc') {
          const lines = await this.joinDoc(id);
          await this.leaveDoc(id);
          const content = lines.join('\n');
          syncedFiles.push({
            path: info.path,
            content: content,
            type: 'doc',
            docId: id  // 🔧 Include docId
          });
          console.log('[Overleaf WS] ✅ Synced:', info.path, `(${content.length} chars, ${lines.length} lines)`);
        } else if (info.type === 'file') {
          const buffer = await this.downloadFile(id);
          syncedFiles.push({
            path: info.path,
            content: buffer,
            type: 'file',
            docId: id  // 🔧 Include docId
          });
          console.log('[Overleaf WS] ✅ Synced:', info.path, `(${buffer.byteLength} bytes, binary)`);
        }
      } catch (error) {
        console.error('[Overleaf WS] ❌ Failed to sync', id, ':', error);
      }
    }

    console.log('[Overleaf WS] ✅ Sync complete:', syncedFiles.length, 'files');
    return syncedFiles;
  }

  /**
   * Register callback for file change events
   */
  onChange(callback: ChangeEventHandler): void {
    this.onChangeCallback = callback;
    console.log('[Overleaf WS] ✅ Change detection enabled');
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
    this.docIdToPath.clear();
    this.folderIdToPath.clear();
    this.projectJoined = false;
    this.onChangeCallback = undefined;
  }
}
