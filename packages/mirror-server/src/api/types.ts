/**
 * Overleaf project file representation
 */
export interface ProjectFile {
  _id: string;
  name: string;
  path: string;
  type: 'doc' | 'file' | 'folder';
  created: string;
  updated: string;
}

/**
 * Generic API error
 */
export class OverleafAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'OverleafAPIError';
  }
}
