import { DomainError } from '../errors';

/** Limits for files attached to messages. */
export const MSG_FILE_LIMITS = { count: 5, fileBytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 };

/** Allowed types → file extension. Images, PDF, Office documents and plain text; nothing executable. */
export const MSG_FILE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(MSG_FILE_TYPES).map(([m, e]) => [e, m]));
BY_EXT.jpeg = 'image/jpeg';
export const MSG_FILE_ACCEPT = Object.keys(BY_EXT).map(e => '.' + e).join(',') + ',image/*';
export const INLINE_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type IncomingFile = { name: string; type: string; data: Buffer };

/** Checks type and size, and returns the normalised files (mime type from the extension when the browser sends none). */
export function validateMessageFiles(files: IncomingFile[]): (IncomingFile & { ext: string })[] {
  const list = files.filter(f => f.data.length > 0);
  if (list.length > MSG_FILE_LIMITS.count) throw new DomainError('files', `Du kan legge ved maks ${MSG_FILE_LIMITS.count} filer per melding.`);
  let total = 0;
  return list.map(f => {
    const extFromName = (f.name.split('.').pop() ?? '').toLowerCase();
    const type = MSG_FILE_TYPES[f.type] ? f.type : BY_EXT[extFromName];
    if (!type) throw new DomainError('files', `«${f.name}» kan ikke legges ved. Tillatt: bilder, PDF, Word, Excel og tekstfiler.`);
    if (f.data.length > MSG_FILE_LIMITS.fileBytes) throw new DomainError('files', `«${f.name}» er for stor (maks 10 MB per fil).`);
    total += f.data.length;
    if (total > MSG_FILE_LIMITS.totalBytes) throw new DomainError('files', 'Vedleggene blir til sammen for store (maks 20 MB per melding).');
    return { name: f.name.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'fil', type, data: f.data, ext: MSG_FILE_TYPES[type] };
  });
}

export function fileSizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
