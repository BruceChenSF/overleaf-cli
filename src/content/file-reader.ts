/**
 * File Reader - Reads Overleaf project files directly from the DOM
 * This avoids the need for Overleaf API calls
 */

interface FileInfo {
  id: string;
  name: string;
  path: string;
  type?: string;
}

interface FileReaderMessage {
  type: 'GET_ALL_FILES' | 'GET_FILE_CONTENT' | 'SET_FILE_CONTENT';
  payload?: unknown;
}

interface FileContent {
  content: string;
  path: string;
}

/**
 * Get all files from the Overleaf file tree DOM
 */
function getAllFiles(): FileInfo[] {
  const files: FileInfo[] = [];
  console.log('[FileReader] Getting all files...');

  // Overleaf stores file information in the document entity
  // We can extract it from the global window object
  const windowWithEditor = window as unknown as {
    overleaf?: {
      document?: {
        entities?: Record<string, { name?: string; docLine?: string }>;
      };
    };
    ____ol8_editor?: {
      currentDocKey?: string;
    };
    ee?: {
      _: {
        document?: {
          entities?: unknown[];
        };
      };
    };
    __initData?: {
      project?: {
        rootFolder?: {
          fileRefs?: unknown[];
          folders?: unknown[];
        };
      };
    };
    window?: {
      __initData?: {
        project?: {
          rootFolder?: {
            fileRefs?: unknown[];
            folders?: unknown[];
          };
        };
      };
    };
  };

  // Try different ways to access Overleaf's internal state
  try {
    // Method 1: Try modern Overleaf (2025+) - ee._.document.entities
    if (windowWithEditor.ee?._?.document?.entities) {
      const entities = windowWithEditor.ee._.document.entities;
      console.log('[FileReader] Found ee._.document.entities:', Array.isArray(entities) ? entities.length : 'not array');
      if (Array.isArray(entities)) {
        for (const entity of entities) {
          const fileEntity = entity as { _id?: string; name?: string; path?: string; type?: string };
          if (fileEntity._id && fileEntity.name && fileEntity.type === 'doc') {
            files.push({
              id: fileEntity._id,
              name: fileEntity.name,
              path: fileEntity.path || `/${fileEntity.name}`
            });
          }
        }
        if (files.length > 0) {
          console.log(`[FileReader] Found ${files.length} files from ee._.document.entities`);
          return files;
        }
      }
    }
  } catch (err) {
    console.error('[FileReader] Error accessing ee._.document.entities:', err);
  }

  // Method 2: Try __initData (older Overleaf)
  try {
    const initData = (window as any).__initData || windowWithEditor.__initData;
    if (initData?.project?.rootFolder?.fileRefs) {
      console.log('[FileReader] Found __initData.project.rootFolder.fileRefs');
      const fileRefs = initData.project.rootFolder.fileRefs;
      if (Array.isArray(fileRefs)) {
        for (const ref of fileRefs) {
          const fileRef = ref as { _id?: string; name?: string };
          if (fileRef._id && fileRef.name) {
            files.push({
              id: fileRef._id,
              name: fileRef.name,
              path: `/${fileRef.name}`
            });
          }
        }
        if (files.length > 0) {
          console.log(`[FileReader] Found ${files.length} files from __initData`);
          return files;
        }
      }
    }
  } catch (err) {
    console.error('[FileReader] Error accessing __initData:', err);
  }

  // Method 3: Try global window.clientVars (ShareJS/Overleaf)
  try {
    const clientVars = (window as any).clientVars;
    if (clientVars?.document?.currentDoc?._id) {
      const docId = clientVars.document.currentDoc._id;
      const docName = clientVars.document.currentDoc.name || 'main.tex';
      files.push({
        id: docId,
        name: docName,
        path: `/${docName}`
      });
      console.log(`[FileReader] Found current doc from clientVars: ${docName}`);
      return files;
    }
  } catch (err) {
    console.error('[FileReader] Error accessing clientVars:', err);
  }

  // Method 4: If no files found via internal API, try DOM parsing
  if (files.length === 0) {
    try {
      console.log('[FileReader] Trying DOM parsing...');
      // Look for file tree in DOM
      const fileTreeItems = document.querySelectorAll('[data-file-id]');
      console.log(`[FileReader] Found ${fileTreeItems.length} elements with data-file-id`);

      // Debug: log the first element to see its structure
      if (fileTreeItems.length > 0) {
        console.log('[FileReader] First file tree element HTML:', fileTreeItems[0].outerHTML.substring(0, 300));
      }

      fileTreeItems.forEach(item => {
        const fileId = item.getAttribute('data-file-id');
        const fileType = item.getAttribute('data-file-type');
        console.log(`[FileReader] Processing element with file-id: ${fileId}, type: ${fileType}`);

        // Try multiple selectors to find the file name
        const fileNameSelectors = [
          '.entity-name',
          '.file-name',
          '[data-testid="file-name"]',
          '.name',
          '.filename',
          'span.link-text',
          'a.link',
          '.link',
          'td.name',
          '.file-list-item-name'
        ];

        let fileName = null;
        for (const selector of fileNameSelectors) {
          const nameElement = item.querySelector(selector);
          if (nameElement?.textContent) {
            const text = nameElement.textContent.trim();
            // Filter out button labels and icon names
            const cleanText = text
              .replace(/^description/, '')
              .replace(/chevron_right/g, '')
              .replace(/more_vert/, '')
              .replace(/菜单/, '')
              .replace(/expand_more|expand_less/, '')
              .replace(/folder|file/, '')
              .trim();

            if (cleanText && cleanText.length > 0 && cleanText.length < 100) {
              fileName = cleanText;
              console.log(`[FileReader] Found name "${fileName}" using selector "${selector}" (cleaned from "${text}")`);
              break;
            }
          }
        }

        if (fileId && fileName) {
          files.push({
            id: fileId,
            name: fileName,
            path: `/${fileName}`,
            type: fileType || 'unknown'
          });
        }
      });
      if (files.length > 0) {
        console.log(`[FileReader] Found ${files.length} files from DOM`);
        return files;
      }
    } catch (err) {
      console.error('[FileReader] Error parsing file tree DOM:', err);
    }
  }

  // Method 5: Try URL parsing to get current document
  if (files.length === 0) {
    const currentDoc = getCurrentDocumentInfo();
    if (currentDoc) {
      files.push(currentDoc);
      console.log(`[FileReader] Using current doc from URL: ${currentDoc.name}`);
      return files;
    }
  }

  console.log(`[FileReader] Returning ${files.length} files total`);
  return files;
}

/**
 * Get information about the currently open document
 */
function getCurrentDocumentInfo(): FileInfo | null {
  // Try to get document info from URL
  const urlMatch = window.location.pathname.match(/\/project\/[^/]+\/(?:doc|folder)\/([^/]+)/);
  if (urlMatch) {
    const docId = urlMatch[1];

    // Try to get document name from page title or breadcrumb
    const docName =
      document.querySelector('.document-title')?.textContent ||
      document.querySelector('[data-document-title]')?.textContent ||
      document.title.split(' - ')[0] ||
      'main.tex';

    return {
      id: docId,
      name: docName,
      path: `/${docName}`
    };
  }

  return null;
}

/**
 * Get content of the currently open document
 */
function getCurrentDocumentContent(): string | null {
  // Try to access the editor content
  const windowWithEditor = window as unknown as {
    editor?: {
      getDocValue?: () => string;
      getValue?: () => string;
      getValue?: () => string;
    };
    ace?: {
      edit?: (selector: string) => {
        getValue?: () => string;
      };
    };
    CodeMirror?: {
      fromTextArea?: (element: HTMLElement) => {
        getValue?: () => string;
      };
    };
  };

  // Method 1: Try Overleaf's custom editor API
  if (windowWithEditor.editor?.getDocValue) {
    try {
      return windowWithEditor.editor.getDocValue();
    } catch (err) {
      console.error('[FileReader] Error using editor.getDocValue:', err);
    }
  }

  if (windowWithEditor.editor?.getValue) {
    try {
      return windowWithEditor.editor.getValue();
    } catch (err) {
      console.error('[FileReader] Error using editor.getValue:', err);
    }
  }

  // Method 2: Try CodeMirror
  const codemirrorElement = document.querySelector('.CodeMirror');
  if (codemirrorElement && windowWithEditor.CodeMirror) {
    try {
      const cm = windowWithEditor.CodeMirror.fromTextArea(codemirrorElement as HTMLElement);
      if (cm.getValue) {
        return cm.getValue();
      }
    } catch (err) {
      console.error('[FileReader] Error using CodeMirror:', err);
    }
  }

  // Method 3: Try ACE editor
  if (windowWithEditor.ace?.edit) {
    try {
      const editor = windowWithEditor.ace.edit('editor');
      if (editor.getValue) {
        return editor.getValue();
      }
    } catch (err) {
      console.error('[FileReader] Error using ACE editor:', err);
    }
  }

  // Method 4: Fallback - extract from textarea or contenteditable
  const textarea = document.querySelector('textarea[name="content"]');
  if (textarea) {
    return (textarea as HTMLTextAreaElement).value;
  }

  const contentEditable = document.querySelector('[contenteditable="true"]');
  if (contentEditable) {
    return contentEditable.textContent || '';
  }

  console.error('[FileReader] Could not extract document content');
  return null;
}

/**
 * Set content of the currently open document
 */
function setCurrentDocumentContent(content: string): boolean {
  const windowWithEditor = window as unknown as {
    editor?: {
      setDocValue?: (value: string) => void;
      setValue?: (value: string) => void;
    };
    ace?: {
      edit?: (selector: string) => {
        setValue?: (value: string) => void;
      };
    };
  };

  // Method 1: Try Overleaf's custom editor API
  if (windowWithEditor.editor?.setDocValue) {
    try {
      windowWithEditor.editor.setDocValue(content);
      return true;
    } catch (err) {
      console.error('[FileReader] Error using editor.setDocValue:', err);
    }
  }

  if (windowWithEditor.editor?.setValue) {
    try {
      windowWithEditor.editor.setValue(content);
      return true;
    } catch (err) {
      console.error('[FileReader] Error using editor.setValue:', err);
    }
  }

  // Method 2: Try ACE editor
  if (windowWithEditor.ace?.edit) {
    try {
      const editor = windowWithEditor.ace.edit('editor');
      if (editor.setValue) {
        editor.setValue(content);
        return true;
      }
    } catch (err) {
      console.error('[FileReader] Error using ACE editor.setValue:', err);
    }
  }

  console.error('[FileReader] Could not set document content');
  return false;
}

/**
 * Handle messages from bridge or background scripts
 */
chrome.runtime.onMessage.addListener((message: FileReaderMessage, sender, sendResponse) => {
  console.log('[FileReader] Received message:', message.type, 'Payload:', JSON.stringify(message).substring(0, 200));

  // Return true to indicate we will send response asynchronously
  let responded = false;

  setTimeout(() => {
    try {
      switch (message.type) {
        case 'GET_ALL_FILES':
          const files = getAllFiles();
          console.log('[FileReader] Found files:', files);
          if (!responded) {
            sendResponse({ success: true, data: files });
            responded = true;
          }
          break;

        case 'GET_FILE_CONTENT':
          const content = getCurrentDocumentContent();
          if (content !== null) {
            console.log('[FileReader] Got content, length:', content.length);
            if (!responded) {
              sendResponse({ success: true, data: { content, path: getCurrentDocumentInfo()?.path || '/main.tex' } });
              responded = true;
            }
          } else {
            if (!responded) {
              sendResponse({ success: false, error: 'Could not read document content' });
              responded = true;
            }
          }
          break;

        case 'SET_FILE_CONTENT':
          const payload = message.payload as FileContent;
          if (payload?.content) {
            const success = setCurrentDocumentContent(payload.content);
            if (!responded) {
              sendResponse({ success, data: { path: payload.path } });
              responded = true;
            }
          } else {
            if (!responded) {
              sendResponse({ success: false, error: 'Invalid payload' });
              responded = true;
            }
          }
          break;

        default:
          console.error('[FileReader] Unknown message type:', message.type);
          if (!responded) {
            sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
            responded = true;
          }
          break;
      }
    } catch (error) {
      console.error('[FileReader] Error handling message:', error);
      if (!responded) {
        sendResponse({ success: false, error: String(error) });
        responded = true;
      }
    }
  }, 0);

  return true; // Keep message channel open for async response
});

console.log('[FileReader] File reader content script loaded');
