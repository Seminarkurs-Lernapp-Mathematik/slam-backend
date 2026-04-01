// src/teacher/classUtils.ts
import { fsGet } from '../utils/firestore';
import type { ClassDoc } from './types';

export async function getOwnedClass(
  projectId: string,
  accessToken: string,
  classId: string,
  teacherUid: string
): Promise<ClassDoc> {
  const doc = await fsGet(projectId, accessToken, `classes/${classId}`);
  if (!doc) throw Object.assign(new Error('Class not found'), { status: 404 });
  if (doc.teacherId !== teacherUid) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return doc as unknown as ClassDoc;
}
