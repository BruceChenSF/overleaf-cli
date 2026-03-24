# Overleaf API Reference

**Purpose:** Document all Overleaf API endpoints needed for file mirroring

**Research Date:** 2026-03-06

**Reference Repository:** `C:\Home\CodeProjects\overleaf\`

---

## Overview

This document catalogs the Overleaf API endpoints that are relevant for implementing file mirroring functionality. The Overleaf web service uses Express.js with router modules defined in `services/web/app/src/router.mjs`.

Key directories:
- Router: `services/web/app/src/router.mjs`
- Project Controllers: `services/web/app/src/Features/Project/`
- Editor Routes: `services/web/app/src/Features/Editor/EditorRouter.mjs`
- Document Controllers: `services/web/app/src/Features/Documents/`

---

## Discovered Routes

### Project Entity Operations

#### Get Project Entities (File Tree)
```
GET /project/:Project_id/entities
```
- **Controller:** `ProjectController.projectEntitiesJson`
- **Auth:** `requireLogin()`, `ensureUserCanReadProject`
- **Purpose:** Returns the complete file/folder structure for a project
- **Controller File:** `ProjectController.mjs`

#### Get All Documents in Project
```
GET /project/:Project_id/entities
```
- **Controller:** `ProjectController.projectEntitiesJson`
- **Auth:** `requireLogin()`, `ensureUserCanReadProject`
- **Purpose:** Get all documents and files in a project, then filter for documents only
- **Note:** This endpoint returns the complete file/folder structure including both documents and files

**Response Format:**
```json
{
  "project_id": "project_id_string",
  "entities": [
    {
      "path": "/main.tex",
      "type": "doc",
      "name": "main.tex"
    },
    {
      "path": "/section1.tex",
      "type": "doc",
      "name": "section1.tex"
    },
    {
      "path": "/images/figure1.png",
      "type": "file",
      "name": "figure1.png"
    },
    {
      "path": "/references.bib",
      "type": "file",
      "name": "references.bib"
    }
  ]
}
```

**To get documents only:**
1. Call `/project/:Project_id/entities`
2. Filter entities where `type === "doc"`
3. Extract document paths/names for processing

**Example document filtering:**
```javascript
// Filter response to get only documents
const documents = response.entities.filter(entity => entity.type === "doc");
// Returns: [{ path: "/main.tex", name: "main.tex", type: "doc" }, ...]
```
- **Controller File:** `ProjectController.mjs` → `ProjectEntityHandler.getAllEntitiesFromProject()`

#### Join Project (Editor Initialization)
```
POST /project/:Project_id/join
```
- **Router:** `privateApiRouter`
- **Controller:** `EditorHttpController.joinProject`
- **Auth:** `requirePrivateApiAuth()`
- **Purpose:** Initialize project state when user joins editor
- **Rate Limit:** 45 requests per 60 seconds
- **Controller File:** `EditorRouter.mjs` → `EditorHttpController.mjs`

---

### Document Operations

#### Get Document Content (Private API)
```
GET /project/:Project_id/doc/:doc_id
```
- **Router:** `privateApiRouter`
- **Controller:** `DocumentController.getDocument`
- **Auth:** `requirePrivateApiAuth()`
- **Query Params:**
  - `plain=true` - Return as plain text
  - `peek=true` - Peek without version increment
- **Purpose:** Get document content for file synchronization
- **Response Format:**
  ```json
  {
    "lines": ["\\documentclass{article}", "..."],
    "version": 123,
    "ranges": {
      "comments": [...],
      "trackedChanges": [...]
    },
    "pathname": "/main.tex",
    "projectHistoryId": "history_id_string",
    "projectHistoryType": "project-history",
    "historyRangesSupport": true,
    "otMigrationStage": 2,
    "resolvedCommentIds": ["comment1", "comment2"]
  }
  ```
  When `plain=true` returns plain text content directly
- **Controller File:** `services/web/app/src/Features/Documents/DocumentController.mjs`
- **Implementation:** Uses `ProjectEntityHandler.promises.getDoc()` → `DocstoreManager.promises.getDoc()`

#### Download Document Content (Web API)
```
GET /Project/:Project_id/doc/:Doc_id/download
```
- **Router:** `webRouter`
- **Controller:** `DocumentUpdaterController.getDoc`
- **Auth:** `ensureUserCanReadProject`
- **Purpose:** Download document content as plain text
- **Note:** "download" suffix to avoid conflict with private API route
- **Controller File:** `services/web/app/src/Features/DocumentUpdater/DocumentUpdaterController.mjs`

## Document Update API

### Set Document Content (Private API)
```
POST /project/:Project_id/doc/:doc_id
```
- **Router:** `privateApiRouter`
- **Controller:** `DocumentController.setDocument`
- **Auth:** `requirePrivateApiAuth()`
- **Purpose:** Update document content using Operational Transformation (OT)
- **Controller File:** `Features/Documents/DocumentController.mjs`

#### Request Format

**URL Parameters:**
- `:Project_id` - Project identifier
- `:doc_id` - Document identifier

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <service-token>`

**Request Body:**
```json
{
  "lines": ["\\documentclass{article}", "\\begin{document}", "Content here", "\\end{document}"],
  "version": 123,
  "ranges": {
    "comments": [
      {
        "id": "comment_123",
        "op": "insert",
        "p": 5,
        "length": 10,
        "attributes": {
          "comment": {
            "id": "comment_123",
            "userId": "user_456",
            "userName": "John Doe",
            "timestamp": "2026-03-06T10:30:00.000Z",
            "resolved": false,
            "text": "This needs clarification"
          }
        }
      }
    ],
    "trackedChanges": [
      {
        "id": "tc_456",
        "op": "insert",
        "p": 15,
        "length": 8,
        "attributes": {
          "tracked": {
            "id": "tc_456",
            "userId": "user_789",
            "userName": "Jane Smith",
            "timestamp": "2026-03-06T11:00:00.000Z",
            "type": "insert"
          }
        }
      }
    ]
  },
  "lastUpdatedAt": "2026-03-06T10:30:00.000Z",
  "lastUpdatedBy": "user_456"
}
```

**Required Fields:**
- `lines` - Array of strings representing document lines (UTF-8)
- `version` - Current document version number for optimistic locking

**Optional Fields:**
- `ranges` - Object containing comments and tracked changes
- `lastUpdatedAt` - ISO timestamp of last update
- `lastUpdatedBy` - User ID who last updated

#### Response Format

**Success Response (200 OK):**
```json
{
  "doc_id": "doc_id_string",
  "version": 124,
  "lines": ["\\documentclass{article}", "\\begin{document}", "Updated content", "\\end{document}"],
  "ranges": {
    "comments": [...],
    "trackedChanges": [...]
  },
  "pathname": "/main.tex",
  "projectHistoryId": "history_id_string",
  "projectHistoryType": "project-history",
  "historyRangesSupport": true,
  "otMigrationStage": 2,
  "resolvedCommentIds": ["comment_123"]
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "invalid_version",
  "message": "Version mismatch: provided 123, current 125"
}
```

**Error Response (404 Not Found):**
```json
{
  "error": "not_found",
  "message": "Document not found"
}
```

**Error Response (403 Forbidden):**
```json
{
  "error": "permission_denied",
  "message": "User lacks write permission"
}
```

#### Version Handling and Optimistic Locking

**Critical Implementation Details:**

1. **Version Increment:** Each successful update increments the document version by 1
2. **Version Validation:** The `version` field in the request must match the current version
3. **Conflict Resolution:** If version doesn't match, request fails with `invalid_version` error
4. **Non-atomic Operations:** The entire document content is replaced, not merged

**Version Flow Example:**
```javascript
// Current state: version = 100
// Request: { lines: ["new content"], version: 100 }
// Response: { doc_id: "123", version: 101, lines: ["new content"] }
// Next request must use version: 101
```

**Peek vs Update Operations:**
- Use `GET /project/:Project_id/doc/:doc_id?peek=true` to read without incrementing version
- Always get current version before updating to avoid conflicts

#### Operational Transformation (OT) Integration

**Range Operations:**
- `ranges.comments` - Comment annotations with insert/update/delete operations
- `ranges.trackedChanges` - Track changes with user attribution
- Each range operation has `op`, `p` (position), `length`, and `attributes`

**Range Operation Types:**
- `insert` - Insert new content/range at position
- `retain` - Preserve content (no change)
- `delete` - Remove content at position

**Migration Stages:**
- `otMigrationStage: 0` - Legacy system
- `otMigrationStage: 1` - Partial migration
- `otMigrationStage: 2` - Full OT migration (current)

#### Usage Examples

**Basic Content Update:**
```javascript
const response = await fetch('/api/project/project_123/doc/doc_456', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer service-token'
  },
  body: JSON.stringify({
    lines: ['\\documentclass{article}', '\\begin{document}', 'Content', '\\end{document}'],
    version: 123
  })
});
```

**Update with Comment:**
```javascript
const response = await fetch('/api/project/project_123/doc/doc_456', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer service-token'
  },
  body: JSON.stringify({
    lines: ['Updated content with comment'],
    version: 123,
    ranges: {
      comments: [{
        id: 'comment_001',
        op: 'insert',
        p: 0,
        length: 5,
        attributes: {
          comment: {
            id: 'comment_001',
            userId: 'user_001',
            userName: 'Editor',
            timestamp: new Date().toISOString(),
            resolved: false,
            text: 'Please review this change'
          }
        }
      }]
    }
  })
});
```

#### Error Handling

**Common Error Scenarios:**

1. **Version Mismatch (400):**
   ```json
   { "error": "invalid_version", "message": "Version conflict" }
   ```

2. **Document Not Found (404):**
   ```json
   { "error": "not_found", "message": "Document does not exist" }
   ```

3. **Permission Denied (403):**
   ```json
   { "error": "permission_denied", "message": "Insufficient permissions" }
   ```

4. **Invalid Request (400):**
   ```json
   { "error": "invalid_request", "message": "Missing required fields" }
   ```

5. **Service Unavailable (503):**
   ```json
   { "error": "service_unavailable", "message": "DocumentUpdater service unavailable" }
   ```

**Retry Strategy:**
- On version mismatch: Re-read document and retry with correct version
- On service unavailable: Implement exponential backoff retry
- On permission denied: Check user access rights

#### Implementation Notes

**Controller Chain:**
1. `DocumentController.setDocument()` (HTTP entry point)
2. `ProjectEntityHandler.promises.updateDoc()` (Entity validation)
3. `DocstoreManager.promises.updateDoc()` (Document storage via OT)
4. `DocumentUpdater` service (Operational Transformation)

**Rate Limiting:**
- Default: 60 requests per 60 seconds per project
- May vary based on project settings and user tier

**Performance Considerations:**
- Large documents (>10,000 lines) may have increased latency
- Concurrent updates require careful version handling
- Use `peek=true` for frequent reads without version increment

**Security:**
- Service-to-service authentication required
- Project write permissions validated
- Input sanitization for document content

---

### File Operations

#### Get File
```
GET /Project/:Project_id/file/:File_id
HEAD /Project/:Project_id/file/:File_id
```
- **Controller:** `FileStoreController.getFile` / `getFileHead`
- **Auth:** `ensureUserCanReadProject`
- **Purpose:** Retrieve binary file content
- **Controller File:** `Features/FileStore/FileStoreController.mjs`

---

### Entity CRUD Operations (Editor Routes)

#### Add Document
```
POST /project/:Project_id/doc
```
- **Controller:** `EditorHttpController.addDoc`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Rate Limit:** 30 requests per 60 seconds
- **Purpose:** Create new document in project
- **Controller File:** `Features/Editor/EditorRouter.mjs`

#### Add Folder
```
POST /project/:Project_id/folder
```
- **Controller:** `EditorHttpController.addFolder`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Rate Limit:** 60 requests per 60 seconds
- **Purpose:** Create new folder in project
- **Controller File:** `Features/Editor/EditorRouter.mjs`

#### Rename Entity
```
POST /project/:Project_id/:entity_type/:entity_id/rename
```
- **Controller:** `EditorHttpController.renameEntity`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Params:**
  - `entity_type`: "doc", "file", or "folder"
  - `entity_id`: ID of the entity
- **Purpose:** Rename document, file, or folder
- **Controller File:** `Features/Editor/EditorRouter.mjs`

#### Move Entity
```
POST /project/:Project_id/:entity_type/:entity_id/move
```
- **Controller:** `EditorHttpController.moveEntity`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Params:**
  - `entity_type`: "doc", "file", or "folder"
  - `entity_id`: ID of the entity
- **Purpose:** Move entity to different folder
- **Controller File:** `Features/Editor/EditorRouter.mjs`

### File, Document, and Folder Operations

#### Rename Entity
```
POST /project/:Project_id/:entity_type/:entity_id/rename
```
- **Controller:** `EditorHttpController.renameEntity`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Rate Limit:** No specific rate limit configured
- **Params:**
  - `entity_type`: "doc", "file", or "folder"
  - `entity_id`: ID of the entity to rename
- **Purpose:** Rename document, file, or folder
- **Controller File:** `Features/Editor/EditorHttpController.mjs`

**Request Format:**
```json
{
  "name": "new_document_name.tex",
  "source": "editor"
}
```

**Required Fields:**
- `name` - New name for the entity (max 149 characters, min 1 character)
- `source` - Source of the rename operation (defaults to "editor")

**Response Format:**
- **Success (204 No Content):** Empty response with 204 status code
- **Error (400 Bad Request):** If name is invalid (too long, too short, or empty)
- **Error (403 Forbidden):** If user lacks write permissions
- **Error (404 Not Found):** If entity doesn't exist

**Usage Example:**
```javascript
const response = await fetch('/api/project/project_123/doc/doc_456/rename', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer user-session-token'
  },
  body: JSON.stringify({
    name: 'renamed_document.tex',
    source: 'mirror-service'
  })
});
```

#### Move Entity
```
POST /project/:Project_id/:entity_type/:entity_id/move
```
- **Controller:** `EditorHttpController.moveEntity`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Params:**
  - `entity_type`: "doc", "file", or "folder"
  - `entity_id`: ID of the entity to move
- **Purpose:** Move entity to different folder
- **Controller File:** `Features/Editor/EditorHttpController.mjs`

**Request Format:**
```json
{
  "folder_id": "target_folder_id",
  "source": "editor"
}
```

**Required Fields:**
- `folder_id` - ID of the target folder (null for root)
- `source` - Source of the move operation (defaults to "editor")

**Response Format:**
- **Success (204 No Content):** Empty response with 204 status code

#### Delete File
```
DELETE /project/:Project_id/file/:entity_id
```
- **Controller:** `EditorHttpController.deleteFile`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a file
- **Controller File:** `Features/Editor/EditorHttpController.mjs`
- **Implementation:** Routes to `deleteEntity` with `entity_type = 'file'`

#### Delete Document
```
DELETE /project/:Project_id/doc/:entity_id
```
- **Controller:** `EditorHttpController.deleteDoc`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a document
- **Controller File:** `Features/Editor/EditorHttpController.mjs`
- **Implementation:** Routes to `deleteEntity` with `entity_type = 'doc'`

#### Delete Folder
```
DELETE /project/:Project_id/folder/:entity_id
```
- **Controller:** `EditorHttpController.deleteFolder`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a folder
- **Controller File:** `Features/Editor/EditorHttpController.mjs`
- **Implementation:** Routes to `deleteEntity` with `entity_type = 'folder'`

#### Unified Delete Entity (Internal Implementation)
```
DELETE /project/:Project_id/:entity_type/:entity_id
```
- **Controller:** `EditorHttpController.deleteEntity`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Core delete functionality used by all entity types
- **Response:** Always returns 204 No Content on success

**Implementation Details:**
1. **Routing:** Separate endpoints for each entity type (doc, file, folder)
2. **Authorization:** All require write permissions via `ensureUserCanWriteProjectContent`
3. **Response:** All operations return 204 No Content on success
4. **Error Handling:**
   - 400: Invalid entity name (for rename)
   - 403: Insufficient permissions
   - 404: Entity not found
5. **Rate Limiting:** No specific rate limits configured for delete/rename operations

---

### Project Operations

#### Get Project Details
```
GET /internal/project/:project_id
```
- **Router:** `privateApiRouter` (deprecated: `/project/:project_id/details`)
- **Controller:** `ProjectApiController.getProjectDetails`
- **Auth:** `requirePrivateApiAuth()`
- **Purpose:** Get detailed project information
- **Controller File:** `Features/Project/ProjectApiController.mjs`

#### User Projects List
```
GET /user/projects
```
- **Controller:** `ProjectController.userProjectsJson`
- **Auth:** `requireLogin()`
- **Purpose:** Get list of user's projects

#### Get Projects (API)
```
POST /api/project
```
- **Controller:** `ProjectListController.getProjectsJson`
- **Auth:** `requireLogin()`
- **Rate Limit:** 30 requests per 60 seconds
- **Purpose:** Get projects with filtering/pagination

#### Create Project
```
POST /project/new
```
- **Controller:** `ProjectController.newProject`
- **Auth:** `requireLogin()`
- **Rate Limit:** 20 requests per 60 seconds
- **Purpose:** Create new project

---

## Project Structure

### Key Controllers and Responsibilities

#### `ProjectController.mjs`
- **Location:** `services/web/app/src/Features/Project/ProjectController.mjs`
- **Responsibilities:**
  - Project CRUD operations (create, read, update, delete)
  - Project settings management
  - Project entity tree retrieval
  - Project archiving/trashing
  - Project cloning
  - User projects list

#### `ProjectApiController.mjs`
- **Location:** `services/web/app/src/Features/Project/ProjectApiController.mjs`
- **Responsibilities:**
  - Internal API endpoints for project details
  - Used by other Overleaf services

#### `ProjectEntityHandler.mjs`
- **Location:** `services/web/app/src/Features/Project/ProjectEntityHandler.mjs`
- **Responsibilities:**
  - Core entity operations (docs, files, folders)
  - Document content retrieval
  - Entity traversal and management

#### `EditorHttpController.mjs`
- **Location:** `services/web/app/src/Features/Editor/EditorHttpController.mjs`
- **Routes defined in:** `EditorRouter.mjs`
- **Responsibilities:**
  - Add/delete/move/rename entities
  - Join project (editor initialization)
  - File and document operations

#### `DocumentController.mjs`
- **Location:** `services/web/app/src/Features/Documents/DocumentController.mjs`
- **Responsibilities:**
  - Get document content (private API)
  - Set document content (private API)
  - Document version management
  - Range operations (comments, tracked changes)

#### `FileStoreController.mjs`
- **Location:** `services/web/app/src/Features/FileStore/FileStoreController.mjs`
- **Responsibilities:**
  - Binary file retrieval
  - File serving (images, PDFs, etc.)
  - File metadata (HEAD requests)

---

## Key Entity Handler Files

### `ProjectEntityHandler.mjs`
Core entity operations:
- `getDoc()` - Retrieve document content
- `getAllEntities()` - Get complete entity tree
- `getEntityAtPath()` - Find entity by path
- Entity traversal and validation

### `ProjectEntityUpdateHandler.mjs`
Entity modification operations:
- `updateDocLines()` - Update document content
- `addDoc()` - Add new document
- `addFile()` - Add new file
- `addFolder()` - Add new folder
- Entity rename and move operations

### `ProjectDetailsHandler.mjs`
Project metadata and configuration:
- Project settings
- Compiler settings
- Root document management
- Project properties

### `FolderStructureBuilder.mjs`
File tree construction:
- Build entity tree from database
- Path resolution
- Folder hierarchy management

---

## Router Types

Overleaf uses three router tiers:

1. **`webRouter`** - Public web routes
   - User-facing HTTP endpoints
   - Browser-accessible APIs
   - Session-based authentication

2. **`privateApiRouter`** - Internal service API
   - Service-to-service communication
   - Requires `requirePrivateApiAuth()`
   - Used by DocumentUpdater, Chat, etc.

3. **`publicApiRouter`** - Public API endpoints
   - Health checks
   - Status endpoints
   - No authentication required

---

## Authentication & Authorization

### Key Middleware

#### `AuthenticationController.requireLogin()`
- Requires user session
- Redirects to login if not authenticated
- Used for most user-facing routes

#### `AuthenticationController.requirePrivateApiAuth()`
- Requires service-to-service token
- Used for internal API routes
- Validates shared secret

#### `AuthorizationMiddleware.ensureUserCanReadProject`
- Checks user read access
- Validates project membership
- Checks token access for shared projects

#### `AuthorizationMiddleware.ensureUserCanWriteProjectContent`
- Checks user write access
- Validates edit permissions
- Blocks restricted users

---

## Rate Limiting

Key rate limiters relevant to file operations:

- `addDocToProject`: 30/60s
- `addFolderToProject`: 60/60s
- `joinProject`: 45/60s
- `getProjects`: 30/60s
- `createProject`: 20/60s
- `zipDownload`: 10/60s

---

## Next Steps for File Mirroring

1. **Entity Tree Monitoring**
   - Primary endpoint: `/project/:Project_id/entities`
   - Returns complete file/folder structure
   - Should be polled or monitored for changes

2. **Document Content Sync**
   - Read via: `GET /project/:Project_id/doc/:doc_id` (private API)
     - Query params: `plain=true` for text, `peek=true` for non-incremental reads
     - Returns `lines`, `version`, `ranges`, `pathname`, and project metadata
     - Critical for OT/conflict detection with `version` field
   - Updates via: `POST /project/:Project_id/doc/:doc_id` (private API)
     - Requires `version` for optimistic locking
     - Supports `ranges` for comments and tracked changes
   - Binary downloads: `GET /Project/:Project_id/doc/:Doc_id/download` (web API)

3. **File Content Sync**
   - Read via: `GET /Project/:Project_id/file/:File_id`
   - Binary files (images, PDFs, etc.)

4. **Change Detection**
   - Monitor: POST/DELETE operations in EditorRouter
   - Entity add/delete/move/rename operations
   - Document update operations

5. **Key Controllers to Study**
   - `ProjectEntityHandler` - Core entity operations and document retrieval
   - `EditorHttpController` - User-initiated changes
   - `DocumentController` - Document content operations (GET/SET)
   - `DocstoreManager` - Document storage and version management
   - `DocumentUpdaterController` - Document download operations

---

## Additional Notes

### Entity Types
- **doc** - LaTeX/text documents (versioned, OT-enabled)
- **file** - Binary files (images, PDFs, etc.)
- **folder** - Folders (organizational structure)

### Document Versioning
- Documents use Operational Transformation (OT)
- Each doc has a `version` number
- Ranges include comments, tracked changes, etc.
- Managed by DocumentUpdater service

### File Storage
- Binary files stored in FileStore service
- Referenced by File_id in project entity tree
- Served via FileStoreController

### Project History
- All projects use "project-history" type
- History ranges support for track changes
- Migrated to Full Project History system

---

---

## Research Findings

### Task 3: Document File Content Retrieval API - Implementation Details

**Research Date:** 2026-03-06

### Discrepancies Found

1. **Incorrect File Path:**
   - **Task Reference:** `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js`
   - **Reality:** File does not exist
   - **Correct Location:** `C:\Home\CodeProjects\overleaf\services\web\app\src\Features\Documents\DocumentController.mjs`

2. **Already Documented Endpoint:**
   - The endpoint was already partially documented in the existing documentation (lines 112-123)
   - Required more detailed information about response format and implementation

3. **Dual API Endpoints:**
   - **Private API:** `GET /project/:Project_id/doc/:doc_id` - Requires service-to-service auth
   - **Web API:** `GET /Project/:Project_id/doc/:Doc_id/download` - Requires user session auth

4. **Enhanced Response Format:**
   - Original task description was missing critical fields:
     - `pathname` - File system path
     - `projectHistoryId` and `projectHistoryType` - History system info
     - `historyRangesSupport` - Feature flag for track changes
     - `otMigrationStage` - Migration status
     - `resolvedCommentIds` - Comment resolution status

### Key Implementation Details

**Controller Chain:**
1. `DocumentController.getDocument()` (HTTP entry point)
2. `ProjectEntityHandler.promises.getDoc()` (Entity validation)
3. `DocstoreManager.promises.getDoc()` (Document storage)

**Version Management:**
- Each document has a `version` number for optimistic locking
- Supports `peek=true` parameter to read without incrementing version
- Essential for Operational Transformation (OT) and conflict detection

**Authentication:**
- Private API: `requirePrivateApiAuth()` - service-to-service tokens
- Web API: `ensureUserCanReadProject()` - user session validation

**Status:** Research complete. Documented accurate endpoint details and implementation discrepancies.

---
