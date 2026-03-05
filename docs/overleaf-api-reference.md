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

#### Get Document Content
```
GET /Project/:Project_id/doc/:Doc_id/download
```
- **Controller:** `DocumentUpdaterController.getDoc`
- **Auth:** `ensureUserCanReadProject`
- **Purpose:** Download document content
- **Note:** "download" suffix avoids conflict with private API route

#### Get Document (Private API)
```
GET /project/:Project_id/doc/:doc_id
```
- **Router:** `privateApiRouter`
- **Controller:** `DocumentController.getDocument`
- **Auth:** `requirePrivateApiAuth()`
- **Query Params:**
  - `plain=true` - Return as plain text
  - `peek=true` - Peek without version increment
- **Response:** JSON with `lines`, `version`, `ranges`, `pathname`, etc.
- **Controller File:** `Features/Documents/DocumentController.mjs`

#### Set Document Content (Private API)
```
POST /project/:Project_id/doc/:doc_id
```
- **Router:** `privateApiRouter`
- **Controller:** `DocumentController.setDocument`
- **Auth:** `requirePrivateApiAuth()`
- **Body:** `{ lines, version, ranges, lastUpdatedAt, lastUpdatedBy }`
- **Purpose:** Update document content
- **Controller File:** `Features/Documents/DocumentController.mjs`

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

#### Delete File
```
DELETE /project/:Project_id/file/:entity_id
```
- **Controller:** `EditorHttpController.deleteFile`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a file
- **Controller File:** `Features/Editor/EditorRouter.mjs`

#### Delete Document
```
DELETE /project/:Project_id/doc/:entity_id
```
- **Controller:** `EditorHttpController.deleteDoc`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a document
- **Controller File:** `Features/Editor/EditorRouter.mjs`

#### Delete Folder
```
DELETE /project/:Project_id/folder/:entity_id
```
- **Controller:** `EditorHttpController.deleteFolder`
- **Auth:** `ensureUserCanWriteProjectContent`
- **Purpose:** Delete a folder
- **Controller File:** `Features/Editor/EditorRouter.mjs`

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
   - Updates via: `POST /project/:Project_id/doc/:doc_id` (private API)
   - Includes version tracking for OT (Operational Transformation)

3. **File Content Sync**
   - Read via: `GET /Project/:Project_id/file/:File_id`
   - Binary files (images, PDFs, etc.)

4. **Change Detection**
   - Monitor: POST/DELETE operations in EditorRouter
   - Entity add/delete/move/rename operations
   - Document update operations

5. **Key Controllers to Study**
   - `ProjectEntityHandler` - Core entity operations
   - `EditorHttpController` - User-initiated changes
   - `DocumentController` - Document content operations

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

**Status:** Initial exploration complete. Ready for detailed endpoint analysis in subsequent tasks.
