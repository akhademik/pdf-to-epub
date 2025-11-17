// src/lib/server/index.ts
import { Hono } from 'hono';
import { pdf } from 'pdf-to-img';
import { createWorker } from 'tesseract.js';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = new Hono();

// Configuration
const CONFIG = {
	PDF_SCALE: 1.5,
	OCR_LANGUAGE: 'vie',
	MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
	TEMP_DIR: './tmp',
	LANG_PATH: '.',
	MAX_OCR_RETRIES: 3,
	OCR_RETRY_DELAY: 1000
} as const;

// Types
interface Chapter {
	title: string;
	pages: string;
}

interface PageRange {
	start: number;
	end: number;
}

/**
 * Sanitizes XML special characters to prevent injection
 * @param text - Raw text that may contain XML special chars
 * @returns XML-safe string
 */
function sanitizeXml(text: string): string {
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
function isValidHash(hash: string): boolean {
	return /^[a-f0-9]{32}$/i.test(hash);
}

/**
 * Validates page range format (e.g., "1-10")
 */
function isValidPageRange(pages: string): boolean {
	return /^\d+-\d+$/.test(pages.trim());
}

/**
 * Parses page range string into start and end numbers
 */
function parsePageRange(pages: string): PageRange | null {
	const parts = pages.trim().split('-').map(Number);
	if (parts.length !== 2 || parts.some(isNaN)) {
		return null;
	}
	return { start: parts[0], end: parts[1] };
}

/**
 * Validates Table of Contents format
 */
function validateToc(tocRaw: string): { valid: boolean; error?: string; chapters?: Chapter[] } {
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
 * Capitalizes the first character of a string
 */
function capitalizeFirst(str: string): string {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Applies corrections from dictionary to text, preserving capitalization
 * Example: "uớc" -> "ước", "Uớc" -> "Ước"
 */
/**
 * Applies text corrections using a dictionary.
 * Preserves capitalization (e.g., "Apple" → "Táo" if "apple": "táo").
 */
export function applyCorrections(text: string, dictionary: Record<string, string>): string {
	let correctedText = text;

	for (const wrong in dictionary) {
		const correct = dictionary[wrong];

		// Escape regex special characters
		const escapedWrong = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// Check if the "wrong" word contains non-word characters.
		// If it does, we treat it as a literal pattern and don't use word boundaries.
		// The character set includes Vietnamese characters.
		const isComplexPattern =
			/[^a-zA-Zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/.test(
				wrong
			);

		// Use word boundaries only for simple words, not for complex patterns.
		const regex = isComplexPattern
			? new RegExp(escapedWrong, 'gi')
			: new RegExp(`\\b${escapedWrong}\\b`, 'gi');

		correctedText = correctedText.replace(regex, (match) => {
			// Capitalize if original matched word starts with an uppercase letter
			if (/[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/.test(match[0])) {
				return capitalizeFirst(correct);
			}
			return correct;
		});
	}

	return correctedText;
}

/**
 * Loads correction dictionary from file
 */
async function loadCorrectionDictionary(): Promise<{
	dictionary: { [key: string]: string };
	loaded: boolean;
}> {
	try {
		const dictionaryPath = path.join(process.cwd(), 'src/lib/server/correction-dictionary.json');
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
async function loadVietnameseDictionary(): Promise<{ dictionary: Set<string>; loaded: boolean }> {
	try {
		const dictPath = path.join(process.cwd(), 'src/lib/server/vietnamese-dictionary.txt');
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
 * Converts PDF to images
 */
async function convertPdfToImages(
	pdfPath: string,
	outputDir: string,
	sendProgress: (msg: string) => void
): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true });

	const existingImages = await fs.readdir(outputDir);
	if (existingImages.length > 0) {
		sendProgress('Images already extracted.');
		return;
	}

	sendProgress('Converting PDF to images...');
	const doc = await pdf(pdfPath, { scale: CONFIG.PDF_SCALE });
	let i = 1;
	for await (const image of doc) {
		sendProgress(`Extracting page ${i}...`);
		const imagePath = path.join(outputDir, `page-${i}.png`);
		await fs.writeFile(imagePath, image);
		i++;
	}
}

/**
 * Performs OCR on all images
 */
async function performOcr(
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
async function applyCorrectionsToOcrFiles(
	ocrDir: string,
	correctionDict: { [key: string]: string },
	sendProgress: (msg: string) => void
): Promise<void> {
	if (Object.keys(correctionDict).length === 0) {
		sendProgress('No correction dictionary loaded, skipping correction step.');
		return;
	}

	sendProgress('Applying corrections to OCR files...');
	const ocrFiles = await fs.readdir(ocrDir);

	for (let i = 0; i < ocrFiles.length; i++) {
		const ocrFile = ocrFiles[i];
		const ocrPath = path.join(ocrDir, ocrFile);
		const percentage = Math.round(((i + 1) / ocrFiles.length) * 100);
		sendProgress(`Correcting file ${i + 1}/${ocrFiles.length} (${percentage}%)...`);

		try {
			const text = await fs.readFile(ocrPath, 'utf-8');
			const correctedText = applyCorrections(text, correctionDict);
			await fs.writeFile(ocrPath, correctedText);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			sendProgress(`Warning: Could not correct file ${ocrFile}: ${message}`);
		}
	}
	sendProgress('Correction of OCR files complete.');
}

/**
 * Generates final chapters with Introduction and Appendices if needed
 */
function generateFinalChapters(
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

/**
 * Finds abnormal words in text
 */
function findAbnormalWords(
	text: string,
	predefinedDict: Set<string>,
	pageNumber: number,
	abnormalWords: Map<string, Set<number>>
): void {
	if (predefinedDict.size === 0) return;

	const words =
		text
			.normalize('NFC')
			.toLowerCase()
			.match(/[a-zA-Zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]+/g) || [];

	for (const word of words) {
		if (word.length > 1 && !predefinedDict.has(word)) {
			if (!abnormalWords.has(word)) {
				abnormalWords.set(word, new Set<number>());
			}
			abnormalWords.get(word)?.add(pageNumber);
		}
	}
}

/**
 * Generates EPUB content
 */
async function generateEpub(
	chapters: Chapter[],
	ocrDir: string,
	pageOffset: number,
	totalPdfPages: number,
	vietnameseDict: Set<string>,
	bookTitle: string
): Promise<{ epub: Buffer; abnormalWords: Map<string, Set<number>> }> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

	// META-INF
	const metaInf = zip.folder('META-INF');
	if (!metaInf) throw new Error('Failed to create META-INF folder');
	metaInf.file(
		'container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
	);

	// OEBPS
	const oebps = zip.folder('OEBPS');
	if (!oebps) throw new Error('Failed to create OEBPS folder');
	const chaptersFolder = oebps.folder('chapters');
	if (!chaptersFolder) throw new Error('Failed to create chapters folder');

	const abnormalWords = new Map<string, Set<number>>();
	let opfManifest = '';
	let opfSpine = '';
	let tocNcx = '';
	let playOrder = 1;

	// Process chapters
	for (const chapter of chapters) {
		const range = parsePageRange(chapter.pages);
		if (!range) continue;

		let chapterContent = '';
		for (let j = range.start; j <= range.end; j++) {
			const imageIndex = j + pageOffset;
			if (imageIndex < 1 || imageIndex > totalPdfPages) continue;

			const ocrPath = path.join(ocrDir, `page-${imageIndex}.txt`);
			try {
				const text = await fs.readFile(ocrPath, 'utf-8');

				findAbnormalWords(text, vietnameseDict, j, abnormalWords);

				chapterContent += sanitizeXml(text).replace(/\n/g, '<br/>');
			} catch {
				// Ignore missing pages
			}
		}

		if (chapterContent.trim() === '') continue;

		const chapterFileName = `chapter-${playOrder}.html`;
		chaptersFolder.file(
			chapterFileName,
			`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${sanitizeXml(chapter.title)}</title>
</head>
<body>
  <h1>${sanitizeXml(chapter.title)}</h1>
  <p>${chapterContent}</p>
</body>
</html>`
		);

		opfManifest += `<item id="chapter-${playOrder}" href="chapters/${chapterFileName}" media-type="application/xhtml+xml"/>\n`;
		opfSpine += `<itemref idref="chapter-${playOrder}"/>\n`;
		tocNcx += `<navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
<navLabel><text>${sanitizeXml(chapter.title)}</text></navLabel>
<content src="chapters/${chapterFileName}"/>
</navPoint>\n`;
		playOrder++;
	}

	// content.opf
	oebps.file(
		'content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${sanitizeXml(bookTitle)}</dc:title>
    <dc:creator opf:role="aut">pdf-to-epub</dc:creator>
    <dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:language>vi</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${opfManifest}
  </manifest>
  <spine toc="ncx">
    ${opfSpine}
  </spine>
</package>`
	);

	// toc.ncx
	oebps.file(
		'toc.ncx',
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${crypto.randomUUID()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${sanitizeXml(bookTitle)}</text>
  </docTitle>
  <navMap>
    ${tocNcx}
  </navMap>
</ncx>`
	);

	const epubContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
	return { epub: epubContent, abnormalWords };
}

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
