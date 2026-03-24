# Overleaf CC API Documentation

**Purpose:** Complete API documentation for Overleaf file mirroring and synchronization

**Research Date:** 2026-03-06

**Target Repository:** `C:\Home\CodeProjects\overleaf-cc`

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Project Operations](#project-operations)
4. [File Operations](#file-operations)
5. [Document Operations](#document-operations)
6. [Folder Operations](#folder-operations)
7. [Versioning Mechanism](#versioning-mechanism)
8. [Error Handling](#error-handling)
9. [Rate Limiting](#rate-limiting)
10. [Response Formats](#response-formats)
11. [Implementation Examples](#implementation-examples)

---

## Overview

This document provides comprehensive API documentation for implementing file mirroring between Overleaf and local systems. The Overleaf API uses RESTful endpoints with JSON payloads and supports both web-based and private API authentication.

### Base URLs

- **Web API:** `https://<overleaf-domain>/`
- **Private API:** `https://<overleaf-domain>/api/private/`

### Entity Types

- **doc** - LaTeX/text documents (versioned, OT-enabled)
- **file** - Binary files (images, PDFs, etc.)
- **folder** - Folders (organizational structure)

---

## Authentication

### Web API Authentication

Session-based authentication for user-facing operations:

```javascript
// Session cookie handling
const response = await fetch('/project/project_123/entities', {
  headers: {
    'Cookie': 'session-id=value; other-cookies=values'
  }
});
```

**Middleware:**
- `AuthenticationController.requireLogin()` - Requires valid user session
- `AuthorizationMiddleware.ensureUserCanReadProject` - Validates project read access
- `AuthorizationMiddleware.ensureUserCanWriteProjectContent` - Validates write permissions

### Private API Authentication

Service-to-service authentication for internal operations:

```javascript
// Service token in Authorization header
const response = await fetch('/api/private/project/project_123/doc/doc_456', {
  headers: {
    'Authorization': 'Bearer service-token',
    'Content-Type': 'application/json'
  }
});
```

**Middleware:**
- `AuthenticationController.requirePrivateApiAuth()` - Validates service-to-service tokens
- Uses shared secret authentication between services

---

## Project Operations

### Get Project Details

```http
GET /api/internal/project/:project_id
```

**Authentication:** Private API auth

**Response:**
```json
{
  "project_id": "project_123",
  "name": "Project Name",
  "owner": "user_456",
  "collaborators": [...],
  "settings": {...}
}
```

### Get User Projects

```http
GET /user/projects
```

**Authentication:** Session auth

**Response:**
```json
{
  "projects": [
    {
      "project_id": "project_123",
      "name": "Project 1",
      "last_accessed": "2026-03-06T10:30:00.000Z"
    }
  ]
}
```

### Create Project

```http
POST /project/new
```

**Authentication:** Session auth
**Rate Limit:** 20 requests per 60 seconds

**Request Body:**
```json
{
  "name": "New Project Name",
  "description": "Optional description",
  "compiler": "pdfLaTeX"
}
```

---

## File Operations

### Get File

```http
GET /Project/:Project_id/file/:File_id
HEAD /Project/:Project_id/file/:File_id
```

**Authentication:** Session auth
**Controller:** `FileStoreController.getFile`

### Get File Metadata (HEAD)

Returns file metadata without content:

```http
HEAD /Project/:Project_id/file/:File_id
```

**Response Headers:**
```
Content-Type: image/png
Content-Length: 1024
Last-Modified: Wed, 06 Mar 2026 10:30:00 GMT
```

---

## Document Operations

### Get Document Content (Private API)

```http
GET /api/private/project/:Project_id/doc/:doc_id
```

**Authentication:** Private API auth
**Query Parameters:**
- `plain=true` - Return as plain text
- `peek=true` - Read without incrementing version

**Response:**
```json
{
  "lines": ["\\documentclass{article}", "\\begin{document}", "..."],
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

### Get Document Content (Web API)

```http
GET /Project/:Project_id/doc/:Doc_id/download
```

**Authentication:** Session auth
**Response:** Plain text content directly

### Set Document Content (Private API)

```http
POST /api/private/project/:Project_id/doc/:doc_id
```

**Authentication:** Private API auth
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "lines": ["\\documentclass{article}", "\\begin{document}", "Content"],
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
    "trackedChanges": [...]
  },
  "lastUpdatedAt": "2026-03-06T10:30:00.000Z",
  "lastUpdatedBy": "user_456"
}
```

**Response:**
```json
{
  "doc_id": "doc_id_string",
  "version": 124,
  "lines": ["\\documentclass{article}", "\\begin{document}", "Updated content"],
  "ranges": {
    "comments": [...],
    "trackedChanges": [...]
  },
  "pathname": "/main.tex"
}
```

---

## Folder Operations

### Add Folder (Web API)

```http
POST /project/:Project_id/folder
```

**Authentication:** Session auth
**Rate Limit:** 60 requests per 60 seconds
**Controller:** `EditorHttpController.addFolder`

**Request Body:**
```json
{
  "name": "new_folder",
  "parent_folder_id": "parent_folder_id_or_null"
}
```

**Parameters:**
- `name` - Folder name (max 149 characters, must be valid filename)
- `parent_folder_id` - ID of parent folder (null for root level)

**Response:**
```json
{
  "folder": {
    "_id": "folder_123",
    "name": "new_folder",
    "path": "/new_folder",
    "parent_folder_id": "parent_456",
    "creator_id": "user_789",
    "created_at": "2026-03-06T10:30:00.000Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid folder name or too many files
- `403 Forbidden` - Insufficient permissions
- `500 Internal Server Error` - Server error

### Delete Folder

```http
DELETE /project/:Project_id/folder/:entity_id
```

**Authentication:** Session auth
**Controller:** `EditorHttpController.deleteFolder`

**Response:** `204 No Content` on success

**Error Responses:**
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Folder doesn't exist
- `400 Bad Request` - Folder contains files (must be empty)

### Folder Operations Summary

| Operation | Method | Endpoint | Auth | Rate Limit |
|-----------|--------|----------|------|------------|
| Create Folder | POST | `/project/:Project_id/folder` | Session | 60/60s |
| Delete Folder | DELETE | `/project/:Project_id/folder/:entity_id` | Session | None |
| Move Folder | POST | `/project/:Project_id/folder/:entity_id/move` | Session | None |
| Rename Folder | POST | `/project/:Project_id/folder/:entity_id/rename` | Session | None |

### TPDS Folder Updates (Internal)

```http
POST /api/private/tpds/folder-update
```

**Authentication:** Private API auth
**Controller:** `TpdsController.updateFolder`

**Purpose:** Internal folder update notifications for TPDS service

**Request Body:**
```json
{
  "userId": "user_123",
  "projectId": "project_456",
  "path": "/folder/path"
}
```

---

## Versioning Mechanism

### Document Versioning

Overleaf uses Operational Transformation (OT) for document versioning:

- **Version Number:** Each document has an incremental integer version
- **Optimistic Locking:** Updates must include current version to prevent conflicts
- **Version Increment:** Successful updates increment version by 1
- **Peek Operations:** `peek=true` parameter reads without incrementing version

**Version Flow Example:**
```javascript
// Current state: version = 100
// Read with peek (no version change)
const readResponse = await fetch('/api/private/project/123/doc/456?peek=true');
const currentVersion = readResponse.version; // 100

// Update with current version
const updateResponse = await fetch('/api/private/project/123/doc/456', {
  method: 'POST',
  body: JSON.stringify({
    lines: ["new content"],
    version: 100  // Must match current version
  })
});
// Response: { version: 101, ... }
```

### Project History

- **History Type:** All projects use "project-history"
- **History Ranges:** Support for track changes and comments
- **Migration Stage:**
  - `otMigrationStage: 0` - Legacy system
  - `otMigrationStage: 1` - Partial migration
  - `otMigrationStage: 2` - Full OT migration (current)

### Range Operations

Documents support range operations for annotations:

```json
{
  "ranges": {
    "comments": [
      {
        "id": "comment_123",
        "op": "insert|retain|delete",
        "p": 5,  // position
        "length": 10,
        "attributes": {
          "comment": {
            "id": "comment_123",
            "userId": "user_456",
            "userName": "John Doe",
            "timestamp": "2026-03-06T10:30:00.000Z",
            "resolved": false,
            "text": "Comment text"
          }
        }
      }
    ],
    "trackedChanges": [...]
  }
}
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "error_type",
  "message": "Human readable error message",
  "details": {...}  // Optional additional details
}
```

### Common Error Types

| Error Type | HTTP Status | Description |
|------------|-------------|-------------|
| `invalid_version` | 400 | Version mismatch in document update |
| `not_found` | 404 | Requested entity doesn't exist |
| `permission_denied` | 403 | Insufficient permissions |
| `invalid_request` | 400 | Missing required fields or invalid data |
| `service_unavailable` | 503 | Backend service unavailable |
| `project_has_too_many_files` | 400 | Project exceeds entity limit |

### Error Retry Strategy

1. **Version Mismatch:** Re-read document and retry with correct version
2. **Service Unavailable:** Implement exponential backoff retry
3. **Permission Denied:** Check user access rights
4. **Rate Limited:** Implement exponential backoff

---

## Rate Limiting

### Key Rate Limits

| Operation | Rate Limit | Duration |
|-----------|------------|----------|
| `addDocToProject` | 30 requests | 60 seconds |
| `addFolderToProject` | 60 requests | 60 seconds |
| `joinProject` | 45 requests | 60 seconds |
| `getProjects` | 30 requests | 60 seconds |
| `createProject` | 20 requests | 60 seconds |
| `zipDownload` | 10 requests | 60 seconds |

### Rate Limit Headers

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1646523600
Retry-After: 2
```

---

## Response Formats

### Project Entities (File Tree)

```json
{
  "project_id": "project_id_string",
  "entities": [
    {
      "path": "/main.tex",
      "type": "doc",
      "name": "main.tex",
      "_id": "doc_123",
      "version": 45,
      "last_modified": "2026-03-06T10:30:00.000Z"
    },
    {
      "path": "/images/figure1.png",
      "type": "file",
      "name": "figure1.png",
      "_id": "file_456",
      "size": 1024,
      "last_modified": "2026-03-06T10:30:00.000Z"
    },
    {
      "path": "/sections",
      "type": "folder",
      "name": "sections",
      "_id": "folder_789",
      "entity_count": 3
    }
  ]
}
```

### Document Update Response

```json
{
  "doc_id": "doc_id_string",
  "version": 124,
  "lines": ["\\documentclass{article}", "\\begin{document}", "Content"],
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
    "trackedChanges": []
  },
  "pathname": "/main.tex",
  "projectHistoryId": "history_id_string",
  "projectHistoryType": "project-history",
  "historyRangesSupport": true,
  "otMigrationStage": 2,
  "resolvedCommentIds": ["comment_123"]
}
```

---

## Implementation Examples

### Basic Document Synchronization

```javascript
class OverleafSync {
  constructor(overleafUrl, serviceToken) {
    this.baseUrl = overleafUrl;
    this.serviceToken = serviceToken;
  }

  async getProjectEntities(projectId) {
    const response = await fetch(`${this.baseUrl}/api/private/project/${projectId}/entities`, {
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`
      }
    });
    return response.json();
  }

  async getDocumentContent(projectId, docId, usePeek = false) {
    const params = new URLSearchParams();
    if (usePeek) params.append('peek', 'true');

    const response = await fetch(
      `${this.baseUrl}/api/private/project/${projectId}/doc/${docId}?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${this.serviceToken}`
        }
      }
    );
    return response.json();
  }

  async updateDocumentContent(projectId, docId, content, version) {
    const response = await fetch(`${this.baseUrl}/api/private/project/${projectId}/doc/${docId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lines: content.lines,
        version: version,
        ranges: content.ranges || {}
      })
    });
    return response.json();
  }

  async createFolder(projectId, folderName, parentFolderId = null) {
    const response = await fetch(`${this.baseUrl}/project/${projectId}/folder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        parent_folder_id: parentFolderId
      })
    });
    return response.json();
  }

  async deleteFolder(projectId, folderId) {
    const response = await fetch(`${this.baseUrl}/project/${projectId}/folder/${folderId}`, {
      method: 'DELETE'
    });
    return response.status === 204;
  }
}
```

### Conflict Resolution with Versioning

```javascript
async syncDocument(sync, projectId, docId, localContent) {
  try {
    // Get current document with peek to avoid version increment
    const doc = await sync.getDocumentContent(projectId, docId, true);

    // Compare versions and content
    if (doc.version !== localContent.version) {
      // Conflict detected - implement merge strategy
      const mergedContent = mergeContent(doc, localContent);

      // Update with merged content
      const result = await sync.updateDocumentContent(
        projectId,
        docId,
        mergedContent,
        doc.version  // Use server version
      );

      return result;
    }

    // No conflict - update with local version
    return await sync.updateDocumentContent(
      projectId,
      docId,
      localContent,
      localContent.version
    );
  } catch (error) {
    if (error.message === 'invalid_version') {
      // Retry with correct version
      const doc = await sync.getDocumentContent(projectId, docId, true);
      return sync.updateDocumentContent(
        projectId,
        docId,
        localContent,
        doc.version
      );
    }
    throw error;
  }
}
```

### Folder Management

```javascript
async ensureFolderStructure(sync, projectId, folderPath) {
  const parts = folderPath.split('/').filter(p => p);
  let currentPath = '';
  let currentParentId = null;

  for (const part of parts) {
    currentPath += `/${part}`;

    // Check if folder exists
    const entities = await sync.getProjectEntities(projectId);
    const folder = entities.entities.find(
      e => e.path === currentPath && e.type === 'folder'
    );

    if (!folder) {
      // Create folder
      const result = await sync.createFolder(projectId, part, currentParentId);
      currentParentId = result.folder._id;
    } else {
      currentParentId = folder._id;
    }
  }
}
```

---

## Best Practices

### Performance Considerations

1. **Use `peek=true`** for frequent reads to avoid unnecessary version increments
2. **Batch operations** when possible to reduce API calls
3. **Implement caching** for frequently accessed entities
4. **Monitor rate limits** and implement exponential backoff

### Data Consistency

1. **Always check version numbers** before updating documents
2. **Handle conflicts gracefully** with proper merge strategies
3. **Validate permissions** before performing write operations
4. **Use proper error handling** for network and server errors

### Security

1. **Store service tokens securely** (never in client-side code)
2. **Validate all user input** before API calls
3. **Implement proper authentication** for all endpoints
4. **Use HTTPS** for all API communications

---

## Next Steps

1. **Implement entity monitoring** for change detection
2. **Create bidirectional sync** logic with conflict resolution
3. **Add offline support** with local storage
4. **Implement user interface** for sync status and controls
5. **Add comprehensive logging** for debugging and monitoring

---

This documentation covers all essential API operations for implementing file mirroring between Overleaf and local systems. Focus on proper version handling, error management, and security for a robust implementation.