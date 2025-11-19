// src/lib/server/modules/toc.ts
import type { Chapter } from './types';
import { isValidPageRange } from './utils';

/**
 * Validates Table of Contents format
 */
export function validateToc(tocRaw: string): {
	valid: boolean;
	error?: string;
	chapters?: Chapter[];
} {
	const tocLines = tocRaw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const chapters: Chapter[] = [];

	for (const line of tocLines) {
		const parts = line.split(':');
		if (parts.length !== 2) {
			return {
				valid: false,
				error: `Invalid TOC line: "${line}". Expected format: "Chapter Title: 1-10"`
			};
		}

		const [title, pages] = parts;
		const trimmedTitle = title.trim();
		const trimmedPages = pages.trim();

		if (!trimmedTitle) {
			return { valid: false, error: `Empty chapter title in line: "${line}"` };
		}

		if (!isValidPageRange(trimmedPages)) {
			return {
				valid: false,
				error: `Invalid page range: "${trimmedPages}". Expected format: "1-10"`
			};
		}

		chapters.push({ title: trimmedTitle, pages: trimmedPages });
	}

	return { valid: true, chapters };
}

/**
 * Generates final chapters with Introduction and Appendices if needed
 */
export function generateFinalChapters(
	userChapters: Chapter[],
	bookStartPage: number,
	bookEndPage: number,
	defaultTitle: string
): Chapter[] {
	const finalChapters: Chapter[] = [];

	if (userChapters.length === 0) {
		// No TOC provided, create one big chapter
		return [
			{
				title: defaultTitle,
				pages: `${bookStartPage}-${bookEndPage}`
			}
		];
	}

	// Sort user chapters by start page
	const sortedChapters = [...userChapters].sort((a, b) => {
		const startA = parseInt(a.pages.split('-')[0], 10);
		const startB = parseInt(b.pages.split('-')[0], 10);
		return startA - startB;
	});

	// Parse first and last chapter pages
	const firstPageParts = sortedChapters[0].pages.split('-');
	const firstChapterStartBookPage = parseInt(firstPageParts[0], 10);

	const lastPageParts = sortedChapters[sortedChapters.length - 1].pages.split('-');
	const lastChapterEndBookPage = parseInt(lastPageParts[lastPageParts.length - 1], 10);

	// Add Introduction if needed
	if (firstChapterStartBookPage > bookStartPage) {
		finalChapters.push({
			title: 'Introduction',
			pages: `${bookStartPage}-${firstChapterStartBookPage - 1}`
		});
	}

	// Add user chapters
	finalChapters.push(...sortedChapters);

	// Add Appendices if needed
	if (lastChapterEndBookPage < bookEndPage) {
		finalChapters.push({
			title: 'Appendices',
			pages: `${lastChapterEndBookPage + 1}-${bookEndPage}`
		});
	}

	return finalChapters;
}
