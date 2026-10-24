import { redirect } from 'next/navigation';
import { HttpError } from '../http';
import { requireUser } from './session';

export async function requirePageUser() {
  try { return await requireUser(); }
  catch (error: unknown) {
    if (error instanceof HttpError && error.failure.code === 'UNAUTHORIZED') redirect('/login');
    throw error;
  }
}
