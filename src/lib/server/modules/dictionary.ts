// src/lib/server/modules/dictionary.ts
import fs from 'fs/promises';
import path from 'path';
import { capitalizeFirst } from './utils';
import { VIETNAMESE_CHARACTERS } from './config';

/**
 * Applies text corrections using a dictionary.
 * Preserves capitalization (e.g., "Apple" → "Táo" if "apple": "táo").
 */
export function applyCorrections(
	text: string,
	dictionary: Record<string, string>,
	pageNumber: number
): { correctedText: string; report: Map<string, { corrected: string; pages: Set<number> }> } {
	let correctedText = text;
	const report = new Map<string, { corrected: string; pages: Set<number> }>();

	for (const wrong in dictionary) {
		const correct = dictionary[wrong];

		// Escape regex special characters
		const escapedWrong = wrong.replace(/[.*+?^${}()|[\\]/g, '\\$&');

		// Check if the "wrong" word contains non-word characters.
		// If it does, we treat it as a literal pattern and don't use word boundaries.
		// The character set includes Vietnamese characters.
		const isComplexPattern = new RegExp(`[^${VIETNAMESE_CHARACTERS}]`).test(wrong);

		// Use word boundaries only for simple words, not for complex patterns.
		const regex = isComplexPattern
			? new RegExp(escapedWrong, 'gi')
			: new RegExp(`\\b${escapedWrong}\\b`, 'gi');

		let matchOccurred = false;
		correctedText = correctedText.replace(regex, (match) => {
			matchOccurred = true;

			// Capitalize if original matched word starts with an uppercase letter
			if (new RegExp(`[${VIETNAMESE_CHARACTERS.toUpperCase()}]`).test(match[0])) {
				return capitalizeFirst(correct);
			}
			return correct;
		});

		if (matchOccurred) {
			const reportEntry = report.get(wrong) || { corrected: correct, pages: new Set<number>() };
			reportEntry.pages.add(pageNumber);
			report.set(wrong, reportEntry);
		}
	}

	return { correctedText, report };
}

/**
 * Loads correction dictionary from file
 */
export async function loadCorrectionDictionary(): Promise<{
	dictionary: { [key: string]: string };
	loaded: boolean;
}> {
	try {
		const dictionaryPath = path.join(process.cwd(), 'src/lib/server/replace-dict.json');
		const dictionaryContent = await fs.readFile(dictionaryPath, 'utf-8');
		const dictionary = JSON.parse(dictionaryContent);
		return { dictionary, loaded: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.warn(`Correction dictionary not loaded: ${message}`);
		return { dictionary: {}, loaded: false };
	}
}

/**
 * Loads Vietnamese dictionary for word validation
 */
export async function loadVietnameseDictionary(): Promise<{
	dictionary: Set<string>;
	loaded: boolean;
}> {
	try {
		const dictPath = path.join(process.cwd(), 'src/lib/server/viet-dict.txt');
		const dictContent = await fs.readFile(dictPath, 'utf-8');
		const dictionary = new Set(dictContent.split('\n').map((word) => word.trim().toLowerCase()));
		return { dictionary, loaded: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.warn(`Vietnamese dictionary not loaded: ${message}`);
		return { dictionary: new Set(), loaded: false };
	}
}

/**
 * Loads ignore words from file
 */
export async function loadIgnoreWords(): Promise<Set<string>> {
	try {
		const ignoreWordsPath = path.join(process.cwd(), 'src/lib/server/ignore-dict.json');
		const ignoreWordsContent = await fs.readFile(ignoreWordsPath, 'utf-8');
		const ignoreWords = JSON.parse(ignoreWordsContent);
		return new Set(ignoreWords.map((word: string) => word.toLowerCase()));
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.warn(`Ignore words file not loaded: ${message}`);
		return new Set();
	}
}

/**
 * Loads English dictionary for word validation
 */
export async function loadEnglishDictionary(): Promise<{
	dictionary: Set<string>;
	loaded: boolean;
}> {
	try {
		const dictPath = path.join(process.cwd(), 'src/lib/server/eng-dict.txt');
		const dictContent = await fs.readFile(dictPath, 'utf-8');
		const dictionary = new Set(dictContent.split('\n').map((word) => word.trim().toLowerCase()));
		return { dictionary, loaded: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.warn(`English dictionary not loaded: ${message}`);
		return { dictionary: new Set(), loaded: false };
	}
}

/**
 * Finds abnormal words in text
 */
export async function findAbnormalWords(
	text: string,
	predefinedDict: Set<string>,
	englishDict: Set<string>,
	pageNumber: number,
	abnormalWords: Map<string, Set<number>>
): Promise<void> {
	if (predefinedDict.size === 0) return;

	const ignoreWords = await loadIgnoreWords();
	const words =
		text
			.normalize('NFC')
			.toLowerCase()
			.match(new RegExp(`[${VIETNAMESE_CHARACTERS}a-zA-Z]+`, 'g')) || [];

	for (const word of words) {
		if (
			word.length > 1 &&
			!predefinedDict.has(word) &&
			!ignoreWords.has(word) &&
			!englishDict.has(word)
		) {
			if (!abnormalWords.has(word)) {
				abnormalWords.set(word, new Set<number>());
			}
			abnormalWords.get(word)?.add(pageNumber);
		}
	}
}
