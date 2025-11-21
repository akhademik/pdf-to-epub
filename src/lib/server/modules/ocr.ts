// src/lib/server/modules/ocr.ts
import fs from 'fs/promises';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { CONFIG } from './config';
import { applyCorrections } from './dictionary';

/**
 * Performs OCR with retry logic
 */
async function recognizeWithRetry(
	worker: Awaited<ReturnType<typeof createWorker>>,
	imagePath: string,
	maxRetries: number = CONFIG.MAX_OCR_RETRIES
): Promise<string> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const {
				data: { text }
			} = await worker.recognize(imagePath);
			return text;
		} catch (error) {
			if (i === maxRetries - 1) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, CONFIG.OCR_RETRY_DELAY * (i + 1)));
		}
	}
	throw new Error('OCR failed after retries');
}

/**
 * Performs OCR on all images
 */
export async function performOcr(
	imageDir: string,
	ocrDir: string,
	sendProgress: (msg: string) => void
): Promise<void> {
	await fs.mkdir(ocrDir, { recursive: true });

	const imageFiles = await fs.readdir(imageDir);
	const worker = await createWorker(CONFIG.OCR_LANGUAGE, undefined, {
		langPath: CONFIG.LANG_PATH
	});

	try {
		for (let i = 0; i < imageFiles.length; i++) {
			const imageFile = `page-${i + 1}.png`;
			const imagePath = path.join(imageDir, imageFile);
			const ocrPath = path.join(ocrDir, `page-${i + 1}.txt`);

			try {
				await fs.access(ocrPath);
				sendProgress(`OCR for page ${i + 1} already exists.`);
			} catch {
				const percentage = Math.round(((i + 1) / imageFiles.length) * 100);
				sendProgress(`OCR on page ${i + 1}/${imageFiles.length} (${percentage}%)...`);

				const text = await recognizeWithRetry(worker, imagePath);
				await fs.writeFile(ocrPath, text);
			}
		}
	} finally {
		await worker.terminate();
	}
}

/**
 * Applies corrections to all OCR text files.
 */
export async function applyCorrectionsToOcrFiles(
	sourceDir: string,
	destDir: string,
	correctionDict: { [key: string]: string },
	sendProgress: (msg: string) => void
): Promise<void> {
	if (Object.keys(correctionDict).length === 0) {
		sendProgress('No correction dictionary loaded, skipping correction step.');
		return;
	}

	await fs.mkdir(destDir, { recursive: true });
	sendProgress('Applying corrections to OCR files...');
	const ocrFiles = await fs.readdir(sourceDir);

	for (let i = 0; i < ocrFiles.length; i++) {
		const ocrFile = ocrFiles[i];
		const sourcePath = path.join(sourceDir, ocrFile);
		const destPath = path.join(destDir, ocrFile);
		const percentage = Math.round(((i + 1) / ocrFiles.length) * 100);
		sendProgress(`Correcting file ${i + 1}/${ocrFiles.length} (${percentage}%)...`);

		try {
			const text = await fs.readFile(sourcePath, 'utf-8');
			const correctedText = applyCorrections(text, correctionDict);
			await fs.writeFile(destPath, correctedText);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			sendProgress(`Warning: Could not correct file ${ocrFile}: ${message}`);
		}
	}
	sendProgress('Correction of OCR files complete.');
}
