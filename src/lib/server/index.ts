// src/lib/server/index.ts
import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = new Hono();

import { CONFIG } from './modules/config';
import type { Chapter } from './modules/types';
import { isValidHash } from './modules/utils';
import { validateToc, generateFinalChapters } from './modules/toc';
import { loadCorrectionDictionary, loadVietnameseDictionary } from './modules/dictionary';
import { performOcr, applyCorrectionsToOcrFiles } from './modules/ocr';
import { convertPdfToImages } from './modules/pdf';
import { generateEpub } from './modules/epub';

app.get('/api', (c) => {
	return c.text('Hono server is running!');
});

app.post('/api/convert', async (c) => {
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	const sendProgress = (message: string) => {
		writer.write(encoder.encode(`data: ${message}\n\n`));
	};

	const processPdf = async () => {
		let tempDir = '';
		try {
			const formData = await c.req.formData();
			const pdfFile = formData.get('pdf');
			const tocRaw = formData.get('toc');
			const pageCorrectionRaw = formData.get('pageCorrection');

			// Validate PDF file
			if (!pdfFile || !(pdfFile instanceof File)) {
				sendProgress('Error: No PDF file uploaded.');
				writer.close();
				return;
			}

			// Check file size
			if (pdfFile.size > CONFIG.MAX_FILE_SIZE) {
				sendProgress(
					`Error: File too large. Maximum size is ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB.`
				);
				writer.close();
				return;
			}

			// Validate and parse page correction
			let pageOffset = 0;
			if (pageCorrectionRaw && (pageCorrectionRaw as string).trim() !== '') {
				const [bookPage, pdfPage] = (pageCorrectionRaw as string).split('=').map(Number);
				if (isNaN(bookPage) || isNaN(pdfPage)) {
					sendProgress('Error: Invalid page correction format. Please use book_page=pdf_page.');
					writer.close();
					return;
				}
				pageOffset = pdfPage - bookPage;
			} else {
				sendProgress('No page correction provided, assuming 1:1 page mapping.');
			}

			// Validate and parse TOC
			let userChapters: Chapter[] = [];
			if (tocRaw && (tocRaw as string).trim() !== '') {
				const validation = validateToc(tocRaw as string);
				if (!validation.valid) {
					sendProgress(`Error: ${validation.error}`);
					writer.close();
					return;
				}
				userChapters = validation.chapters!;
			} else {
				sendProgress('No Table of Contents provided, treating book as a single chapter.');
			}

			// Create temp directory
			const hash = crypto.createHash('md5').update(pdfFile.name).digest('hex');
			tempDir = path.join(process.cwd(), CONFIG.TEMP_DIR, `pdf-to-epub-${hash}`);
			await fs.mkdir(tempDir, { recursive: true });

			const pdfPath = path.join(tempDir, pdfFile.name);

			// Save PDF if not exists
			try {
				await fs.access(pdfPath);
				sendProgress('PDF already exists, skipping upload.');
			} catch {
				sendProgress('Uploading PDF...');
				await fs.writeFile(pdfPath, Buffer.from(await pdfFile.arrayBuffer()));
			}

			// Convert PDF to images
			const imageOutputDir = path.join(tempDir, 'images');
			await convertPdfToImages(pdfPath, imageOutputDir, sendProgress);

			// Perform OCR
			const ocrOutputDir = path.join(tempDir, 'ocr');
			await performOcr(imageOutputDir, ocrOutputDir, sendProgress);

			// Load dictionaries
			const { dictionary: correctionDict, loaded: correctionLoaded } =
				await loadCorrectionDictionary();
			if (correctionLoaded) {
				sendProgress('Correction dictionary loaded.');
			} else {
				sendProgress('Correction dictionary not found, skipping correction.');
			}

			// Apply corrections to OCR files
			await applyCorrectionsToOcrFiles(ocrOutputDir, correctionDict, sendProgress);

			const { dictionary: vietnameseDict, loaded: vietnameseLoaded } =
				await loadVietnameseDictionary();
			if (vietnameseLoaded) {
				sendProgress('Vietnamese dictionary loaded for error checking.');
			} else {
				sendProgress('Vietnamese dictionary not found, skipping abnormal word check.');
			}

			// Calculate page ranges
			const ocrFiles = await fs.readdir(ocrOutputDir);
			const totalPdfPages = ocrFiles.length;
			const bookEndPage = totalPdfPages - pageOffset;
			const bookStartPage = 1 - pageOffset;

			// Generate final chapters
			const bookTitle = pdfFile.name.replace('.pdf', '');
			const finalChapters = generateFinalChapters(
				userChapters,
				bookStartPage,
				bookEndPage,
				bookTitle
			);

			// Generate EPUB
			sendProgress('Generating EPUB...');
			const { epub, abnormalWords } = await generateEpub(
				finalChapters,
				ocrOutputDir,
				pageOffset,
				totalPdfPages,
				vietnameseDict,
				bookTitle
			);

			// Save EPUB
			const epubFilename = `${bookTitle}.epub`;
			const epubPath = path.join(tempDir, epubFilename);
			await fs.writeFile(epubPath, epub);

			// Save abnormal words
			if (abnormalWords.size > 0) {
				const abnormalWordsPath = path.join(tempDir, 'abnormal-words.txt');
				const formattedAbnormalWords = Array.from(abnormalWords.entries())
					.sort(([wordA], [wordB]) => wordA.localeCompare(wordB))
					.map(
						([word, pages]) =>
							`${word}: ${Array.from(pages)
								.sort((a, b) => a - b)
								.join(', ')}`
					);
				await fs.writeFile(abnormalWordsPath, formattedAbnormalWords.join('\n'));
				sendProgress(
					`Found ${abnormalWords.size} potential OCR errors. See abnormal-words.txt in the temp folder.`
				);
			}

			const downloadUrl = `/api/download/${hash}/${epubFilename}`;
			sendProgress(`download:${downloadUrl}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error('Error during conversion:', error);
			sendProgress(`Error: An error occurred during conversion: ${message}`);
		} finally {
			writer.close();
		}
	};

	processPdf();

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
});

app.get('/api/download/:hash/:filename', async (c) => {
	const { hash, filename } = c.req.param();

	// Validate hash
	if (!isValidHash(hash)) {
		return c.text('Invalid hash format.', 400);
	}

	// Sanitize filename
	const safeFilename = path.basename(filename);

	const tempDir = path.join(process.cwd(), CONFIG.TEMP_DIR, `pdf-to-epub-${hash}`);
	const filePath = path.join(tempDir, safeFilename);

	try {
		await fs.access(filePath);
		const fileBuffer = await fs.readFile(filePath);

		return new Response(fileBuffer, {
			headers: {
				'Content-Type': 'application/epub+zip',
				'Content-Disposition': `attachment; filename="${safeFilename}"`,
				'Cache-Control': 'public, max-age=3600'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('Download error:', message);
		return c.text('File not found or access denied.', 404);
	}
});

export type AppType = typeof app;

export default app;
