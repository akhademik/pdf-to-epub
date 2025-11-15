// src/hooks.server.ts
import app from '$lib/server';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api')) {
    return await app.fetch(event.request);
  }

  return resolve(event);
};
