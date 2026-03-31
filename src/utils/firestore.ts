/**
 * Thin helpers for Firestore REST API.
 * Converts between plain JS objects and Firestore wire format.
 */

type FsRawValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FsRawValue[] } }
  | { mapValue: { fields?: Record<string, FsRawValue> } };

type FsFields = Record<string, FsRawValue>;

const fsBase = (projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

/** Read a single document. Returns null on 404. */
export async function fsGet(
  projectId: string,
  token: string,
  path: string
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status}`);
  return fromFsDoc(await res.json() as { fields?: FsFields; name?: string });
}

/** Write (full replace) a document at the given path. */
export async function fsPatch(
  projectId: string,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFsFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed: ${res.status}`);
  return fromFsDoc(await res.json() as { fields?: FsFields; name?: string });
}

/** Delete a document. */
export async function fsDelete(
  projectId: string,
  token: string,
  path: string
): Promise<void> {
  const res = await fetch(`${fsBase(projectId)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore DELETE ${path} failed: ${res.status}`);
}

/**
 * Run a structured query.
 * @param parent - path relative to /documents, e.g. '' for top-level, 'users/uid123' for subcollection
 * @param query  - Firestore structuredQuery object (without the outer { structuredQuery: } wrapper)
 */
export async function fsQuery(
  projectId: string,
  token: string,
  parent: string,
  query: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const parentPath = parent
    ? `projects/${projectId}/databases/(default)/documents/${parent}`
    : `projects/${projectId}/databases/(default)/documents`;

  const res = await fetch(`${parentPath}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery: query }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const rows = await res.json() as Array<{ document?: { fields?: FsFields; name?: string } }>;
  return rows.filter((r) => r.document).map((r) => fromFsDoc(r.document!));
}

// --- Serialization ---

export function toFsFields(obj: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFsValue(v);
  }
  return out;
}

export function toFsValue(v: unknown): FsRawValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFsValue) } };
  }
  if (typeof v === 'object') {
    return { mapValue: { fields: toFsFields(v as Record<string, unknown>) } };
  }
  return { stringValue: String(v) };
}

export function fromFsDoc(doc: { fields?: FsFields; name?: string }): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (doc.name) result.id = doc.name.split('/').pop()!;
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    result[k] = fromFsValue(v);
  }
  return result;
}

export function fromFsValue(v: FsRawValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFsValue);
  if ('mapValue' in v) return fromFsDoc({ fields: v.mapValue.fields });
  return null;
}
