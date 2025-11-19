// src/lib/server/modules/epub.ts
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { Chapter } from './types';
import { parsePageRange, sanitizeXml } from './utils';
import { findAbnormalWords } from './dictionary';

/**
 * Formats raw text into HTML paragraphs.
 * @param text - The raw text from OCR.
 * @returns An HTML string with paragraphs.
 */
function formatTextAsHtml(text: string): string {
	const lines = text.split('\n');
	const paragraphs: string[] = [];
	let currentParagraph: string[] = [];

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine === '') {
			if (currentParagraph.length > 0) {
				paragraphs.push(`<p>${currentParagraph.join(' ')}</p>`);
				currentParagraph = [];
			}
		} else {
			currentParagraph.push(sanitizeXml(trimmedLine));
		}
	}

	if (currentParagraph.length > 0) {
		paragraphs.push(`<p>${currentParagraph.join(' ')}</p>`);
	}

	return paragraphs.join('\n');
}

/**
 * Generates EPUB content
 */
export async function generateEpub(
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

	const cssContent = await fs.readFile(
		path.join(process.cwd(), 'src/lib/server/epub-style.css'),
		'utf-8'
	);
	oebps.file('style.css', cssContent);

	const abnormalWords = new Map<string, Set<number>>();
	let opfManifest = '<item id="css" href="style.css" media-type="text/css"/>';
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

				await findAbnormalWords(text, vietnameseDict, j, abnormalWords);

				chapterContent += formatTextAsHtml(text);
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
  <link rel="stylesheet" type="text/css" href="../style.css" />
</head>
<body>
  <h2>${sanitizeXml(chapter.title)}</h2>
  ${chapterContent}
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
