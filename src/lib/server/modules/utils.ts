// src/lib/server/modules/utils.ts
import type { PageRange } from './types';

/**
 * Sanitizes XML special characters to prevent injection
 * @param text - Raw text that may contain XML special chars
 * @returns XML-safe string
 */
export function sanitizeXml(text: string): string {
	return text.replace(/[&<>"']/g, (match) => {
		switch (match) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			case "'":
				return '&apos;';
			default:
				return match;
		}
	});
}

/**
 * Validates that a hash string is a valid MD5 hash
 */
export function isValidHash(hash: string): boolean {
	return /^[a-f0-9]{32}$/i.test(hash);
}

/**
 * Validates page range format (e.g., "1-10")
 */
export function isValidPageRange(pages: string): boolean {
	return /^\d+-\d+$/.test(pages.trim());
}

/**
 * Parses page range string into start and end numbers
 */
export function parsePageRange(pages: string): PageRange | null {
	const parts = pages.trim().split('-').map(Number);
	if (parts.length !== 2 || parts.some(isNaN)) {
		return null;
	}
	return { start: parts[0], end: parts[1] };
}

/**
 * Capitalizes the first character of a string
 */
export function capitalizeFirst(str: string): string {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}
